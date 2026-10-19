import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeState, createFakeSupabase, fakeResponse, type FakeState } from "./helpers/fakeSupabase";

// Staff endpoints for collection sorting:
//   /api/admin/sorting-requests/:id — status (with customer emails), notes,
//     counted cards, return tracking, the itemized quote draft, sending it,
//     and payments taken in person;
//   /api/admin/sorting-options — the per-1,000-card rates.
// An approved total can't be exceeded or changed from here.

beforeAll(() => {
  process.env.SUPABASE_URL = "https://x.invalid";
  process.env.SUPABASE_SECRET_KEY = "svc";
});

let state: FakeState = createFakeState();
vi.mock("../api/_lib/supabaseAdmin.js", () => ({ getSupabaseAdmin: () => createFakeSupabase(state) }));

const mail = vi.hoisted(() => ({
  status: [] as { id: string; status: string; message: string | null }[],
  quotes: [] as string[],
  receipts: [] as string[],
}));
vi.mock("../api/_lib/sortingEmails.js", () => ({
  isNotifiableSortingStatus: (s: string) => ["awaiting_cards", "received", "ready", "returned", "cancelled"].includes(s),
  sendSortingStatusUpdate: async (id: string, status: string, message: string | null) => {
    mail.status.push({ id, status, message });
    return { status: "sent" };
  },
  sendSortingQuote: async (quoteId: string) => {
    mail.quotes.push(quoteId);
    return { status: "sent" };
  },
  sendSortingPaymentReceipt: async (paymentId: string) => {
    mail.receipts.push(paymentId);
    return { status: "sent" };
  },
}));

const { default: requestHandler } = await import("../api/admin/sorting-requests/[id].ts");
const { default: optionsHandler } = await import("../api/admin/sorting-options.ts");

const STAFF = "staff-token";
const CUSTOMER = "customer-token";
const REQ = "11111111-1111-4111-8111-111111111111";
const OTHER_REQ = "22222222-2222-4222-8222-222222222222";

function requestRow(overrides: Record<string, unknown> = {}) {
  return {
    id: REQ,
    reference_number: "GG-SR-1001",
    first_name: "Ann",
    last_name: "Lee",
    email: "ann@example.com",
    delivery_method: "ship",
    status: "received",
    accepted_quote_id: null,
    amount_paid_cents: 0,
    counted_cards: null,
    internal_notes: null,
    return_carrier: null,
    return_tracking_number: null,
    ...overrides,
  };
}

const ITEMS = {
  sortingServiceCents: 6400,
  returnShippingCents: 1850,
  returnPackagingCents: 400,
  otherCharges: [{ label: "Rush", amountCents: 500 }],
};

beforeEach(() => {
  state = createFakeState();
  mail.status = [];
  mail.quotes = [];
  mail.receipts = [];
  state.sessions[STAFF] = { id: "staff-1", email: "jacob@example.com", app_metadata: { role: "staff" } };
  state.sessions[CUSTOMER] = { id: "cust-1", email: "c@example.com", app_metadata: { role: "customer" } };
  state.tables.sorting_requests = [requestRow(), requestRow({ id: OTHER_REQ, reference_number: "GG-SR-1002" })];
  state.tables.sorting_quotes = [];
  state.tables.sorting_payments = [];
  state.tables.admin_audit_log = [];
  state.unique.sorting_quotes = [{ columns: ["request_id"], where: (row) => row.status === "draft" }];
  // The real trigger totals a draft; the fake has to do it on read below.
  state.rpc.sorting_send_quote = ({ p_quote_id, p_actor }) => {
    const q = state.tables.sorting_quotes.find((x) => x.id === p_quote_id)!;
    if (q.status !== "draft") return { data: null, error: { code: "GGS02", message: "This quote was already sent." } };
    for (const other of state.tables.sorting_quotes) {
      if (other.request_id === q.request_id && other.status === "sent") other.status = "superseded";
    }
    Object.assign(q, { status: "sent", sent_at: "2026-10-18T12:00:00Z", sent_by: p_actor });
    const r = state.tables.sorting_requests.find((x) => x.id === q.request_id)!;
    if (["new", "awaiting_cards", "received"].includes(r.status as string)) r.status = "quoted";
    return { data: { ...q }, error: null };
  };
  state.rpc.sorting_record_payment = ({ p_request_id, p_amount_cents, p_method, p_note, p_actor }) => {
    const r = state.tables.sorting_requests.find((x) => x.id === p_request_id)!;
    const id = `pay-${state.tables.sorting_payments.length + 1}`;
    state.tables.sorting_payments.push({ id, request_id: p_request_id, amount_cents: p_amount_cents, method: p_method, note: p_note ?? null, recorded_by: p_actor });
    r.amount_paid_cents = (r.amount_paid_cents as number) + (p_amount_cents as number);
    return { data: { payment_id: id, inserted: true, amount_paid_cents: r.amount_paid_cents }, error: null };
  };
});

