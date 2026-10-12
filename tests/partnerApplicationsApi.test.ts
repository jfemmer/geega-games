import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeState, createFakeSupabase, fakeResponse, type FakeState } from "./helpers/fakeSupabase";

// POST /api/partner-applications — the public forms on /for-stores and
// /referral-partners. Nothing goes anywhere until the owner approves an
// application, so the endpoint's job is: refuse junk, never trust the client
// for status or fee, store where the applicant came from, and tell staff.

beforeAll(() => {
  process.env.SUPABASE_URL = "https://x.invalid";
  process.env.SUPABASE_SECRET_KEY = "svc";
});

let state: FakeState = createFakeState();
vi.mock("../api/_lib/supabaseAdmin.js", () => ({ getSupabaseAdmin: () => createFakeSupabase(state) }));

const emailCalls: string[] = [];
vi.mock("../api/_lib/partnerEmails.js", () => ({
  sendPartnerApplicationEmails: vi.fn(async (id: string) => {
    emailCalls.push(id);
    return { admin: { status: "sent" }, applicant: { status: "sent" } };
  }),
}));

const { default: handler } = await import("../api/partner-applications.ts");

let ipCounter = 0;
async function post(body: Record<string, unknown>, method = "POST") {
  ipCounter += 1;
  const ip = `203.0.113.${ipCounter}`;
  const req = { method, headers: { "x-forwarded-for": ip }, body, socket: { remoteAddress: ip } };
  const res = fakeResponse();
  await handler(req as never, res as never);
  return res as typeof res & { body: { ok: boolean; message?: string } };
}

const store = {
  kind: "store",
  businessName: "Gateway Games",
  contactName: "Pat Lee",
  email: "Pat@GatewayGames.example",
  phone: "314-555-0100",
  website: "gatewaygames.example",
  city: "Kirkwood",
  state: "MO",
  categories: ["pokemon", "video_games", "pokemon", "baseball"],
  coverage: "St. Louis County, and by mail",
  buysByMail: true,
  agreed: true,
};

const referrer = {
  kind: "referrer",
  businessName: "Heirloom Estate Sales",
  contactName: "Jo Park",
  email: "jo@heirloom.example",
  city: "St. Charles",
  state: "Missouri",
  profession: "estate_sale",
  agreed: true,
};

function saved() {
  return state.tables.partners ?? [];
}

beforeEach(() => {
  state = createFakeState();
  emailCalls.length = 0;
});

