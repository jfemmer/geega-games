import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// Security-boundary + business-rule tests for the public, unauthenticated
// "respond to your offer" endpoint. Mirrors sellSubmitApi.test.ts's mocking
// style (a stateful fake for getSupabaseAdmin, mocked email senders, a
// per-test unique IP so the module-level rate limiter never interferes).

beforeAll(() => {
  process.env.SUPABASE_URL = "https://x.invalid";
  process.env.SUPABASE_SECRET_KEY = "svc";
  process.env.RESEND_API_KEY = "re_test";
  process.env.RESEND_FROM_ORDERS = "Geega <orders@geega-games.com>";
  process.env.RESEND_REPLY_TO = "support@geega-games.com";
  process.env.PUBLIC_SITE_URL = "https://geega-games.com";
});

interface FakeSubmission {
  id: string;
  email: string;
  user_id?: string | null;
  reference_number: string;
  offer_value_cents: number | null;
  offer_sent_at: string | null;
  offer_responded_at: string | null;
  total_cards: number;
  collection_size: string | null;
}

const state: {
  submission: FakeSubmission | null;
  lastEq: { col: string; val: unknown }[];
  lastUpdate: Record<string, unknown> | null;
  updateShouldFail: boolean;
} = {
  submission: null,
  lastEq: [],
  lastUpdate: null,
  updateShouldFail: false,
};

vi.mock("../api/_lib/supabaseAdmin.js", () => ({
  getSupabaseAdmin: () => ({
    from: (table: string) => {
      if (table !== "sell_submissions") throw new Error(`unexpected table ${table}`);
      return {
        select: () => ({
          eq: (col1: string, val1: unknown) => {
            state.lastEq = [{ col: col1, val: val1 }];
            return {
              eq: (col2: string, val2: unknown) => {
                state.lastEq.push({ col: col2, val: val2 });
                return {
                  maybeSingle: async () => {
                    const match =
                      state.submission &&
                      state.submission.reference_number === val1 &&
                      state.submission.email === val2;
                    return { data: match ? state.submission : null, error: null };
                  },
                };
              },
            };
          },
        }),
        update: (patch: Record<string, unknown>) => {
          state.lastUpdate = patch;
          return {
            eq: async () => ({
              error: state.updateShouldFail ? { message: "update failed" } : null,
            }),
          };
        },
      };
    },
  }),
}));

const emailCalls: {
  statusUpdate: { id: string; status: string }[];
  responseConfirmation: unknown[];
  adminNotification: unknown[];
} = { statusUpdate: [], responseConfirmation: [], adminNotification: [] };

vi.mock("../api/_lib/sellSubmissionEmails.js", () => ({
  sendSellSubmissionStatusUpdate: vi.fn(async (id: string, status: string) => {
    emailCalls.statusUpdate.push({ id, status });
    return { status: "sent" };
  }),
  sendSellSubmissionOfferResponseConfirmation: vi.fn(async (...args: unknown[]) => {
    emailCalls.responseConfirmation.push(args);
    return { status: "sent" };
  }),
  sendSellSubmissionOfferResponseAdminNotification: vi.fn(async (...args: unknown[]) => {
    emailCalls.adminNotification.push(args);
    return { status: "sent" };
  }),
}));

// Store credit identifies the seller from their Supabase access token.
vi.mock("@supabase/supabase-js", () => ({
  createClient: (_url: string, _key: string, opts: { global: { headers: Record<string, string> } }) => ({
    auth: {
      getUser: async () =>
        opts.global.headers.Authorization === "Bearer good-token"
          ? { data: { user: { id: "user-9" } }, error: null }
          : { data: { user: null }, error: { message: "invalid" } },
    },
  }),
}));

const { default: handler } = await import("../api/sell/respond-to-offer.ts");

let ipCounter = 0;
function nextIp(): string {
  ipCounter += 1;
  return `203.0.114.${ipCounter}`;
}

function makeReqRes(body: Record<string, unknown>, ip?: string) {
  const resolvedIp = ip ?? nextIp();
  const req = {
    method: "POST",
    headers: { "x-forwarded-for": resolvedIp, "content-type": "application/json" },
    body,
    socket: { remoteAddress: resolvedIp },
  };
  const res = {
    statusCode: 200,
    body: undefined as unknown,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.body = payload;
      return this;
    },
    setHeader() {},
  };
  return { req, res };
}

async function invoke(body: Record<string, unknown>, ip?: string) {
  const { req, res } = makeReqRes(body, ip);
  await handler(req as never, res as never);
  return res;
}

const BASE_SUBMISSION: FakeSubmission = {
  id: "sub-1",
  email: "jordan@example.com",
  reference_number: "GG-S-100042",
  offer_value_cents: 35000,
  offer_sent_at: "2026-09-21T12:00:00Z",
  offer_responded_at: null,
  total_cards: 0,
  collection_size: "10000_plus",
};

