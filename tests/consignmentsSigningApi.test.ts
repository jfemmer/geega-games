import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createFakeState, createFakeSupabase, fakeResponse, type FakeState } from "./helpers/fakeSupabase";

// Consignment agreements over the API.
//
// /api/consignments (consignors): opening an invitation needs the invited
// email's account; signing passes the session's own identity, IP and browser
// to consignment_sign_agreement, then stores and emails the signed PDF;
// a signed PDF link is only for its signer.
//
// /api/admin/consignments: creating a consignment links an existing account,
// sending one stores only the token's hash and emails the link, and
// publishing is the owner's and refused while blanks remain.

beforeAll(() => {
  process.env.SUPABASE_URL = "https://x.invalid";
  process.env.SUPABASE_SECRET_KEY = "svc";
  process.env.PUBLIC_SITE_URL = "https://geega-games.com";
});

let state: FakeState = createFakeState();
vi.mock("../api/_lib/supabaseAdmin.js", () => ({ getSupabaseAdmin: () => createFakeSupabase(state) }));

type Sent = { emailType: string; to: string; subject: string; text: string; attachments?: { filename: string; content: Buffer }[] };
const sent: Sent[] = [];
vi.mock("../api/_lib/emailService.js", () => ({
  sendTrackedEmail: vi.fn(async (args: Sent) => {
    sent.push(args);
    return { status: "sent", resendEmailId: "re_1", deduped: false };
  }),
}));

const { default: consignments } = await import("../api/consignments.ts");
const { default: adminConsignments } = await import("../api/admin/consignments.ts");

const PAT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const EVE = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1";
const C1 = "c1c1c1c1-c1c1-4c1c-8c1c-c1c1c1c1c1c1";
const A1 = "a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1";
const V1ID = "b1b1b1b1-b1b1-4b1b-8b1b-b1b1b1b1b1b1";
const TOKEN = "T".repeat(43);
const sha = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");
const V1 = readFileSync(new URL("../docs/consignment-agreement-v1.md", import.meta.url), "utf8");
const RENDERED = "## 1. Parties\n\n" + "Consignment terms for Pat. ".repeat(10);

async function call(handler: typeof consignments, req: Record<string, unknown>) {
  const res = fakeResponse();
  await handler({ headers: {}, query: {}, ...req } as never, res as never);
  return res as typeof res & { body: Record<string, unknown> & { message?: string } };
}
const as = (token: string | null, method: string, query: Record<string, string> = {}, body?: Record<string, unknown>) =>
  call(consignments, {
    method,
    query,
    body,
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), "x-forwarded-for": "203.0.113.9, 10.0.0.1", "user-agent": "TestBrowser/1.0" },
  });
const asAdmin = (token: string, method: string, query: Record<string, string> = {}, body?: Record<string, unknown>) =>
  call(adminConsignments, { method, query, body, headers: { authorization: `Bearer ${token}` } });

beforeEach(() => {
  state = createFakeState();
  sent.length = 0;
  state.sessions["pat-token"] = { id: PAT, email: "Pat@X.com", app_metadata: {} };
  state.sessions["eve-token"] = { id: EVE, email: "eve@x.com", app_metadata: {} };
  state.sessions["owner-token"] = { id: "owner", email: "jacob@example.com", app_metadata: { role: "admin" } };
  state.sessions["staff-token"] = { id: "staff", email: "helper@example.com", app_metadata: { role: "staff" } };
  state.tables.consignors = [{ id: "p1", legal_name: "Pat Consignor", email: "pat@x.com", user_id: null }];
  state.tables.consignments = [{ id: C1, consignment_number: 1001, consignor_id: "p1", status: "awaiting_signature" }];
  state.tables.consignment_agreement_versions = [{ id: V1ID, version_number: 1, title: "Geega Games Consignment Agreement", status: "published", body_md: V1 }];
  state.tables.consignment_agreements = [
    {
      id: A1,
      consignment_id: C1,
      version_id: V1ID,
      status: "pending",
      rendered_md: RENDERED,
      rendered_sha256: sha(RENDERED),
      terms_snapshot: { capturedAt: "2026-10-28T00:00:00Z" },
      invited_email: "pat@x.com",
      invite_token_hash: sha(TOKEN),
      invite_expires_at: new Date(Date.now() + 86_400_000).toISOString(),
      signed_at: null,
    },
  ];
  state.tables.consignment_signatures = [];
  state.tables.email_deliveries = [];
  state.tables.admin_audit_log = [];
});

