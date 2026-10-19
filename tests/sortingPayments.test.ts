import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import { createFakeState, createFakeSupabase, type FakeState } from "./helpers/fakeSupabase";

// Card payments for collection sorting quotes: recorded once per Stripe
// PaymentIntent (api/_lib/sortingPayments.ts), whether the quote page or the
// Stripe webhook reports them first — and the webhook keeps handling store
// orders exactly as before.

beforeAll(() => {
  process.env.SUPABASE_URL = "https://x.invalid";
  process.env.SUPABASE_SECRET_KEY = "svc";
  process.env.STRIPE_SECRET_KEY = "sk_test_x";
  process.env.STRIPE_WEBHOOK_SECRET = "whsec_test";
});

let state: FakeState = createFakeState();
vi.mock("../api/_lib/supabaseAdmin.js", () => ({ getSupabaseAdmin: () => createFakeSupabase(state) }));

const mail = vi.hoisted(() => ({ receipts: [] as string[], staff: [] as string[], orders: [] as string[] }));
vi.mock("../api/_lib/sortingEmails.js", () => ({
  sendSortingPaymentReceipt: async (id: string) => {
    mail.receipts.push(id);
    return { status: "sent" };
  },
  notifySortingStaff: async (_id: string, event: { kind: string }) => {
    mail.staff.push(event.kind);
  },
}));
vi.mock("../api/_lib/orderConfirmation.js", () => ({
  sendOrderConfirmation: async (orderId: string) => {
    mail.orders.push(orderId);
    return { status: "sent" };
  },
  sendOrderAdminNotification: async () => ({ status: "sent" }),
}));

let currentEvent: Record<string, unknown>;
vi.mock("../api/_lib/stripe.js", () => ({
  getStripe: () => ({ webhooks: { constructEvent: () => currentEvent } }),
}));

const { recordSortingCardPayment, isSortingPaymentIntent } = await import("../api/_lib/sortingPayments.ts");
const { default: webhook } = await import("../api/webhooks/stripe.ts");

const REQ = "11111111-1111-4111-8111-111111111111";

function intent(overrides: Record<string, unknown> = {}) {
  return {
    id: "pi_sort1",
    amount: 7000,
    amount_received: 7000,
    status: "succeeded",
    metadata: { kind: "sorting", sorting_request_id: REQ, sorting_quote_id: "q1" },
    ...overrides,
  } as never;
}

let rpcResult: () => { data: unknown; error: { code?: string; message: string } | null };
const rpcCalls: Record<string, unknown>[] = [];

beforeEach(() => {
  state = createFakeState();
  mail.receipts = [];
  mail.staff = [];
  mail.orders = [];
  rpcCalls.length = 0;
  state.tables.payment_events = [];
  rpcResult = () => ({ data: { payment_id: "pay-1", inserted: true, amount_paid_cents: 7000 }, error: null });
  state.rpc.sorting_record_payment = (args) => {
    rpcCalls.push(args);
    return rpcResult();
  };
  state.rpc.mark_order_paid = () => ({ data: null, error: null });
});

describe("recordSortingCardPayment", () => {
  it("records the amount received against the request, with a receipt and a staff alert", async () => {
    const result = await recordSortingCardPayment(intent());
    expect(result).toEqual({ ok: true, inserted: true, amountPaidCents: 7000 });
    expect(rpcCalls).toEqual([
      { p_request_id: REQ, p_amount_cents: 7000, p_method: "card_online", p_reference: "pi_sort1" },
    ]);
    expect(mail.receipts).toEqual(["pay-1"]);
    expect(mail.staff).toEqual(["payment"]);
  });

  it("sends nothing when the payment was already counted", async () => {
    rpcResult = () => ({ data: { payment_id: "pay-1", inserted: false, amount_paid_cents: 7000 }, error: null });
    expect(await recordSortingCardPayment(intent())).toMatchObject({ ok: true, inserted: false });
    expect(mail.receipts).toHaveLength(0);
    expect(mail.staff).toHaveLength(0);
  });

  it("says whether a failure is worth retrying", async () => {
    rpcResult = () => ({ data: null, error: { code: "GGS04", message: "There's no approved quote to pay yet." } });
    expect(await recordSortingCardPayment(intent())).toMatchObject({ ok: false, retryable: false });
    rpcResult = () => ({ data: null, error: { message: "connection reset" } });
    expect(await recordSortingCardPayment(intent())).toMatchObject({ ok: false, retryable: true });
  });

  it("only handles sorting payments", async () => {
    expect(isSortingPaymentIntent(intent())).toBe(true);
    expect(isSortingPaymentIntent(intent({ metadata: { order_id: "o1" } }))).toBe(false);
    expect(await recordSortingCardPayment(intent({ metadata: { order_id: "o1" } }))).toMatchObject({ ok: false });
    expect(rpcCalls).toHaveLength(0);
  });
});

function deliver() {
  const req = new EventEmitter() as EventEmitter & { method: string; headers: Record<string, string> };
  req.method = "POST";
  req.headers = { "stripe-signature": "t=1,v1=abc" };
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
    req.emit("data", Buffer.from("{}"));
    req.emit("end");
  });
  return webhook(req as never, res as never).then(() => res);
}

describe("the Stripe webhook", () => {
  it("records a sorting payment and the event", async () => {
    currentEvent = { id: "evt_s1", type: "payment_intent.succeeded", data: { object: intent() } };
    const res = await deliver();
    expect(res.statusCode).toBe(200);
    expect(rpcCalls).toHaveLength(1);
    expect(mail.orders).toHaveLength(0);
    expect(state.tables.payment_events).toHaveLength(1);
  });

  it("asks Stripe to retry when recording fails for a passing reason", async () => {
    rpcResult = () => ({ data: null, error: { message: "connection reset" } });
    currentEvent = { id: "evt_s2", type: "payment_intent.succeeded", data: { object: intent() } };
    const res = await deliver();
    expect(res.statusCode).toBe(500);
    expect(state.tables.payment_events).toHaveLength(0);
  });

  it("keeps the event, without retrying, when retrying can't help", async () => {
    rpcResult = () => ({ data: null, error: { code: "GGS03", message: "Request not found." } });
    currentEvent = { id: "evt_s3", type: "payment_intent.succeeded", data: { object: intent() } };
    const res = await deliver();
    expect(res.statusCode).toBe(200);
    expect(state.tables.payment_events).toHaveLength(1);
  });

  it("still handles store orders the same way", async () => {
    currentEvent = {
      id: "evt_o1",
      type: "payment_intent.succeeded",
      data: { object: { id: "pi_order", metadata: { order_id: "order_abc" } } },
    };
    const res = await deliver();
    expect(res.statusCode).toBe(200);
    expect(mail.orders).toEqual(["order_abc"]);
    expect(rpcCalls).toHaveLength(0);
  });
});