describe("POST /api/partner-applications", () => {
  it("rejects other methods", async () => {
    expect((await post({}, "GET")).statusCode).toBe(405);
  });

  it("saves a store application as 'applied' with the default fee, and emails staff and the applicant", async () => {
    const res = await post({ ...store, status: "active", fee_percent: 0, feePercent: 0 });
    expect(res.statusCode).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(saved()).toHaveLength(1);
    const row = saved()[0];
    expect(row).toMatchObject({
      kind: "store",
      // Never from the client: status and fee are the server's.
      status: "applied",
      fee_percent: 8,
      business_name: "Gateway Games",
      contact_name: "Pat Lee",
      email: "pat@gatewaygames.example",
      website: "https://gatewaygames.example/",
      city: "Kirkwood",
      state: "MO",
      // Deduplicated, unknown categories dropped.
      categories: ["pokemon", "video_games"],
      buys_by_mail: true,
      profession: null,
    });
    expect(typeof row.agreed_to_standards_at).toBe("string");
    expect(emailCalls).toEqual([row.id]);
  });

  it("saves a referral partner with its profession, a state name turned into a code, and no store fields", async () => {
    const res = await post({ ...referrer, categories: ["pokemon"], buysByMail: true, coverage: "x" });
    expect(res.statusCode).toBe(200);
    expect(saved()[0]).toMatchObject({
      kind: "referrer",
      status: "applied",
      fee_percent: 3,
      state: "MO",
      profession: "estate_sale",
      categories: [],
      coverage: null,
      buys_by_mail: false,
    });
  });

  it("stores where the applicant came from, cleaned", async () => {
    await post({
      ...store,
      attribution: {
        utmSource: "Card Show",
        utmMedium: "qr",
        utmCampaign: "Nov 1 Show!",
        landingPath: "/for-stores?utm_source=card_show",
        referrerHost: "l.facebook.com",
        ref: "abcd2345",
      },
    });
    expect(saved()[0]).toMatchObject({
      utm_source: "card-show",
      utm_medium: "qr",
      utm_campaign: "nov-1-show",
      landing_path: "/for-stores",
      referrer_host: "l.facebook.com",
    });
    // Partners can't be "referred" — there's no ref column on the application.
    expect(saved()[0]).not.toHaveProperty("ref_code");
  });

  it("pretends to succeed for bots that fill the honeypot, and stores nothing", async () => {
    const res = await post({ ...store, fax: "555-0199" });
    expect(res.statusCode).toBe(200);
    expect(saved()).toHaveLength(0);
    expect(emailCalls).toEqual([]);
  });

  it("requires agreeing to the standards", async () => {
    const res = await post({ ...store, agreed: false });
    expect(res.statusCode).toBe(400);
    expect(res.body.message).toMatch(/partner standards/);
    const res2 = await post({ ...referrer, agreed: "yes" });
    expect(res2.statusCode).toBe(400);
    expect(saved()).toHaveLength(0);
  });

  it("requires the kind, names, a valid email, and a city and state", async () => {
    expect((await post({ ...store, kind: "wholesaler" })).statusCode).toBe(400);
    expect((await post({ ...store, businessName: "  " })).statusCode).toBe(400);
    expect((await post({ ...store, contactName: undefined })).statusCode).toBe(400);
    expect((await post({ ...store, email: "not-an-email" })).statusCode).toBe(400);
    expect((await post({ ...store, city: "" })).statusCode).toBe(400);
    expect((await post({ ...store, state: "Ontario" })).statusCode).toBe(400);
    expect(saved()).toHaveLength(0);
  });

  it("requires a store to say what it buys, and a referral partner what they do", async () => {
    const noCategories = await post({ ...store, categories: ["baseball"] });
    expect(noCategories.statusCode).toBe(400);
    expect(noCategories.body.message).toMatch(/what your store buys/);
    const noProfession = await post({ ...referrer, profession: "astronaut" });
    expect(noProfession.statusCode).toBe(400);
    expect(noProfession.body.message).toMatch(/what you do/);
    expect(saved()).toHaveLength(0);
  });

  it("allows three applications per email a day, then asks them to wait", async () => {
    for (let i = 0; i < 3; i++) expect((await post(store)).statusCode).toBe(200);
    const fourth = await post({ ...store, email: "PAT@gatewaygames.example" });
    expect(fourth.statusCode).toBe(429);
    expect(saved()).toHaveLength(3);
  });

  it("still succeeds when the emails fail — the application is saved", async () => {
    const { sendPartnerApplicationEmails } = await import("../api/_lib/partnerEmails.js");
    vi.mocked(sendPartnerApplicationEmails).mockRejectedValueOnce(new Error("resend down"));
    const res = await post(store);
    expect(res.statusCode).toBe(200);
    expect(saved()).toHaveLength(1);
  });

  it("reports a database failure without pretending it worked", async () => {
    // An old application from the same email doesn't count toward today's
    // limit; a (simulated) unique clash makes the insert itself fail.
    state.unique.partners = [{ columns: ["email"] }];
    state.tables.partners = [{ id: "x", email: "pat@gatewaygames.example", created_at: "2000-01-01T00:00:00.000Z" }];
    const res = await post(store);
    expect(res.statusCode).toBe(500);
    expect(res.body.message).toMatch(/couldn't save your application/i);
    expect(emailCalls).toEqual([]);
  });
});