describe("opening an invitation", () => {
  it("needs a signed-in account", async () => {
    expect((await as(null, "GET", { view: "invite", t: TOKEN })).statusCode).toBe(401);
  });

  it("says a wrong or old link isn't valid", async () => {
    expect((await as("pat-token", "GET", { view: "invite", t: "x".repeat(43) })).statusCode).toBe(404);
    expect((await as("pat-token", "GET", { view: "invite", t: "short" })).statusCode).toBe(404);
  });

  it("is only for the invited email's account, and says where it went without the full address", async () => {
    const res = await as("eve-token", "GET", { view: "invite", t: TOKEN });
    expect(res.statusCode).toBe(403);
    expect(res.body.message).toBe("This agreement was sent to p***@x.com. Sign in with that email address to open it.");
    expect(JSON.stringify(res.body)).not.toContain("Consignment terms");
  });

  it("shows the invited consignor the frozen text and its hash", async () => {
    const res = await as("pat-token", "GET", { view: "invite", t: TOKEN });
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ status: "pending", consignmentLabel: "GG-C-1001", consignorName: "Pat Consignor", renderedMd: RENDERED, agreementSha256: sha(RENDERED) });
  });

  it("says when the link was replaced or has expired", async () => {
    state.tables.consignment_agreements[0].status = "void";
    expect((await as("pat-token", "GET", { view: "invite", t: TOKEN })).statusCode).toBe(410);
    state.tables.consignment_agreements[0].status = "pending";
    state.tables.consignment_agreements[0].invite_expires_at = new Date(Date.now() - 1000).toISOString();
    expect((await as("pat-token", "GET", { view: "invite", t: TOKEN })).body.message).toMatch(/expired/);
  });
});

describe("signing", () => {
  const body = {
    action: "sign",
    t: TOKEN,
    agreementSha256: sha(RENDERED),
    acknowledgments: { esign: true, reviewed: true, commission: true, deductions: true, shipping_liability: true, inspection: true, term: true, estimates: true, extra: true },
    channels: { website: true, tcgplayer: false, ebay: "yes" },
    additionalInsurance: true,
    legalName: "Pat Consignor",
    typedSignature: "Pat Consignor",
    signerEmail: "someone-else@x.com",
  };

  it("passes the session's identity, IP and browser to the signing function, then stores and emails the PDF", async () => {
    let args: Record<string, unknown> = {};
    state.rpc.consignment_sign_agreement = (a) => {
      args = a;
      state.tables.consignment_signatures.push({
        id: "s1",
        agreement_id: A1,
        consignment_id: C1,
        consignor_id: "p1",
        user_id: PAT,
        signer_email: "pat@x.com",
        legal_name: "Pat Consignor",
        typed_signature: "Pat Consignor",
        channels: { website: true, tcgplayer: false, ebay: false },
        additional_insurance: true,
        agreement_sha256: sha(RENDERED),
        record_sha256: "b".repeat(64),
        signed_at: "2026-10-28T17:00:00Z",
        ip: "203.0.113.9",
        user_agent: "TestBrowser/1.0",
        pdf_path: null,
        pdf_sha256: null,
        emailed_at: null,
      });
      return { data: "s1", error: null };
    };
    const res = await as("pat-token", "POST", {}, body);
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ ok: true, agreementId: A1, pdfReady: true });
    expect(args).toMatchObject({
      p_agreement_id: A1,
      p_user_id: PAT,
      p_signer_email: "pat@x.com", // from the session, never the body
      p_ip: "203.0.113.9",
      p_user_agent: "TestBrowser/1.0",
      p_channels: { website: true, tcgplayer: false, ebay: null }, // "yes" isn't an answer
      p_additional_insurance: true,
    });
    expect(Object.keys(args.p_acknowledgments as object)).not.toContain("extra");

    const sig = state.tables.consignment_signatures[0];
    expect(sig.pdf_path).toBe(`${C1}/${A1}.pdf`);
    const pdf = state.files[`${C1}/${A1}.pdf`];
    expect(pdf.data.subarray(0, 5).toString()).toBe("%PDF-");
    expect(sig.pdf_sha256).toBe(createHash("sha256").update(pdf.data).digest("hex"));
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ emailType: "consignment_signed", to: "pat@x.com" });
    expect(sent[0].attachments?.[0].filename).toBe("Geega-Games-Consignment-Agreement-GG-C-1001.pdf");
    expect(sig.emailed_at).toBeTruthy();
  });

  it("passes the database's refusal through as a clear message", async () => {
    state.rpc.consignment_sign_agreement = () => ({ data: null, error: { code: "GC038", message: "Answer Yes or No for every sales channel." } });
    const res = await as("pat-token", "POST", {}, body);
    expect(res.statusCode).toBe(400);
    expect(res.body.message).toBe("Answer Yes or No for every sales channel.");
    expect(sent).toHaveLength(0);
  });
});

