import { beforeEach, describe, expect, it, vi } from "vitest";

// Exercises the "orders" / "refund" branch of the consolidated admin router
// (api/admin/index.ts). Mocks the _lib boundaries (Supabase admin client,
// Stripe, the order-status email, and the audit log) so the real handler
// logic — eligibility checks, partial-vs-full accounting against
// amount_due_cents, and what gets written where — is what's actually under
// test, the same "mock the _lib boundary" pattern as ordersBuyLabelApi.test.ts.

const state: {
  order: Record<string, unknown> | null;
  priorRefunds: { amount_cents: number }[];
  insertedRefund: Record<string, unknown> | null;
  orderUpdatePayload: Record<string, unknown> | null;
  orderItems: { inventory_item_id: string | null; quantity: number }[];
  rpcCalls: { name: string; args: unknown }[];
  authUser: { id: string; app_metadata: Record<string, unknown> } | null;
} = {
  order: null,
  priorRefunds: [],
  insertedRefund: null,
  orderUpdatePayload: null,
  orderItems: [],
  rpcCalls: [],
  authUser: {
    id: "staff-1",
    app_metadata: { role: "staff", staff_role: "owner" },
  },
};

vi.mock("../api/_lib/supabaseAdmin.js", () => ({
  getSupabaseAdmin: () => ({
    auth: {
      getUser: async () => ({ data: { user: state.authUser }, error: null }),
    },
    from: (table: string) => {
      if (table === "orders") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: state.order, error: null }),
            }),
          }),
          update: (payload: Record<string, unknown>) => ({
            eq: async () => {
              state.orderUpdatePayload = payload;
              return { error: null };
            },
          }),
        };
      }
      if (table === "order_refunds") {
        return {
          select: () => ({
            eq: async () => ({ data: state.priorRefunds, error: null }),
          }),
          insert: (payload: Record<string, unknown>) => {
            state.insertedRefund = payload;
            return Promise.resolve({ error: null });
          },
        };
      }
      if (table === "order_items") {
        return {
          select: () => ({
            eq: async () => ({ data: state.orderItems, error: null }),
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

vi.mock("../api/_lib/orderStatusEmail.js", () => ({
  sendOrderStatusEmail: vi.fn(async () => ({ status: "sent" })),
}));

const stripeRefundsCreate = vi.fn();
vi.mock("../api/_lib/stripe.js", () => ({
  getStripe: () => ({ refunds: { create: (...args: unknown[]) => stripeRefundsCreate(...args) } }),
}));

vi.mock("../api/_lib/easypost.js", () => ({
  buyShippingLabel: vi.fn(),
}));

const { default: handler } = await import("../api/admin/index.ts");
const { sendOrderStatusEmail } = await import("../api/_lib/orderStatusEmail.js");

function makeReqRes(body: Record<string, unknown>) {
  const req = {
    method: "POST",
    headers: { authorization: "Bearer staff-token", "content-type": "application/json" },
    query: { resource: "orders", action: "refund" },
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

const paidStripeOrder = {
  id: "order-1",
  status: "delivered",
  payment_provider: "stripe",
  payment_reference: "pi_123",
  payment_status: "paid",
  amount_due_cents: 5000,
};

beforeEach(() => {
  state.order = { ...paidStripeOrder };
  state.priorRefunds = [];
  state.insertedRefund = null;
  state.orderUpdatePayload = null;
  state.orderItems = [];
  state.rpcCalls = [];
  state.authUser = { id: "staff-1", app_metadata: { role: "staff", staff_role: "owner" } };
  stripeRefundsCreate.mockReset();
  vi.mocked(sendOrderStatusEmail).mockClear();
});

describe("POST /api/admin?resource=orders&action=refund", () => {
  it("rejects an unauthenticated request", async () => {
    state.authUser = null;
    const res = await invoke({ orderId: "order-1" });
    expect(res.statusCode).toBe(401);
    expect(stripeRefundsCreate).not.toHaveBeenCalled();
  });

  it("rejects a staff role without the orders.refund capability", async () => {
    state.authUser = {
      id: "staff-2",
      app_metadata: { role: "staff", staff_role: "fulfillment" },
    };
    const res = await invoke({ orderId: "order-1" });
    expect(res.statusCode).toBe(403);
    expect(stripeRefundsCreate).not.toHaveBeenCalled();
  });

  it("requires an orderId", async () => {
    const res = await invoke({});
    expect(res.statusCode).toBe(400);
  });

  it("404s for an order that doesn't exist", async () => {
    state.order = null;
    const res = await invoke({ orderId: "order-1" });
    expect(res.statusCode).toBe(404);
  });

  it("refuses to refund an order that wasn't paid through Stripe", async () => {
    state.order = { ...paidStripeOrder, payment_provider: "store_credit", payment_reference: null };
    const res = await invoke({ orderId: "order-1" });
    expect(res.statusCode).toBe(400);
    expect(stripeRefundsCreate).not.toHaveBeenCalled();
  });

  it("refuses to refund an order that was never paid", async () => {
    state.order = { ...paidStripeOrder, payment_status: "unpaid" };
    const res = await invoke({ orderId: "order-1" });
    expect(res.statusCode).toBe(409);
    expect(stripeRefundsCreate).not.toHaveBeenCalled();
  });

  it("refuses a second refund once the order is already fully refunded", async () => {
    state.priorRefunds = [{ amount_cents: 5000 }];
    const res = await invoke({ orderId: "order-1" });
    expect(res.statusCode).toBe(409);
    expect(stripeRefundsCreate).not.toHaveBeenCalled();
  });

  it("rejects an amount larger than what's left to refund", async () => {
    state.priorRefunds = [{ amount_cents: 2000 }];
    const res = await invoke({ orderId: "order-1", amountCents: 4000 });
    expect(res.statusCode).toBe(400);
    expect(stripeRefundsCreate).not.toHaveBeenCalled();
  });

  it("issues a full refund, marks the order refunded, and emails the customer", async () => {
    stripeRefundsCreate.mockResolvedValue({ id: "re_123" });

    const res = await invoke({ orderId: "order-1", reason: "Item never arrived" });

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ ok: true, amountCents: 5000, fullyRefunded: true });
    expect(stripeRefundsCreate).toHaveBeenCalledWith(
      { payment_intent: "pi_123", amount: 5000 },
      expect.objectContaining({ idempotencyKey: expect.any(String) }),
    );
    expect(state.insertedRefund).toMatchObject({
      order_id: "order-1",
      stripe_refund_id: "re_123",
      amount_cents: 5000,
      reason: "Item never arrived",
      restocked: false,
    });
    expect(state.orderUpdatePayload).toEqual({ status: "refunded", payment_status: "refunded" });
    expect(sendOrderStatusEmail).toHaveBeenCalledWith("order-1", "refunded");
  });

  it("issues a partial refund without closing the order or emailing", async () => {
    stripeRefundsCreate.mockResolvedValue({ id: "re_456" });

    const res = await invoke({ orderId: "order-1", amountCents: 1500 });

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ ok: true, amountCents: 1500, fullyRefunded: false, remainingCents: 3500 });
    expect(state.orderUpdatePayload).toBeNull();
    expect(sendOrderStatusEmail).not.toHaveBeenCalled();
  });

  it("restocks each order line via the inventory RPC when restock is requested", async () => {
    stripeRefundsCreate.mockResolvedValue({ id: "re_789" });
    state.orderItems = [
      { inventory_item_id: "item-1", quantity: 2 },
      { inventory_item_id: null, quantity: 1 }, // no linked line — must be skipped, not crash
    ];

    const res = await invoke({ orderId: "order-1", restock: true });

    expect(res.statusCode).toBe(200);
    expect(state.rpcCalls).toHaveLength(1);
    expect(state.rpcCalls[0]).toMatchObject({
      name: "admin_adjust_inventory_quantity",
      args: expect.objectContaining({
        p_id: "item-1",
        p_delta: 2,
        p_reason: "return_restock",
      }),
    });
  });

  it("surfaces a clear error and never records a refund when Stripe rejects it", async () => {
    stripeRefundsCreate.mockRejectedValue(new Error("charge already refunded"));

    const res = await invoke({ orderId: "order-1" });

    expect(res.statusCode).toBe(502);
    expect(state.insertedRefund).toBeNull();
    expect(state.orderUpdatePayload).toBeNull();
  });
});
