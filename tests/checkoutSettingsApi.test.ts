import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeState, createFakeSupabase, fakeId, fakeResponse, type FakeState } from "./helpers/fakeSupabase";

// GET/PUT /api/admin/checkout-settings: staff set the most different cards
// one online order may have (store_settings.max_order_lines), see how big
// signed-in customers' carts are against it, and every change is audited.

let state: FakeState = createFakeState();
vi.mock("../api/_lib/supabaseAdmin.js", () => ({ getSupabaseAdmin: () => createFakeSupabase(state) }));

const { default: handler } = await import("../api/admin/checkout-settings.ts");
const STAFF = "staff-token";

async function call(method: "GET" | "PUT" | "POST", body?: Record<string, unknown>, auth: string | null = STAFF) {
  const res = fakeResponse();
  await handler(
    { method, body, headers: auth ? { authorization: `Bearer ${auth}` } : {} } as never,
    res as never,
  );
  return res;
}

beforeEach(() => {
  state = createFakeState();
  state.sessions[STAFF] = { id: fakeId(), email: "jordan@geega-games.com", app_metadata: { role: "admin" } };
  state.tables.store_settings = [{ id: true, max_order_lines: 500, updated_at: "2026-11-23T00:00:00.000Z", updated_by: null }];
  state.tables.admin_audit_log = [];
  state.rpc.admin_cart_size_summary = (args) => ({
    data: [{ largest_lines: 121, carts_over_limit: 121 > (args.p_limit as number) ? 1 : 0 }],
    error: null,
  });
});

describe("checkout settings", () => {
  it("is for staff only", async () => {
    expect((await call("GET", undefined, null)).statusCode).toBe(401);
    expect((await call("POST")).statusCode).toBe(405);
  });

  it("shows the limit and how signed-in carts compare with it", async () => {
    const res = await call("GET");
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({
      settings: { maxOrderLines: 500, updatedAt: "2026-11-23T00:00:00.000Z" },
      carts: { largestLines: 121, overLimit: 0 },
    });
  });

  it("saves a new limit, audits it, and re-counts carts against it", async () => {
    const res = await call("PUT", { maxOrderLines: 100 });
    expect(res.statusCode).toBe(200);
    expect(res.body.settings.maxOrderLines).toBe(100);
    expect(res.body.carts).toEqual({ largestLines: 121, overLimit: 1 });
    expect(state.tables.store_settings[0]).toMatchObject({ max_order_lines: 100, updated_by: state.sessions[STAFF].id });
    expect(state.tables.admin_audit_log).toHaveLength(1);
    expect(state.tables.admin_audit_log[0]).toMatchObject({
      action: "store.max_order_lines_changed",
      before: { max_order_lines: 500 },
      after: { max_order_lines: 100 },
    });

    // Saving the same number again isn't a change worth auditing.
    await call("PUT", { maxOrderLines: 100 });
    expect(state.tables.admin_audit_log).toHaveLength(1);
  });

  it.each([0, 1001, 12.5, "200", null])("refuses %s", async (value) => {
    const res = await call("PUT", { maxOrderLines: value });
    expect(res.statusCode).toBe(400);
    expect(res.body.message).toBe("Enter a whole number from 1 to 1,000.");
    expect(state.tables.store_settings[0].max_order_lines).toBe(500);
  });

  it("still works if the carts can't be counted", async () => {
    state.rpc.admin_cart_size_summary = () => ({ data: null, error: { message: "timeout" } });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const res = await call("GET");
    warn.mockRestore();
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ settings: { maxOrderLines: 500 }, carts: null });
  });
});
