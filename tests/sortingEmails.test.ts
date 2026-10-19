import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeState, createFakeSupabase, type FakeState } from "./helpers/fakeSupabase";
import { SORTING_NO_INBOUND_LABELS, SORTING_RETURN_POLICY } from "../src/store/lib/sortingService";
import { shipFromLines } from "../src/store/lib/shipFrom";

// What collection sorting customers (and staff) are told by email: the
// shipping policy on every request for a shipped collection, the itemized
// quote with return shipping and packaging as their own lines, where to ship,
// and receipts. Checked through the plain-text versions.

beforeAll(() => {
  process.env.SUPABASE_URL = "https://x.invalid";
  process.env.SUPABASE_SECRET_KEY = "svc";
  process.env.PUBLIC_SITE_URL = "https://geega-games.com";
  process.env.EMAIL_TOKEN_SECRET = "e".repeat(40);
  process.env.STRIPE_SECRET_KEY = "sk_test_x";
  process.env.SORTING_NOTIFICATION_EMAIL = "staff@example.com";
});

let state: FakeState = createFakeState();
vi.mock("../api/_lib/supabaseAdmin.js", () => ({ getSupabaseAdmin: () => createFakeSupabase(state) }));

type Sent = { emailType: string; idempotencyKey: string; to: string; subject: string; text: string; replyTo?: string };
const sent = vi.hoisted(() => ({ emails: [] as Sent[], pushes: [] as Record<string, unknown>[] }));
vi.mock("../api/_lib/emailService.js", () => ({
  sendTrackedEmail: async (args: Sent) => {
    sent.emails.push(args);
    return { status: "sent", resendEmailId: "re_1", deduped: false };
  },
}));
vi.mock("../api/_lib/staffPush.js", () => ({
  notifyStaff: async (event: Record<string, unknown>) => {
    sent.pushes.push(event);
    return { status: "sent", delivered: 1, failed: 0, removed: 0 };
  },
  shortName: (first: string, last: string) => `${first} ${last[0]}.`,
}));

const emails = await import("../api/_lib/sortingEmails.ts");

const REQ = "11111111-1111-4111-8111-111111111111";

function requestRow(overrides: Record<string, unknown> = {}) {
  return {
    id: REQ,
    reference_number: "GG-SR-1001",
    created_at: "2026-10-17T12:00:00Z",
    first_name: "Ann",
    last_name: "Lee",
    email: "ann@example.com",
    phone: null,
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
    customer_notes: null,
    status: "new",
    status_changed_at: "2026-10-17T12:00:00Z",
    accepted_quote_id: null,
    amount_paid_cents: 0,
    return_carrier: null,
    return_tracking_number: null,
    ...overrides,
  };
}

function quoteRow(id: string, status: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    request_id: REQ,
    version: 1,
    status,
    counted_cards: 3200,
    sorting_service_cents: 6400,
    return_shipping_cents: 1850,
    return_packaging_cents: 400,
    other_charges: [{ label: "Rush", amountCents: 500 }],
    total_cents: 9150,
    note_to_customer: "Counted twice to be sure.",
    sent_at: "2026-10-18T12:00:00Z",
    accepted_at: null,
    ...overrides,
  };
}

beforeEach(() => {
  state = createFakeState();
  sent.emails = [];
  sent.pushes = [];
  state.tables.sorting_requests = [requestRow()];
  state.tables.sorting_quotes = [];
  state.tables.sorting_payments = [];
});

const last = () => sent.emails[sent.emails.length - 1];

describe("request received", () => {
  it("gives a shipped collection the whole shipping policy", async () => {
    await emails.sendSortingRequestReceived(REQ);
    const email = last();
    expect(email).toMatchObject({
      to: "ann@example.com",
      subject: "We got your sorting request — GG-SR-1001",
      idempotencyKey: `sorting-request-received-${REQ}`,
    });
    expect(email.text).toContain("Please wait for that email before sending anything.");
    expect(email.text).toContain("Paying the full cost of shipping your collection to Geega Games.");
    expect(email.text).toContain(SORTING_NO_INBOUND_LABELS);
    for (const line of SORTING_RETURN_POLICY) expect(email.text).toContain(line);
    expect(email.text).toContain("Sorting estimate: $60.00");
    expect(email.text).toContain("doesn't include return shipping or packaging");
  });

  it("keeps a drop-off simple", async () => {
    state.tables.sorting_requests = [requestRow({ delivery_method: "drop_off" })];
    await emails.sendSortingRequestReceived(REQ);
    expect(last().text).toContain("drop off your cards in the St. Louis area");
    expect(last().text).not.toContain(SORTING_NO_INBOUND_LABELS);
  });
});

