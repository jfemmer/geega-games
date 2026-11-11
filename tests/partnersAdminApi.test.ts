import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeState, createFakeSupabase, fakeId, fakeResponse, type FakeState } from "./helpers/fakeSupabase";

// /api/admin/partners (add) and /api/admin/partners/:id (approve, decline,
// pause, activate, update, delete). Partners and their fees are business
// terms, so every change is owner-only; referral partners get a personal code
// when they go active; fee records are never orphaned by a delete.

beforeAll(() => {
  process.env.SUPABASE_URL = "https://x.invalid";
  process.env.SUPABASE_SECRET_KEY = "svc";
});

let state: FakeState = createFakeState();
vi.mock("../api/_lib/supabaseAdmin.js", () => ({ getSupabaseAdmin: () => createFakeSupabase(state) }));

const welcomeCalls: string[] = [];
const messageCalls: string[] = [];
let messageEmailStatus = "sent";
vi.mock("../api/_lib/partnerEmails.js", () => ({
  sendPartnerApprovedEmail: vi.fn(async (id: string) => {
    welcomeCalls.push(id);
    return { status: "sent" };
  }),
  sendPartnerMessageEmail: vi.fn(async (id: string) => {
    messageCalls.push(id);
    return { status: messageEmailStatus };
  }),
}));

const agreementCalls: string[] = [];
const voided: string[] = [];
const countersigned: { agreementId: string; name: string; email: string | null; ip: string }[] = [];
vi.mock("../api/_lib/partnerAgreements.js", () => ({
  countersignAgreement: vi.fn(async (_admin: unknown, agreementId: string, input: { name: string; email: string | null; ip: string }) => {
    countersigned.push({ agreementId, name: input.name, email: input.email, ip: input.ip });
    const a = (state.tables.partner_agreements ?? []).find((r) => r.id === agreementId)!;
    if (a.status !== "awaiting_countersign") {
      const { HttpError } = await import("../api/_lib/http.js");
      throw new HttpError(409, "This agreement isn't waiting for a countersignature.");
    }
    a.status = "signed";
    return { activated: true, kind: "referrer", pdfReady: true, emailed: true };
  }),
  sendPartnerAgreement: vi.fn(async (_admin: unknown, id: string) => {
    agreementCalls.push(id);
    return { agreementId: "agr-1", emailed: true, signUrl: "https://geega-games.com/partner-agreement?t=x" };
  }),
  signedAgreementFor: vi.fn(async (_admin: unknown, id: string) =>
    (state.tables.partner_agreements ?? []).find((a) => a.partner_id === id && a.status === "signed") ?? null,
  ),
  voidOpenAgreement: vi.fn(async (_admin: unknown, id: string) => {
    voided.push(id);
  }),
  partnerAgreementPdfLink: vi.fn(async () => "https://files.example/signed.pdf"),
}));

/** A signed agreement on file, so approving goes straight to active. */
function signAgreement(partnerId: unknown) {
  (state.tables.partner_agreements ??= []).push({ id: fakeId(), partner_id: partnerId, status: "signed", fee_percent: 8 });
}

const { default: createHandler } = await import("../api/admin/partners/index.ts");
const { default: partnerHandler } = await import("../api/admin/partners/[id].ts");

const OWNER = "owner-token";
const STAFF = "staff-token";

function seedSessions() {
  state.sessions[OWNER] = { id: "owner-1", email: "owner@example.com", app_metadata: { role: "admin" } };
  state.sessions[STAFF] = { id: "staff-1", email: "staff@example.com", app_metadata: { role: "staff" } };
  state.unique.referral_codes = [{ columns: ["code"] }, { columns: ["partner_id"] }];
}

