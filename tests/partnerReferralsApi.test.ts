import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeState, createFakeSupabase, fakeId, fakeResponse, type FakeState } from "./helpers/fakeSupabase";

// Sending a lead to a partner store (POST /api/admin/partner-referrals) and
// recording what happened (PATCH /api/admin/partner-referrals/:id). The rules
// that protect sellers and the fee records:
//   * only an active store that buys what the seller has;
//   * only with the seller's OK (a Magic seller must have ticked the box);
//   * one store at a time per lead;
//   * the server works out the fee, and a paid fee can't be rewritten.

beforeAll(() => {
  process.env.SUPABASE_URL = "https://x.invalid";
  process.env.SUPABASE_SECRET_KEY = "svc";
});

let state: FakeState = createFakeState();
vi.mock("../api/_lib/supabaseAdmin.js", () => ({ getSupabaseAdmin: () => createFakeSupabase(state) }));

const sent: string[] = [];
vi.mock("../api/_lib/partnerEmails.js", () => ({
  sendLeadToPartnerEmails: vi.fn(async (id: string) => {
    sent.push(id);
    return { store: { status: "sent" }, seller: { status: "sent" } };
  }),
}));

const { default: sendHandler } = await import("../api/admin/partner-referrals/index.ts");
const { default: updateHandler } = await import("../api/admin/partner-referrals/[id].ts");

const OWNER = "owner-token";
const STAFF = "staff-token";

async function call(
  handler: typeof sendHandler,
  opts: { method: string; token?: string; body?: Record<string, unknown>; id?: string },
) {
  const req = {
    method: opts.method,
    headers: opts.token ? { authorization: `Bearer ${opts.token}` } : {},
    body: opts.body ?? {},
    query: opts.id ? { id: opts.id } : {},
  };
  const res = fakeResponse();
  await handler(req as never, res as never);
  return res as typeof res & { body: Record<string, unknown> };
}

let store: Record<string, unknown>;
let lead: Record<string, unknown>;
let magic: Record<string, unknown>;

beforeEach(() => {
  state = createFakeState();
  sent.length = 0;
  state.sessions[OWNER] = { id: "owner-1", email: "owner@example.com", app_metadata: { role: "admin" } };
  state.sessions[STAFF] = { id: "staff-1", email: "staff@example.com", app_metadata: { role: "staff" } };
  state.defaults.partner_referrals = () => ({
    sent_at: new Date().toISOString(),
    outcome: "pending",
    outcome_at: null,
    sale_amount_cents: null,
    fee_cents: null,
    fee_status: "none",
    fee_paid_at: null,
    notes: null,
  });
  // One pending referral per lead (the real partial unique indexes).
  state.unique.partner_referrals = [
    { columns: ["referral_lead_id"], where: (r) => r.outcome === "pending" },
    { columns: ["sell_submission_id"], where: (r) => r.outcome === "pending" },
  ];
  store = {
    id: fakeId(),
    kind: "store",
    status: "active",
    business_name: "Gateway Games",
    categories: ["pokemon", "magic"],
    fee_percent: 8,
  };
  lead = {
    id: fakeId(),
    reference_number: "GG-R-100001",
    categories: ["pokemon"],
    consent_to_share_at: "2026-10-11T12:00:00.000Z",
    status: "new",
  };
  magic = { id: fakeId(), reference_number: "GG-S-100050", partner_consent_at: "2026-10-11T12:00:00.000Z" };
  state.tables.partners = [store];
  state.tables.referral_leads = [lead];
  state.tables.sell_submissions = [magic];
});

function send(body: Record<string, unknown>, token = STAFF) {
  return call(sendHandler, { method: "POST", token, body });
}