describe("signed PDF links", () => {
  beforeEach(() => {
    state.tables.consignment_signatures = [{ id: "s1", agreement_id: A1, user_id: PAT, consignment_id: C1, pdf_path: `${C1}/${A1}.pdf` }];
  });

  it("gives the signer a short-lived link", async () => {
    const res = await as("pat-token", "GET", { view: "pdf", agreement: A1 });
    expect(res.statusCode).toBe(200);
    expect(res.body.url).toBe(`https://signed.example/${C1}/${A1}.pdf`);
  });

  it("treats someone else's agreement as not there", async () => {
    expect((await as("eve-token", "GET", { view: "pdf", agreement: A1 })).statusCode).toBe(404);
  });
});

describe("admin", () => {
  it("creates a consignment linked to the customer's existing account", async () => {
    state.tables.customers = [{ id: "cust1", email: "sam@x.com", auth_user_id: "user-sam" }];
    state.tables.consignment_settings = [{ id: true, initial_term_days: 90 }];
    let n = 1002;
    state.defaults.consignments = () => ({ consignment_number: n++, status: "draft" });
    const res = await asAdmin("staff-token", "POST", {}, {
      action: "createConsignment",
      consignor: { legalName: "  Sam   Rivera ", email: "Sam@X.com", stateCode: "il", postalCode: "62701" },
      adminNotes: "Collection from estate",
    });
    expect(res.statusCode).toBe(200);
    expect(res.body.consignment).toMatchObject({ label: "GG-C-1002" });
    expect(state.tables.consignors.find((c) => c.email === "sam@x.com")).toMatchObject({ legal_name: "Sam Rivera", state_code: "IL", user_id: "user-sam" });
    expect(state.tables.admin_audit_log[0]).toMatchObject({ action: "consignment.create" });
  });

  it("rejects a state outside the US", async () => {
    const res = await asAdmin("staff-token", "POST", {}, { action: "createConsignment", consignor: { legalName: "Sam", email: "s@x.com", stateCode: "ON" } });
    expect(res.statusCode).toBe(400);
  });

  it("sends the agreement: stores only the link's hash and emails the link", async () => {
    state.tables.consignments[0].status = "draft";
    state.rpc.consignment_estimator_settings = () => ({
      data: JSON.parse(readFileSync(new URL("./fixtures/estimatorSettings.json", import.meta.url), "utf8")),
      error: null,
    });
    let args: Record<string, unknown> = {};
    state.rpc.consignment_create_invitation = (a) => {
      args = a;
      state.tables.consignment_agreements.push({ id: "a2" });
      return { data: "a2", error: null };
    };
    const res = await asAdmin("staff-token", "POST", {}, { action: "sendInvitation", consignmentId: C1 });
    expect(res.statusCode).toBe(200);
    const link = (res.body.invitation as { signUrl: string }).signUrl;
    const token = new URL(link).searchParams.get("t")!;
    expect(link.startsWith("https://geega-games.com/consign/sign?t=")).toBe(true);
    expect(args.p_token_hash).toBe(sha(token));
    expect(JSON.stringify(args)).not.toContain(token);
    expect(args.p_rendered_md).toContain("GG-C-1001");
    expect(args.p_rendered_md).not.toMatch(/\{\{/);
    expect(sent[0]).toMatchObject({ emailType: "consignment_invite", to: "pat@x.com" });
    expect(sent[0].text).toContain(link);
  });

  it("lets only the owner publish, and refuses while blanks remain", async () => {
    state.tables.consignment_agreement_versions[0].status = "draft";
    expect((await asAdmin("staff-token", "POST", {}, { action: "publishVersion", id: V1ID, confirm: true })).statusCode).toBe(403);
    const res = await asAdmin("owner-token", "POST", {}, { action: "publishVersion", id: V1ID, confirm: true });
    expect(res.statusCode).toBe(409);
    expect(res.body.message).toMatch(/^Fill in or remove these before publishing: \[Geega Games legal entity name and form\]/);
  });
});
