import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { PDFDocument } from "pdf-lib";
import { createFakeState, createFakeSupabase, fakeId, fakeResponse, type FakeState } from "./helpers/fakeSupabase";

// Sending a partner agreement (api/_lib/partnerAgreements.ts) and signing it
// on the public page's API (api/partner-agreement.ts): the link's secret is
// only stored hashed; signing goes through partner_sign_agreement(). A
// Referral Partner Agreement (version 2) then waits for the owner: a push and
// an email say to countersign, and countersignAgreement() makes it take
// effect (referral code, welcome, the signed PDF with both signatures, to
// them and to us). A Partner Store Agreement takes effect when signed.

beforeAll(() => {
  process.env.SUPABASE_URL = "https://x.invalid";
  process.env.SUPABASE_SECRET_KEY = "svc";
  process.env.RESEND_FROM_ORDERS = "Geega Games <orders@geega-games.com>";
  process.env.RESEND_REPLY_TO = "support@geega-games.com";
  process.env.SELL_LEADS_NOTIFICATION_EMAIL = "leads@geega-games.com";
  process.env.PUBLIC_SITE_URL = "https://geega-games.com";
});

let state: FakeState = createFakeState();
vi.mock("../api/_lib/supabaseAdmin.js", () => ({ getSupabaseAdmin: () => createFakeSupabase(state) }));

type Sent = { emailType: string; to: string; subject: string; text: string; idempotencyKey: string; attachments?: { filename: string; content: Buffer }[] };
const sent: Sent[] = [];
vi.mock("../api/_lib/emailService.js", () => ({
  sendTrackedEmail: vi.fn(async (args: Sent) => {
    sent.push(args);
    return { status: "sent", resendEmailId: "re_1", deduped: false };
  }),
}));
const pushes: { title: string; url: string }[] = [];
vi.mock("../api/_lib/staffPush.js", () => ({
  notifyStaff: vi.fn(async (p: { title: string; url: string }) => {
    pushes.push(p);
  }),
  usd: (c: number) => `$${(c / 100).toFixed(2)}`,
}));
const welcomes: string[] = [];
vi.mock("../api/_lib/partnerEmails.js", () => ({
  sendPartnerApprovedEmail: vi.fn(async (id: string) => {
    welcomes.push(id);
    return { status: "sent" };
  }),
}));

const { sendPartnerAgreement, countersignAgreement } = await import("../api/_lib/partnerAgreements.ts");
const { default: handler } = await import("../api/partner-agreement.ts");

const sha = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");

let partner: Record<string, unknown>;

