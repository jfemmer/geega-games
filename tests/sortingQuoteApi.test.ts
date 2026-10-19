import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeState, createFakeSupabase, fakeResponse, type FakeState } from "./helpers/fakeSupabase";

// POST /api/sorting-quote — the customer's quote page: look up a request,
// approve or decline the quote waiting on them, and pay the balance by card.
// Looking needs the reference number and email; acting also needs the quote
// email's token (or the signed-in owner). What's charged is always the
// approved total minus what's been paid, from the database.

beforeAll(() => {
  process.env.SUPABASE_URL = "https://x.invalid";
  process.env.SUPABASE_SECRET_KEY = "svc";
  process.env.EMAIL_TOKEN_SECRET = "t".repeat(40);
  process.env.PUBLIC_SITE_URL = "https://geega-games.com";
  process.env.STRIPE_SECRET_KEY = "sk_test_x";
});

let state: FakeState = createFakeState();
vi.mock("../api/_lib/supabaseAdmin.js", () => ({ getSupabaseAdmin: () => createFakeSupabase(state) }));

const mail = vi.hoisted(() => ({
  approved: [] as string[],
  receipts: [] as string[],
  staff: [] as { kind: string; reason?: string | null }[],
}));
vi.mock("../api/_lib/sortingEmails.js", () => ({
  sendSortingQuoteApproved: async (quoteId: string) => {
    mail.approved.push(quoteId);
    return { status: "sent" };
  },
  sendSortingPaymentReceipt: async (paymentId: string) => {
    mail.receipts.push(paymentId);
    return { status: "sent" };
  },
  notifySortingStaff: async (_id: string, event: { kind: string; reason?: string | null }) => {
    mail.staff.push({ kind: event.kind, reason: event.reason });
  },
}));

type Intent = {
  id: string;
  amount: number;
  amount_received: number;
  status: string;
  client_secret: string;
  metadata: Record<string, string>;
};
const stripe = vi.hoisted(() => ({
  intents: {} as Record<string, Intent>,
  created: [] as Record<string, unknown>[],
  cancelled: [] as string[],
  counter: 0,
}));
vi.mock("../api/_lib/stripe.js", () => ({
  getStripe: () => ({
    paymentIntents: {
      create: async (params: Record<string, unknown>) => {
        stripe.counter++;
        const intent: Intent = {
          id: `pi_test${stripe.counter}`,
          amount: params.amount as number,
          amount_received: 0,
          status: "requires_payment_method",
          client_secret: `pi_test${stripe.counter}_secret`,
          metadata: params.metadata as Record<string, string>,
        };
        stripe.created.push(params);
        stripe.intents[intent.id] = intent;
        return intent;
      },
      retrieve: async (id: string) => {
        const intent = stripe.intents[id];
        if (!intent) throw new Error("No such payment_intent");
        return intent;
      },
      cancel: async (id: string) => {
        stripe.cancelled.push(id);
        stripe.intents[id] = { ...stripe.intents[id], status: "canceled" };
        return stripe.intents[id];
      },
    },
  }),
}));

const { default: handler } = await import("../api/sorting-quote.ts");
const { signGuestToken } = await import("../api/_lib/guestAccess.ts");

const REQ = "11111111-1111-4111-8111-111111111111";
const OTHER_REQ = "99999999-9999-4999-8999-999999999999";
const Q1 = "22222222-2222-4222-8222-222222222222";
const Q2 = "33333333-3333-4333-8333-333333333333";
const OWNER_TOKEN = "owner-session";
let ip = 0;

function request(overrides: Record<string, unknown> = {}) {
  return {
    id: REQ,
    reference_number: "GG-SR-1001",
    created_at: "2026-10-17T12:00:00Z",
    user_id: "member-1",
    first_name: "Ann",
    last_name: "Lee",
    email: "ann@example.com",
    option_name: "Sort by set",
    rate_per_thousand_cents: 2000,
    estimated_cards: 3000,
    estimated_sorting_cents: 6000,
    delivery_method: "ship",
    return_recipient: "Ann Lee",
    return_line1: "1 Main St",
    return_city: "Ballwin",
    return_state: "MO",
    return_postal_code: "63011",
    status: "quoted",
    accepted_quote_id: null,
    amount_paid_cents: 0,
    stripe_payment_intent_id: null,
    return_carrier: null,
    return_tracking_number: null,
    internal_notes: "secret staff note",
    ...overrides,
  };
}

