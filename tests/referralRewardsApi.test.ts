import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeState, createFakeSupabase, fakeId, fakeResponse, type FakeState } from "./helpers/fakeSupabase";

// /api/admin/referral-rewards: rewarding whoever referred a seller who sold.
// A customer's code earns $10 of store credit; a referral partner earns their
// fee % in cash, but only when Geega Games bought the collection itself
// (a completed submission), for a request made while a Referral Partner
// Agreement was in effect (version 2: countersigned), at the fee in that
// agreement, closed in time (version 2 adds the 30-day Completion
// Extension). Owner-only, only after a real sale, never for a seller who
// referred themselves, and never twice for one lead. Marking a fee paid
// emails the payment statement.

beforeAll(() => {
  process.env.SUPABASE_URL = "https://x.invalid";
  process.env.SUPABASE_SECRET_KEY = "svc";
});

let state: FakeState = createFakeState();
vi.mock("../api/_lib/supabaseAdmin.js", () => ({ getSupabaseAdmin: () => createFakeSupabase(state) }));

const rewardEmails: string[] = [];
const rewardEmailOpts: ({ feePercent?: number } | undefined)[] = [];
const paidEmails: string[] = [];
vi.mock("../api/_lib/partnerEmails.js", () => ({
  sendReferralRewardEmail: vi.fn(async (id: string, opts?: { feePercent?: number }) => {
    rewardEmails.push(id);
    rewardEmailOpts.push(opts);
    return { status: "sent" };
  }),
  sendReferralFeePaidEmail: vi.fn(async (id: string) => {
    paidEmails.push(id);
    return { status: "sent" };
  }),
}));

const { default: handler } = await import("../api/admin/referral-rewards.ts");

const OWNER = "owner-token";
const STAFF = "staff-token";

async function call(opts: { method?: string; token?: string; body?: Record<string, unknown>; id?: string }) {
  const req = {
    method: opts.method ?? "POST",
    headers: opts.token ? { authorization: `Bearer ${opts.token}` } : {},
    body: opts.body ?? {},
    query: opts.id ? { id: opts.id } : {},
  };
  const res = fakeResponse();
  await handler(req as never, res as never);
  return res as typeof res & { body: Record<string, unknown> };
}

/** grant_referral_reward(): records the reward (unique per lead) and, for store credit, issues it. */
function installGrantRpc() {
  state.unique.referral_rewards = [{ columns: ["referral_lead_id"] }, { columns: ["sell_submission_id"] }];
  state.rpc.grant_referral_reward = (args) => {
    const rows = (state.tables.referral_rewards ??= []);
    const leadCol = args.p_referral_lead_id ? "referral_lead_id" : "sell_submission_id";
    const leadId = args.p_referral_lead_id ?? args.p_sell_submission_id;
    if (rows.some((r) => r[leadCol] === leadId)) return { data: null, error: { message: "duplicate", code: "23505" } };
    const id = fakeId();
    rows.push({
      id,
      referral_lead_id: args.p_referral_lead_id,
      sell_submission_id: args.p_sell_submission_id,
      ref_code: args.p_ref_code,
      user_id: args.p_user_id,
      partner_id: args.p_partner_id,
      kind: args.p_kind,
      amount_cents: args.p_amount_cents,
      status: args.p_kind === "store_credit" ? "paid" : "owed",
    });
    return { data: id, error: null };
  };
}

let customerCode: Record<string, unknown>;
let partnerCode: Record<string, unknown>;
let partner: Record<string, unknown>;

beforeEach(() => {
  state = createFakeState();
  rewardEmails.length = 0;
  rewardEmailOpts.length = 0;
  paidEmails.length = 0;
  state.sessions[OWNER] = { id: "owner-1", email: "owner@example.com", app_metadata: { role: "admin" } };
  state.sessions[STAFF] = { id: "staff-1", email: "staff@example.com", app_metadata: { role: "staff" } };
  state.users["cust-1"] = { id: "cust-1", email: "friend@example.com" };
  partner = { id: fakeId(), kind: "referrer", status: "active", fee_percent: 3, email: "jo@heirloom.example", business_name: "Heirloom Estate Sales" };
  customerCode = { id: fakeId(), code: "friend22", user_id: "cust-1", partner_id: null };
  partnerCode = { id: fakeId(), code: "heirloom", user_id: null, partner_id: partner.id };
  state.tables.partners = [partner];
  state.tables.referral_codes = [customerCode, partnerCode];
  state.tables.partner_agreements = [
    { id: fakeId(), partner_id: partner.id, status: "signed", fee_percent: 3, signed_at: "2026-10-01T12:00:00.000Z", version_number: 1 },
  ];
  installGrantRpc();
});

