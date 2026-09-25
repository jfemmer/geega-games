import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// /api/admin/referral-leads/:id is the only way to change a partner lead
// (referral_leads has no write grant for `authenticated` — see its
// migration). Staff-only, and it may only ever set `status` to one of the
// three workflow values.

beforeAll(() => {
  process.env.SUPABASE_URL = "https://x.invalid";
  process.env.SUPABASE_SECRET_KEY = "svc";
});

const state: {
  user: { id: string; app_metadata: Record<string, unknown> } | null;
  updated: Record<string, unknown> | null;
  table: string | null;
  found: boolean;
} = { user: null, updated: null, table: null, found: true };

vi.mock("../api/_lib/supabaseAdmin.js", () => ({
  getSupabaseAdmin: () => ({
    auth: {
      getUser: async () => ({
        data: state.user ? { user: state.user } : null,
        error: state.user ? null : { message: "invalid token" },
      }),
    },
    from: (table: string) => ({
      update: (patch: Record<string, unknown>) => {
        state.table = table;
        state.updated = patch;
        return {
          eq: () => ({
            select: () => ({
              maybeSingle: async () => ({ data: state.found ? { id: "lead-1" } : null, error: null }),
            }),
          }),
        };
      },
    }),
  }),
}));

const { default: handler } = await import("../api/admin/referral-leads/[id].ts");

function makeReqRes(body: Record<string, unknown>, headers: Record<string, string> = {}, method = "PATCH") {
  const req = { method, headers, body, query: { id: "lead-1" } };
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

const STAFF = { authorization: "Bearer sometoken" };

beforeEach(() => {
  state.user = null;
  state.updated = null;
  state.table = null;
  state.found = true;
});

describe("PATCH /api/admin/referral-leads/:id", () => {
  it("rejects other methods", async () => {
    const { req, res } = makeReqRes({}, STAFF, "DELETE");
    await handler(req as never, res as never);
    expect(res.statusCode).toBe(405);
  });

  it("rejects a request with no Authorization header", async () => {
    const { req, res } = makeReqRes({ status: "sent_to_partner" });
    await handler(req as never, res as never);
    expect(res.statusCode).toBe(401);
    expect(state.updated).toBeNull();
  });

  it("rejects a signed-in customer", async () => {
    state.user = { id: "u1", app_metadata: { role: "customer" } };
    const { req, res } = makeReqRes({ status: "sent_to_partner" }, STAFF);
    await handler(req as never, res as never);
    expect(res.statusCode).toBe(403);
    expect(state.updated).toBeNull();
  });

  it("lets staff move a lead to Sent to partner, changing nothing else", async () => {
    state.user = { id: "u1", app_metadata: { role: "staff" } };
    const { req, res } = makeReqRes({ status: "sent_to_partner", email: "evil@example.com" }, STAFF);
    await handler(req as never, res as never);
    expect(res.statusCode).toBe(200);
    expect(state.table).toBe("referral_leads");
    expect(state.updated).toEqual({ status: "sent_to_partner" });
  });

  it("rejects a status outside the workflow", async () => {
    state.user = { id: "u1", app_metadata: { role: "staff" } };
    const { req, res } = makeReqRes({ status: "offer_made" }, STAFF);
    await handler(req as never, res as never);
    expect(res.statusCode).toBe(400);
    expect(state.updated).toBeNull();
  });

  it("returns 404 for an unknown lead", async () => {
    state.user = { id: "u1", app_metadata: { role: "staff" } };
    state.found = false;
    const { req, res } = makeReqRes({ status: "closed" }, STAFF);
    await handler(req as never, res as never);
    expect(res.statusCode).toBe(404);
  });
});
