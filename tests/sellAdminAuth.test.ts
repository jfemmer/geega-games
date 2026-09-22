import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// Security-boundary test: /api/admin/sell-submissions/:id is the ONLY way to
// change status/internal notes/offer/purchase amounts (there is no UPDATE
// grant to `authenticated` on sell_submissions at all — see the
// sell_submissions migration). This confirms the endpoint actually enforces
// requireStaff() rather than trusting the caller, mirroring every other
// /api/admin/* endpoint's contract.

beforeAll(() => {
  process.env.SUPABASE_URL = "https://x.invalid";
  process.env.SUPABASE_SECRET_KEY = "svc";
});

const state: { user: { id: string; app_metadata: Record<string, unknown> } | null; updated: Record<string, unknown> | null } =
  { user: null, updated: null };

vi.mock("../api/_lib/supabaseAdmin.js", () => ({
  getSupabaseAdmin: () => ({
    auth: {
      getUser: async () => ({
        data: state.user ? { user: state.user } : null,
        error: state.user ? null : { message: "invalid token" },
      }),
    },
    from: () => ({
      update: (patch: Record<string, unknown>) => {
        state.updated = patch;
        return {
          eq: () => ({
            select: () => ({
              maybeSingle: async () => ({ data: { id: "sub-1" }, error: null }),
            }),
          }),
        };
      },
    }),
  }),
}));

const { default: handler } = await import("../api/admin/sell-submissions/[id].ts");
const { default: sendOfferHandler } = await import(
  "../api/admin/sell-submissions/[id]/send-offer.ts"
);

function makeReqRes(
  body: Record<string, unknown>,
  headers: Record<string, string> = {},
  method = "PATCH",
) {
  const req = { method, headers, body, query: { id: "sub-1" } };
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

beforeEach(() => {
  state.user = null;
  state.updated = null;
});

describe("PATCH /api/admin/sell-submissions/:id — staff-only", () => {
  it("rejects a request with no Authorization header", async () => {
    const { req, res } = makeReqRes({ status: "reviewing" });
    await handler(req as never, res as never);
    expect(res.statusCode).toBe(401);
    expect(state.updated).toBeNull();
  });

  it("rejects a request from an authenticated but non-staff user", async () => {
    state.user = { id: "u1", app_metadata: { role: "customer" } };
    const { req, res } = makeReqRes(
      { status: "reviewing" },
      { authorization: "Bearer sometoken" },
    );
    await handler(req as never, res as never);
    expect(res.statusCode).toBe(403);
    expect(state.updated).toBeNull();
  });

  it("allows a verified staff user to change status", async () => {
    state.user = { id: "u1", app_metadata: { role: "staff" } };
    const { req, res } = makeReqRes(
      { status: "reviewing" },
      { authorization: "Bearer sometoken" },
    );
    await handler(req as never, res as never);
    expect(res.statusCode).toBe(200);
    expect(state.updated).toMatchObject({ status: "reviewing" });
  });

  it("rejects an invalid status value even from staff", async () => {
    state.user = { id: "u1", app_metadata: { role: "staff" } };
    const { req, res } = makeReqRes(
      { status: "not_a_real_status" },
      { authorization: "Bearer sometoken" },
    );
    await handler(req as never, res as never);
    expect(res.statusCode).toBe(400);
    expect(state.updated).toBeNull();
  });

  it("sets contacted_at when status moves to 'contacted'", async () => {
    state.user = { id: "u1", app_metadata: { role: "staff" } };
    const { req, res } = makeReqRes(
      { status: "contacted" },
      { authorization: "Bearer sometoken" },
    );
    await handler(req as never, res as never);
    expect(res.statusCode).toBe(200);
    expect(state.updated?.contacted_at).toBeTruthy();
  });
});

describe("POST /api/admin/sell-submissions/:id/send-offer — staff-only", () => {
  it("rejects a request with no Authorization header", async () => {
    const { req, res } = makeReqRes({ offerValueCents: 35000 }, {}, "POST");
    await sendOfferHandler(req as never, res as never);
    expect(res.statusCode).toBe(401);
    expect(state.updated).toBeNull();
  });

  it("rejects a request from an authenticated but non-staff user", async () => {
    state.user = { id: "u1", app_metadata: { role: "customer" } };
    const { req, res } = makeReqRes(
      { offerValueCents: 35000 },
      { authorization: "Bearer sometoken" },
      "POST",
    );
    await sendOfferHandler(req as never, res as never);
    expect(res.statusCode).toBe(403);
    expect(state.updated).toBeNull();
  });

  it("rejects a missing or non-positive offer amount even from staff", async () => {
    state.user = { id: "u1", app_metadata: { role: "staff" } };
    for (const bad of [{}, { offerValueCents: 0 }, { offerValueCents: -100 }]) {
      const { req, res } = makeReqRes(bad, { authorization: "Bearer sometoken" }, "POST");
      await sendOfferHandler(req as never, res as never);
      expect(res.statusCode).toBe(400);
      expect(state.updated).toBeNull();
    }
  });

  it("records the amount, flips status to offer_made, and stamps offer_sent_at for a verified staff user", async () => {
    state.user = { id: "u1", app_metadata: { role: "staff" } };
    const { req, res } = makeReqRes(
      { offerValueCents: 35000 },
      { authorization: "Bearer sometoken" },
      "POST",
    );
    await sendOfferHandler(req as never, res as never);
    expect(res.statusCode).toBe(200);
    expect(state.updated).toMatchObject({ offer_value_cents: 35000, status: "offer_made" });
    expect(state.updated?.offer_sent_at).toBeTruthy();
  });
});