function quote(id: string, version: number, status: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    request_id: REQ,
    version,
    status,
    counted_cards: 3200,
    sorting_service_cents: 6400,
    return_shipping_cents: 1850,
    return_packaging_cents: 400,
    other_charges: [],
    total_cents: 8650,
    note_to_customer: null,
    sent_at: "2026-10-18T12:00:00Z",
    accepted_at: null,
    declined_at: null,
    ...overrides,
  };
}

const req = () => state.tables.sorting_requests.find((r) => r.id === REQ) as Record<string, unknown>;
const quoteRow = (id: string) => state.tables.sorting_quotes.find((q) => q.id === id) as Record<string, unknown>;

beforeEach(() => {
  state = createFakeState();
  mail.approved = [];
  mail.receipts = [];
  mail.staff = [];
  stripe.intents = {};
  stripe.created = [];
  stripe.cancelled = [];
  process.env.STRIPE_SECRET_KEY = "sk_test_x";
  state.tables.sorting_requests = [request(), request({ id: OTHER_REQ, reference_number: "GG-SR-1002", email: "bo@example.com" })];
  state.tables.sorting_quotes = [quote(Q1, 1, "sent")];
  state.tables.sorting_payments = [];
  state.sessions[OWNER_TOKEN] = { id: "member-1", email: "ann@example.com", app_metadata: {} };

  // Stand-ins for the database functions (the real ones are in the migration).
  state.rpc.sorting_accept_quote = ({ p_request_id, p_quote_id }) => {
    const q = state.tables.sorting_quotes.find((x) => x.id === p_quote_id && x.request_id === p_request_id);
    if (!q) return { data: null, error: { code: "GGS03", message: "Quote not found." } };
    if (q.status === "accepted") return { data: { already: true, total_cents: q.total_cents }, error: null };
    if (q.status !== "sent") return { data: null, error: { code: "GGS02", message: "This quote is no longer open." } };
    const r = state.tables.sorting_requests.find((x) => x.id === p_request_id)!;
    const previous = r.accepted_quote_id as string | null;
    if (previous) Object.assign(state.tables.sorting_quotes.find((x) => x.id === previous)!, { status: "superseded" });
    Object.assign(q, { status: "accepted", accepted_at: "2026-10-18T13:00:00Z" });
    Object.assign(r, { accepted_quote_id: q.id, status: r.status === "quoted" ? "approved" : r.status });
    return { data: { already: false, total_cents: q.total_cents, previous_quote_id: previous }, error: null };
  };
  state.rpc.sorting_decline_quote = ({ p_request_id, p_quote_id, p_reason }) => {
    const q = state.tables.sorting_quotes.find((x) => x.id === p_quote_id && x.request_id === p_request_id);
    if (!q) return { data: null, error: { code: "GGS03", message: "Quote not found." } };
    if (q.status === "declined") return { data: { already: true }, error: null };
    if (q.status !== "sent") return { data: null, error: { code: "GGS02", message: "This quote is no longer open." } };
    Object.assign(q, { status: "declined", declined_at: "2026-10-18T13:00:00Z", decline_reason: p_reason ?? null });
    return { data: { already: false }, error: null };
  };
  state.rpc.sorting_record_payment = ({ p_request_id, p_amount_cents, p_method, p_reference }) => {
    const r = state.tables.sorting_requests.find((x) => x.id === p_request_id)!;
    if (!r.accepted_quote_id) return { data: null, error: { code: "GGS04", message: "There's no approved quote to pay yet." } };
    const existing = state.tables.sorting_payments.find((p) => p.provider_reference === p_reference);
    if (existing) return { data: { payment_id: existing.id, inserted: false, amount_paid_cents: r.amount_paid_cents }, error: null };
    const id = `pay-${state.tables.sorting_payments.length + 1}`;
    state.tables.sorting_payments.push({ id, request_id: p_request_id, amount_cents: p_amount_cents, method: p_method, provider_reference: p_reference });
    r.amount_paid_cents = (r.amount_paid_cents as number) + (p_amount_cents as number);
    return { data: { payment_id: id, inserted: true, amount_paid_cents: r.amount_paid_cents }, error: null };
  };
});