async function call(
  handler: typeof createHandler,
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

function addPartner(row: Record<string, unknown>) {
  const partner = {
    id: fakeId(),
    kind: "store",
    status: "applied",
    business_name: "Gateway Games",
    contact_name: "Pat",
    email: "pat@example.com",
    categories: ["pokemon"],
    fee_percent: 8,
    approved_at: null,
    ...row,
  };
  (state.tables.partners ??= []).push(partner);
  return partner;
}

beforeEach(() => {
  state = createFakeState();
  seedSessions();
  welcomeCalls.length = 0;
  messageCalls.length = 0;
  messageEmailStatus = "sent";
  agreementCalls.length = 0;
  voided.length = 0;
  countersigned.length = 0;
});

describe("POST /api/admin/partners", () => {
  const body = {
    kind: "store",
    businessName: "Gateway Games",
    contactName: "Pat Lee",
    email: "pat@example.com",
    state: "MO",
    categories: ["pokemon", "video_games"],
    feePercent: 10,
  };

  it("needs a signed-in owner", async () => {
    expect((await call(createHandler, { method: "POST", body })).statusCode).toBe(401);
    const staff = await call(createHandler, { method: "POST", token: STAFF, body });
    expect(staff.statusCode).toBe(403);
    expect(state.tables.partners ?? []).toHaveLength(0);
  });

  it("adds a store straight to active with the agreed fee, and logs it", async () => {
    const res = await call(createHandler, { method: "POST", token: OWNER, body: { ...body, sendWelcome: true } });
    expect(res.statusCode).toBe(200);
    const [row] = state.tables.partners;
    expect(row).toMatchObject({
      kind: "store",
      status: "active",
      fee_percent: 10,
      categories: ["pokemon", "video_games"],
      profession: null,
    });
    expect(typeof row.approved_at).toBe("string");
    expect(res.body).toMatchObject({ ok: true, id: row.id, welcome: "sent" });
    expect(welcomeCalls).toEqual([row.id]);
    expect(state.tables.admin_audit_log?.[0]).toMatchObject({ action: "partner.create", resource_id: row.id });
  });

  it("gives a referral partner a personal referral code, and doesn't email unless asked", async () => {
    const res = await call(createHandler, {
      method: "POST",
      token: OWNER,
      body: { kind: "referrer", businessName: "Heirloom Estate Sales", contactName: "Jo", email: "jo@example.com", profession: "estate_sale" },
    });
    expect(res.statusCode).toBe(200);
    const [row] = state.tables.partners;
    expect(row).toMatchObject({ kind: "referrer", fee_percent: 3, categories: [], profession: "estate_sale" });
    expect(state.tables.referral_codes).toHaveLength(1);
    expect(state.tables.referral_codes[0]).toMatchObject({ partner_id: row.id });
    expect(String(state.tables.referral_codes[0].code)).toMatch(/^[abcdefghjkmnpqrstuvwxyz23456789]{8}$/);
    expect(welcomeCalls).toEqual([]);
  });

  it("refuses a store that buys nothing, and a fee outside 0–50%", async () => {
    expect((await call(createHandler, { method: "POST", token: OWNER, body: { ...body, categories: [] } })).statusCode).toBe(400);
    expect((await call(createHandler, { method: "POST", token: OWNER, body: { ...body, feePercent: 75 } })).statusCode).toBe(400);
    expect(state.tables.partners ?? []).toHaveLength(0);
  });
});

describe("PATCH /api/admin/partners/:id", () => {
  it("is owner-only", async () => {
    const p = addPartner({});
    const res = await call(partnerHandler, { method: "PATCH", token: STAFF, id: p.id, body: { action: "approve" } });
    expect(res.statusCode).toBe(403);
    expect(p.status).toBe("applied");
  });

  it("approving a new application sends the agreement to sign, and leaves them waiting on it", async () => {
    const p = addPartner({ kind: "referrer", categories: [], profession: "realtor", fee_percent: 3 });
    const res = await call(partnerHandler, { method: "PATCH", token: OWNER, id: p.id, body: { action: "approve" } });
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ ok: true, agreement: { id: "agr-1", emailed: true }, referralCode: null, welcome: null });
    expect(agreementCalls).toEqual([p.id]);
    // Not live until they sign: no link, no welcome.
    expect(p.status).toBe("applied");
    expect(state.tables.referral_codes ?? []).toHaveLength(0);
    expect(welcomeCalls).toEqual([]);
    expect(state.tables.admin_audit_log?.[0]).toMatchObject({ action: "partner.approve" });
  });

  it("re-approving a declined application reopens it and sends the agreement", async () => {
    const p = addPartner({ status: "declined" });
    const res = await call(partnerHandler, { method: "PATCH", token: OWNER, id: p.id, body: { action: "approve" } });
    expect(res.statusCode).toBe(200);
    expect(p.status).toBe("applied");
    expect(agreementCalls).toEqual([p.id]);
  });

  it("resends the agreement on request, but not to a declined partner", async () => {
    const active = addPartner({ status: "active" });
    const res = await call(partnerHandler, { method: "PATCH", token: OWNER, id: active.id, body: { action: "send_agreement" } });
    expect(res.statusCode).toBe(200);
    expect(active.status).toBe("active");
    const declined = addPartner({ status: "declined" });
    expect((await call(partnerHandler, { method: "PATCH", token: OWNER, id: declined.id, body: { action: "send_agreement" } })).statusCode).toBe(409);
    expect((await call(partnerHandler, { method: "PATCH", token: STAFF, id: active.id, body: { action: "send_agreement" } })).statusCode).toBe(403);
    expect(agreementCalls).toEqual([active.id]);
  });

  it("countersigning: owner-only, a matching signature and the authority box, then it takes effect", async () => {
    const p = addPartner({ kind: "referrer" });
    const agreement = { id: fakeId(), partner_id: p.id, status: "awaiting_countersign" };
    state.tables.partner_agreements = [agreement];
    (state.tables.referral_codes ??= []).push({ id: fakeId(), code: "niterun1", partner_id: p.id, user_id: null });
    const body = { action: "countersign", agreementId: agreement.id, name: "Jacob Femmer", title: "Owner", typedSignature: "Jacob Femmer", authorized: true };

    expect((await call(partnerHandler, { method: "PATCH", token: STAFF, id: p.id, body })).statusCode).toBe(403);
    const unauthorized = await call(partnerHandler, { method: "PATCH", token: OWNER, id: p.id, body: { ...body, authorized: false } });
    expect(unauthorized.statusCode).toBe(400);
    expect(unauthorized.body.message).toMatch(/authorized to sign for Geega Games LLC/);
    expect((await call(partnerHandler, { method: "PATCH", token: OWNER, id: p.id, body: { ...body, typedSignature: "J. Femmer" } })).statusCode).toBe(400);
    const other = addPartner({});
    expect((await call(partnerHandler, { method: "PATCH", token: OWNER, id: other.id, body })).statusCode).toBe(404);
    expect(countersigned).toEqual([]);

    const res = await call(partnerHandler, { method: "PATCH", token: OWNER, id: p.id, body });
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ ok: true, activated: true, pdfEmailed: true, referralCode: "niterun1" });
    expect(countersigned).toEqual([{ agreementId: agreement.id, name: "Jacob Femmer", email: "owner@example.com", ip: expect.any(String) }]);
    expect(state.tables.admin_audit_log?.at(-1)).toMatchObject({ action: "partner.countersign", resource_id: p.id });
    expect((await call(partnerHandler, { method: "PATCH", token: OWNER, id: p.id, body })).statusCode).toBe(409);
  });

  it("won't send a new agreement on Approve once they've signed and are waiting for the countersignature", async () => {
    const p = addPartner({ kind: "referrer" });
    state.tables.partner_agreements = [{ id: fakeId(), partner_id: p.id, status: "awaiting_countersign" }];
    const res = await call(partnerHandler, { method: "PATCH", token: OWNER, id: p.id, body: { action: "approve" } });
    expect(res.statusCode).toBe(409);
    expect(res.body.message).toMatch(/Countersign their agreement/);
    expect(agreementCalls).toEqual([]);
  });

  it("declining cancels an unsigned agreement link", async () => {
    const p = addPartner({});
    await call(partnerHandler, { method: "PATCH", token: OWNER, id: p.id, body: { action: "decline" } });
    expect(voided).toEqual([p.id]);
  });

  it("gives a download link only for this partner's own agreement", async () => {
    const p = addPartner({});
    const other = addPartner({});
    const agreement = { id: fakeId(), partner_id: other.id, status: "signed" };
    state.tables.partner_agreements = [agreement];
    const wrong = await call(partnerHandler, { method: "PATCH", token: OWNER, id: p.id, body: { action: "agreement_pdf", agreementId: agreement.id } });
    expect(wrong.statusCode).toBe(404);
    const right = await call(partnerHandler, { method: "PATCH", token: OWNER, id: other.id, body: { action: "agreement_pdf", agreementId: agreement.id } });
    expect(right.body).toMatchObject({ ok: true, url: "https://files.example/signed.pdf" });
  });

  it("keeps a partner that was sent an agreement from being deleted", async () => {
    const p = addPartner({});
    state.tables.partner_agreements = [{ id: fakeId(), partner_id: p.id, status: "void" }];
    const res = await call(partnerHandler, { method: "DELETE", token: OWNER, id: p.id });
    expect(res.statusCode).toBe(409);
    expect(res.body.message).toMatch(/kept for the record/);
  });

  it("approves an application with a signed agreement on file and sends the welcome by default", async () => {
    const p = addPartner({});
    signAgreement(p.id);
    const res = await call(partnerHandler, { method: "PATCH", token: OWNER, id: p.id, body: { action: "approve" } });
    expect(res.statusCode).toBe(200);
    expect(p.status).toBe("active");
    expect(typeof p.approved_at).toBe("string");
    expect(res.body).toMatchObject({ ok: true, welcome: "sent", referralCode: null });
    expect(welcomeCalls).toEqual([p.id]);
  });

  it("can approve quietly, and gives an approved referral partner a code", async () => {
    const p = addPartner({ kind: "referrer", categories: [], profession: "realtor", fee_percent: 3 });
    signAgreement(p.id);
    const res = await call(partnerHandler, {
      method: "PATCH",
      token: OWNER,
      id: p.id,
      body: { action: "approve", sendWelcome: false },
    });
    expect(res.statusCode).toBe(200);
    expect(welcomeCalls).toEqual([]);
    expect(typeof res.body.referralCode).toBe("string");
    expect(state.tables.referral_codes[0]).toMatchObject({ partner_id: p.id, code: res.body.referralCode });
  });

  it("keeps a referral partner's code when paused and reactivated", async () => {
    const p = addPartner({ kind: "referrer", status: "active", categories: [], profession: "realtor" });
    state.tables.referral_codes = [{ id: fakeId(), code: "keepme22", partner_id: p.id }];
    await call(partnerHandler, { method: "PATCH", token: OWNER, id: p.id, body: { action: "pause" } });
    expect(p.status).toBe("paused");
    const res = await call(partnerHandler, { method: "PATCH", token: OWNER, id: p.id, body: { action: "activate" } });
    expect(p.status).toBe("active");
    expect(res.body.referralCode).toBe("keepme22");
    expect(state.tables.referral_codes).toHaveLength(1);
  });

  it("only moves between statuses that make sense", async () => {
    const active = addPartner({ status: "active" });
    expect((await call(partnerHandler, { method: "PATCH", token: OWNER, id: active.id, body: { action: "approve" } })).statusCode).toBe(409);
    expect((await call(partnerHandler, { method: "PATCH", token: OWNER, id: active.id, body: { action: "activate" } })).statusCode).toBe(409);
    const applied = addPartner({});
    expect((await call(partnerHandler, { method: "PATCH", token: OWNER, id: applied.id, body: { action: "pause" } })).statusCode).toBe(409);
    expect((await call(partnerHandler, { method: "PATCH", token: OWNER, id: applied.id, body: { action: "decline" } })).statusCode).toBe(200);
    expect(applied.status).toBe("declined");
    expect(welcomeCalls).toEqual([]);
    expect((await call(partnerHandler, { method: "PATCH", token: OWNER, id: applied.id, body: { action: "explode" } })).statusCode).toBe(400);
  });

  it("updates only the fields sent, cleaned", async () => {
    const p = addPartner({ status: "active", phone: "314-555-0100" });
    const res = await call(partnerHandler, {
      method: "PATCH",
      token: OWNER,
      id: p.id,
      body: { action: "update", fields: { feePercent: "7.5", website: "gateway.example", categories: ["one_piece", "lorcana"] } },
    });
    expect(res.statusCode).toBe(200);
    expect(p).toMatchObject({
      fee_percent: 7.5,
      website: "https://gateway.example/",
      // Unknown categories (Lorcana isn't one) are dropped.
      categories: ["one_piece"],
      phone: "314-555-0100",
      business_name: "Gateway Games",
    });
    const blank = await call(partnerHandler, {
      method: "PATCH",
      token: OWNER,
      id: p.id,
      body: { action: "update", fields: { businessName: " " } },
    });
    expect(blank.statusCode).toBe(400);
    expect(p.business_name).toBe("Gateway Games");
  });

  it("404s for an unknown partner and 400s for a bad id", async () => {
    expect((await call(partnerHandler, { method: "PATCH", token: OWNER, id: fakeId(), body: { action: "approve" } })).statusCode).toBe(404);
    expect((await call(partnerHandler, { method: "PATCH", token: OWNER, id: "nope", body: { action: "approve" } })).statusCode).toBe(400);
  });
});

