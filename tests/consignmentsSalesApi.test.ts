import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeState, createFakeSupabase, fakeResponse, type FakeState } from "./helpers/fakeSupabase";

// /api/admin/consignments selling actions: input is checked before the
// database sees it, the database's refusals reach staff word for word, every
// change is audited, payouts are for the owner, and a website sale's proposed
// expenses come from its order: processing on what the buyer was charged and
// postage less the buyer's shipping, each split across the order's cards by
// price (agreement 4.3-4.5). (The bookkeeping itself is tested in
// tests/consignmentSalesDb.test.ts.)

beforeAll(() => {
  process.env.SUPABASE_URL = "https://x.invalid";
  process.env.SUPABASE_SECRET_KEY = "svc";
});

let state: FakeState = createFakeState();
vi.mock("../api/_lib/supabaseAdmin.js", () => ({ getSupabaseAdmin: () => createFakeSupabase(state) }));

const { default: handler } = await import("../api/admin/consignments.ts");

const OWNER = "owner-token";
const STAFF = "staff-token";
const LOT = "11111111-1111-4111-8111-111111111111";
const SALE = "22222222-2222-4222-8222-222222222222";
const ORDER = "33333333-3333-4333-8333-333333333333";
const ITEM_A = "44444444-4444-4444-8444-444444444441";
const ITEM_B = "44444444-4444-4444-8444-444444444442";
const CONSIGNMENT = "55555555-5555-4555-8555-555555555555";
const TIERS = [{ maxPriceCents: 15000, rateBps: 2000 }, { maxPriceCents: null, rateBps: 1000 }];

async function call(token: string, method: "GET" | "POST", body?: Record<string, unknown>, query: Record<string, string> = {}) {
  const res = fakeResponse();
  await handler({ method, headers: { authorization: `Bearer ${token}` }, query, body } as never, res as never);
  return res as typeof res & { body: Record<string, unknown> & { message?: string } };
}

let calls: Record<string, Record<string, unknown>[]>;
const stub = (name: string, data: unknown, error: { code: string; message: string } | null = null) => {
  state.rpc[name] = (args) => {
    (calls[name] ??= []).push(args);
    return { data: error ? null : data, error };
  };
};

beforeEach(() => {
  state = createFakeState();
  calls = {};
  state.sessions[OWNER] = { id: "owner-1", email: "jacob@example.com", app_metadata: { role: "admin" } };
  state.sessions[STAFF] = { id: "staff-1", email: "helper@example.com", app_metadata: { role: "staff" } };
  state.tables.admin_audit_log = [];
  state.tables.consignment_sales = [
    {
      id: SALE,
      consignment_id: CONSIGNMENT,
      lot_id: LOT,
      channel: "website",
      order_id: ORDER,
      order_item_id: ITEM_A,
      quantity: 1,
      unit_price_cents: 22500,
      gross_cents: 22500,
      sold_at: "2026-10-20T12:00:00Z",
      status: "open",
      commission_tiers: TIERS,
      marketplace_fee_cents: null,
      processing_fee_cents: null,
      postage_cents: null,
    },
  ];
  state.tables.orders = [
    { id: ORDER, amount_due_cents: 30000, shipping_cents: 0, postage_cost_cents: 900, payment_provider: "stripe", shipping_method: "tracked", tracking_number: "9400" },
  ];
  state.tables.order_items = [
    { id: ITEM_A, order_id: ORDER, line_total_cents: 22500 },
    { id: ITEM_B, order_id: ORDER, line_total_cents: 7500 },
  ];
  state.tables.consignment_fee_schedules = [
    { channel: "website", effective_from: "2026-10-01T00:00:00Z", marketplace_bps: 0, processing_bps: 290, processing_fixed_cents: 30 },
    { channel: "website", effective_from: "2026-11-01T00:00:00Z", marketplace_bps: 0, processing_bps: 500, processing_fixed_cents: 99 },
  ];
  state.tables.consignment_insurance_schedules = [
    {
      effective_from: "2026-10-04T00:00:00Z",
      included_coverage_cents: 10000,
      brackets: [{ maxValueCents: 10000, premiumCents: 0 }, { maxValueCents: 20000, premiumCents: 430 }, { maxValueCents: 30000, premiumCents: 560 }],
      step_cents: 10000,
      step_premium_cents: 135,
      max_insurable_cents: 500000,
    },
  ];
  stub("consignment_current_elections", { channels: { website: true }, additionalInsurance: false });
  state.tables.consignment_shipments = [];
});

