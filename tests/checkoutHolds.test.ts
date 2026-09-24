import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";

beforeAll(() => {
  process.env.SUPABASE_URL = "https://x.invalid";
  process.env.SUPABASE_SECRET_KEY = "svc";
});

const state = {
  intents: {} as Record<string, { id: string; status: string }>,
  searchResults: [] as { id: string; status: string }[],
  cancelled: [] as string[],
  cancelFails: false,
  cancelOrderCalls: [] as { id: string; reason: string }[],
  holds: [] as { id: string; payment_reference: string | null }[],
  filters: [] as [string, unknown][],
};

vi.mock("../api/_lib/stripe.js", () => ({
  getStripe: () => ({
    paymentIntents: {
      retrieve: async (id: string) => state.intents[id],
      search: async () => ({ data: state.searchResults }),
      cancel: async (id: string) => {
        if (state.cancelFails) {
          state.intents[id] = { id, status: "processing" };
          throw new Error("state changed");
        }
        state.cancelled.push(id);
        state.intents[id] = { id, status: "canceled" };
        return state.intents[id];
      },
    },
  }),
}));

vi.mock("../api/_lib/supabaseAdmin.js", () => ({
  getSupabaseAdmin: () => ({
    from: () => {
      const q = {
        select: () => q,
        eq: (c: string, v: unknown) => (state.filters.push([c, v]), q),
        lt: (c: string, v: unknown) => (state.filters.push([c, v]), q),
        order: () => q,
        limit: () => q,
        then: (r: (v: unknown) => void) => r({ data: state.holds, error: null }),
      };
      return q;
    },
    rpc: async (fn: string, args: { p_order_id: string; p_reason: string }) => {
      if (fn === "cancel_unpaid_order") {
        state.cancelOrderCalls.push({ id: args.p_order_id, reason: args.p_reason });
      }
      return { error: null };
    },
  }),
}));

beforeEach(() => {
  process.env.STRIPE_SECRET_KEY = "sk_test_x";
  state.intents = {};
  state.searchResults = [];
  state.cancelled = [];
  state.cancelFails = false;
  state.cancelOrderCalls = [];
  state.holds = [];
  state.filters = [];
});

describe("releaseHold", () => {
  it("cancels the order's open PaymentIntent, then restocks", async () => {
    state.intents.pi_1 = { id: "pi_1", status: "requires_payment_method" };
    const { releaseHold } = await import("../api/_lib/checkoutHolds.ts");
    const outcome = await releaseHold({ id: "o1", payment_reference: "pi_1" }, "Checkout expired");
    expect(outcome).toBe("released");
    expect(state.cancelled).toEqual(["pi_1"]);
    expect(state.cancelOrderCalls).toEqual([{ id: "o1", reason: "Checkout expired" }]);
  });

  it("never releases a hold whose payment is processing or succeeded", async () => {
    for (const status of ["processing", "succeeded"]) {
      state.cancelOrderCalls = [];
      state.intents.pi_1 = { id: "pi_1", status };
      const { releaseHold } = await import("../api/_lib/checkoutHolds.ts");
      expect(await releaseHold({ id: "o1", payment_reference: "pi_1" }, "x")).toBe("payment_in_flight");
      expect(state.cancelOrderCalls).toHaveLength(0);
    }
  });

  it("keeps the hold if the customer confirms payment mid-cancel", async () => {
    state.intents.pi_1 = { id: "pi_1", status: "requires_action" };
    state.cancelFails = true;
    const { releaseHold } = await import("../api/_lib/checkoutHolds.ts");
    expect(await releaseHold({ id: "o1", payment_reference: "pi_1" }, "x")).toBe("payment_in_flight");
    expect(state.cancelOrderCalls).toHaveLength(0);
  });

  it("finds PaymentIntents by metadata for orders without a stored id", async () => {
    state.searchResults = [{ id: "pi_old", status: "requires_payment_method" }];
    const { releaseHold } = await import("../api/_lib/checkoutHolds.ts");
    expect(await releaseHold({ id: "o-old", payment_reference: null }, "x")).toBe("released");
    expect(state.cancelled).toEqual(["pi_old"]);
  });

  it("releases directly when Stripe isn't configured", async () => {
    delete process.env.STRIPE_SECRET_KEY;
    const { releaseHold } = await import("../api/_lib/checkoutHolds.ts");
    expect(await releaseHold({ id: "o1", payment_reference: null }, "x")).toBe("released");
    expect(state.cancelOrderCalls).toHaveLength(1);
  });
});

describe("expireStaleHolds", () => {
  it("only looks at unpaid online holds older than the hold window", async () => {
    state.holds = [
      { id: "a", payment_reference: null },
      { id: "b", payment_reference: "pi_b" },
    ];
    state.intents.pi_b = { id: "pi_b", status: "processing" };
    const { expireStaleHolds, HOLD_MINUTES } = await import("../api/_lib/checkoutHolds.ts");
    state.searchResults = [];
    const before = Date.now();
    const counts = await expireStaleHolds();
    expect(counts).toEqual({ released: 1, payment_in_flight: 1, failed: 0 });
    expect(state.filters).toEqual(
      expect.arrayContaining([
        ["channel", "online"],
        ["status", "pending_payment"],
        ["payment_status", "unpaid"],
      ]),
    );
    const cutoff = Date.parse(state.filters.find(([c]) => c === "created_at")![1] as string);
    expect(before - cutoff).toBeGreaterThanOrEqual(HOLD_MINUTES * 60_000 - 1000);
  });
});