function addSubmission(row: Record<string, unknown>) {
  const sub = {
    id: fakeId(),
    reference_number: "GG-S-100060",
    ref_code: "friend22",
    email: "seller@example.com",
    status: "completed",
    purchase_amount_cents: 40000,
    created_at: "2026-10-05T12:00:00.000Z",
    closed_at: "2026-10-12T12:00:00.000Z",
    ...row,
  };
  (state.tables.sell_submissions ??= []).push(sub);
  return sub;
}

function addPartnerLead(row: Record<string, unknown>, sale: number | null) {
  const lead = { id: fakeId(), reference_number: "GG-R-100070", ref_code: "heirloom", email: "seller@example.com", ...row };
  (state.tables.referral_leads ??= []).push(lead);
  if (sale !== null) {
    (state.tables.partner_referrals ??= []).push({
      id: fakeId(),
      referral_lead_id: lead.id,
      sell_submission_id: null,
      outcome: "sold",
      outcome_at: "2026-10-10T12:00:00.000Z",
      sale_amount_cents: sale,
    });
  }
  return lead;
}

describe("POST /api/admin/referral-rewards", () => {
  it("is owner-only", async () => {
    const sub = addSubmission({});
    expect((await call({ body: { leadType: "sell_submission", leadId: sub.id } })).statusCode).toBe(401);
    expect((await call({ token: STAFF, body: { leadType: "sell_submission", leadId: sub.id } })).statusCode).toBe(403);
    expect(state.tables.referral_rewards ?? []).toHaveLength(0);
  });

  it("gives a customer $10 of store credit when the seller they referred sells to us", async () => {
    const sub = addSubmission({});
    const res = await call({ token: OWNER, body: { leadType: "sell_submission", leadId: sub.id } });
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ ok: true, kind: "store_credit", amountCents: 1000 });
    expect(state.tables.referral_rewards[0]).toMatchObject({
      sell_submission_id: sub.id,
      user_id: "cust-1",
      partner_id: null,
      kind: "store_credit",
      amount_cents: 1000,
    });
    expect(rewardEmails).toEqual([res.body.rewardId]);
    expect(state.tables.admin_audit_log?.[0]).toMatchObject({ action: "referral_reward.grant" });
  });

  it("pays a referral partner nothing when the collection went to a partner store", async () => {
    const lead = addPartnerLead({}, 50000);
    const res = await call({ token: OWNER, body: { leadType: "referral_lead", leadId: lead.id } });
    expect(res.statusCode).toBe(409);
    expect(res.body.message).toMatch(/only when Geega Games buys the collection itself/);
    // A Magic submission passed to a store and sold there: also no fee.
    const passedOn = addSubmission({ ref_code: "heirloom", status: "sent_to_partner" });
    (state.tables.partner_referrals ??= []).push({
      id: fakeId(),
      referral_lead_id: null,
      sell_submission_id: passedOn.id,
      outcome: "sold",
      outcome_at: "2026-10-10T12:00:00.000Z",
      sale_amount_cents: 50000,
    });
    expect((await call({ token: OWNER, body: { leadType: "sell_submission", leadId: passedOn.id } })).statusCode).toBe(409);
    expect(state.tables.referral_rewards ?? []).toHaveLength(0);
  });

  it("still gives a customer store credit when the seller they referred sold to a partner store", async () => {
    const lead = addPartnerLead({ ref_code: "friend22" }, 50000);
    const res = await call({ token: OWNER, body: { leadType: "referral_lead", leadId: lead.id } });
    expect(res.body).toMatchObject({ kind: "store_credit", amountCents: 1000 });
  });

  it("rewards a partner for a completed sale to us, at the fee in their signed agreement", async () => {
    partner.fee_percent = 10; // changed on their profile since they signed for 3%
    const sub = addSubmission({ ref_code: "heirloom", purchase_amount_cents: 120000 });
    const res = await call({ token: OWNER, body: { leadType: "sell_submission", leadId: sub.id } });
    expect(res.body).toMatchObject({ kind: "cash", amountCents: 3600 });
    expect(state.tables.referral_rewards[0]).toMatchObject({ partner_id: partner.id, kind: "cash", status: "owed" });
    // The Transaction Summary shows the fee they signed for.
    expect(rewardEmailOpts[0]).toEqual({ feePercent: 3 });
  });

  it("pays a partner nothing without an agreement in effect, or when the request was over 180 days before closing", async () => {
    state.tables.partner_agreements = [{ id: fakeId(), partner_id: partner.id, status: "pending", fee_percent: 3, signed_at: null }];
    const sub = addSubmission({ ref_code: "heirloom" });
    const unsigned = await call({ token: OWNER, body: { leadType: "sell_submission", leadId: sub.id } });
    expect(unsigned.statusCode).toBe(409);
    expect(unsigned.body.message).toMatch(/Heirloom Estate Sales has no Referral Partner Agreement in effect/);

    state.tables.partner_agreements = [
      { id: fakeId(), partner_id: partner.id, status: "signed", fee_percent: 3, signed_at: "2026-01-01T00:00:00Z", version_number: 1 },
    ];
    const old = addSubmission({ ref_code: "heirloom", created_at: "2026-01-02T00:00:00.000Z", closed_at: "2026-08-01T00:00:00.000Z" });
    const late = await call({ token: OWNER, body: { leadType: "sell_submission", leadId: old.id } });
    expect(late.statusCode).toBe(409);
    expect(late.body.message).toMatch(/180 days/);
    expect(state.tables.referral_rewards ?? []).toHaveLength(0);
  });

  it("version 2 counts only once we've countersigned, and only for requests made after that", async () => {
    const v2 = {
      id: fakeId(),
      partner_id: partner.id,
      status: "awaiting_countersign",
      fee_percent: 3,
      signed_at: "2026-09-01T12:00:00.000Z",
      countersigned_at: null,
      version_number: 2,
    };
    state.tables.partner_agreements = [v2];
    const sub = addSubmission({ ref_code: "heirloom", created_at: "2026-09-10T12:00:00.000Z", closed_at: "2026-09-20T12:00:00.000Z" });
    expect((await call({ token: OWNER, body: { leadType: "sell_submission", leadId: sub.id } })).body.message).toMatch(/no Referral Partner Agreement in effect/);

    Object.assign(v2, { status: "signed", countersigned_at: "2026-09-15T12:00:00.000Z" });
    const before = await call({ token: OWNER, body: { leadType: "sell_submission", leadId: sub.id } });
    expect(before.statusCode).toBe(409);
    expect(before.body.message).toMatch(/came in before Heirloom Estate Sales's Referral Partner Agreement took effect \(September 15, 2026\)/);

    const after = addSubmission({ ref_code: "heirloom", created_at: "2026-09-16T12:00:00.000Z", closed_at: "2026-09-30T12:00:00.000Z" });
    const ok = await call({ token: OWNER, body: { leadType: "sell_submission", leadId: after.id } });
    expect(ok.body).toMatchObject({ kind: "cash", amountCents: 1200 });
  });

  it("each referral falls under the version in force when the seller's request came in", async () => {
    state.tables.partner_agreements = [
      { id: fakeId(), partner_id: partner.id, status: "signed", fee_percent: 3, signed_at: "2026-01-01T00:00:00Z", countersigned_at: null, version_number: 1 },
      { id: fakeId(), partner_id: partner.id, status: "signed", fee_percent: 5, signed_at: "2026-09-30T00:00:00Z", countersigned_at: "2026-10-01T00:00:00Z", version_number: 2 },
    ];
    const underV1 = addSubmission({ ref_code: "heirloom", created_at: "2026-09-20T12:00:00.000Z", closed_at: "2026-10-12T12:00:00.000Z" });
    expect((await call({ token: OWNER, body: { leadType: "sell_submission", leadId: underV1.id } })).body).toMatchObject({ amountCents: 1200 });
    const underV2 = addSubmission({ ref_code: "heirloom", created_at: "2026-10-05T12:00:00.000Z", closed_at: "2026-10-12T12:00:00.000Z" });
    expect((await call({ token: OWNER, body: { leadType: "sell_submission", leadId: underV2.id } })).body).toMatchObject({ amountCents: 2000 });
    expect(rewardEmailOpts).toEqual([{ feePercent: 3 }, { feePercent: 5 }]);
  });

  it("version 2: 30 more days to close when the seller accepted our offer within 180 days", async () => {
    state.tables.partner_agreements = [
      { id: fakeId(), partner_id: partner.id, status: "signed", fee_percent: 3, signed_at: "2025-12-30T00:00:00Z", countersigned_at: "2025-12-31T00:00:00Z", version_number: 2 },
    ];
    const extended = addSubmission({
      ref_code: "heirloom",
      created_at: "2026-01-02T00:00:00.000Z",
      offer_response: "accepted",
      offer_responded_at: "2026-06-20T00:00:00.000Z", // day 169
      closed_at: "2026-07-20T00:00:00.000Z", // day 199
    });
    expect((await call({ token: OWNER, body: { leadType: "sell_submission", leadId: extended.id } })).statusCode).toBe(200);

    const tooLate = addSubmission({
      ref_code: "heirloom",
      created_at: "2026-01-02T00:00:00.000Z",
      offer_response: "accepted",
      offer_responded_at: "2026-06-20T00:00:00.000Z",
      closed_at: "2026-08-05T00:00:00.000Z", // day 215
    });
    const late = await call({ token: OWNER, body: { leadType: "sell_submission", leadId: tooLate.id } });
    expect(late.statusCode).toBe(409);
    expect(late.body.message).toMatch(/more than 210 days/);

    const notAccepted = addSubmission({
      ref_code: "heirloom",
      created_at: "2026-01-02T00:00:00.000Z",
      offer_response: "countered",
      offer_responded_at: "2026-06-20T00:00:00.000Z",
      closed_at: "2026-07-20T00:00:00.000Z",
    });
    expect((await call({ token: OWNER, body: { leadType: "sell_submission", leadId: notAccepted.id } })).body.message).toMatch(/more than 180 days/);
  });

  it("waits for a real sale", async () => {
    const open = addSubmission({ status: "offer_sent" });
    const notYet = await call({ token: OWNER, body: { leadType: "sell_submission", leadId: open.id } });
    expect(notYet.statusCode).toBe(409);
    expect(notYet.body.message).toMatch(/completed/);

    const unsold = addPartnerLead({}, null);
    const noSale = await call({ token: OWNER, body: { leadType: "referral_lead", leadId: unsold.id } });
    expect(noSale.statusCode).toBe(409);
    expect(noSale.body.message).toMatch(/Record the sale/);
    expect(state.tables.referral_rewards ?? []).toHaveLength(0);
  });

  it("pays nothing when nobody referred the seller, or they referred themselves", async () => {
    const direct = addSubmission({ ref_code: null });
    expect((await call({ token: OWNER, body: { leadType: "sell_submission", leadId: direct.id } })).body.message).toMatch(
      /Nobody referred/,
    );
    const self = addSubmission({ email: "Friend@Example.com" });
    const res = await call({ token: OWNER, body: { leadType: "sell_submission", leadId: self.id } });
    expect(res.statusCode).toBe(409);
    expect(res.body.message).toMatch(/referred themselves/);
    expect(state.tables.referral_rewards ?? []).toHaveLength(0);
  });

  it("never rewards the same lead twice", async () => {
    const sub = addSubmission({});
    expect((await call({ token: OWNER, body: { leadType: "sell_submission", leadId: sub.id } })).statusCode).toBe(200);
    const again = await call({ token: OWNER, body: { leadType: "sell_submission", leadId: sub.id } });
    expect(again.statusCode).toBe(409);
    expect(again.body.message).toMatch(/already rewarded/);
    expect(state.tables.referral_rewards).toHaveLength(1);
    expect(rewardEmails).toHaveLength(1);
  });

  it("handles a deleted code or partner", async () => {
    const orphan = addSubmission({ ref_code: "gone2345" });
    expect((await call({ token: OWNER, body: { leadType: "sell_submission", leadId: orphan.id } })).body.message).toMatch(
      /no longer exists/,
    );
    state.tables.partners = [];
    const lead = addPartnerLead({}, 50000);
    expect((await call({ token: OWNER, body: { leadType: "referral_lead", leadId: lead.id } })).body.message).toMatch(
      /partner no longer exists/,
    );
  });
});

