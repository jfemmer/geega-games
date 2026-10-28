import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeState, createFakeSupabase, fakeResponse, type FakeState } from "./helpers/fakeSupabase";

// /api/admin/consignments (Phase 1: settings). Staff can read the rates;
// only the owner can add or remove a schedule or change the settings, every
// change is checked before it reaches the database and audited, and a new
// schedule can't start in the past. (The database's own locks on schedules
// already in effect are tested in tests/consignmentFoundationDb.test.ts.)

beforeAll(() => {
  process.env.SUPABASE_URL = "https://x.invalid";
  process.env.SUPABASE_SECRET_KEY = "svc";
});

let state: FakeState = createFakeState();
vi.mock("../api/_lib/supabaseAdmin.js", () => ({ getSupabaseAdmin: () => createFakeSupabase(state) }));

const { default: handler, readTiers, readBrackets } = await import("../api/admin/consignments.ts");

const OWNER = "owner-token";
const STAFF = "staff-token";

async function call(token: string | null, method: string, body?: Record<string, unknown>, query: Record<string, string> = {}) {
  const res = fakeResponse();
  await handler({ method, headers: token ? { authorization: `Bearer ${token}` } : {}, query, body } as never, res as never);
  return res as typeof res & { body: Record<string, unknown> & { message?: string } };
}

beforeEach(() => {
  state = createFakeState();
  state.sessions[OWNER] = { id: "owner-1", email: "jacob@example.com", app_metadata: { role: "admin" } };
  state.sessions[STAFF] = { id: "staff-1", email: "helper@example.com", app_metadata: { role: "staff" } };
  state.tables.consignment_fee_schedules = [];
  state.tables.consignment_insurance_schedules = [];
  state.tables.consignment_commission_schedules = [];
  state.tables.consignment_settings = [
    {
      id: true,
      default_postage_cents: 500,
      buyer_terms: {},
      estimator_insurance_default: false,
      min_card_value_cents: 0,
      initial_term_days: 90,
      inspection_days: 3,
      payout_methods: ["paypal", "check"],
      updated_at: "2026-10-28T00:00:00Z",
      updated_by: null,
    },
  ];
  state.tables.admin_audit_log = [];
  state.rpc.consignment_estimator_settings = () => ({ data: { channels: {} }, error: null });
});

describe("reading", () => {
  it("lets staff read the settings", async () => {
    const res = await call(STAFF, "GET", undefined, { view: "settings" });
    expect(res.statusCode).toBe(200);
    expect(res.body.settings).toMatchObject({ default_postage_cents: 500 });
  });

  it("needs a staff session", async () => {
    expect((await call(null, "GET")).statusCode).toBe(401);
  });
});

describe("changing", () => {
  it("is for the owner only", async () => {
    const res = await call(STAFF, "POST", { action: "updateSettings", defaultPostageCents: 450 });
    expect(res.statusCode).toBe(403);
    expect(res.body.message).toMatch(/Only the owner/);
    expect(state.writes).toHaveLength(0);
  });

  it("adds a channel's fees from now, and audits it", async () => {
    const res = await call(OWNER, "POST", {
      action: "addFeeSchedule",
      channel: "tcgplayer",
      marketplaceBps: 1075,
      marketplaceBase: "item_shipping",
      perOrderCents: 0,
      processingBps: 250,
      processingFixedCents: 30,
      processingBase: "item_shipping_tax",
      sourceNote: "  2026 schedule ",
    });
    expect(res.statusCode).toBe(200);
    const row = state.tables.consignment_fee_schedules[0];
    expect(row).toMatchObject({ channel: "tcgplayer", marketplace_bps: 1075, processing_bps: 250, source_note: "2026 schedule", created_by: "jacob@example.com" });
    expect(Math.abs(new Date(String(row.effective_from)).getTime() - Date.now())).toBeLessThan(5000);
    expect(state.tables.admin_audit_log[0]).toMatchObject({ action: "consignment.fee_schedule.add", actor_email: "jacob@example.com" });
  });

  it("won't backdate new rates", async () => {
    const res = await call(OWNER, "POST", {
      action: "addCommissionSchedule",
      effectiveFrom: new Date(Date.now() - 86400000).toISOString(),
      tiers: [{ maxPriceCents: null, rateBps: 1500 }],
    });
    expect(res.statusCode).toBe(400);
    expect(res.body.message).toMatch(/not in the past/);
    expect(state.tables.consignment_commission_schedules).toHaveLength(0);
  });

  it("needs both halves of a threshold rate", async () => {
    const res = await call(OWNER, "POST", {
      action: "addFeeSchedule",
      channel: "ebay",
      marketplaceBps: 1325,
      marketplaceBase: "item_shipping_tax",
      marketplaceThresholdCents: 750000,
    });
    expect(res.statusCode).toBe(400);
    expect(res.body.message).toMatch(/threshold and the rate above it/);
  });

  it("updates estimator and term settings, keeping the before and after", async () => {
    const res = await call(OWNER, "POST", {
      action: "updateSettings",
      defaultPostageCents: 450,
      buyerTerms: { website: { shippingCents: 550, freeShippingAtCents: 7500, salesTaxBps: 0 } },
      payoutMethods: ["paypal", "venmo", "paypal"],
    });
    expect(res.statusCode).toBe(200);
    expect(state.tables.consignment_settings[0]).toMatchObject({
      default_postage_cents: 450,
      payout_methods: ["paypal", "venmo"],
      updated_by: "jacob@example.com",
    });
    const audit = state.tables.admin_audit_log[0] as { before: { default_postage_cents: number }; after: { default_postage_cents: number } };
    expect(audit.before.default_postage_cents).toBe(500);
    expect(audit.after.default_postage_cents).toBe(450);
  });

  it("rejects an unknown payout method or action", async () => {
    expect((await call(OWNER, "POST", { action: "updateSettings", payoutMethods: ["crypto"] })).statusCode).toBe(400);
    expect((await call(OWNER, "POST", { action: "dropTables" })).statusCode).toBe(400);
  });
});

describe("validating tiers and brackets", () => {
  it("sorts tiers and needs exactly one open-ended top tier", () => {
    expect(readTiers([{ maxPriceCents: null, rateBps: 1000 }, { maxPriceCents: 15000, rateBps: 2000 }])).toEqual([
      { maxPriceCents: 15000, rateBps: 2000 },
      { maxPriceCents: null, rateBps: 1000 },
    ]);
    expect(() => readTiers([{ maxPriceCents: 15000, rateBps: 2000 }])).toThrow(/no top price/);
    expect(() => readTiers([{ maxPriceCents: null, rateBps: 2000 }, { maxPriceCents: null, rateBps: 1000 }])).toThrow(/no top price/);
    expect(() => readTiers([{ maxPriceCents: null, rateBps: 9000 }])).toThrow(/rate/);
  });

  it("sorts brackets and refuses duplicates", () => {
    expect(readBrackets([{ maxValueCents: 20000, premiumCents: 450 }, { maxValueCents: 10000, premiumCents: 0 }])[0].maxValueCents).toBe(10000);
    expect(() => readBrackets([{ maxValueCents: 100, premiumCents: 0 }, { maxValueCents: 100, premiumCents: 5 }])).toThrow(/same value/);
  });
});
