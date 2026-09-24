import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import { EventEmitter } from "node:events";

beforeAll(() => {
  process.env.SUPABASE_URL = "https://x.invalid";
  process.env.SUPABASE_SECRET_KEY = "svc";
  process.env.PAYPAL_CLIENT_ID = "pp_client";
  process.env.PAYPAL_CLIENT_SECRET = "pp_secret";
  process.env.PAYPAL_WEBHOOK_ID = "WH-1";
});

const ORDER_ID = "11111111-2222-3333-4444-555555555555";

type Order = {
  id: string;
  user_id: string | null;
  status: string;
  payment_status: string;
  payment_provider: string | null;
  payment_reference: string | null;
  amount_due_cents: number;
};

const state = {
  order: null as Order | null,
  paypalOrder: null as Record<string, unknown> | null,
  captureCalls: 0,
  captureResult: null as Record<string, unknown> | null,
  markPaidCalls: [] as { orderId: string; provider: string; ref: string }[],
  updates: [] as Record<string, unknown>[],
  events: [] as string[],
  emails: [] as string[],
  webhookValid: true,
};

vi.mock("../api/_lib/paypal.js", async (importActual) => {
  const actual = await importActual<typeof import("../api/_lib/paypal.js")>();
  return {
    ...actual,
    getPayPalOrder: async () => state.paypalOrder,
    capturePayPalOrder: async () => {
      state.captureCalls++;
      return state.captureResult;
    },
    createPayPalOrder: async () => ({ id: "PPORDER123" }),
    verifyPayPalWebhook: async () => state.webhookValid,
  };
});

vi.mock("../api/_lib/stripe.js", () => ({ getStripe: () => ({}) }));

vi.mock("../api/_lib/orderConfirmation.js", () => ({
  sendOrderConfirmation: async (id: string) => {
    state.emails.push(`customer:${id}`);
  },
  sendOrderAdminNotification: async (id: string) => {
    state.emails.push(`admin:${id}`);
  },
}));

vi.mock("../api/_lib/supabaseAdmin.js", () => ({
  getSupabaseAdmin: () => ({
    from: (table: string) => {
      if (table === "orders") {
        return {
          select: () => ({
            eq: () => ({ maybeSingle: async () => ({ data: state.order, error: null }) }),
          }),
          update: (patch: Record<string, unknown>) => {
            state.updates.push(patch);
            const chain = { eq: () => chain, then: (r: (v: unknown) => void) => r({ error: null }) };
            return chain;
          },
        };
      }
      if (table === "payment_events") {
        return {
          select: () => ({
            eq: (_c: string, id: string) => ({
              maybeSingle: async () => ({
                data: state.events.includes(id) ? { event_id: id } : null,
              }),
            }),
          }),
          insert: async (row: { event_id: string }) => {
            state.events.push(row.event_id);
            return { error: null };
          },
        };
      }
      return {};
    },
    rpc: async (fn: string, args: Record<string, string>) => {
      if (fn === "mark_order_paid") {
        state.markPaidCalls.push({ orderId: args.p_order_id, provider: args.p_provider, ref: args.p_reference });
        if (state.order) state.order.payment_status = "paid";
      }
      return { error: null };
    },
  }),
}));

function ppOrder(status: string, value = "12.34", captures?: unknown[]) {
  return {
    id: "PPORDER123",
    status,
    purchase_units: [
      {
        custom_id: ORDER_ID,
        amount: { currency_code: "USD", value },
        ...(captures ? { payments: { captures } } : {}),
      },
    ],
  };
}

function completedCapture(value = "12.34", status = "COMPLETED") {
  return { id: "CAP-1", status, amount: { currency_code: "USD", value }, custom_id: ORDER_ID };
}

beforeEach(() => {
  state.order = {
    id: ORDER_ID,
    user_id: "user-1",
    status: "pending_payment",
    payment_status: "unpaid",
    payment_provider: null,
    payment_reference: null,
    amount_due_cents: 1234,
  };
  state.paypalOrder = ppOrder("APPROVED");
  state.captureCalls = 0;
  state.captureResult = ppOrder("COMPLETED", "12.34", [completedCapture()]);
  state.markPaidCalls = [];
  state.updates = [];
  state.events = [];
  state.emails = [];
  state.webhookValid = true;
});

describe("PayPal amount conversion", () => {
  it("round-trips cents without float error", async () => {
    const { centsToPayPalValue, payPalValueToCents } = await import("../api/_lib/paypal.ts");
    expect(centsToPayPalValue(1234)).toBe("12.34");
    expect(centsToPayPalValue(5)).toBe("0.05");
    expect(centsToPayPalValue(1000)).toBe("10.00");
    expect(payPalValueToCents("12.34")).toBe(1234);
    expect(payPalValueToCents("0.1")).toBe(10);
    expect(payPalValueToCents("10")).toBe(1000);
    expect(payPalValueToCents("1.234")).toBeNull();
    expect(payPalValueToCents("-1.00")).toBeNull();
  });
});

