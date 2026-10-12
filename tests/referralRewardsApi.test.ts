import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeState, createFakeSupabase, fakeId, fakeResponse, type FakeState } from "./helpers/fakeSupabase";

// /api/admin/referral-rewards: rewarding whoever referred a seller who sold.
// A customer's code earns $10 of store credit; a referral partner earns their
// fee % of the sale in cash. Owner-only, only after a real sale, never for a
// seller who referred themselves, and never twice for one lead.

beforeAll(() => {
  process.env.SUPABASE_URL = "https://x.invalid";
  process.env.SUPABASE_SECRET_KEY = "svc";
});

let state: FakeState = createFakeState();
vi.mock("../api/_lib/supabaseAdmin.js", () => ({ getSupabaseAdmin: () => createFakeSupabase(state) }));

const rewardEmails: string[] = [];
vi.mock("../api/_lib/partnerEmails.js", () => ({
  sendReferralRewardEmail: vi.fn(async (id: string) => {
    rewardEmails.push(id);
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
  state.sessions[OWNER] = { id: "owner-1", email: "owner@example.com", app_metadata: { role: "admin" } };
  state.sessions[STAFF] = { id: "staff-1", email: "staff@example.com", app_metadata: { role: "staff" } };
  state.users["cust-1"] = { id: "cust-1", email: "friend@example.com" };
  partner = { id: fakeId(), kind: "referrer", status: "active", fee_percent: 3, email: "jo@heirloom.example" };
  customerCode = { id: fakeId(), code: "friend22", user_id: "cust-1", partner_id: null };
  partnerCode = { id: fakeId(), code: "heirloom", user_id: null, partner_id: partner.id };
  state.tables.partners = [partner];
  state.tables.referral_codes = [customerCode, partnerCode];
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

  it("gives a referral partner their fee % of what a partner store paid (3% of $500 = $15)", async () => {
    const lead = addPartnerLead({}, 50000);
    const res = await call({ token: OWNER, body: { leadType: "referral_lead", leadId: lead.id } });
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ kind: "cash", amountCents: 1500 });
    expect(state.tables.referral_rewards[0]).toMatchObject({ partner_id: partner.id, kind: "cash", status: "owed" });
  });

  it("rewards a partner for a Magic sale to us using what we paid", async () => {
    const sub = addSubmission({ ref_code: "heirloom", purchase_amount_cents: 120000 });
    const res = await call({ token: OWNER, body: { leadType: "sell_submission", leadId: sub.id } });
    expect(res.body).toMatchObject({ kind: "cash", amountCents: 3600 });
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
    const again = await call({ method: "PATCH", token: OWNER, id: reward.id, body: { status: "paid" } });
    expect(again.body).toEqual({ ok: true, unchanged: true });
  });

  it("validates the request", async () => {
    expect((await call({ method: "PATCH", token: OWNER, id: "nope", body: { status: "paid" } })).statusCode).toBe(400);
    expect((await call({ method: "PATCH", token: OWNER, id: fakeId(), body: { status: "owed" } })).statusCode).toBe(400);
    expect((await call({ method: "PATCH", token: OWNER, id: fakeId(), body: { status: "paid" } })).statusCode).toBe(404);
    expect((await call({ method: "PATCH", token: STAFF, id: fakeId(), body: { status: "paid" } })).statusCode).toBe(403);
  });
});