describe("the quote email", () => {
  it("itemizes return shipping and packaging, says they're in the total, and links to approve", async () => {
    state.tables.sorting_quotes = [quoteRow("q1", "sent")];
    await emails.sendSortingQuote("q1");
    const email = last();
    expect(email.subject).toBe("Your sorting quote — GG-SR-1001");
    expect(email.text).toContain("Sorting service (3,200 cards): $64.00");
    expect(email.text).toContain("Return shipping: $18.50");
    expect(email.text).toContain("Return packaging & supplies: $4.00");
    expect(email.text).toContain("Rush: $5.00");
    expect(email.text).toContain("Total: $91.50");
    expect(email.text).toContain("Return shipping and packaging are included in this total.");
    expect(email.text).toContain("Counted twice to be sure.");
    expect(email.text).toMatch(/collection-sorting\/quote\?ref=GG-SR-1001&email=ann%40example\.com&t=[\w-]{43}/);
  });

  it("says what a revision replaces", async () => {
    state.tables.sorting_quotes = [
      quoteRow("q1", "accepted", { total_cents: 8000, accepted_at: "2026-10-18T13:00:00Z" }),
      quoteRow("q2", "sent", { version: 2 }),
    ];
    state.tables.sorting_requests = [requestRow({ accepted_quote_id: "q1", status: "sorting" })];
    await emails.sendSortingQuote("q2");
    expect(last().subject).toBe("Your revised sorting quote — GG-SR-1001");
    expect(last().text).toContain("It replaces the $80.00 total you approved only if you approve this one.");
  });

  it("isn't sent for a draft", async () => {
    state.tables.sorting_quotes = [quoteRow("q1", "draft")];
    expect(await emails.sendSortingQuote("q1")).toMatchObject({ status: "skipped" });
    expect(sent.emails).toHaveLength(0);
  });
});

describe("status updates", () => {
  it("tell a shipping customer where to send their cards", async () => {
    state.tables.sorting_requests = [requestRow({ status: "awaiting_cards", status_changed_at: "2026-10-18T09:00:00Z" })];
    await emails.sendSortingStatusUpdate(REQ, "awaiting_cards", "Pack them tight, please.");
    const email = last();
    expect(email.subject).toBe("Ready for your cards — GG-SR-1001");
    for (const line of shipFromLines()) expect(email.text).toContain(line);
    expect(email.text).toContain("Pack them tight, please.");
    expect(email.idempotencyKey).toBe(`sorting-status-${REQ}-awaiting_cards-2026-10-18T09:00:00Z`);
  });

  it("aren't sent for a status the request isn't in", async () => {
    await emails.sendSortingStatusUpdate(REQ, "ready", null);
    expect(sent.emails).toHaveLength(0);
  });

  it("include tracking when the collection ships back", async () => {
    state.tables.sorting_requests = [
      requestRow({ status: "returned", return_carrier: "USPS", return_tracking_number: "9400111" }),
    ];
    await emails.sendSortingStatusUpdate(REQ, "returned", null);
    expect(last().text).toContain("Carrier: USPS");
    expect(last().text).toContain("Tracking number: 9400111");
  });
});

describe("receipts and staff alerts", () => {
  it("send a receipt with what's left to pay", async () => {
    state.tables.sorting_quotes = [quoteRow("q1", "accepted")];
    state.tables.sorting_requests = [requestRow({ accepted_quote_id: "q1", status: "approved", amount_paid_cents: 5000 })];
    state.tables.sorting_payments = [
      { id: "pay-1", request_id: REQ, amount_cents: 5000, method: "cash", created_at: "2026-10-18T15:00:00Z" },
    ];
    await emails.sendSortingPaymentReceipt("pay-1");
    const email = last();
    expect(email.subject).toBe("Payment received — GG-SR-1001");
    expect(email.text).toContain("Amount paid: $50.00");
    expect(email.text).toContain("Paid by: Cash");
    expect(email.text).toContain("Approved total: $91.50");
    expect(email.text).toContain("Balance: $41.50");
  });

  it("push and email staff about a new request", async () => {
    await emails.notifySortingStaff(REQ, { kind: "new_request" });
    expect(sent.pushes[0]).toMatchObject({
      kind: "sorting_request",
      key: `sorting_request:${REQ}`,
      title: "Sorting request · Ann L.",
      url: `https://geega-games.com/admin_dashboard/sorting?request=${REQ}`,
    });
    expect(last()).toMatchObject({ to: "staff@example.com", replyTo: "ann@example.com" });
    expect(last().subject).toBe("New collection sorting request — GG-SR-1001");
  });
});