describe("listing", () => {
  it("lists copies at a price and audits it", async () => {
    stub("consignment_list_lot", "inv-1");
    const res = await call(STAFF, "POST", { action: "listLot", lotId: LOT, quantity: 2, priceCents: 22500 });
    expect(res.statusCode).toBe(200);
    expect(calls.consignment_list_lot[0]).toEqual({ p_lot_id: LOT, p_quantity: 2, p_price_cents: 22500, p_actor: "helper@example.com" });
    expect(state.tables.admin_audit_log).toHaveLength(1);
  });

  it("checks the numbers first, and passes on the database's reasons", async () => {
    stub("consignment_list_lot", null, { code: "GC060", message: "The consignor didn't approve website sales. Sell on a channel they approved and record the sale." });
    expect((await call(STAFF, "POST", { action: "listLot", lotId: LOT, quantity: 0 })).statusCode).toBe(400);
    expect((await call(STAFF, "POST", { action: "listLot", lotId: LOT, quantity: 1, priceCents: 12.5 })).statusCode).toBe(400);
    const res = await call(STAFF, "POST", { action: "listLot", lotId: LOT, quantity: 1 });
    expect(res.statusCode).toBe(400);
    expect(res.body.message).toMatch(/didn't approve website sales/);
  });
});

describe("marketplace sales", () => {
  it("only takes TCGplayer or eBay, with the order number and date", async () => {
    stub("consignment_record_external_sale", "sale-9");
    expect((await call(STAFF, "POST", { action: "recordExternalSale", lotId: LOT, channel: "website", quantity: 1, unitPriceCents: 500, soldAt: "2026-10-20" })).statusCode).toBe(400);
    expect((await call(STAFF, "POST", { action: "recordExternalSale", lotId: LOT, channel: "ebay", quantity: 1, unitPriceCents: 500 })).statusCode).toBe(400);
    const res = await call(STAFF, "POST", {
      action: "recordExternalSale",
      lotId: LOT,
      channel: "ebay",
      quantity: 1,
      unitPriceCents: 20000,
      soldAt: "2026-10-20T12:00:00Z",
      externalRef: " EB-77 ",
      marketplaceFeeCents: 2650,
      postageCents: 600,
    });
    expect(res.statusCode).toBe(200);
    expect(calls.consignment_record_external_sale[0]).toMatchObject({ p_channel: "ebay", p_external_ref: "EB-77", p_marketplace_fee_cents: 2650, p_processing_fee_cents: 0, p_postage_cents: 600 });
  });
});

describe("settling", () => {
  it("proposes a website sale's expenses from its order, split by price", async () => {
    const res = await call(STAFF, "GET", undefined, { view: "settlement", sale: SALE });
    expect(res.statusCode).toBe(200);
    // Processing under the rates in effect when it sold: 2.90% of $300.00 + $0.30 = $9.00,
    // and this $225 card's share of the $300 order is $6.75.
    // Postage: $9.00 label, buyer paid $0 → $9.00; its share $6.75.
    expect(res.body.expenses).toEqual({ marketplaceFeeCents: 0, processingFeeCents: 675, postageCents: 675, insuranceCents: 0, otherExpenseCents: 0 });
    // $225.00 − $13.50 = $211.50; sold above $150, so 10% = $21.15; payout $190.35.
    expect(res.body.preview).toEqual({ grossCents: 22500, expensesCents: 1350, netSaleCents: 21150, commissionRateBps: 1000, commissionCents: 2115, payoutCents: 19035 });
    expect((res.body.basis as string[]).join(" ")).toMatch(/2\.90% \+ \$0\.30 on \$300\.00 charged/);
  });

  it("asks for postage when the label wasn't bought here, and for insurance the consignor approved", async () => {
    state.tables.orders[0].postage_cost_cents = null;
    state.tables.consignment_shipments = [{ order_id: ORDER, insurance_needed: true, insurance_premium_cents: null, estimated_premium_cents: 560, over_limit: false }];
    const res = await call(STAFF, "GET", undefined, { view: "settlement", sale: SALE });
    const warnings = (res.body.warnings as string[]).join(" ");
    expect(warnings).toMatch(/postage isn't known/);
    expect(warnings).toMatch(/approved additional insurance and the package was worth \$300\.00 \(published premium \$5\.60\), but no insurance purchase is recorded/);
    expect((res.body.expenses as Record<string, number>).insuranceCents).toBe(0);
  });

  it("charges the recorded premium by the card's share, only when the consignor approved insurance", async () => {
    state.tables.consignment_shipments = [{ order_id: ORDER, insurance_needed: true, insurance_premium_cents: 560, over_limit: false }];
    state.tables.consignment_sales[0].insurance_elected = true;
    let res = await call(STAFF, "GET", undefined, { view: "settlement", sale: SALE });
    // $5.60 split $225 / $75: $4.20 for this card.
    expect((res.body.expenses as Record<string, number>).insuranceCents).toBe(420);
    state.tables.consignment_sales[0].insurance_elected = false;
    res = await call(STAFF, "GET", undefined, { view: "settlement", sale: SALE });
    expect((res.body.expenses as Record<string, number>).insuranceCents).toBe(0);
    expect((res.body.basis as string[]).join(" ")).toMatch(/declined additional insurance/);
  });

  it("settles with the confirmed expenses, recording what was changed from the proposal", async () => {
    stub("consignment_settle_sale", 19000);
    const res = await call(STAFF, "POST", {
      action: "settleSale",
      saleId: SALE,
      expenses: { marketplaceFeeCents: 0, processingFeeCents: 675, postageCents: 720, insuranceCents: 0, otherExpenseCents: 0 },
      adjustmentNote: "Label was re-bought",
    });
    expect(res.statusCode).toBe(200);
    expect(res.body.payoutCents).toBe(19000);
    expect(calls.consignment_settle_sale[0]).toMatchObject({ p_sale_id: SALE, p_postage_cents: 720, p_actor: "helper@example.com" });
    expect(calls.consignment_settle_sale[0].p_detail).toMatchObject({ adjusted: ["postageCents"], adjustmentNote: "Label was re-bought" });
  });

  it("passes on the inspection period", async () => {
    stub("consignment_settle_sale", null, { code: "GC064", message: "The buyer's inspection period ends Oct 30 at 2:00 PM." });
    const res = await call(STAFF, "POST", { action: "settleSale", saleId: SALE, expenses: {} });
    expect(res.statusCode).toBe(409);
    expect(res.body.message).toMatch(/inspection period ends/);
  });
});

describe("payouts", () => {
  const body = { action: "recordPayout", consignmentId: CONSIGNMENT, saleIds: [SALE], method: "paypal", reference: "PP-1", paidAt: "2026-10-28T12:00:00Z" };

  it("are for the owner", async () => {
    stub("consignment_record_payout", "p1");
    const res = await call(STAFF, "POST", body);
    expect(res.statusCode).toBe(403);
    expect(calls.consignment_record_payout).toBeUndefined();
    expect((await call(STAFF, "POST", { action: "voidPayout", payoutId: SALE, reason: "x" })).statusCode).toBe(403);
  });

  it("record the sales covered and how it was paid", async () => {
    stub("consignment_record_payout", "p1");
    const res = await call(OWNER, "POST", body);
    expect(res.statusCode).toBe(200);
    expect(calls.consignment_record_payout[0]).toMatchObject({ p_consignment_id: CONSIGNMENT, p_sale_ids: [SALE], p_adjustment_ids: [], p_method: "paypal", p_reference: "PP-1" });
    expect((await call(OWNER, "POST", { ...body, method: "cash" })).statusCode).toBe(400);
  });
});
