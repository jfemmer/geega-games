import { beforeEach, describe, expect, it, vi } from "vitest";

// Exercises PATCH /api/admin/inventory/bulk. Mocks the Supabase admin client
// boundary so the real handler logic — the itemIds/patch validation, the
// per-row percentage math, and which query goes to which field — is what's
// actually under test.

const state: {
  rows: { id: string; price_cents: number | null }[];
  updates: { table: string; payload: Record<string, unknown>; ids: string[] }[];
  rpcCalls: { name: string; args: unknown }[];
  authUser: { id: string; app_metadata: Record<string, unknown> } | null;
} = {
  rows: [],
  updates: [],
  rpcCalls: [],
  authUser: { id: "staff-1", app_metadata: { role: "staff", staff_role: "owner" } },
};

vi.mock("../api/_lib/supabaseAdmin.js", () => ({
  getSupabaseAdmin: () => ({
    auth: {
      getUser: async () => ({ data: { user: state.authUser }, error: null }),
    },
    from: (table: string) => {
      if (table === "inventory_items") {
        return {
          select: () => ({
            in: async (_col: string, ids: string[]) => ({
              data: state.rows.filter((r) => ids.includes(r.id)),
              error: null,
            }),
          }),
          update: (payload: Record<string, unknown>) => ({
            in: (_col: string, ids: string[]) => {
              state.updates.push({ table, payload, ids });
              return Promise.resolve({ error: null });
            },
            eq: (_col: string, id: string) => {
              state.updates.push({ table, payload, ids: [id] });
              return Promise.resolve({ error: null });
            },
          }),
        };
      }
      if (table === "admin_audit_log") {
        return { insert: async () => ({ error: null }) };
      }
      throw new Error(`unexpected table ${table}`);
    },
    rpc: (name: string, args: unknown) => {
      state.rpcCalls.push({ name, args });
      return Promise.resolve({ data: null, error: null });
    },
  }),
}));

const { default: handler } = await import("../api/admin/inventory/bulk.ts");

function makeReqRes(body: Record<string, unknown>) {
  const req = {
    method: "PATCH",
    headers: { authorization: "Bearer staff-token", "content-type": "application/json" },
    query: {},
    body,
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

async function invoke(body: Record<string, unknown>) {
  const { req, res } = makeReqRes(body);
  await handler(req as never, res as never);
  return res;
}

beforeEach(() => {
  state.rows = [
    { id: "item-1", price_cents: 1000 },
    { id: "item-2", price_cents: 500 },
  ];
  state.updates = [];
  state.rpcCalls = [];
  state.authUser = { id: "staff-1", app_metadata: { role: "staff", staff_role: "owner" } };
});

describe("PATCH /api/admin/inventory/bulk", () => {
  it("rejects an unauthenticated request", async () => {
    state.authUser = null;
    const res = await invoke({ itemIds: ["item-1"], status: "archived" });
    expect(res.statusCode).toBe(401);
  });

  it("rejects a staff role without inventory.write", async () => {
    state.authUser = { id: "staff-2", app_metadata: { role: "staff", staff_role: "fulfillment" } };
    const res = await invoke({ itemIds: ["item-1"], status: "archived" });
    expect(res.statusCode).toBe(403);
  });

  it("requires at least one item id", async () => {
    const res = await invoke({ itemIds: [], status: "archived" });
    expect(res.statusCode).toBe(400);
  });

  it("requires at least one change", async () => {
    const res = await invoke({ itemIds: ["item-1"] });
    expect(res.statusCode).toBe(400);
  });

  it("rejects setting a fixed price and a percentage together", async () => {
    const res = await invoke({ itemIds: ["item-1"], priceCents: 1000, priceAdjustPercent: 10 });
    expect(res.statusCode).toBe(400);
  });

  it("archives every selected item through the same RPC a single archive uses", async () => {
    const res = await invoke({ itemIds: ["item-1", "item-2"], status: "archived" });
    expect(res.statusCode).toBe(200);
    expect(state.rpcCalls).toHaveLength(2);
    expect(state.rpcCalls[0]).toMatchObject({
      name: "admin_set_inventory_status",
      args: expect.objectContaining({ p_id: "item-1", p_status: "archived" }),
    });
  });

  it("sets a fixed price for every selected item in one query", async () => {
    const res = await invoke({ itemIds: ["item-1", "item-2"], priceCents: 1250 });
    expect(res.statusCode).toBe(200);
    expect(state.updates).toHaveLength(1);
    expect(state.updates[0]).toMatchObject({
      payload: { price_cents: 1250 },
      ids: ["item-1", "item-2"],
    });
  });

  it("adjusts each row's price against ITS OWN current price for a percentage change", async () => {
    const res = await invoke({ itemIds: ["item-1", "item-2"], priceAdjustPercent: -10 });
    expect(res.statusCode).toBe(200);
    // item-1: 1000 -> 900, item-2: 500 -> 450 — never the same absolute value.
    expect(state.updates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ payload: { price_cents: 900 }, ids: ["item-1"] }),
        expect.objectContaining({ payload: { price_cents: 450 }, ids: ["item-2"] }),
      ]),
    );
  });

  it("sets storage location for every selected item in one query", async () => {
    const res = await invoke({ itemIds: ["item-1", "item-2"], storageLocation: "Box 4" });
    expect(res.statusCode).toBe(200);
    expect(state.updates).toContainEqual(
      expect.objectContaining({
        payload: { storage_location: "Box 4" },
        ids: ["item-1", "item-2"],
      }),
    );
  });
});