async function call(method: string, body: Record<string, unknown> = {}, opts: { id?: string; token?: string | null } = {}) {
  const res = fakeResponse();
  const token = opts.token === undefined ? STAFF : opts.token;
  await requestHandler(
    {
      method,
      headers: token ? { authorization: `Bearer ${token}` } : {},
      query: { id: opts.id ?? REQ },
      body,
    } as never,
    res as never,
  );
  return res as typeof res & { body: Record<string, any> };
}

const req = () => state.tables.sorting_requests.find((r) => r.id === REQ) as Record<string, unknown>;
const audit = () => state.tables.admin_audit_log as Record<string, unknown>[];

describe("staff only", () => {
  it("refuses guests and customers", async () => {
    expect((await call("PATCH", { status: "sorting" }, { token: null })).statusCode).toBe(401);
    expect((await call("PATCH", { status: "sorting" }, { token: CUSTOMER })).statusCode).toBe(403);
    expect(req().status).toBe("received");
  });
});

describe("PATCH a request", () => {
  it("moves the status and emails the customer, with staff's message", async () => {
    const res = await call("PATCH", { status: "awaiting_cards", customerMessage: "  Ship by Friday please  " });
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ ok: true, emailed: true });
    expect(req().status).toBe("awaiting_cards");
    expect(mail.status).toEqual([{ id: REQ, status: "awaiting_cards", message: "Ship by Friday please" }]);
  });

  it("doesn't email for steps the customer isn't waiting on", async () => {
    await call("PATCH", { status: "sorting" });
    expect(req().status).toBe("sorting");
    expect(mail.status).toHaveLength(0);
  });

  it("leaves Quote sent and Quote approved to the quote", async () => {
    expect((await call("PATCH", { status: "quoted" })).statusCode).toBe(400);
    expect((await call("PATCH", { status: "approved" })).statusCode).toBe(400);
    expect(req().status).toBe("received");
  });

  it("only marks a request returned once its approved total is paid", async () => {
    expect((await call("PATCH", { status: "returned" })).statusCode).toBe(409);
    state.tables.sorting_quotes = [{ id: "q1", request_id: REQ, version: 1, status: "accepted", total_cents: 8650 }];
    Object.assign(req(), { accepted_quote_id: "q1", amount_paid_cents: 5000 });
    const owing = await call("PATCH", { status: "returned" });
    expect(owing.statusCode).toBe(409);
    expect(owing.body.message).toMatch(/\$36\.50/);
    req().amount_paid_cents = 8650;
    expect((await call("PATCH", { status: "returned" })).statusCode).toBe(200);
    expect(req().status).toBe("returned");
  });

  it("saves notes, the count and return tracking", async () => {
    const res = await call("PATCH", {
      internalNotes: "Two binders, one box",
      countedCards: 3200,
      returnCarrier: " USPS ",
      returnTrackingNumber: "9400 1000",
    });
    expect(res.statusCode).toBe(200);
    expect(req()).toMatchObject({
      internal_notes: "Two binders, one box",
      counted_cards: 3200,
      return_carrier: "USPS",
      return_tracking_number: "9400 1000",
    });
    expect((await call("PATCH", { countedCards: -1 })).statusCode).toBe(400);
    expect((await call("PATCH", { countedCards: 1.5 })).statusCode).toBe(400);
  });
});