/** The two database functions, as the migration defines them (the rules themselves are tested in partnerAgreementsDb.test.ts). */
function installRpcs() {
  state.rpc.partner_create_agreement = (args) => {
    const rows = (state.tables.partner_agreements ??= []);
    for (const r of rows) {
      if (r.partner_id === args.p_partner_id && (r.status === "pending" || r.status === "awaiting_countersign")) Object.assign(r, { status: "void", voided_at: "now" });
    }
    const id = fakeId();
    rows.push({
      id,
      created_at: new Date().toISOString(),
      partner_id: args.p_partner_id,
      kind: args.p_kind,
      version_number: args.p_version_number,
      title: args.p_title,
      rendered_md: args.p_rendered_md,
      rendered_sha256: sha(String(args.p_rendered_md)),
      fee_percent: args.p_fee_percent,
      required_acks: args.p_required_acks,
      status: "pending",
      invited_email: String(args.p_invited_email).toLowerCase(),
      invite_token_hash: args.p_token_hash,
      invite_expires_at: args.p_expires_at,
      requires_countersign: args.p_requires_countersign === true,
      countersigned_at: null,
      pdf_path: null,
      pdf_sha256: null,
      signed_copy_emailed_at: null,
    });
    return { data: id, error: null };
  };
  state.rpc.partner_sign_agreement = (args) => {
    const a = state.tables.partner_agreements.find((r) => r.id === args.p_agreement_id)!;
    if (a.status === "signed" || a.status === "awaiting_countersign") {
      return { data: null, error: { code: "GP014", message: "This agreement is already signed." } };
    }
    if (args.p_agreement_sha256 !== a.rendered_sha256) return { data: null, error: { code: "GP016", message: "The agreement changed." } };
    const acks = args.p_acknowledgments as Record<string, boolean>;
    if ((a.required_acks as string[]).some((k) => acks[k] !== true)) return { data: null, error: { code: "GP017", message: "Tick every box before signing." } };
    if (a.requires_countersign && (!args.p_entity_name || !args.p_entity_type || !/^[A-Z]{2}$/.test(String(args.p_entity_state)) || !args.p_business_address)) {
      return { data: null, error: { code: "GP020", message: "Choose what kind of business it is." } };
    }
    const awaiting = a.requires_countersign === true;
    Object.assign(a, {
      status: awaiting ? "awaiting_countersign" : "signed",
      signed_at: "2026-11-11T15:00:00.000Z",
      signer_legal_name: args.p_legal_name,
      signer_title: args.p_title,
      typed_signature: args.p_typed_signature,
      acknowledgments: acks,
      signer_ip: args.p_ip,
      signer_user_agent: args.p_user_agent,
      signer_entity_name: awaiting ? args.p_entity_name : null,
      signer_entity_type: awaiting ? args.p_entity_type : null,
      signer_entity_state: awaiting ? args.p_entity_state : null,
      signer_business_address: awaiting ? args.p_business_address : null,
      record_sha256: "f".repeat(64),
    });
    const p = state.tables.partners.find((r) => r.id === a.partner_id)!;
    const activated = !awaiting && p.status === "applied";
    if (activated) Object.assign(p, { status: "active", fee_percent: a.fee_percent });
    return { data: { partnerId: p.id, kind: a.kind, activated, awaitingCountersign: awaiting }, error: null };
  };
  state.rpc.partner_countersign_agreement = (args) => {
    const a = state.tables.partner_agreements.find((r) => r.id === args.p_agreement_id)!;
    if (a.status !== "awaiting_countersign") return { data: null, error: { code: "GP022", message: "This agreement isn't waiting for a countersignature." } };
    Object.assign(a, {
      status: "signed",
      countersigned_at: "2026-11-12T16:00:00.000Z",
      countersigned_by_email: args.p_user_email,
      countersigner_name: args.p_name,
      countersigner_title: args.p_title,
      countersign_typed_signature: args.p_typed_signature,
      countersign_ip: args.p_ip,
      countersign_user_agent: args.p_user_agent,
      countersign_record_sha256: "c".repeat(64),
    });
    const p = state.tables.partners.find((r) => r.id === a.partner_id)!;
    const activated = p.status === "applied";
    if (activated) Object.assign(p, { status: "active", fee_percent: a.fee_percent });
    return { data: { partnerId: p.id, kind: a.kind, activated }, error: null };
  };
}

async function call(opts: { method: string; query?: Record<string, string>; body?: Record<string, unknown> }) {
  const req = {
    method: opts.method,
    headers: { "user-agent": "Mozilla/5.0 (iPhone)", "x-forwarded-for": `198.51.100.${Math.floor(Math.random() * 200)}` },
    body: opts.body ?? {},
    query: opts.query ?? {},
  };
  const res = fakeResponse();
  await handler(req as never, res as never);
  return res as typeof res & { body: Record<string, unknown> };
}

const tokenFrom = (url: string) => new URL(url).searchParams.get("t")!;

beforeEach(() => {
  state = createFakeState();
  sent.length = 0;
  pushes.length = 0;
  welcomes.length = 0;
  partner = {
    id: fakeId(),
    kind: "referrer",
    status: "applied",
    business_name: "NITE Run Delivery LLC",
    contact_name: "Chayson",
    email: "Chay@Example.com",
    city: "Fuquay-Varina",
    state: "NC",
    fee_percent: 3,
  };
  state.tables.partners = [partner];
  state.unique.referral_codes = [{ columns: ["code"] }, { columns: ["partner_id"] }];
  installRpcs();
});

describe("sending the agreement", () => {
  it("emails a private signing link and stores only its hash", async () => {
    const res = await sendPartnerAgreement(createFakeSupabase(state) as never, partner.id as string, { userId: "owner-1", email: "owner@x.com" });
    expect(res.emailed).toBe(true);
    const token = tokenFrom(res.signUrl);
    expect(res.signUrl).toMatch(/\/partner-agreement\?t=/);
    const [a] = state.tables.partner_agreements;
    expect(a.invite_token_hash).toBe(sha(token));
    expect(JSON.stringify(a)).not.toContain(token);
    expect(a.rendered_md).toContain("3% of the Net Purchase Price");
    expect(a.rendered_md).toContain("Version 3");
    expect(a.version_number).toBe(3);
    expect(a.requires_countersign).toBe(true);
    expect(a.required_acks).toContain("countersign");
    expect(sent[0]).toMatchObject({ emailType: "partner_agreement_invite", to: "Chay@Example.com" });
    expect(sent[0].subject).toContain("please sign your partner agreement");
    expect(sent[0].text).toContain(res.signUrl);
  });
});

