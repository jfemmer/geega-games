import { beforeEach, describe, expect, it, vi } from "vitest";

// Admin order actions that email the customer: "Mark ready to ship" sends the
// packed email (online orders only), and the shipping-setup check the Orders
// page uses to say whether labels can be bought yet.

const state: {
  order: Record<string, unknown> | null;
  updatePayload: Record<string, unknown> | null;
  easypostKey: string | undefined;
} = { order: null, updatePayload: null, easypostKey: undefined };

vi.mock("../api/_lib/supabaseAdmin.js", () => ({
  getSupabaseAdmin: () => ({
    auth: {
      getUser: async () => ({ data: { user: { id: "staff-1", app_metadata: { role: "staff" } } }, error: null }),
    },
    from: (table: string) => {
      if (table === "admin_audit_log") return { insert: async () => ({ error: null }) };
      if (table !== "orders") throw new Error(`unexpected table ${table}`);
      return {
        select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: state.order, error: null }) }) }),
        update: (payload: Record<string, unknown>) => ({
          eq: async () => {
            state.updatePayload = payload;
            return { error: null };
          },
        }),
      };
    },
  }),
}));

const sendOrderStatusEmail = vi.fn(async () => ({ status: "sent" }));
vi.mock("../api/_lib/orderStatusEmail.js", () => ({
  sendOrderStatusEmail: (...args: unknown[]) => sendOrderStatusEmail(...(args as [])),
}));

vi.mock("../api/_lib/env.js", async (importActual) => {
  const actual = await importActual<typeof import("../api/_lib/env.js")>();
  return { ServerEnv: { ...actual.ServerEnv, easypostApiKey: () => state.easypostKey } };
});

const { default: handler } = await import("../api/admin/index.ts");

async function invoke(method: string, action: string, body: Record<string, unknown> = {}) {
  const req = {
    method,
    headers: { authorization: "Bearer staff-token", "content-type": "application/json" },
    query: { resource: "orders", action },
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
  await handler(req as never, res as never);
  return res;
}

const packingOrder = {
  id: "order-1",
  status: "packing",
  packed_at: "2026-09-30T15:00:00Z",
  ready_at: null,
  cancelled_at: null,
  channel: "online",
  shipping_method: "pwe",
};

beforeEach(() => {
  state.order = { ...packingOrder };
  state.updatePayload = null;
  state.easypostKey = undefined;
  sendOrderStatusEmail.mockClear();
});

describe("Mark ready to ship", () => {
  it("emails the customer that their order is packed", async () => {
    const res = await invoke("POST", "set-status", { orderId: "order-1", status: "ready_to_ship" });
    expect(res.statusCode).toBe(200);
    expect(state.updatePayload).toMatchObject({ status: "ready_to_ship" });
    expect(sendOrderStatusEmail).toHaveBeenCalledWith("order-1", "packed");
  });

  it("doesn't email about packing for an in-person sale", async () => {
    state.order = { ...packingOrder, channel: "pos", shipping_method: null };
    await invoke("POST", "set-status", { orderId: "order-1", status: "ready_to_ship" });
    expect(sendOrderStatusEmail).not.toHaveBeenCalled();
  });

  it("still marks it ready when the email fails", async () => {
    sendOrderStatusEmail.mockRejectedValueOnce(new Error("Resend is down"));
    const res = await invoke("POST", "set-status", { orderId: "order-1", status: "ready_to_ship" });
    expect(res.statusCode).toBe(200);
    expect(state.updatePayload).toMatchObject({ status: "ready_to_ship" });
  });

  it("sends nothing when packing starts", async () => {
    state.order = { ...packingOrder, status: "paid", packed_at: null };
    await invoke("POST", "set-status", { orderId: "order-1", status: "packing" });
    expect(sendOrderStatusEmail).not.toHaveBeenCalled();
  });
});

describe("shipping setup", () => {
  it("reports whether EasyPost is connected", async () => {
    let res = await invoke("GET", "shipping-setup");
    expect(res.body).toEqual({ ok: true, easypostConnected: false });

    state.easypostKey = "EZAK_test";
    res = await invoke("GET", "shipping-setup");
    expect(res.body).toEqual({ ok: true, easypostConnected: true });
  });
});
