import { beforeEach, describe, expect, it, vi } from "vitest";

// /api/admin/push: staff-only device settings for admin push notifications.

process.env.SUPABASE_URL = "https://x.invalid";
process.env.SUPABASE_SECRET_KEY = "svc";

type Row = { id: string; user_id: string; endpoint: string; p256dh: string; auth: string; kinds: string[] };

const state: {
  user: { id: string; app_metadata: Record<string, unknown> } | null;
  rows: Row[];
  inserted: Record<string, unknown> | null;
  updated: Record<string, unknown> | null;
  deletedEndpoint: string | null;
  sendOutcome: "delivered" | "gone" | "failed";
  sentTo: string[];
} = { user: null, rows: [], inserted: null, updated: null, deletedEndpoint: null, sendOutcome: "delivered", sentTo: [] };

function query() {
  let endpoint: string | null = null;
  let id: string | null = null;
  const find = () => state.rows.find((r) => (endpoint ? r.endpoint === endpoint : r.id === id)) ?? null;
  const chain = {
    eq(col: string, value: string) {
      if (col === "endpoint") endpoint = value;
      if (col === "id") id = value;
      return chain;
    },
    select() {
      return chain;
    },
    maybeSingle: async () => ({ data: find(), error: null }),
    then(resolve: (v: { error: null }) => void) {
      resolve({ error: null });
    },
  };
  return chain;
}

vi.mock("../api/_lib/supabaseAdmin.js", () => ({
  getSupabaseAdmin: () => ({
    auth: {
      getUser: async () => ({
        data: state.user ? { user: state.user } : null,
        error: state.user ? null : { message: "invalid token" },
      }),
    },
    from: () => ({
      select: () => query(),
      insert: async (row: Record<string, unknown>) => {
        state.inserted = row;
        return { error: null };
      },
      update: (patch: Record<string, unknown>) => {
        state.updated = patch;
        return query();
      },
      delete: () => {
        const q = query();
        const eq = q.eq;
        q.eq = (col: string, value: string) => {
          if (col === "endpoint") state.deletedEndpoint = value;
          return eq(col, value);
        };
        return q;
      },
    }),
  }),
}));

vi.mock("../api/_lib/staffPush.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api/_lib/staffPush.ts")>();
  return {
    ...actual,
    sendToSubscription: vi.fn(async (sub: { endpoint: string }) => {
      state.sentTo.push(sub.endpoint);
      return state.sendOutcome;
    }),
  };
});

const { default: handler } = await import("../api/admin/push.ts");

const ENDPOINT = "https://fcm.googleapis.com/fcm/send/device-1";
const SUBSCRIPTION = { endpoint: ENDPOINT, keys: { p256dh: "B".repeat(87), auth: "a".repeat(22) } };
const STAFF = { authorization: "Bearer token" };

async function call(method: string, body?: Record<string, unknown>, headers: Record<string, string> = STAFF) {
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
  process.env.VAPID_PUBLIC_KEY = "BPublicKey";
  process.env.VAPID_PRIVATE_KEY = "private";
  state.user = { id: "staff-1", app_metadata: { role: "staff" } };
  state.rows = [];
  state.inserted = null;
  state.updated = null;
  state.deletedEndpoint = null;
  state.sendOutcome = "delivered";
  state.sentTo = [];
});

describe("/api/admin/push", () => {
  it("is staff-only", async () => {
    state.user = null;
    expect((await call("GET", undefined, {})).statusCode).toBe(401);
    state.user = { id: "c1", app_metadata: { role: "customer" } };
    expect((await call("POST", { action: "subscribe", subscription: SUBSCRIPTION })).statusCode).toBe(403);
    expect(state.inserted).toBeNull();
  });

  it("hands the browser the public key only when push is configured", async () => {
    expect((await call("GET")).body).toMatchObject({ configured: true, publicKey: "BPublicKey" });
    delete process.env.VAPID_PRIVATE_KEY;
    expect((await call("GET")).body).toMatchObject({ configured: false, publicKey: null });
  });

  it("saves a new device for the signed-in staff member, with every kind on by default", async () => {
    const res = await call("POST", { action: "subscribe", subscription: SUBSCRIPTION });
    expect(res.statusCode).toBe(200);
    expect(state.inserted).toMatchObject({
      user_id: "staff-1",
      endpoint: ENDPOINT,
      kinds: ["order", "buying_lead", "partner_lead", "signup", "offer_response", "pickup"],
    });
  });

  it("keeps a known device's choices when the app re-syncs it", async () => {
    state.rows = [{ id: "r1", user_id: "staff-1", endpoint: ENDPOINT, p256dh: "x", auth: "y", kinds: ["order"] }];
    const res = await call("POST", { action: "subscribe", subscription: SUBSCRIPTION });
    expect(res.body).toMatchObject({ subscribed: true, kinds: ["order"] });
    expect(state.updated).not.toHaveProperty("kinds");
    expect(state.inserted).toBeNull();
  });

  it("refuses endpoints outside the browsers' push services", async () => {
    const res = await call("POST", {
      action: "subscribe",
      subscription: { ...SUBSCRIPTION, endpoint: "https://internal.example.com/hook" },
    });
    expect(res.statusCode).toBe(400);
    expect(state.inserted).toBeNull();
  });

  it("rejects malformed keys and unknown notification kinds", async () => {
    expect(
      (await call("POST", { action: "subscribe", subscription: { endpoint: ENDPOINT, keys: { p256dh: "<script>", auth: "x" } } }))
        .statusCode,
    ).toBe(400);
    expect((await call("POST", { action: "update", endpoint: ENDPOINT, kinds: ["everything"] })).statusCode).toBe(400);
  });

  it("won't subscribe while the server has no VAPID keys", async () => {
    delete process.env.VAPID_PUBLIC_KEY;
    expect((await call("POST", { action: "subscribe", subscription: SUBSCRIPTION })).statusCode).toBe(503);
  });

  it("updates which events a device gets", async () => {
    state.rows = [{ id: "r1", user_id: "staff-1", endpoint: ENDPOINT, p256dh: "x", auth: "y", kinds: ["order"] }];
    const res = await call("POST", { action: "update", endpoint: ENDPOINT, kinds: ["order", "pickup"] });
    expect(res.statusCode).toBe(200);
    expect(state.updated).toMatchObject({ kinds: ["order", "pickup"] });
  });

  it("forgets a device on unsubscribe", async () => {
    const res = await call("POST", { action: "unsubscribe", endpoint: ENDPOINT });
    expect(res.statusCode).toBe(200);
    expect(state.deletedEndpoint).toBe(ENDPOINT);
  });

  it("sends a test only to the device that asked, and cleans up an expired one", async () => {
    state.rows = [{ id: "r1", user_id: "staff-1", endpoint: ENDPOINT, p256dh: "x", auth: "y", kinds: ["order"] }];
    expect((await call("POST", { action: "test", endpoint: ENDPOINT })).statusCode).toBe(200);
    expect(state.sentTo).toEqual([ENDPOINT]);

    state.sendOutcome = "gone";
    expect((await call("POST", { action: "test", endpoint: ENDPOINT })).statusCode).toBe(410);
  });

  it("404s a test for a device that never turned notifications on", async () => {
    expect((await call("POST", { action: "test", endpoint: ENDPOINT })).statusCode).toBe(404);
    expect(state.sentTo).toEqual([]);
  });
});