beforeEach(() => {
  state.submission = { ...BASE_SUBMISSION };
  state.lastEq = [];
  state.lastUpdate = null;
  state.updateShouldFail = false;
  emailCalls.statusUpdate = [];
  emailCalls.responseConfirmation = [];
  emailCalls.adminNotification = [];
});

describe("POST /api/sell/respond-to-offer", () => {
  it("rejects a non-POST method", async () => {
    const { req, res } = makeReqRes({});
    req.method = "GET";
    await handler(req as never, res as never);
    expect(res.statusCode).toBe(405);
  });

  it("rejects a missing reference number, email, or response", async () => {
    const res = await invoke({ email: "jordan@example.com", response: "accepted" });
    expect(res.statusCode).toBe(400);
    const res2 = await invoke({ referenceNumber: "GG-S-100042", response: "accepted" });
    expect(res2.statusCode).toBe(400);
    const res3 = await invoke({ referenceNumber: "GG-S-100042", email: "jordan@example.com" });
    expect(res3.statusCode).toBe(400);
  });

  it("rejects an invalid response value", async () => {
    const res = await invoke({
      referenceNumber: "GG-S-100042",
      email: "jordan@example.com",
      response: "maybe",
    });
    expect(res.statusCode).toBe(400);
  });

  it("independently re-matches reference number (uppercased) and email (lowercased) server-side, never trusting a bare id", async () => {
    const res = await invoke({
      referenceNumber: "gg-s-100042",
      email: "JORDAN@example.com",
      response: "declined",
    });
    expect(res.statusCode).toBe(200);
    expect(state.lastEq).toEqual([
      { col: "reference_number", val: "GG-S-100042" },
      { col: "email", val: "jordan@example.com" },
    ]);
  });

  it("returns an identical 404 for a wrong ref/email pair and for a real submission with no offer sent yet — anti-enumeration", async () => {
    const wrongMatch = await invoke({
      referenceNumber: "GG-S-999999",
      email: "nobody@example.com",
      response: "declined",
    });
    expect(wrongMatch.statusCode).toBe(404);

    state.submission = { ...BASE_SUBMISSION, offer_sent_at: null, offer_value_cents: null };
    const noOfferYet = await invoke({
      referenceNumber: "GG-S-100042",
      email: "jordan@example.com",
      response: "declined",
    });
    expect(noOfferYet.statusCode).toBe(404);
    expect((noOfferYet.body as { message: string }).message).toBe(
      (wrongMatch.body as { message: string }).message,
    );
    expect(state.lastUpdate).toBeNull();
  });

  it("rejects a second response to an already-responded offer", async () => {
    state.submission = { ...BASE_SUBMISSION, offer_responded_at: "2026-09-22T00:00:00Z" };
    const res = await invoke({
      referenceNumber: "GG-S-100042",
      email: "jordan@example.com",
      response: "declined",
    });
    expect(res.statusCode).toBe(409);
    expect(state.lastUpdate).toBeNull();
  });

  it("accepting sets offer_response AND status='accepted', and sends the existing accepted status email (not a duplicate template)", async () => {
    const res = await invoke({
      referenceNumber: "GG-S-100042",
      email: "jordan@example.com",
      response: "accepted",
    });
    expect(res.statusCode).toBe(200);
    expect(state.lastUpdate).toMatchObject({
      offer_response: "accepted",
      status: "accepted",
      counter_offer_cents: null,
    });
    expect(emailCalls.statusUpdate).toEqual([{ id: "sub-1", status: "accepted" }]);
    expect(emailCalls.responseConfirmation).toHaveLength(0);
    expect(emailCalls.adminNotification).toHaveLength(1);
  });

  it("declining sets offer_response but leaves status untouched, and sends the decline confirmation + admin notification", async () => {
    const res = await invoke({
      referenceNumber: "GG-S-100042",
      email: "jordan@example.com",
      response: "declined",
    });
    expect(res.statusCode).toBe(200);
    expect(state.lastUpdate).toMatchObject({ offer_response: "declined", counter_offer_cents: null });
    expect(state.lastUpdate).not.toHaveProperty("status");
    expect(emailCalls.statusUpdate).toHaveLength(0);
    expect(emailCalls.responseConfirmation).toEqual([["sub-1", "declined", 35000, null]]);
    expect(emailCalls.adminNotification).toEqual([["sub-1", "declined", 35000, null]]);
  });

  it("rejects a counter-offer on a submission that isn't a large, unsorted collection", async () => {
    state.submission = { ...BASE_SUBMISSION, total_cards: 12, collection_size: "10000_plus" };
    const res = await invoke({
      referenceNumber: "GG-S-100042",
      email: "jordan@example.com",
      response: "countered",
      counterOfferCents: 40000,
    });
    expect(res.statusCode).toBe(400);
    expect(state.lastUpdate).toBeNull();

    state.submission = { ...BASE_SUBMISSION, total_cards: 0, collection_size: "1000_to_5000" };
    const res2 = await invoke({
      referenceNumber: "GG-S-100042",
      email: "jordan@example.com",
      response: "countered",
      counterOfferCents: 40000,
    });
    expect(res2.statusCode).toBe(400);
    expect(state.lastUpdate).toBeNull();
  });

  it("rejects a missing or non-positive counter-offer amount even when otherwise eligible", async () => {
    for (const bad of [{}, { counterOfferCents: 0 }, { counterOfferCents: -100 }]) {
      const res = await invoke({
        referenceNumber: "GG-S-100042",
        email: "jordan@example.com",
        response: "countered",
        ...bad,
      });
      expect(res.statusCode).toBe(400);
      expect(state.lastUpdate).toBeNull();
    }
  });

  it("accepts a valid counter-offer on an eligible (large, unsorted) submission", async () => {
    const res = await invoke({
      referenceNumber: "GG-S-100042",
      email: "jordan@example.com",
      response: "countered",
      counterOfferCents: 42000,
    });
    expect(res.statusCode).toBe(200);
    expect(state.lastUpdate).toMatchObject({
      offer_response: "countered",
      counter_offer_cents: 42000,
    });
    expect(state.lastUpdate).not.toHaveProperty("status");
    expect(emailCalls.responseConfirmation).toEqual([["sub-1", "countered", 35000, 42000]]);
    expect(emailCalls.adminNotification).toEqual([["sub-1", "countered", 35000, 42000]]);
  });

  it("never stores a counter amount for an accept or decline response, even if the client sends one", async () => {
    const res = await invoke({
      referenceNumber: "GG-S-100042",
      email: "jordan@example.com",
      response: "accepted",
      counterOfferCents: 999999,
    });
    expect(res.statusCode).toBe(200);
    expect(state.lastUpdate).toMatchObject({ counter_offer_cents: null });
  });

  it("a failing confirmation email does not fail the response", async () => {
    const { sendSellSubmissionOfferResponseConfirmation } = await import(
      "../api/_lib/sellSubmissionEmails.js"
    );
    vi.mocked(sendSellSubmissionOfferResponseConfirmation).mockRejectedValueOnce(
      new Error("resend down"),
    );
    const res = await invoke({
      referenceNumber: "GG-S-100042",
      email: "jordan@example.com",
      response: "declined",
    });
    expect(res.statusCode).toBe(200);
    expect((res.body as { ok: boolean }).ok).toBe(true);
  });
});