describe("PATCH /api/admin/referral-rewards?id=", () => {
  it("marks a cash reward paid, once", async () => {
    const reward = { id: fakeId(), kind: "cash", status: "owed", amount_cents: 1500, paid_at: null };
    state.tables.referral_rewards = [reward];
    const res = await call({ method: "PATCH", token: OWNER, id: reward.id, body: { status: "paid" } });
    expect(res.statusCode).toBe(200);
    expect(reward.status).toBe("paid");
    expect(typeof reward.paid_at).toBe("string");
    // The payment statement goes to the partner (agreement 6.6).
    expect(paidEmails).toEqual([reward.id]);
    const again = await call({ method: "PATCH", token: OWNER, id: reward.id, body: { status: "paid" } });
    expect(again.body).toEqual({ ok: true, unchanged: true });
    expect(paidEmails).toHaveLength(1);
  });

  it("validates the request", async () => {
    expect((await call({ method: "PATCH", token: OWNER, id: "nope", body: { status: "paid" } })).statusCode).toBe(400);
    expect((await call({ method: "PATCH", token: OWNER, id: fakeId(), body: { status: "owed" } })).statusCode).toBe(400);
    expect((await call({ method: "PATCH", token: OWNER, id: fakeId(), body: { status: "paid" } })).statusCode).toBe(404);
    expect((await call({ method: "PATCH", token: STAFF, id: fakeId(), body: { status: "paid" } })).statusCode).toBe(403);
  });
});