describe("the quote", () => {
  it("creates one draft and updates it, checking the items", async () => {
    const first = await call("POST", { action: "save-quote", items: ITEMS, countedCards: 3200, noteToCustomer: " Counted twice " });
    expect(first.statusCode).toBe(200);
    expect(state.tables.sorting_quotes).toHaveLength(1);
    expect(state.tables.sorting_quotes[0]).toMatchObject({
      request_id: REQ,
      version: 1,
      counted_cards: 3200,
      sorting_service_cents: 6400,
      return_shipping_cents: 1850,
      return_packaging_cents: 400,
      other_charges: [{ label: "Rush", amountCents: 500 }],
      note_to_customer: "Counted twice",
      created_by: "staff-1",
    });

    state.tables.sorting_quotes[0].status = "draft";
    await call("POST", { action: "save-quote", items: { ...ITEMS, returnShippingCents: 2000 } });
    expect(state.tables.sorting_quotes).toHaveLength(1);
    expect(state.tables.sorting_quotes[0].return_shipping_cents).toBe(2000);

    const bad = await call("POST", { action: "save-quote", items: { ...ITEMS, returnShippingCents: -5 } });
    expect(bad.statusCode).toBe(400);
  });

  it("sends the draft, emails it and logs who sent it", async () => {
    await call("POST", { action: "save-quote", items: ITEMS });
    const draft = state.tables.sorting_quotes[0];
    draft.status = "draft";
    const res = await call("POST", { action: "send-quote", quoteId: draft.id });
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ ok: true, emailed: true });
    expect(draft).toMatchObject({ status: "sent", sent_by: "staff-1" });
    expect(req().status).toBe("quoted");
    expect(mail.quotes).toEqual([draft.id]);
    expect(audit()).toEqual([
      expect.objectContaining({ action: "sorting.quote_sent", resource_type: "sorting_request", resource_id: REQ, actor_id: "staff-1" }),
    ]);
  });

  it("starts a new version once the last one was sent", async () => {
    state.tables.sorting_quotes = [{ id: "q1", request_id: REQ, version: 1, status: "sent" }];
    await call("POST", { action: "save-quote", items: ITEMS });
    expect(state.tables.sorting_quotes.map((q) => q.version)).toEqual([1, 2]);
  });

  it("won't send another request's quote, or remove a sent one", async () => {
    state.tables.sorting_quotes = [
      { id: "33333333-3333-4333-8333-333333333333", request_id: OTHER_REQ, version: 1, status: "draft" },
      { id: "44444444-4444-4444-8444-444444444444", request_id: REQ, version: 1, status: "sent" },
    ];
    expect((await call("POST", { action: "send-quote", quoteId: "33333333-3333-4333-8333-333333333333" })).statusCode).toBe(404);
    expect((await call("POST", { action: "discard-draft", quoteId: "44444444-4444-4444-8444-444444444444" })).statusCode).toBe(409);
    expect(state.tables.sorting_quotes).toHaveLength(2);
  });

  it("removes an unsent draft", async () => {
    state.tables.sorting_quotes = [{ id: "55555555-5555-4555-8555-555555555555", request_id: REQ, version: 1, status: "draft" }];
    expect((await call("POST", { action: "discard-draft", quoteId: "55555555-5555-4555-8555-555555555555" })).statusCode).toBe(200);
    expect(state.tables.sorting_quotes).toHaveLength(0);
  });
});