describe("store-credit payout", () => {
  async function invokeWithToken(body: Record<string, unknown>, token?: string) {
    const { req, res } = makeReqRes(body);
    if (token) (req.headers as Record<string, string>).authorization = `Bearer ${token}`;
    await handler(req as never, res as never);
    return res;
  }
  const accept = { referenceNumber: "GG-S-100042", email: "jordan@example.com", response: "accepted" };

  it("defaults an acceptance to PayPal, with no account needed", async () => {
    const res = await invokeWithToken(accept);
    expect(res.statusCode).toBe(200);
    expect(state.lastUpdate).toMatchObject({ status: "accepted", payout_method: "paypal" });
    expect(state.lastUpdate).not.toHaveProperty("user_id");
  });

  it("refuses store credit without a signed-in seller, and saves nothing", async () => {
    const res = await invokeWithToken({ ...accept, payoutMethod: "store_credit" });
    expect(res.statusCode).toBe(401);
    expect(state.lastUpdate).toBeNull();
    const bad = await invokeWithToken({ ...accept, payoutMethod: "store_credit" }, "forged");
    expect(bad.statusCode).toBe(401);
  });

  it("links the submission to the signed-in seller and snapshots the 20% bonus", async () => {
    const res = await invokeWithToken({ ...accept, payoutMethod: "store_credit" }, "good-token");
    expect(res.statusCode).toBe(200);
    expect(state.lastUpdate).toMatchObject({
      status: "accepted",
      payout_method: "store_credit",
      user_id: "user-9",
      store_credit_bonus_percent: 20,
    });
  });

  it("won't move a submission that already belongs to a different account", async () => {
    state.submission = { ...BASE_SUBMISSION, user_id: "someone-else" };
    const res = await invokeWithToken({ ...accept, payoutMethod: "store_credit" }, "good-token");
    expect(res.statusCode).toBe(403);
    expect(state.lastUpdate).toBeNull();
  });
});
