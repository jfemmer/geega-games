import { beforeEach, describe, expect, it, vi } from "vitest";

// Exercises the "orders" / "buy-label" branch of the consolidated admin
// router (api/admin/index.ts). Rather than hitting the real EasyPost SDK
// (which needs live credentials and would make network calls), this mocks
// api/_lib/easypost.js's exported buyShippingLabel directly — the same
// "mock the _lib boundary, exercise the real handler" pattern already used
// for the sell-submit endpoint (see sellSubmitApi.test.ts). What actually
// matters to get right here — the ready_to_ship/tracked preconditions, the
// address mapping, and persisting the returned label fields — all lives in
// api/admin/index.ts itself and is fully exercised.

const state: {
  order: Record<string, unknown> | null;
  updatePayload: Record<string, unknown> | null;
  authUser: { id: string; app_metadata: Record<string, unknown> } | null;
} = {
  order: null,
  updatePayload: null,
  authUser: { id: "staff-1", app_metadata: { role: "staff" } },
};

vi.mock("../api/_lib/supabaseAdmin.js", () => ({
  getSupabaseAdmin: () => ({
    auth: {
      getUser: async () => ({ data: { user: state.authUser }, error: null }),
    },
    from: (table: string) => {
      if (table !== "orders") throw new Error(`unexpected table ${table}`);
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: state.order, error: null }),
          }),
        }),
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

vi.mock("../api/_lib/orderStatusEmail.js", () => ({
  sendOrderStatusEmail: vi.fn(async () => ({ status: "sent" })),
}));

const buyShippingLabel = vi.fn();
vi.mock("../api/_lib/easypost.js", () => ({
  buyShippingLabel: (...args: unknown[]) => buyShippingLabel(...args),
}));

const { default: handler } = await import("../api/admin/index.ts");

function makeReqRes(body: Record<string, unknown>) {
  const req = {
    method: "POST",
    headers: { authorization: "Bearer staff-token", "content-type": "application/json" },
    query: { resource: "orders", action: "buy-label" },
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

const readyTrackedOrder = {
  id: "order-1",
  status: "ready_to_ship",
  shipping_method: "tracked",
  ship_recipient: "Jordan Vega",
  ship_line1: "123 Main St",
  ship_line2: null,
  ship_city: "Ballwin",
  ship_state: "MO",
  ship_postal_code: "63011",
  ship_country: "US",
};

beforeEach(() => {
  state.order = { ...readyTrackedOrder };
  state.updatePayload = null;
  state.authUser = { id: "staff-1", app_metadata: { role: "staff" } };
  buyShippingLabel.mockReset();
});

describe("POST /api/admin?resource=orders&action=buy-label", () => {
  it("rejects an unauthenticated request", async () => {
    state.authUser = null;
    const res = await invoke({ orderId: "order-1" });
    expect(res.statusCode).toBe(401);
    expect(buyShippingLabel).not.toHaveBeenCalled();
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

  it("refuses to buy a label before the order is ready to ship", async () => {
    state.order = { ...readyTrackedOrder, status: "packing" };
    const res = await invoke({ orderId: "order-1" });
    expect(res.statusCode).toBe(409);
    expect(buyShippingLabel).not.toHaveBeenCalled();
  });

  it("refuses to buy a label for a Plain White Envelope order", async () => {
    state.order = { ...readyTrackedOrder, shipping_method: "pwe" };
    const res = await invoke({ orderId: "order-1" });
    expect(res.statusCode).toBe(400);
    expect(buyShippingLabel).not.toHaveBeenCalled();
  });

  it("buys a label, persists the result, and marks the order shipped", async () => {
    buyShippingLabel.mockResolvedValue({
      labelUrl: "https://easypost.example/label.pdf",
      trackingCode: "9400111899223344556677",
      carrier: "USPS",
      service: "First",
      rateCents: 487,
      shipmentId: "shp_123",
      weightOz: 3,
    });

    const res = await invoke({ orderId: "order-1" });

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({
      ok: true,
      labelUrl: "https://easypost.example/label.pdf",
      trackingCarrier: "USPS",
      trackingNumber: "9400111899223344556677",
      postageCostCents: 487,
    });

    // The order's own address was mapped through to EasyPost unchanged.
    expect(buyShippingLabel).toHaveBeenCalledWith({
      name: "Jordan Vega",
      street1: "123 Main St",
      street2: null,
      city: "Ballwin",
      state: "MO",
      zip: "63011",
      country: "US",
    });

    expect(state.updatePayload).toMatchObject({
      status: "shipped",
      tracking_carrier: "USPS",
      tracking_number: "9400111899223344556677",
      label_url: "https://easypost.example/label.pdf",
      postage_cost_cents: 487,
      easypost_shipment_id: "shp_123",
      shipping_service: "First",
      package_weight_oz: 3,
    });
  });

  it("surfaces a clear error and never marks the order shipped when EasyPost isn't connected", async () => {
    buyShippingLabel.mockRejectedValue(
      new Error("EasyPost isn't connected yet — add EASYPOST_API_KEY in Vercel to enable label purchasing."),
    );

    const res = await invoke({ orderId: "order-1" });

    expect(res.statusCode).toBe(502);
    expect((res.body as { message: string }).message).toMatch(/EasyPost isn't connected/);
    expect(state.updatePayload).toBeNull();
  });
});