describe("finalizePayPalCheckout", () => {
  it("captures an approved order and marks it paid via PayPal", async () => {
    const { finalizePayPalCheckout } = await import("../api/_lib/paypalCheckout.ts");
    const result = await finalizePayPalCheckout("PPORDER123", { userId: "user-1", expectedOrderId: ORDER_ID });
    expect(result.outcome).toBe("paid");
    expect(state.captureCalls).toBe(1);
    expect(state.markPaidCalls).toEqual([{ orderId: ORDER_ID, provider: "paypal", ref: "CAP-1" }]);
    expect(state.emails).toEqual([`customer:${ORDER_ID}`, `admin:${ORDER_ID}`]);
  });

  it("refuses another customer's order", async () => {
    const { finalizePayPalCheckout } = await import("../api/_lib/paypalCheckout.ts");
    await expect(
      finalizePayPalCheckout("PPORDER123", { userId: "someone-else", expectedOrderId: ORDER_ID }),
    ).rejects.toMatchObject({ status: 404 });
    expect(state.captureCalls).toBe(0);
  });

  it("never captures when the PayPal amount doesn't match the order", async () => {
    state.paypalOrder = ppOrder("APPROVED", "0.01");
    const { finalizePayPalCheckout } = await import("../api/_lib/paypalCheckout.ts");
    const result = await finalizePayPalCheckout("PPORDER123", { userId: "user-1" });
    expect(result.outcome).toBe("rejected");
    expect(state.captureCalls).toBe(0);
    expect(state.markPaidCalls).toHaveLength(0);
  });

  it("never captures an order already paid another way (e.g. Stripe)", async () => {
    state.order!.payment_status = "paid";
    state.order!.status = "paid";
    const { finalizePayPalCheckout } = await import("../api/_lib/paypalCheckout.ts");
    const result = await finalizePayPalCheckout("PPORDER123", { userId: "user-1" });
    expect(result.outcome).toBe("already_paid");
    expect(state.captureCalls).toBe(0);
  });

  it("never captures a cancelled order", async () => {
    state.order!.status = "cancelled";
    const { finalizePayPalCheckout } = await import("../api/_lib/paypalCheckout.ts");
    const result = await finalizePayPalCheckout("PPORDER123", { userId: "user-1" });
    expect(result.outcome).toBe("rejected");
    expect(state.captureCalls).toBe(0);
  });

  it("marks a pending capture as processing, not paid", async () => {
    state.captureResult = ppOrder("COMPLETED", "12.34", [completedCapture("12.34", "PENDING")]);
    const { finalizePayPalCheckout } = await import("../api/_lib/paypalCheckout.ts");
    const result = await finalizePayPalCheckout("PPORDER123", { userId: "user-1" });
    expect(result.outcome).toBe("pending");
    expect(state.markPaidCalls).toHaveLength(0);
    expect(state.updates[0]).toMatchObject({ payment_status: "processing", payment_provider: "paypal" });
  });

  it("is idempotent for an order PayPal already completed", async () => {
    state.paypalOrder = ppOrder("COMPLETED", "12.34", [completedCapture()]);
    const { finalizePayPalCheckout } = await import("../api/_lib/paypalCheckout.ts");
    await finalizePayPalCheckout("PPORDER123", { userId: null });
    const again = await finalizePayPalCheckout("PPORDER123", { userId: null });
    expect(again.outcome).toBe("already_paid");
    expect(state.captureCalls).toBe(0);
    expect(state.markPaidCalls).toHaveLength(1);
  });
});

function webhookReq(event: unknown) {
  const req = new EventEmitter() as EventEmitter & { method: string; headers: Record<string, string> };
  req.method = "POST";
  req.headers = {};
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
  queueMicrotask(() => {
    req.emit("data", Buffer.from(JSON.stringify(event)));
    req.emit("end");
  });
  return { req, res };
}

async function invokeWebhook(event: unknown) {
  const { default: handler } = await import("../api/webhooks/paypal.ts");
  const { req, res } = webhookReq(event);
  await handler(req as never, res as never);
  return res;
}

describe("paypal webhook", () => {
  const completed = {
    id: "WH-EVT-1",
    event_type: "PAYMENT.CAPTURE.COMPLETED",
    resource: completedCapture(),
  };

  it("rejects an unverified delivery without touching the order", async () => {
    state.webhookValid = false;
    const res = await invokeWebhook(completed);
    expect(res.statusCode).toBe(400);
    expect(state.markPaidCalls).toHaveLength(0);
  });

  it("marks the order paid from PAYMENT.CAPTURE.COMPLETED and dedupes replays", async () => {
    const first = await invokeWebhook(completed);
    expect(first.statusCode).toBe(200);
    expect(state.markPaidCalls).toHaveLength(1);
    expect(state.events).toEqual(["WH-EVT-1"]);

    const replay = await invokeWebhook(completed);
    expect(replay.body).toMatchObject({ deduped: true });
    expect(state.markPaidCalls).toHaveLength(1);
  });

  it("captures from CHECKOUT.ORDER.APPROVED when the browser never did", async () => {
    const res = await invokeWebhook({
      id: "WH-EVT-2",
      event_type: "CHECKOUT.ORDER.APPROVED",
      resource: ppOrder("APPROVED"),
    });
    expect(res.statusCode).toBe(200);
    expect(state.captureCalls).toBe(1);
    expect(state.markPaidCalls).toHaveLength(1);
  });
});
