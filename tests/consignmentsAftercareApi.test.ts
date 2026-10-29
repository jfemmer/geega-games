import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeState, createFakeSupabase, fakeResponse, type FakeState } from "./helpers/fakeSupabase";

// After the sale, over the API: staff hold sales, record insurance and
// claims and move returns along; money-moving steps (adjustments, closing a
// claim, closing a consignment) are the owner's; consignors can ask for their
// own cards back and download their own statements, and nobody else's.

beforeAll(() => {
  process.env.SUPABASE_URL = "https://x.invalid";
  process.env.SUPABASE_SECRET_KEY = "svc";
});

let state: FakeState = createFakeState();
vi.mock("../api/_lib/supabaseAdmin.js", () => ({ getSupabaseAdmin: () => createFakeSupabase(state) }));

const { default: admin } = await import("../api/admin/consignments.ts");
const { default: consignor } = await import("../api/consignments.ts");
const { buildStatementPdf, loadStatement } = await import("../api/_lib/consignmentStatement.ts");

const OWNER = "owner-token";
const STAFF = "staff-token";
const PAT = "pat-token";
const EVE = "eve-token";
const C1 = "11111111-1111-4111-8111-111111111111";
const SALE = "22222222-2222-4222-8222-222222222222";
const ORDER = "33333333-3333-4333-8333-333333333333";
const CLAIM = "44444444-4444-4444-8444-444444444444";
const LOT = "55555555-5555-4555-8555-555555555555";
const PAYOUT = "66666666-6666-4666-8666-666666666666";
const RET = "77777777-7777-4777-8777-777777777777";

let calls: Record<string, Record<string, unknown>[]>;
const stub = (name: string, data: unknown = null, error: { code: string; message: string } | null = null) => {
  state.rpc[name] = (args) => {
    (calls[name] ??= []).push(args);
    return { data: error ? null : data, error };
  };
};

async function call(handler: typeof admin, token: string, method: "GET" | "POST", body?: Record<string, unknown>, query: Record<string, string> = {}) {
  const res = fakeResponse();
  await handler({ method, headers: { authorization: `Bearer ${token}`, "x-forwarded-for": "203.0.113.9" }, query, body } as never, res as never);
  return res as typeof res & { body: Record<string, unknown> & { message?: string } };
}
const staff = (body: Record<string, unknown>, token = STAFF) => call(admin, token, "POST", body);

beforeEach(() => {
  state = createFakeState();
  calls = {};
  state.sessions[OWNER] = { id: "owner-1", email: "jacob@example.com", app_metadata: { role: "admin" } };
  state.sessions[STAFF] = { id: "staff-1", email: "helper@example.com", app_metadata: { role: "staff" } };
  state.sessions[PAT] = { id: "pat-1", email: "pat@x.com", app_metadata: {} };
  state.sessions[EVE] = { id: "eve-1", email: "eve@x.com", app_metadata: {} };
  state.tables.admin_audit_log = [];
  state.tables.consignments = [{ id: C1, consignment_number: 1001, consignor_id: "p1" }];
  state.tables.consignors = [{ id: "p1", legal_name: "Pat Consignor", email: "pat@x.com", user_id: "pat-1" }];
  state.tables.consignment_payouts = [
    { id: PAYOUT, consignment_id: C1, amount_cents: 17041, method: "paypal", reference: "PP-1", paid_at: "2026-10-30T17:00:00Z", voided_at: null, void_reason: null },
  ];
  state.tables.consignment_sales = [
    {
      id: SALE, consignment_id: C1, lot_id: LOT, payout_id: PAYOUT, channel: "website", sold_at: "2026-10-20T12:00:00Z", delivered_at: "2026-10-26T20:00:00Z",
      quantity: 1, unit_price_cents: 20000, gross_cents: 20000, marketplace_fee_cents: 0, processing_fee_cents: 610, postage_cents: 0, insurance_cents: 455,
      other_expense_cents: 0, other_expense_note: null, net_sale_cents: 18935, commission_rate_bps: 1000, commission_cents: 1894, payout_cents: 17041,
    },
  ];
  state.tables.consignment_adjustments = [];
  state.tables.consignment_lots = [{ id: LOT, card_name: "Jace, the Mind Sculptor", set_code: "wwk", collector_number: "31" }];
});