async function call(body: Record<string, unknown>, opts: { token?: boolean; session?: string } = {}) {
  ip++;
  const res = fakeResponse();
  await handler(
    {
      method: "POST",
      headers: { "x-forwarded-for": `10.1.0.${ip}`, ...(opts.session ? { authorization: `Bearer ${opts.session}` } : {}) },
      body: {
        referenceNumber: "gg-sr-1001",
        email: "Ann@Example.com",
        ...(opts.token ? { token: signGuestToken("sorting", REQ) } : {}),
        ...body,
      },
    } as never,
    res as never,
  );
  return res as typeof res & { body: Record<string, any> };
}

describe("looking up a request", () => {
  it("shows the itemized quote with the reference number and email, and nothing staff-only", async () => {
    const res = await call({ action: "lookup" });
    expect(res.statusCode).toBe(200);
    const view = res.body.request;
    expect(view).toMatchObject({
      referenceNumber: "GG-SR-1001",
      status: "quoted",
      statusLabel: "Quote ready for your approval",
      returnTo: "Ballwin, MO 63011",
      canRespond: false,
      payOnline: true,
      balanceDueCents: 0,
    });
    expect(view.openQuote.lines.map((l: { label: string; amountCents: number }) => [l.label, l.amountCents])).toEqual([
      ["Sorting service (3,200 cards)", 6400],
      ["Return shipping", 1850],
      ["Return packaging & supplies", 400],
    ]);
    expect(view.openQuote.totalCents).toBe(8650);
    expect(JSON.stringify(res.body)).not.toContain("secret staff note");
    expect(JSON.stringify(res.body)).not.toContain("1 Main St");
  });

  it("looks the same for a wrong email as for no request at all", async () => {
    const wrong = await call({ action: "lookup", email: "bo@example.com" });
    const missing = await call({ action: "lookup", referenceNumber: "GG-SR-9999" });
    expect(wrong.statusCode).toBe(404);
    expect(missing.statusCode).toBe(404);
    expect(wrong.body.message).toBe(missing.body.message);
  });

  it("lets the quote link's token, or the signed-in owner, respond", async () => {
    expect((await call({ action: "lookup" }, { token: true })).body.request.canRespond).toBe(true);
    expect((await call({ action: "lookup" }, { session: OWNER_TOKEN })).body.request.canRespond).toBe(true);
    expect((await call({ action: "lookup", token: "made-up-token-made-up-token-made-up-token123" })).body.request.canRespond).toBe(false);
  });
});

describe("approving and declining", () => {
  it("needs the token or the owner's session", async () => {
    const res = await call({ action: "approve", quoteId: Q1 });
    expect(res.statusCode).toBe(403);
    expect(quoteRow(Q1).status).toBe("sent");
  });

  it("approves the quote waiting on them, once", async () => {
    const res = await call({ action: "approve", quoteId: Q1 }, { token: true });
    expect(res.statusCode).toBe(200);
    expect(res.body.request.acceptedQuote).toMatchObject({ id: Q1, totalCents: 8650, status: "accepted" });
    expect(res.body.request.openQuote).toBeNull();
    expect(res.body.request.balanceDueCents).toBe(8650);
    expect(req().status).toBe("approved");
    expect(mail.approved).toEqual([Q1]);
    expect(mail.staff).toEqual([{ kind: "quote_approved", reason: undefined }]);

    await call({ action: "approve", quoteId: Q1 }, { token: true });
    expect(mail.approved).toHaveLength(1);
  });

  it("lets the signed-in owner approve without the link", async () => {
    expect((await call({ action: "approve", quoteId: Q1 }, { session: OWNER_TOKEN })).statusCode).toBe(200);
  });

  it("won't approve a quote that was replaced", async () => {
    state.tables.sorting_quotes = [quote(Q1, 1, "superseded"), quote(Q2, 2, "sent", { total_cents: 9000 })];
    const res = await call({ action: "approve", quoteId: Q1 }, { token: true });
    expect(res.statusCode).toBe(409);
  });

  it("records a decline with the customer's reason and tells staff", async () => {
    const res = await call({ action: "decline", quoteId: Q1, reason: "  Too much for me  " }, { token: true });
    expect(res.statusCode).toBe(200);
    expect(quoteRow(Q1)).toMatchObject({ status: "declined", decline_reason: "Too much for me" });
    expect(mail.staff).toEqual([{ kind: "quote_declined", reason: "Too much for me" }]);
    expect(res.body.request.latestQuote.status).toBe("declined");
  });
});