describe("DELETE /api/admin/partners/:id", () => {
  it("deletes a partner with no fee records", async () => {
    const p = addPartner({});
    const res = await call(partnerHandler, { method: "DELETE", token: OWNER, id: p.id });
    expect(res.statusCode).toBe(204);
    expect(state.tables.partners).toHaveLength(0);
    expect(state.tables.admin_audit_log?.[0]).toMatchObject({ action: "partner.delete" });
  });

  it("keeps a store that leads were sent to", async () => {
    const p = addPartner({ status: "active" });
    state.tables.partner_referrals = [{ id: fakeId(), partner_id: p.id }];
    const res = await call(partnerHandler, { method: "DELETE", token: OWNER, id: p.id });
    expect(res.statusCode).toBe(409);
    expect(res.body.message).toMatch(/Pause it instead/);
    expect(state.tables.partners).toHaveLength(1);
  });

  it("keeps a referral partner that earned referral fees", async () => {
    const p = addPartner({ kind: "referrer", status: "active", categories: [] });
    state.tables.referral_rewards = [{ id: fakeId(), partner_id: p.id, kind: "cash", amount_cents: 1500 }];
    const res = await call(partnerHandler, { method: "DELETE", token: OWNER, id: p.id });
    expect(res.statusCode).toBe(409);
    expect(res.body.message).toMatch(/earned referral fees/);
    expect(state.tables.partners).toHaveLength(1);
  });

  it("is owner-only", async () => {
    const p = addPartner({});
    expect((await call(partnerHandler, { method: "DELETE", token: STAFF, id: p.id })).statusCode).toBe(403);
    expect(state.tables.partners).toHaveLength(1);
  });
});

