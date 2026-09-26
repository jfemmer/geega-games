import { beforeEach, describe, expect, it, vi } from "vitest";

// /api/admin/native-push: staff-only settings for the Geega Admin iPhone app.

process.env.SUPABASE_URL = "https://x.invalid";
process.env.SUPABASE_SECRET_KEY = "svc";

type Row = { id: string; user_id: string; token: string; kinds: string[] };

const state: {
  user: { id: string; app_metadata: Record<string, unknown> } | null;
  rows: Row[];
  inserted: Record<string, unknown> | null;
  updated: Record<string, unknown> | null;
  deletedToken: string | null;
  deletedId: string | null;
  outcome: "delivered" | "gone" | "failed";
  sent: string[][];
  configured: boolean;
} = { user: null, rows: [], inserted: null, updated: null, deletedToken: null, deletedId: null, outcome: "delivered", sent: [], configured: true };

function query() {
  const filter: Record<string, string> = {};
  const chain = {
    eq(col: string, value: string) {
      filter[col] = value;
      return chain;
    },
    select() {
      return chain;
    },
    maybeSingle: async () => ({
      data: state.rows.find((r) => (filter.token ? r.token === filter.token : r.id === filter.id)) ?? null,
      error: null,
    }),
    then(resolve: (v: { error: null }) => void) {
      resolve({ error: null });
    },
  };
  return { chain, filter };
}

vi.mock("../api/_lib/supabaseAdmin.js", () => ({
  getSupabaseAdmin: () => ({
    auth: {
      getUser: async () =>
        state.user ? { data: { user: state.user }, error: null } : { data: null, error: { message: "bad" } },
    },
    from: () => ({
      select: () => query().chain,
      insert: async (row: Record<string, unknown>) => {
        state.inserted = row;
        return { error: null };
      },
      update: (patch: Record<string, unknown>) => {
        state.updated = patch;
        return query().chain;
      },
      delete: () => {
        const q = query();
        const eq = q.chain.eq;
        q.chain.eq = (col: string, value: string) => {
          if (col === "token") state.deletedToken = value;
          if (col === "id") state.deletedId = value;
          return eq(col, value);
        };
        return q.chain;
      },
    }),
  }),
}));

vi.mock("../api/_lib/apns.js", () => ({
  apnsConfigured: () => state.configured,
  sendApns: vi.fn(async (tokens: string[]) => {
    state.sent.push(tokens);
    return tokens.map(() => state.outcome);
  }),
}));

const { default: handler } = await import("../api/admin/native-push.ts");

const TOKEN = "0f".repeat(32);

async function call(method: string, body?: Record<string, unknown>, headers: Record<string, string> = { authorization: "Bearer t" }) {
  const req = { method, headers, body, query: {} };
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
  await handler(req as never, res as never);
  return res as { statusCode: number; body: Record<string, unknown> };
}

beforeEach(() => {
  state.user = { id: "staff-1", app_metadata: { role: "staff" } };
  state.rows = [];
  state.inserted = null;
  state.updated = null;
  state.deletedToken = null;
  state.deletedId = null;
  state.outcome = "delivered";
  state.sent = [];
  state.configured = true;
});

describe("/api/admin/native-push", () => {
  it("is staff-only", async () => {
    state.user = null;
    expect((await call("GET", undefined, {})).statusCode).toBe(401);
    state.user = { id: "c", app_metadata: { role: "customer" } };
    expect((await call("POST", { action: "register", token: TOKEN })).statusCode).toBe(403);
    expect(state.inserted).toBeNull();
  });

  it("says whether the server has the Apple push key", async () => {
    expect((await call("GET")).body).toMatchObject({ configured: true });
    state.configured = false;
    expect((await call("GET")).body).toMatchObject({ configured: false });
  });

  it("registers a new iPhone for the signed-in staff member with every kind on", async () => {
    const res = await call("POST", { action: "register", token: TOKEN, deviceName: "iPhone" });
    expect(res.statusCode).toBe(200);
    expect(state.inserted).toMatchObject({
      user_id: "staff-1",
      token: TOKEN,
      device_name: "iPhone",
      kinds: ["order", "buying_lead", "partner_lead", "signup", "offer_response", "pickup"],
    });
  });

  it("keeps a known iPhone's choices when the app re-syncs", async () => {
    state.rows = [{ id: "d1", user_id: "staff-1", token: TOKEN, kinds: ["order"] }];
    const res = await call("POST", { action: "register", token: TOKEN });
    expect(res.body).toMatchObject({ subscribed: true, kinds: ["order"] });
    expect(state.updated).not.toHaveProperty("kinds");
  });

  it("rejects malformed tokens and unknown kinds", async () => {
    expect((await call("POST", { action: "register", token: "not-hex!" })).statusCode).toBe(400);
    expect((await call("POST", { action: "update", token: TOKEN, kinds: ["everything"] })).statusCode).toBe(400);
  });

  it("won't register while the server has no APNs key", async () => {
    state.configured = false;
    expect((await call("POST", { action: "register", token: TOKEN })).statusCode).toBe(503);
  });

  it("forgets an iPhone on unregister", async () => {
    await call("POST", { action: "unregister", token: TOKEN });
    expect(state.deletedToken).toBe(TOKEN);
  });

  it("sends a test to that iPhone only, and forgets it if Apple says it's gone", async () => {
    state.rows = [{ id: "d1", user_id: "staff-1", token: TOKEN, kinds: ["order"] }];
    expect((await call("POST", { action: "test", token: TOKEN })).statusCode).toBe(200);
    expect(state.sent).toEqual([[TOKEN]]);
    state.outcome = "gone";
    expect((await call("POST", { action: "test", token: TOKEN })).statusCode).toBe(410);
    expect(state.deletedId).toBe("d1");
  });
});