describe("GET/POST /api/partner-agreement", () => {
  async function invite() {
    const res = await sendPartnerAgreement(createFakeSupabase(state) as never, partner.id as string, { userId: null, email: null });
    sent.length = 0;
    return tokenFrom(res.signUrl);
  }

  it("shows the agreement for a valid link, and nothing for a wrong one", async () => {
    const t = await invite();
    const view = await call({ method: "GET", query: { t } });
    expect(view.statusCode).toBe(200);
    expect(view.body).toMatchObject({
      status: "pending",
      kind: "referrer",
      businessName: "NITE Run Delivery LLC",
      versionNumber: 3,
      collectEntity: true,
      entityDefaults: { name: "NITE Run Delivery LLC", state: "NC" },
    });
    expect((view.body.acknowledgments as unknown[]).length).toBe(6);
    expect(view.body.agreementSha256).toBe(state.tables.partner_agreements[0].rendered_sha256);
    expect((await call({ method: "GET", query: { t: "x".repeat(43) } })).statusCode).toBe(404);
    expect((await call({ method: "GET", query: { t: "short" } })).statusCode).toBe(404);
  });

  it("an old link stops working once a new one is sent, and an expired one says so", async () => {
    const first = await invite();
    await invite();
    expect((await call({ method: "GET", query: { t: first } })).statusCode).toBe(410);
    const t = await invite();
    state.tables.partner_agreements.at(-1)!.invite_expires_at = "2020-01-01T00:00:00.000Z";
    const expired = await call({ method: "GET", query: { t } });
    expect(expired.statusCode).toBe(410);
    expect(expired.body.message).toMatch(/expired/);
  });

  const ENTITY = { name: "NITE Run Delivery LLC", type: "llc", state: "North Carolina", address: "100 Main St, Fuquay-Varina, NC 27526" };

  async function signAs(t: string, extra: Record<string, unknown> = { entity: ENTITY }) {
    const view = await call({ method: "GET", query: { t } });
    const acknowledgments = Object.fromEntries((view.body.acknowledgments as { key: string }[]).map((a) => [a.key, true]));
    const body = { t, legalName: "Chayson Ingram-Gray", title: "Owner", typedSignature: "Chayson Ingram-Gray", acknowledgments, agreementSha256: view.body.agreementSha256, ...extra };
    return { res: await call({ method: "POST", body }), body };
  }

  it("a referral partner's signature waits for the owner: nothing goes live, the owner is told to countersign", async () => {
    const t = await invite();
    expect((await signAs(t, {})).res.statusCode).toBe(400); // no entity details
    const { res, body } = await signAs(t);
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ ok: true, activated: false, awaitingCountersign: true, kind: "referrer", pdfEmailed: false });

    const a = state.tables.partner_agreements[0];
    // "North Carolina" arrives as the code the database checks for.
    expect(a).toMatchObject({ status: "awaiting_countersign", signer_entity_name: "NITE Run Delivery LLC", signer_entity_type: "llc", signer_entity_state: "NC" });
    expect(partner.status).toBe("applied");
    expect(state.tables.referral_codes ?? []).toEqual([]);
    expect(welcomes).toEqual([]);
    expect(a.pdf_path).toBeNull();

    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ emailType: "partner_agreement_countersign_needed", to: "leads@geega-games.com" });
    expect(sent[0].text).toContain("NITE Run Delivery LLC, a North Carolina limited liability company");
    expect(sent[0].text).toContain(`https://geega-games.com/admin_dashboard/partners?partner=${partner.id}`);
    expect(pushes[0]).toMatchObject({ title: "Countersign a partner agreement", url: `/admin_dashboard/partners?partner=${partner.id}` });

    // The link says it's waiting, and can't be signed again.
    expect((await call({ method: "GET", query: { t } })).body).toMatchObject({ status: "awaiting", signerName: "Chayson Ingram-Gray" });
    expect((await call({ method: "POST", body })).statusCode).toBe(409);
  });

  it("countersigning makes it take effect: referral code, welcome, the PDF with both signatures to them and to us", async () => {
    const t = await invite();
    await signAs(t);
    sent.length = 0;
    const a = state.tables.partner_agreements[0];
    const result = await countersignAgreement(createFakeSupabase(state) as never, a.id as string, {
      name: "Jacob Femmer",
      title: "Owner",
      typedSignature: "Jacob Femmer",
      userId: "owner-1",
      email: "owner@geega-games.com",
      ip: "198.51.100.7",
      userAgent: "Admin browser",
    });
    expect(result).toMatchObject({ activated: true, kind: "referrer", pdfReady: true, emailed: true });

    expect(partner.status).toBe("active");
    expect(state.tables.referral_codes?.[0]).toMatchObject({ partner_id: partner.id });
    expect(welcomes).toEqual([partner.id]);

    expect(a).toMatchObject({ status: "signed", countersigner_name: "Jacob Femmer" });
    expect(a.pdf_path).toBe(`${partner.id}/${a.id}.pdf`);
    const stored = state.files[a.pdf_path as string];
    expect(stored.contentType).toBe("application/pdf");
    expect(a.pdf_sha256).toBe(createHash("sha256").update(stored.data).digest("hex"));
    const pdf = await PDFDocument.load(stored.data);
    expect(pdf.getPageCount()).toBeGreaterThanOrEqual(3);
    expect(pdf.getTitle()).toBe("Geega Games Referral Partner Agreement - NITE Run Delivery LLC");
    expect(pdf.getKeywords()).toContain(`agreement-sha256:${a.rendered_sha256}`);
    expect(pdf.getKeywords()).toContain(`countersign-sha256:${"c".repeat(64)}`);

    const [toThem, toUs] = sent;
    expect(toThem).toMatchObject({ emailType: "partner_agreement_signed", to: "chay@example.com" });
    expect(toThem.subject).toBe("Your signed Geega Games Referral Partner Agreement is in effect");
    expect(toThem.attachments?.[0].filename).toBe("Geega-Games-Referral-Partner-Agreement-NITE-Run-Delivery-LLC.pdf");
    expect(toThem.text).toContain("Geega Games countersigned it on");
    expect(toThem.text).toContain("Your referral link is on its way");
    expect(toUs).toMatchObject({ emailType: "partner_agreement_signed_admin", to: "leads@geega-games.com" });
    expect(toUs.text).toContain("Countersigned by Jacob Femmer");

    expect((await call({ method: "GET", query: { t } })).body).toMatchObject({ status: "signed", effectiveAt: "2026-11-12T16:00:00.000Z" });
    // Once only.
    await expect(
      countersignAgreement(createFakeSupabase(state) as never, a.id as string, {
        name: "Jacob Femmer",
        title: "Owner",
        typedSignature: "Jacob Femmer",
        userId: null,
        email: null,
        ip: "",
        userAgent: "",
      }),
    ).rejects.toMatchObject({ status: 409 });
  });

  it("a partner store's signature takes effect at once: live, signed PDF to them and to us, and a push", async () => {
    Object.assign(partner, { kind: "store", fee_percent: 8 });
    const t = await invite();
    expect(state.tables.partner_agreements[0]).toMatchObject({ version_number: 1, requires_countersign: false });
    const { res } = await signAs(t, {});
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ ok: true, activated: true, awaitingCountersign: false, kind: "store", pdfEmailed: true });
    expect(partner.status).toBe("active");
    expect(welcomes).toEqual([partner.id]);
    expect(state.tables.referral_codes ?? []).toEqual([]);
    const [toThem, toUs] = sent;
    expect(toThem).toMatchObject({ emailType: "partner_agreement_signed", to: "chay@example.com" });
    expect(toThem.subject).toBe("Your signed Geega Games Partner Store Agreement");
    expect(toUs).toMatchObject({ emailType: "partner_agreement_signed_admin" });
    expect(pushes[0]).toMatchObject({ title: "Partner agreement signed" });
    expect((await call({ method: "GET", query: { t } })).body).toMatchObject({ status: "signed", signerName: "Chayson Ingram-Gray" });
  });

  it("refuses a signature with a box unticked, and changes nothing", async () => {
    const t = await invite();
    const view = await call({ method: "GET", query: { t } });
    const res = await call({
      method: "POST",
      body: {
        t,
        legalName: "Chayson Ingram-Gray",
        title: "Owner",
        typedSignature: "Chayson Ingram-Gray",
        acknowledgments: { esign: true, reviewed: true, unexpected: true },
        agreementSha256: view.body.agreementSha256,
      },
    });
    expect(res.statusCode).toBe(400);
    expect(partner.status).toBe("applied");
    expect(sent).toEqual([]);
    expect(welcomes).toEqual([]);
  });
});
