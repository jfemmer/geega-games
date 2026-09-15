import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import { EventEmitter } from "node:events";

beforeAll(() => {
  process.env.SUPABASE_URL = "https://x.invalid";
  process.env.SUPABASE_SECRET_KEY = "svc";
  process.env.STRIPE_SECRET_KEY = "sk_test_x";
  process.env.STRIPE_WEBHOOK_SECRET = "whsec_test";
  process.env.RESEND_API_KEY = "re_test";
  process.env.RESEND_FROM_ORDERS = "orders@geega-games.com";
  process.env.EMAIL_TOKEN_SECRET = "s".repeat(32);
  process.env.PUBLIC_SITE_URL = "https://geega-games.com";
});

// Fake DB state shared across the mock.
const state = {
  events: [] as { event_id: string }[],
  markPaidCalls: [] as { orderId: string; ref: string }[],
  emails: [] as string[],
};

// The event our fake Stripe will "verify" from any raw body.
let currentEvent: Record<string, unknown>;

vi.mock("../api/_lib/stripe.js", () => ({
  getStripe: () => ({
    webhooks: {
      // Signature check is exercised in integration; here we return the event.
      constructEvent: () => currentEvent,
    },
  }),
}));

vi.mock("../api/_lib/orderConfirmation.js", () => ({
  sendOrderConfirmation: async (orderId: string) => {
    state.emails.push(orderId);
    return { status: "sent" };
  },
}));

vi.mock("../api/_lib/supabaseAdmin.js", () => ({
  getSupabaseAdmin: () => ({
    from: (table: string) => {
      if (table === "payment_events") {
        return {
          insert: async (row: { event_id: string }) => {
            if (state.events.some((e) => e.event_id === row.event_id)) {
              // Simulate a unique-violation on event_id.
              return { error: { code: "23505", message: "duplicate key" } };
            }
            state.events.push({ event_id: row.event_id });
            return { error: null };
          },
        };
      }
      return {};
    },
    rpc: async (fn: string, args: Record<string, unknown>) => {
      if (fn === "mark_order_paid") {
        state.markPaidCalls.push({
          orderId: args.p_order_id as string,
          ref: args.p_reference as string,
        });
        return { error: null };
      }
      return { error: null };
    },
  }),
}));

// Build a minimal Vercel-style req/res.
function makeReqRes(rawBody: string) {
  const req = new EventEmitter() as unknown as {
    method: string;
    headers: Record<string, string>;
    on: (ev: string, cb: (chunk?: unknown) => void) => void;
  } & EventEmitter;
  req.method = "POST";
  req.headers = { "stripe-signature": "t=1,v1=abc", "content-type": "application/json" };

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

  // Emit the raw body on next tick so readRawBody resolves.
  queueMicrotask(() => {
    req.emit("data", Buffer.from(rawBody));
    req.emit("end");
  });

  return { req, res };
}

async function invoke(rawBody: string) {
  const mod = await import("../api/webhooks/stripe.ts");
  const handler = mod.default;
  const { req, res } = makeReqRes(rawBody);
  await handler(req as never, res as never);
  return res;
}

describe("stripe webhook idempotency", () => {
  beforeEach(() => {
    state.events = [];
    state.markPaidCalls = [];
    state.emails = [];
    currentEvent = {
      id: "evt_123",
      type: "payment_intent.succeeded",
      data: { object: { id: "pi_1", metadata: { order_id: "order_abc" } } },
    };
  });

  it("marks the order paid and emails once on first delivery", async () => {
    const res = await invoke("{}");
    expect(res.statusCode).toBe(200);
    expect(state.markPaidCalls).toHaveLength(1);
    expect(state.markPaidCalls[0]).toEqual({ orderId: "order_abc", ref: "pi_1" });
    expect(state.emails).toEqual(["order_abc"]);
  });

  it("dedupes a repeated delivery of the same event id (no double charge effects)", async () => {
    await invoke("{}"); // first
    const res2 = await invoke("{}"); // duplicate event id
    expect(res2.statusCode).toBe(200);
    expect((res2.body as { deduped?: boolean }).deduped).toBe(true);
    // mark_order_paid and email happened only once total.
    expect(state.markPaidCalls).toHaveLength(1);
    expect(state.emails).toHaveLength(1);
  });

  it("records non-success events without marking paid", async () => {
    currentEvent = {
      id: "evt_other",
      type: "payment_intent.payment_failed",
      data: { object: { id: "pi_2", metadata: { order_id: "order_xyz" } } },
    };
    const res = await invoke("{}");
    expect(res.statusCode).toBe(200);
    expect(state.markPaidCalls).toHaveLength(0);
    expect(state.emails).toHaveLength(0);
    expect(state.events).toHaveLength(1); // still recorded for audit
  });
});
