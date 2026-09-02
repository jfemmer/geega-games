import { describe, it, expect, beforeAll, vi, beforeEach } from "vitest";

beforeAll(() => {
  process.env.EMAIL_TOKEN_SECRET = "test-secret";
  process.env.SUPABASE_URL = "https://x.invalid";
  process.env.SUPABASE_SECRET_KEY = "svc";
  process.env.RESEND_API_KEY = "re_test";
  process.env.PUBLIC_SITE_URL = "https://geega-games.com";
  process.env.RESEND_FROM_ORDERS = "Geega <orders@geega-games.com>";
  process.env.RESEND_REPLY_TO = "support@geega-games.com";
});

// Configurable fake order state.
const state: {
  order: Record<string, unknown> | null;
  items: Record<string, unknown>[];
  sentKeys: Set<string>;
} = { order: null, items: [], sentKeys: new Set() };

// order_items uses .select().eq() (no single) returning a list; orders uses
// .select().eq().single(). The mock below models both shapes.
vi.mock("../api/_lib/supabaseAdmin.js", () => ({
  getSupabaseAdmin: () => ({
    from: (table: string) => {
      if (table === "orders") {
        return {
          select: () => ({
            eq: () => ({
              single: async () => ({
                data: state.order,
                error: state.order ? null : "not-found",
              }),
            }),
          }),
        };
      }
      if (table === "order_items") {
        return {
          select: () => ({
            eq: async () => ({ data: state.items, error: null }),
          }),
        };
      }
      if (table === "profiles") {
        return {
          select: () => ({
            eq: () => ({ maybeSingle: async () => ({ data: null }) }),
          }),
        };
      }
      // email_deliveries
      return {
        insert: async (row: Record<string, unknown>) => {
          const key = String(row.idempotency_key);
          if (state.sentKeys.has(key)) {
            return { error: { code: "23505", message: "dup" } };
          }
          state.sentKeys.add(key);
          return { error: null };
        },
        update: () => ({ eq: async () => ({ error: null }) }),
      };
    },
  }),
}));

const sendMock = vi.fn(async () => ({ data: { id: "re_1" }, error: null }));
vi.mock("../api/_lib/resend.js", () => ({
  getResend: () => ({ emails: { send: sendMock } }),
}));
vi.mock("@react-email/render", () => ({ render: async () => "<html/>" }));

const { sendOrderConfirmation } = await import(
  "../api/_lib/orderConfirmation.js"
);

const paidOrder = () => ({
  id: "11111111-2222-3333-4444-555555555555",
  email: "buyer@example.com",
  payment_status: "paid",
  created_at: new Date().toISOString(),
  subtotal_cents: 1000,
  shipping_cents: 100,
  discount_cents: 0,
  total_cents: 1100,
  ship_recipient: "Buyer",
  ship_line1: "1 Main",
  ship_line2: null,
  ship_city: "Town",
  ship_state: "CA",
  ship_postal_code: "90001",
  ship_country: "US",
  user_id: null,
});

beforeEach(() => {
  state.order = null;
  state.items = [
    {
      card_name: "Lightning Bolt",
      set_name: "M10",
      condition: "NM",
      finish: "nonfoil",
      quantity: 2,
      unit_price_cents: 500,
      line_total_cents: 1000,
    },
  ];
  state.sentKeys = new Set();
  sendMock.mockClear();
});

describe("sendOrderConfirmation", () => {
  it("accepts only an order ID (never browser-supplied details)", () => {
    // Type-level guarantee + runtime: the function signature takes a string.
    expect(sendOrderConfirmation.length).toBe(1);
  });

  it("skips when the order is not paid", async () => {
    state.order = { ...paidOrder(), payment_status: "unpaid" };
    const r = await sendOrderConfirmation(state.order.id as string);
    expect(r).toEqual({ status: "skipped", reason: "payment_status=unpaid" });
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("skips when the order does not exist", async () => {
    state.order = null;
    const r = await sendOrderConfirmation("does-not-exist");
    expect(r).toEqual({ status: "skipped", reason: "order-not-found" });
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("sends exactly once for a paid order", async () => {
    state.order = paidOrder();
    const r = await sendOrderConfirmation(state.order.id as string);
    expect(r.status).toBe("sent");
    expect(sendMock).toHaveBeenCalledTimes(1);
  });

  it("prevents duplicate confirmations on retry", async () => {
    state.order = paidOrder();
    const id = state.order.id as string;
    const first = await sendOrderConfirmation(id);
    const second = await sendOrderConfirmation(id);
    expect(first.status).toBe("sent");
    expect(second.status).toBe("deduped");
    expect(sendMock).toHaveBeenCalledTimes(1);
  });

  it("skips when there are no items", async () => {
    state.order = paidOrder();
    state.items = [];
    const r = await sendOrderConfirmation(state.order.id as string);
    expect(r).toEqual({ status: "skipped", reason: "no-items" });
  });
});