describe("payments taken in person", () => {
  beforeEach(() => {
    state.tables.sorting_quotes = [{ id: "q1", request_id: REQ, version: 1, status: "accepted", total_cents: 8650 }];
  });

  it("need an approved quote", async () => {
    const res = await call("POST", { action: "record-payment", amountCents: 1000, method: "cash" });
    expect(res.statusCode).toBe(409);
  });

  it("can't go past the approved total", async () => {
    Object.assign(req(), { accepted_quote_id: "q1", amount_paid_cents: 8000 });
    const res = await call("POST", { action: "record-payment", amountCents: 1000, method: "cash" });
    expect(res.statusCode).toBe(400);
    expect(res.body.message).toMatch(/\$6\.50/);
    expect(state.tables.sorting_payments).toHaveLength(0);
  });

  it("are recorded with a receipt and an audit entry", async () => {
    req().accepted_quote_id = "q1";
    const res = await call("POST", { action: "record-payment", amountCents: 8650, method: "in_store_card", note: " Square " });
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ amountPaidCents: 8650, emailed: true });
    expect(state.tables.sorting_payments[0]).toMatchObject({ amount_cents: 8650, method: "in_store_card", note: "Square", recorded_by: "staff-1" });
    expect(mail.receipts).toEqual(["pay-1"]);
    expect(audit()[0]).toMatchObject({ action: "sorting.payment_recorded" });
  });

  it("only take the in-person methods", async () => {
    req().accepted_quote_id = "q1";
    expect((await call("POST", { action: "record-payment", amountCents: 100, method: "card_online" })).statusCode).toBe(400);
    expect((await call("POST", { action: "record-payment", amountCents: 0, method: "cash" })).statusCode).toBe(400);
  });
});

describe("rates", () => {
  async function options(method: string, body: Record<string, unknown> = {}, query: Record<string, string> = {}, token = STAFF) {
    const res = fakeResponse();
    await optionsHandler({ method, headers: { authorization: `Bearer ${token}` }, query, body } as never, res as never);
    return res as typeof res & { body: Record<string, any> };
  }

  beforeEach(() => {
    state.tables.sorting_service_options = [];
  });

  it("adds a rate, checking it", async () => {
    expect((await options("POST", { name: "Sort by set", ratePerThousandCents: 0 })).statusCode).toBe(400);
    expect((await options("POST", { name: "  ", ratePerThousandCents: 2500 })).statusCode).toBe(400);
    const res = await options("POST", { name: " Sort by set ", description: "By set and number", ratePerThousandCents: 2500 });
    expect(res.statusCode).toBe(200);
    expect(state.tables.sorting_service_options[0]).toMatchObject({
      name: "Sort by set",
      description: "By set and number",
      rate_per_thousand_cents: 2500,
      updated_by: "staff-1",
    });
    expect(audit()[0]).toMatchObject({ action: "sorting.option_created" });
  });

  it("hides, edits and removes a rate, logging each change", async () => {
    await options("POST", { name: "Sort by set", ratePerThousandCents: 2500 });
    const id = state.tables.sorting_service_options[0].id as string;
    state.tables.sorting_service_options[0].active = true;
    await options("PATCH", { active: false }, { id });
    expect(state.tables.sorting_service_options[0].active).toBe(false);
    await options("PATCH", { ratePerThousandCents: 3000 }, { id });
    expect(state.tables.sorting_service_options[0].rate_per_thousand_cents).toBe(3000);
    expect((await options("DELETE", {}, { id })).statusCode).toBe(204);
    expect(state.tables.sorting_service_options).toHaveLength(0);
    expect(audit().map((a) => a.action)).toEqual([
      "sorting.option_created",
      "sorting.option_updated",
      "sorting.option_updated",
      "sorting.option_deleted",
    ]);
  });

  it("is staff only", async () => {
    expect((await options("POST", { name: "x", ratePerThousandCents: 100 }, {}, CUSTOMER)).statusCode).toBe(403);
  });
});