describe("POST /api/admin/partner-referrals", () => {
  it("needs staff", async () => {
    expect((await call(sendHandler, { method: "POST", body: {} })).statusCode).toBe(401);
  });

  it("sends a partner lead: records the store's fee %, marks the lead sent, emails both sides, logs it", async () => {
    const res = await send({ leadType: "referral_lead", leadId: lead.id, partnerId: store.id });
    expect(res.statusCode).toBe(200);
    const [referral] = state.tables.partner_referrals;
    expect(referral).toMatchObject({
      partner_id: store.id,
      referral_lead_id: lead.id,
      sell_submission_id: null,
      lead_reference: "GG-R-100001",
      sent_by: "staff-1",
      fee_percent: 8,
      outcome: "pending",
    });
    expect(lead.status).toBe("sent_to_partner");
    expect(sent).toEqual([referral.id]);
    expect(res.body).toEqual({ ok: true, referralId: referral.id, emails: { store: "sent", seller: "sent" } });
    expect(state.tables.admin_audit_log?.[0]).toMatchObject({ action: "partner_referral.send" });
  });

  it("sends a Magic submission only when the seller ticked the partner box", async () => {
    const ok = await send({ leadType: "sell_submission", leadId: magic.id, partnerId: store.id });
    expect(ok.statusCode).toBe(200);
    expect(state.tables.partner_referrals[0]).toMatchObject({ sell_submission_id: magic.id, lead_reference: "GG-S-100050" });

    const noConsent = { id: fakeId(), reference_number: "GG-S-100051", partner_consent_at: null };
    state.tables.sell_submissions.push(noConsent);
    const refused = await send({ leadType: "sell_submission", leadId: noConsent.id, partnerId: store.id });
    expect(refused.statusCode).toBe(409);
    expect(refused.body.message).toMatch(/didn't agree/);
    expect(state.tables.partner_referrals).toHaveLength(1);
  });

  it("never sends a partner lead without the seller's consent on record", async () => {
    lead.consent_to_share_at = null;
    const res = await send({ leadType: "referral_lead", leadId: lead.id, partnerId: store.id });
    expect(res.statusCode).toBe(409);
    expect(state.tables.partner_referrals ?? []).toHaveLength(0);
    expect(sent).toEqual([]);
  });

  it("only sends to an active store that buys what the seller has", async () => {
    lead.categories = ["video_games"];
    const wrongCategory = await send({ leadType: "referral_lead", leadId: lead.id, partnerId: store.id });
    expect(wrongCategory.statusCode).toBe(400);
    expect(wrongCategory.body.message).toMatch(/doesn't buy Video games/);

    lead.categories = ["pokemon"];
    store.status = "paused";
    expect((await send({ leadType: "referral_lead", leadId: lead.id, partnerId: store.id })).statusCode).toBe(409);

    store.status = "active";
    store.kind = "referrer";
    expect((await send({ leadType: "referral_lead", leadId: lead.id, partnerId: store.id })).statusCode).toBe(404);
    expect(state.tables.partner_referrals ?? []).toHaveLength(0);
    expect(sent).toEqual([]);
  });

  it("keeps a lead with one store at a time", async () => {
    expect((await send({ leadType: "referral_lead", leadId: lead.id, partnerId: store.id })).statusCode).toBe(200);
    const other = { ...store, id: fakeId(), business_name: "Other Store" };
    state.tables.partners.push(other);
    const second = await send({ leadType: "referral_lead", leadId: lead.id, partnerId: other.id });
    expect(second.statusCode).toBe(409);
    expect(second.body.message).toMatch(/already with a partner store/);
    expect(sent).toHaveLength(1);
  });

  it("validates the request", async () => {
    expect((await send({ leadType: "order", leadId: lead.id, partnerId: store.id })).statusCode).toBe(400);
    expect((await send({ leadType: "referral_lead", leadId: "x", partnerId: store.id })).statusCode).toBe(400);
    expect((await send({ leadType: "referral_lead", leadId: fakeId(), partnerId: store.id })).statusCode).toBe(404);
  });
});

describe("PATCH /api/admin/partner-referrals/:id", () => {
  let referral: Record<string, unknown>;

  beforeEach(() => {
    referral = {
      id: fakeId(),
      partner_id: store.id,
      referral_lead_id: lead.id,
      sell_submission_id: null,
      lead_reference: "GG-R-100001",
      outcome: "pending",
      outcome_at: null,
      sale_amount_cents: null,
      fee_percent: 8,
      fee_cents: null,
      fee_status: "none",
      fee_paid_at: null,
      notes: null,
    };
    state.tables.partner_referrals = [referral];
    lead.status = "sent_to_partner";
  });

  function patch(body: Record<string, unknown>, token = STAFF) {
    return call(updateHandler, { method: "PATCH", token, id: referral.id as string, body });
  }

  it("records a sale: works out the fee (8% of $1,234.56 = $98.76), marks it owed, closes the lead", async () => {
    const res = await patch({ outcome: "sold", saleAmountCents: 123456 });
    expect(res.statusCode).toBe(200);
    expect(referral).toMatchObject({ outcome: "sold", sale_amount_cents: 123456, fee_cents: 9876, fee_status: "owed" });
    expect(typeof referral.outcome_at).toBe("string");
    expect(lead.status).toBe("closed");
  });

  it("needs the sale amount to record a sale, and ignores a fee sent by the client", async () => {
    expect((await patch({ outcome: "sold" })).statusCode).toBe(400);
    expect((await patch({ outcome: "sold", saleAmountCents: -5 })).statusCode).toBe(400);
    expect((await patch({ outcome: "sold", saleAmountCents: 12.5 })).statusCode).toBe(400);
    const res = await patch({ outcome: "sold", saleAmountCents: 10000, feeCents: 1, fee_cents: 1 });
    expect(res.statusCode).toBe(200);
    expect(referral.fee_cents).toBe(800);
  });

  it("sends the lead back to New when the store passes or can't reach them", async () => {
    await patch({ outcome: "passed" });
    expect(lead.status).toBe("new");
    expect(referral.fee_status).toBe("none");
    await patch({ outcome: "pending" });
    expect(lead.status).toBe("sent_to_partner");
    expect(referral.outcome_at).toBeNull();
  });

  it("clears the fee when a sale is changed to 'didn't sell'", async () => {
    await patch({ outcome: "sold", saleAmountCents: 50000 });
    const res = await patch({ outcome: "not_sold" });
    expect(res.statusCode).toBe(200);
    expect(referral).toMatchObject({ outcome: "not_sold", sale_amount_cents: null, fee_cents: null, fee_status: "none" });
  });

  it("lets only the owner mark a fee paid or waived", async () => {
    await patch({ outcome: "sold", saleAmountCents: 50000 });
    const staffTry = await patch({ feeStatus: "paid" });
    expect(staffTry.statusCode).toBe(403);
    expect(referral.fee_status).toBe("owed");

    const ownerPaid = await patch({ feeStatus: "paid" }, OWNER);
    expect(ownerPaid.statusCode).toBe(200);
    expect(referral.fee_status).toBe("paid");
    expect(typeof referral.fee_paid_at).toBe("string");

    // Staff can't undo it either.
    expect((await patch({ feeStatus: "owed" })).statusCode).toBe(403);
  });

  it("never rewrites a paid fee: no new sale amount, no other outcome, until the owner reopens it", async () => {
    await patch({ outcome: "sold", saleAmountCents: 50000 });
    await patch({ feeStatus: "paid" }, OWNER);
    expect((await patch({ saleAmountCents: 90000 }, OWNER)).statusCode).toBe(409);
    expect((await patch({ outcome: "not_sold" }, OWNER)).statusCode).toBe(409);
    expect(referral).toMatchObject({ sale_amount_cents: 50000, fee_cents: 4000, fee_status: "paid" });

    // The owner marks it owed again, then corrects the sale.
    expect((await patch({ feeStatus: "owed" }, OWNER)).statusCode).toBe(200);
    expect(referral.fee_paid_at).toBeNull();
    expect((await patch({ saleAmountCents: 90000 }, OWNER)).statusCode).toBe(200);
    expect(referral).toMatchObject({ sale_amount_cents: 90000, fee_cents: 7200, fee_status: "owed" });
  });

  it("refuses a fee on something that didn't sell", async () => {
    const res = await patch({ outcome: "not_sold", feeStatus: "owed" }, OWNER);
    expect(res.statusCode).toBe(400);
  });

  it("validates input and reports nothing to change", async () => {
    expect((await patch({ outcome: "won" })).statusCode).toBe(400);
    expect((await patch({ feeStatus: "maybe" })).statusCode).toBe(400);
    const same = await patch({ outcome: "pending" });
    expect(same.body).toEqual({ ok: true, unchanged: true });
  });

  it("saves notes", async () => {
    await patch({ notes: "  Store called Tuesday.  " });
    expect(referral.notes).toBe("Store called Tuesday.");
  });
});
