import { beforeEach, describe, expect, it, vi } from "vitest";

// POST /api/account/new-account: "a new customer signed up" push. Everything
// comes from the verified session — the account must really be new, staff
// don't count, and the push is keyed per user so it can only go out once.

process.env.SUPABASE_URL = "https://x.invalid";
process.env.SUPABASE_SECRET_KEY = "svc";

const HOUR = 60 * 60 * 1000;

const state: {
  user: Record<string, unknown> | null;
  customer: { id: string; first_name: string | null; last_name: string | null } | null;
  pushed: Record<string, unknown>[];
} = { user: null, customer: null, pushed: [] };

vi.mock("../api/_lib/supabaseAdmin.js", () => ({
  getSupabaseAdmin: () => ({
    auth: {
      getUser: async () =>
        state.user ? { data: { user: state.user }, error: null } : { data: { user: null }, error: { message: "bad jwt" } },
    },
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle: async () => ({ data: state.customer, error: null }) }),
      }),
    }),
  }),
}));

vi.mock("../api/_lib/staffPush.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api/_lib/staffPush.ts")>();
  return {
    ...actual,
    notifyStaff: vi.fn(async (event: Record<string, unknown>) => {
      state.pushed.push(event);
      return { status: "sent", delivered: 1, failed: 0, removed: 0 };
    }),
  };
});

const { default: handler } = await import("../api/account/new-account.ts");

let ip = 0;
async function call(headers: Record<string, string> = { authorization: "Bearer token" }, method = "POST") {
  ip += 1;
  const req = { method, headers: { ...headers, "x-forwarded-for": `198.51.100.${ip}` }, body: {}, socket: {} };
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

function newUser(overrides: Record<string, unknown> = {}) {
  return {
    id: "user-1",
    created_at: new Date(Date.now() - HOUR).toISOString(),
    app_metadata: { role: "customer" },
    user_metadata: { first_name: "Jordan", last_name: "Vega" },
    ...overrides,
  };
}

beforeEach(() => {
  state.user = null;
  state.customer = null;
  state.pushed = [];
});

describe("POST /api/account/new-account", () => {
  it("needs a real session", async () => {
    expect((await call({})).statusCode).toBe(401);
    expect((await call()).statusCode).toBe(401); // token didn't verify
    expect(state.pushed).toHaveLength(0);
  });

  it("only accepts POST", async () => {
    expect((await call(undefined, "GET")).statusCode).toBe(405);
  });

  it("tells staff about a brand-new customer, linking to their customer record", async () => {
    state.user = newUser();
    state.customer = { id: "cust-9", first_name: "Jordan", last_name: "Vega" };
    const res = await call();
    expect(res.body).toMatchObject({ ok: true, notified: true });
    expect(state.pushed).toEqual([
      expect.objectContaining({
        key: "signup:user-1",
        kind: "signup",
        title: "New customer sign-up",
        body: "Jordan V. just created a Geega Games account.",
        url: "/admin_dashboard/users?customer=cust-9",
      }),
    ]);
  });

  it("falls back to the sign-up form's name when the customer row isn't there yet", async () => {
    state.user = newUser();
    await call();
    expect(state.pushed[0]).toMatchObject({ body: "Jordan V. just created a Geega Games account.", url: "/admin_dashboard/users" });
  });

  it("ignores accounts that aren't new", async () => {
    state.user = newUser({ created_at: new Date(Date.now() - 72 * HOUR).toISOString() });
    expect((await call()).body).toMatchObject({ ok: true, notified: false });
    expect(state.pushed).toHaveLength(0);
  });

  it("ignores staff accounts", async () => {
    state.user = newUser({ app_metadata: { role: "admin" } });
    await call();
    expect(state.pushed).toHaveLength(0);
  });
});