describe("paying by card", () => {
  beforeEach(() => {
    state.tables.sorting_quotes = [quote(Q1, 1, "accepted")];
    Object.assign(req(), { accepted_quote_id: Q1, status: "approved", amount_paid_cents: 1650 });
  });

  it("asks Stripe for exactly the balance due on the approved total, cards only", async () => {
    const res = await call({ action: "pay", amountCents: 1 /* ignored */ }, { token: true });
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ clientSecret: `pi_test${stripe.counter}_secret`, amountDueCents: 7000 });
    expect(stripe.created[0]).toMatchObject({
      amount: 7000,
      currency: "usd",
      payment_method_types: ["card"],
      receipt_email: "ann@example.com",
      metadata: { kind: "sorting", sorting_request_id: REQ, sorting_quote_id: Q1, reference_number: "GG-SR-1001" },
    });
    expect(req().stripe_payment_intent_id).toBe(`pi_test${stripe.counter}`);
  });

  it("reuses an open payment for the same amount instead of starting another", async () => {
    await call({ action: "pay" }, { token: true });
    const again = await call({ action: "pay" }, { token: true });
    expect(stripe.created).toHaveLength(1);
    expect(again.body.clientSecret).toBe(`pi_test${stripe.counter}_secret`);
  });

  it("retires a payment that no longer matches the balance", async () => {
    await call({ action: "pay" }, { token: true });
    const stale = req().stripe_payment_intent_id as string;
    req().amount_paid_cents = 5000; // paid in person meanwhile
    const res = await call({ action: "pay" }, { token: true });
    expect(stripe.cancelled).toEqual([stale]);
    expect(res.body.amountDueCents).toBe(3650);
  });

  it("records a successful payment once, with a receipt, whoever reports it first", async () => {
    await call({ action: "pay" }, { token: true });
    const intentId = req().stripe_payment_intent_id as string;
    Object.assign(stripe.intents[intentId], { status: "succeeded", amount_received: 7000 });

    const res = await call({ action: "confirm-payment", paymentIntentId: intentId }, { token: true });
    expect(res.statusCode).toBe(200);
    expect(res.body.paymentStatus).toBe("succeeded");
    expect(res.body.request.balanceDueCents).toBe(0);
    expect(state.tables.sorting_payments).toEqual([
      { id: "pay-1", request_id: REQ, amount_cents: 7000, method: "card_online", provider_reference: intentId },
    ]);
    expect(mail.receipts).toEqual(["pay-1"]);
    expect(mail.staff.map((s) => s.kind)).toEqual(["payment"]);

    await call({ action: "confirm-payment", paymentIntentId: intentId }, { token: true });
    expect(state.tables.sorting_payments).toHaveLength(1);
    expect(mail.receipts).toHaveLength(1);
  });

  it("says it's paid instead of charging again", async () => {
    req().amount_paid_cents = 8650;
    const res = await call({ action: "pay" }, { token: true });
    expect(res.body).toMatchObject({ ok: true, paid: true });
    expect(stripe.created).toHaveLength(0);
  });

  it("won't confirm another request's payment", async () => {
    stripe.intents.pi_other = {
      id: "pi_other",
      amount: 500,
      amount_received: 500,
      status: "succeeded",
      client_secret: "x",
      metadata: { sorting_request_id: OTHER_REQ },
    };
    const res = await call({ action: "confirm-payment", paymentIntentId: "pi_other" }, { token: true });
    expect(res.statusCode).toBe(400);
    expect(state.tables.sorting_payments).toHaveLength(0);
  });

  it("needs an approved quote, and card payments set up", async () => {
    Object.assign(req(), { accepted_quote_id: null });
    expect((await call({ action: "pay" }, { token: true })).statusCode).toBe(409);
    delete process.env.STRIPE_SECRET_KEY;
    expect((await call({ action: "pay" }, { token: true })).statusCode).toBe(503);
  });
});