describe("PATCH /api/admin/partners/:id — message", () => {
  it("emails an applicant, keeps the message, leaves their status alone and logs it", async () => {
    const p = addPartner({ kind: "referrer", categories: [], profession: "other", email: "chay@example.com" });
    const res = await call(partnerHandler, {
      method: "PATCH",
      token: OWNER,
      id: p.id,
      body: { action: "message", subject: "  A few   questions ", message: "Hi there\r\n\r\n\r\n\r\nWhat do you do?   \n" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ ok: true, email: "sent" });
    const [row] = state.tables.partner_messages;
    expect(row).toMatchObject({
      partner_id: p.id,
      sent_by: "owner-1",
      sent_by_email: "owner@example.com",
      to_email: "chay@example.com",
      subject: "A few questions",
      body: "Hi there\n\nWhat do you do?",
    });
    expect(messageCalls).toEqual([row.id]);
    expect(p.status).toBe("applied");
    expect(state.tables.admin_audit_log?.[0]).toMatchObject({ action: "partner.message", resource_id: p.id });
  });

  it("marks the message when the email fails, so staff know to email by hand", async () => {
    messageEmailStatus = "failed";
    const p = addPartner({});
    const res = await call(partnerHandler, { method: "PATCH", token: OWNER, id: p.id, body: { action: "message", subject: "Hi", message: "Question" } });
    expect(res.statusCode).toBe(200);
    expect(res.body.email).toBe("failed");
    expect(state.tables.partner_messages[0].email_status).toBe("failed");
  });

  it("needs a subject and a message within the limits, and is owner-only", async () => {
    const p = addPartner({});
    const send = (token: string, body: Record<string, unknown>) =>
      call(partnerHandler, { method: "PATCH", token, id: p.id, body: { action: "message", ...body } });
    expect((await send(OWNER, { subject: " ", message: "x" })).statusCode).toBe(400);
    expect((await send(OWNER, { subject: "Hi", message: "   " })).statusCode).toBe(400);
    expect((await send(OWNER, { subject: "Hi", message: "x".repeat(5001) })).statusCode).toBe(400);
    expect((await send(STAFF, { subject: "Hi", message: "x" })).statusCode).toBe(403);
    expect(state.tables.partner_messages ?? []).toHaveLength(0);
    expect(messageCalls).toEqual([]);
  });
});
