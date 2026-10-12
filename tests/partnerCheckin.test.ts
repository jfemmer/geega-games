import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeState, createFakeSupabase, fakeId, fakeResponse, type FakeState } from "./helpers/fakeSupabase";

// The seller check-in a week after a lead goes to a partner store:
//   * /api/partner-referrals/checkin — GET only shows the question (email
//     scanners open links by themselves, and a "yes, I sold" nobody meant
//     would corrupt the fee records); POST records the answer. The signed
//     token proves the request came from that seller's email.
//   * /api/partner-referrals/process — the daily worker that sends the
//     check-in once per referral, in production only.

beforeAll(() => {
  process.env.SUPABASE_URL = "https://x.invalid";
  process.env.SUPABASE_SECRET_KEY = "svc";
  process.env.EMAIL_TOKEN_SECRET = "test-secret-for-guest-tokens";
  process.env.PUBLIC_SITE_URL = "https://geega-games.com";
});

let state: FakeState = createFakeState();
vi.mock("../api/_lib/supabaseAdmin.js", () => ({ getSupabaseAdmin: () => createFakeSupabase(state) }));

const pushes: { key: string; title: string }[] = [];
vi.mock("../api/_lib/staffPush.js", () => ({
  notifyStaff: vi.fn(async (n: { key: string; title: string }) => {
    pushes.push(n);
  }),
  usd: (cents: number) => `$${(cents / 100).toFixed(2)}`,
}));

const checkinSends: string[] = [];
let checkinResult: (id: string) => { status: string } = () => ({ status: "sent" });
vi.mock("../api/_lib/partnerEmails.js", () => ({
  sendPartnerReferralCheckin: vi.fn(async (id: string) => {
    checkinSends.push(id);
    return checkinResult(id);
  }),
}));

const { default: checkin, parseDollars } = await import("../api/partner-referrals/checkin.ts");
const { default: worker } = await import("../api/partner-referrals/process.ts");
const { signGuestToken } = await import("../api/_lib/guestAccess.ts");

let referral: Record<string, unknown>;

beforeEach(() => {
  state = createFakeState();
  pushes.length = 0;
  checkinSends.length = 0;
  checkinResult = () => ({ status: "sent" });
  const store = { id: fakeId(), business_name: "Gateway Games & Comics" };
  referral = {
    id: fakeId(),
    partner_id: store.id,
    lead_reference: "GG-R-100001",
    outcome: "pending",
    checkin_sent_at: "2026-10-01T15:35:00.000Z",
    checkin_response: null,
    checkin_amount_cents: null,
    checkin_responded_at: null,
  };
  state.tables.partners = [store];
  state.tables.partner_referrals = [referral];
});

async function get(query: Record<string, string>) {
  const res = fakeResponse();
  await checkin({ method: "GET", query, headers: {} } as never, res as never);
  return res as typeof res & { body: string };
}

async function post(fields: Record<string, string>) {
  const res = fakeResponse();
  // Vercel parses form posts into an object.
  await checkin({ method: "POST", body: fields, query: {}, headers: {} } as never, res as never);
  return res as typeof res & { body: string };
}

function token(id = referral.id as string) {
  return signGuestToken("checkin", id);
}

describe("GET /api/partner-referrals/checkin", () => {
  it("shows the question with their answer picked, and records nothing", async () => {
    const res = await get({ r: referral.id as string, a: "sold", t: token() });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toMatch(/text\/html/);
    expect(res.headers["x-robots-tag"]).toBe("noindex");
    expect(res.body).toContain("Did Gateway Games &amp; Comics get in touch?");
    expect(res.body).toMatch(/value="sold" checked/);
    expect(res.body).toContain('method="post"');
    expect(referral.checkin_response).toBeNull();
    expect(state.writes).toEqual([]);
  });

  it("refuses a link whose token doesn't match the referral", async () => {
    const other = fakeId();
    const res = await get({ r: referral.id as string, a: "sold", t: token(other) });
    expect(res.statusCode).toBe(400);
    expect(res.body).toContain("This link didn");
    expect(state.writes).toEqual([]);
  });

  it("says when they've already answered", async () => {
    referral.checkin_response = "not_sold";
    const res = await get({ r: referral.id as string, a: "sold", t: token() });
    expect(res.body).toContain("You already told us");
  });
});