describe("staff steps", () => {
  it("hold a sale with a reason the consignor will see, and audit it", async () => {
    stub("consignment_open_hold", "h1");
    expect((await staff({ action: "openHold", saleId: SALE, source: "buyer_report", reason: " " })).statusCode).toBe(400);
    expect((await staff({ action: "openHold", saleId: SALE, source: "gossip", reason: "Bent corner" })).statusCode).toBe(400);
    const res = await staff({ action: "openHold", saleId: SALE, source: "buyer_report", reason: "Buyer says the corner is bent" });
    expect(res.statusCode).toBe(200);
    expect(calls.consignment_open_hold[0]).toMatchObject({ p_sale_id: SALE, p_source: "buyer_report", p_reason: "Buyer says the corner is bent", p_actor: "helper@example.com" });
    expect(state.tables.admin_audit_log).toHaveLength(1);
  });

  it("record insurance bought for a package", async () => {
    stub("consignment_record_insurance");
    const res = await staff({ action: "recordInsurance", orderId: ORDER, insuredValueCents: 20000, premiumCents: 455, source: "USPS counter" });
    expect(res.statusCode).toBe(200);
    expect(calls.consignment_record_insurance[0]).toMatchObject({ p_order_id: ORDER, p_insured_value_cents: 20000, p_premium_cents: 455 });
    expect((await staff({ action: "recordInsurance", orderId: ORDER, insuredValueCents: 20000 })).statusCode).toBe(400);
  });

  it("open and update a claim, and move a return along", async () => {
    stub("consignment_open_claim", CLAIM);
    stub("consignment_update_claim");
    stub("consignment_advance_return", "awaiting_shipping_payment");
    expect((await staff({ action: "openClaim", orderId: ORDER, kind: "stolen" })).statusCode).toBe(400);
    expect((await staff({ action: "openClaim", orderId: ORDER, kind: "lost" })).body).toEqual({ claimId: CLAIM });
    expect((await staff({ action: "updateClaim", claimId: CLAIM, status: "closed" })).statusCode).toBe(400);
    await staff({ action: "updateClaim", claimId: CLAIM, status: "filed", claimNumber: "CLM-9", customerRefundStatus: "refunded", reimbursementCents: 10000 });
    expect(calls.consignment_update_claim[0]).toMatchObject({ p_status: "filed", p_claim_number: "CLM-9", p_customer_refund_status: "refunded", p_reimbursement_cents: 10000 });
    const r = await staff({ action: "advanceReturn", returnId: RET, step: "quote", shippingCostCents: 595 });
    expect(r.body).toEqual({ status: "awaiting_shipping_payment" });
  });

  it("pass on the database's reasons", async () => {
    stub("consignment_approve_return", null, { code: "GC089", message: "Sol Ring has copies committed to a sale now." });
    const res = await staff({ action: "approveReturn", returnId: RET });
    expect(res.statusCode).toBe(400);
    expect(res.body.message).toMatch(/committed to a sale/);
    stub("consignment_close", null, { code: "GC090", message: "2 card(s) are still with us. Return or sell them first." });
    const closing = await staff({ action: "closeConsignment", consignmentId: C1 }, OWNER);
    expect(closing.statusCode).toBe(409);
  });
});

describe("owner-only steps", () => {
  it("adjustments, closing claims and closing consignments", async () => {
    stub("consignment_add_adjustment", "a1");
    stub("consignment_close_claim");
    stub("consignment_close");
    for (const body of [
      { action: "addAdjustment", consignmentId: C1, kind: "chargeback", amountCents: -2000, reason: "Chargeback after payout" },
      { action: "closeClaim", claimId: CLAIM, outcome: "our_responsibility", note: "Wrong address" },
      { action: "closeConsignment", consignmentId: C1 },
    ]) {
      expect((await staff(body)).statusCode).toBe(403);
    }
    expect(calls.consignment_add_adjustment).toBeUndefined();
    const ok = await staff({ action: "addAdjustment", consignmentId: C1, kind: "chargeback", amountCents: -2000, reason: "Chargeback after payout" }, OWNER);
    expect(ok.statusCode).toBe(200);
    expect(calls.consignment_add_adjustment[0]).toMatchObject({ p_kind: "chargeback", p_amount_cents: -2000, p_sale_id: null });
    expect((await staff({ action: "addAdjustment", consignmentId: C1, kind: "chargeback", amountCents: 0, reason: "Nothing" }, OWNER)).statusCode).toBe(400);
    expect((await staff({ action: "addAdjustment", consignmentId: C1, kind: "claim_payment", amountCents: 500, reason: "By hand" }, OWNER)).statusCode).toBe(400);
  });

  it("a carrier-loss close says what happened to each card", async () => {
    stub("consignment_close_claim");
    expect((await staff({ action: "closeClaim", claimId: CLAIM, outcome: "carrier_loss", note: "Paid in part" }, OWNER)).statusCode).toBe(400);
    const res = await staff({ action: "closeClaim", claimId: CLAIM, outcome: "carrier_loss", note: "Paid in part", allocations: [{ saleId: SALE, claimPaymentCents: 10000 }] }, OWNER);
    expect(res.statusCode).toBe(200);
    expect(calls.consignment_close_claim[0].p_allocations).toEqual([{ saleId: SALE, claimPaymentCents: 10000, returnedDamaged: false }]);
  });
});

describe("consignors", () => {
  it("can ask for their own cards back, and nobody else's", async () => {
    stub("consignment_request_return", RET);
    const mine = await call(consignor, PAT, "POST", { action: "requestReturn", consignmentId: C1, lines: null, endsConsignment: true });
    expect(mine.statusCode).toBe(200);
    expect(calls.consignment_request_return[0]).toMatchObject({ p_consignment_id: C1, p_lines: null, p_ends_consignment: true, p_requested_by: "consignor", p_actor: "pat@x.com" });
    const theirs = await call(consignor, EVE, "POST", { action: "requestReturn", consignmentId: C1, lines: null });
    expect(theirs.statusCode).toBe(404);
    expect(calls.consignment_request_return).toHaveLength(1);
  });

  it("download their own statements only", async () => {
    const mine = await call(consignor, PAT, "GET", undefined, { view: "statement", payout: PAYOUT });
    expect(mine.statusCode).toBe(200);
    expect(mine.headers["content-type"]).toBe("application/pdf");
    const theirs = await call(consignor, EVE, "GET", undefined, { view: "statement", payout: PAYOUT });
    expect(theirs.statusCode).toBe(404);
  });
});

describe("the statement", () => {
  it("lists every card's price, expenses, commission and proceeds, with the total paid", async () => {
    const data = await loadStatement(createFakeSupabase(state) as never, PAYOUT);
    expect(data.sales[0].card_name).toBe("Jace, the Mind Sculptor (WWK #31)");
    const pdf = await buildStatementPdf(data);
    expect(Buffer.from(pdf.slice(0, 5)).toString()).toBe("%PDF-");
    expect(pdf.length).toBeGreaterThan(1500);
  });
});