describe("POST /api/partner-referrals/checkin", () => {
  it("records a sale with the amount they give", async () => {
    const res = await post({ r: referral.id as string, t: token(), a: "sold", amount: "$1,250.50" });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain("Congratulations on the sale");
    expect(referral).toMatchObject({ checkin_response: "sold", checkin_amount_cents: 125050 });
    expect(typeof referral.checkin_responded_at).toBe("string");
    // The answer is information for staff; it doesn't change the outcome or any fee.
    expect(referral.outcome).toBe("pending");
    expect(pushes).toEqual([]);
  });

  it("ignores an amount unless they sold, and a garbled amount", async () => {
    await post({ r: referral.id as string, t: token(), a: "not_sold", amount: "500" });
    expect(referral).toMatchObject({ checkin_response: "not_sold", checkin_amount_cents: null });
    await post({ r: referral.id as string, t: token(), a: "sold", amount: "about five hundred" });
    expect(referral).toMatchObject({ checkin_response: "sold", checkin_amount_cents: null });
  });

  it("alerts staff once when the store never got in touch", async () => {
    const res = await post({ r: referral.id as string, t: token(), a: "not_contacted" });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain("follow up with Gateway Games &amp; Comics");
    expect(pushes).toHaveLength(1);
    expect(pushes[0].title).toMatch(/never got in touch/);
    await post({ r: referral.id as string, t: token(), a: "not_contacted" });
    expect(pushes).toHaveLength(1);
  });

  it("shows the question again when no answer was picked", async () => {
    const res = await post({ r: referral.id as string, t: token() });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain("Pick the answer that fits");
    expect(referral.checkin_response).toBeNull();
  });

  it("refuses a forged token and an unknown referral", async () => {
    expect((await post({ r: referral.id as string, t: "x".repeat(43), a: "sold" })).statusCode).toBe(400);
    const missing = fakeId();
    expect((await post({ r: missing, t: token(missing), a: "sold" })).statusCode).toBe(404);
    expect(referral.checkin_response).toBeNull();
  });

  it("turns away other methods", async () => {
    const res = fakeResponse();
    await checkin({ method: "PUT", query: {}, headers: {} } as never, res as never);
    expect(res.statusCode).toBe(405);
  });
});

describe("parseDollars", () => {
  it("reads dollars the way people type them", () => {
    expect(parseDollars("1250")).toBe(125000);
    expect(parseDollars("$1,250.5")).toBe(125050);
    expect(parseDollars(" 99.99 ")).toBe(9999);
    expect(parseDollars("")).toBeNull();
    expect(parseDollars("-5")).toBeNull();
    expect(parseDollars("12.345")).toBeNull();
    expect(parseDollars("1e5")).toBeNull();
    expect(parseDollars("2000000")).toBeNull();
    expect(parseDollars(undefined)).toBeNull();
  });
});

describe("/api/partner-referrals/process (daily worker)", () => {
  async function run(method = "POST") {
    const res = fakeResponse();
    await worker({ method, headers: {}, query: {} } as never, res as never);
    return res as typeof res & { body: Record<string, unknown> };
  }

  function addReferral(row: Record<string, unknown>) {
    const r = {
      id: fakeId(),
      outcome: "pending",
      checkin_sent_at: null,
      sent_at: "2026-09-20T12:00:00.000Z",
      ...row,
    };
    state.tables.partner_referrals.push(r);
    return r;
  }

  beforeEach(() => {
    state.tables.partner_referrals = [];
    delete process.env.VERCEL_ENV;
  });

  it("checks in once on each pending referral sent at least a week ago", async () => {
    const due = addReferral({});
    const recent = addReferral({ sent_at: new Date().toISOString() });
    const decided = addReferral({ outcome: "sold" });
    const alreadyAsked = addReferral({ checkin_sent_at: "2026-09-28T15:35:00.000Z" });
    const res = await run();
    expect(res.statusCode).toBe(200);
    expect(checkinSends).toEqual([due.id]);
    expect(typeof due.checkin_sent_at).toBe("string");
    expect(recent.checkin_sent_at).toBeNull();
    expect(decided.checkin_sent_at).toBeNull();
    expect(alreadyAsked.checkin_sent_at).toBe("2026-09-28T15:35:00.000Z");
    expect(res.body).toMatchObject({ ok: true, due: 1, sent: 1, failed: 0 });

    // The next day, nothing is sent again.
    await run();
    expect(checkinSends).toEqual([due.id]);
  });

  it("retries a failed send the next day, and stops on one with nothing to send", async () => {
    const failing = addReferral({});
    const gone = addReferral({});
    checkinResult = (id) => (id === failing.id ? { status: "failed" } : { status: "skipped" });
    const res = await run();
    expect(res.body).toMatchObject({ due: 2, sent: 0, skipped: 1, failed: 1 });
    expect(failing.checkin_sent_at).toBeNull();
    expect(typeof gone.checkin_sent_at).toBe("string");
  });

  it("never runs on a preview deployment (it shares the production database)", async () => {
    addReferral({});
    process.env.VERCEL_ENV = "preview";
    const res = await run("GET");
    expect(res.body).toMatchObject({ ok: true, skipped: "not production" });
    expect(checkinSends).toEqual([]);
    delete process.env.VERCEL_ENV;
  });

  it("turns away other methods", async () => {
    expect((await run("DELETE")).statusCode).toBe(405);
  });
});
