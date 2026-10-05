import { beforeEach, describe, expect, it, vi } from "vitest";
import { US_ONLY_MESSAGE, US_STATE_MESSAGE, US_ZIP_MESSAGE } from "../src/store/lib/usAddress";

// POST /api/checkout/create-payment-intent only starts an order that ships
// within the United States. The real handler runs here against mocked
// database clients, so what's checked is what it decides: a foreign (or
// incomplete) address is refused before the database is touched at all, so
// no order is created, no stock is held and an earlier hold is left alone;
// an address it accepts reaches the database tidied.
// (The database refuses a foreign address on its own as well:
// supabase/migrations/20261005150000_us_shipping_only.sql.)
// Also here, since it is the same endpoint: how big a guest's cart may be.

const calls = vi.hoisted(() => ({
  adminRpc: vi.fn(),
  userRpc: vi.fn(),
  getUser: vi.fn(),
  releaseUserHolds: vi.fn(),
  releaseHold: vi.fn(),
}));

vi.mock("../api/_lib/supabaseAdmin.js", () => ({
  getSupabaseAdmin: () => ({
    rpc: calls.adminRpc,
    from: () => {
      throw new Error("unexpected table access");
    },
  }),
}));

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({ auth: { getUser: calls.getUser }, rpc: calls.userRpc }),
}));

vi.mock("../api/_lib/checkoutHolds.js", () => ({
  releaseHold: calls.releaseHold,
  releaseUserHolds: calls.releaseUserHolds,
}));

vi.mock("../api/_lib/rateLimit.js", () => ({
  checkRateLimit: () => ({ allowed: true }),
  getClientIp: () => "203.0.113.9",
}));

vi.mock("../api/_lib/stripe.js", () => ({
  getStripe: () => {
    throw new Error("Stripe isn't part of these tests");
  },
}));

const { default: handler } = await import("../api/checkout/create-payment-intent.ts");

const ORDER_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const ITEM_ID = "11111111-2222-3333-4444-555555555555";

type Ship = Record<string, unknown>;

const US_ADDRESS: Ship = {
  recipient: "Jordan Vega",
  line1: "123 Main St",
  city: "Ballwin",
  state: "MO",
  postalCode: "63011",
  country: "US",
};

const ABROAD: [string, Ship][] = [
  ["Canada", { ...US_ADDRESS, line1: "100 Queen St W", city: "Toronto", state: "ON", postalCode: "M5H 2N2", country: "CA" }],
  ["the United Kingdom", { ...US_ADDRESS, city: "London", state: "England", postalCode: "SW1A 1AA", country: "United Kingdom" }],
  ["Mexico", { ...US_ADDRESS, city: "Guadalajara", state: "Jalisco", postalCode: "44100", country: "MX" }],
  // A US-looking state and ZIP under another country is still another country.
  ["Germany, dressed as Missouri", { ...US_ADDRESS, country: "Germany" }],
];

async function post(body: Record<string, unknown>, headers: Record<string, string> = {}) {
  const req = { method: "POST", headers: { "content-type": "application/json", ...headers }, body };
  const res = {
    statusCode: 200,
    body: undefined as unknown as Record<string, unknown>,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: Record<string, unknown>) {
      this.body = payload;
      return this;
    },
    setHeader() {},
  };
  await handler(req as never, res as never);
  return res;
}

const guestOrder = (ship: Ship | undefined, lines = 1) =>
  post({
    shippingMethod: "tracked",
    guest: {
      email: "buyer@example.com",
      items: Array.from({ length: lines }, (_, i) => ({
        inventoryItemId: `${ITEM_ID.slice(0, -3)}${String(i).padStart(3, "0")}`,
        quantity: 1,
      })),
    },
    ship,
  });

const memberOrder = (ship: Ship | undefined) =>
  post({ shippingMethod: "tracked", ship }, { authorization: "Bearer member-token" });

/** The arguments the order function was called with, or undefined if it wasn't. */
const orderArgs = (rpc: typeof calls.adminRpc, name: string) =>
  rpc.mock.calls.find(([fn]) => fn === name)?.[1] as Record<string, unknown> | undefined;

beforeEach(() => {
  process.env.SUPABASE_URL = "https://db.invalid";
  process.env.EMAIL_TOKEN_SECRET = "test-secret-for-guest-tokens";
  // No card processor here: the endpoint then answers once the order exists.
  delete process.env.STRIPE_SECRET_KEY;

  for (const mock of Object.values(calls)) mock.mockReset();
  const created = { data: [{ order_id: ORDER_ID, amount_due_cents: 1550 }], error: null };
  const open = { data: [{ paused: false, message: "" }], error: null };
  calls.adminRpc.mockImplementation(async (fn: string) => (fn === "store_ordering_status" ? open : created));
  calls.userRpc.mockImplementation(async (fn: string) => (fn === "store_ordering_status" ? open : created));
  calls.getUser.mockResolvedValue({ data: { user: { id: "member-1" } }, error: null });
  calls.releaseUserHolds.mockResolvedValue(undefined);
  calls.releaseHold.mockResolvedValue(undefined);
});

describe("guest checkout", () => {
  it.each(ABROAD)("refuses an address in %s without creating anything", async (_where, ship) => {
    const res = await guestOrder(ship);

    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ ok: false, code: "shipping_address", message: US_ONLY_MESSAGE });
    // The database was never asked for anything: no order, no stock hold.
    expect(calls.adminRpc).not.toHaveBeenCalled();
    expect(calls.releaseHold).not.toHaveBeenCalled();
  });

  it("refuses a state that isn't a US state", async () => {
    const res = await guestOrder({ ...US_ADDRESS, state: "Ontario" });
    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ ok: false, code: "shipping_address", message: US_STATE_MESSAGE });
    expect(calls.adminRpc).not.toHaveBeenCalled();
  });

  it("refuses a missing state", async () => {
    const res = await guestOrder({ ...US_ADDRESS, state: "" });
    expect(res.body).toEqual({ ok: false, code: "shipping_address", message: US_STATE_MESSAGE });
    expect(calls.adminRpc).not.toHaveBeenCalled();
  });

  it("refuses a postcode that isn't a US ZIP", async () => {
    const res = await guestOrder({ ...US_ADDRESS, postalCode: "M5H 2N2" });
    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ ok: false, code: "shipping_address", message: US_ZIP_MESSAGE });
    expect(calls.adminRpc).not.toHaveBeenCalled();
  });

  it.each([
    ["no address at all", undefined],
    ["no street", { ...US_ADDRESS, line1: "  " }],
    ["no city", { ...US_ADDRESS, city: "" }],
    ["no ZIP", { ...US_ADDRESS, postalCode: "" }],
    ["no name", { ...US_ADDRESS, recipient: " " }],
    ["fields that aren't text", { ...US_ADDRESS, line1: 123, city: ["Ballwin"] }],
  ])("refuses an order with %s", async (_what, ship) => {
    const res = await guestOrder(ship as Ship | undefined);
    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({
      ok: false,
      code: "shipping_address",
      message: "Please provide your name and a complete shipping address.",
    });
    expect(calls.adminRpc).not.toHaveBeenCalled();
  });

  it("creates the order for a US address", async () => {
    const res = await guestOrder(US_ADDRESS);

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ ok: true, orderId: ORDER_ID, amountDueCents: 1550 });
    expect(typeof res.body.guestToken).toBe("string");
    expect(orderArgs(calls.adminRpc, "checkout_create_guest_order")).toEqual({
      p_email: "buyer@example.com",
      p_items: [{ inventory_item_id: `${ITEM_ID.slice(0, -3)}000`, quantity: 1 }],
      p_shipping_method: "tracked",
      p_ship_recipient: "Jordan Vega",
      p_ship_line1: "123 Main St",
      p_ship_line2: null,
      p_ship_city: "Ballwin",
      p_ship_state: "MO",
      p_ship_postal_code: "63011",
      p_ship_country: "US",
    });
  });

  it("tidies the address before it reaches the database", async () => {
    await guestOrder({
      recipient: "  Jordan Vega ",
      line1: " 123 Main St ",
      line2: " Apt 4 ",
      city: " Ballwin ",
      state: " missouri ",
      postalCode: "630111234",
      country: "usa",
    });

    expect(orderArgs(calls.adminRpc, "checkout_create_guest_order")).toMatchObject({
      p_ship_recipient: "Jordan Vega",
      p_ship_line1: "123 Main St",
      p_ship_line2: "Apt 4",
      p_ship_city: "Ballwin",
      p_ship_state: "MO",
      p_ship_postal_code: "63011-1234",
      p_ship_country: "US",
    });
  });

  it("treats an address sent without a country as a US address", async () => {
    const { country: _country, ...noCountry } = US_ADDRESS;
    const res = await guestOrder(noCountry);
    expect(res.statusCode).toBe(200);
    expect(orderArgs(calls.adminRpc, "checkout_create_guest_order")).toMatchObject({
      p_ship_state: "MO",
      p_ship_country: "US",
    });
  });

  it.each([
    ["Puerto Rico, as the address lookup gives it", { city: "San Juan", state: "San Juan", postalCode: "00901", country: "PR" }, "PR"],
    ["Puerto Rico, as the form sends it", { city: "San Juan", state: "PR", postalCode: "00901", country: "US" }, "PR"],
    ["Guam", { city: "Tamuning", state: "Guam", postalCode: "96913", country: "US" }, "GU"],
    ["Hawaii", { city: "Honolulu", state: "Hawaii", postalCode: "96813", country: "US" }, "HI"],
    ["Washington, D.C.", { city: "Washington", state: "Washington, D.C.", postalCode: "20001", country: "US" }, "DC"],
    ["a military address", { city: "APO", state: "AE", postalCode: "09012", country: "US" }, "AE"],
  ])("ships to %s", async (_where, place, state) => {
    const res = await guestOrder({ ...US_ADDRESS, ...place });
    expect(res.statusCode).toBe(200);
    expect(orderArgs(calls.adminRpc, "checkout_create_guest_order")).toMatchObject({
      p_ship_state: state,
      p_ship_postal_code: place.postalCode,
      p_ship_country: "US",
    });
  });

  it("still answers that checkout is paused, for an address it would ship to", async () => {
    calls.adminRpc.mockImplementation(async (fn: string) =>
      fn === "store_ordering_status"
        ? { data: [{ paused: true, message: "Back Monday." }], error: null }
        : { data: null, error: { message: "should not be reached" } },
    );
    const res = await guestOrder(US_ADDRESS);
    expect(res.statusCode).toBe(503);
    expect(res.body).toEqual({ ok: false, code: "orders_paused", message: "Back Monday." });
    expect(orderArgs(calls.adminRpc, "checkout_create_guest_order")).toBeUndefined();
  });
});

describe("a guest's cart size", () => {
  // A guest's cart travels in the request. The endpoint allows 100 different
  // cards, so the request must be allowed to be big enough to hold them: it
  // used to be cut off at about 50, and those guests could not check out.
  it("can hold 100 different cards", async () => {
    const res = await guestOrder(
      { ...US_ADDRESS, recipient: "Jordan Alexander Vega-Martinez", line1: "12345 North Example Boulevard", line2: "Apartment 1234", postalCode: "63011-1234" },
      100,
    );

    expect(res.statusCode).toBe(200);
    const sent = orderArgs(calls.adminRpc, "checkout_create_guest_order")?.p_items as unknown[];
    expect(sent).toHaveLength(100);
  });

  it("still stops at 100", async () => {
    const res = await guestOrder(US_ADDRESS, 101);
    expect(res.statusCode).toBe(400);
    expect(res.body.message).toMatch(/cart is empty or couldn.t be read/);
    expect(calls.adminRpc).not.toHaveBeenCalled();
  });

  it("still refuses a request far bigger than any cart", async () => {
    const res = await post({
      shippingMethod: "tracked",
      guest: { email: "buyer@example.com", items: [{ inventoryItemId: ITEM_ID, quantity: 1 }] },
      ship: { ...US_ADDRESS, line2: "x".repeat(20_000) },
    });
    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ ok: false, message: "Bad request body." });
    expect(calls.adminRpc).not.toHaveBeenCalled();
  });
});

describe("signed-in checkout", () => {
  it.each(ABROAD)("refuses an address in %s and leaves an earlier hold alone", async (_where, ship) => {
    const res = await memberOrder(ship);

    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ ok: false, code: "shipping_address", message: US_ONLY_MESSAGE });
    expect(calls.userRpc).not.toHaveBeenCalled();
    // Cards the customer is already holding for a US order stay held.
    expect(calls.releaseUserHolds).not.toHaveBeenCalled();
  });

  it("refuses an order with no address", async () => {
    const res = await memberOrder(undefined);
    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({
      ok: false,
      code: "shipping_address",
      message: "Please provide a complete shipping address.",
    });
    expect(calls.userRpc).not.toHaveBeenCalled();
    expect(calls.releaseUserHolds).not.toHaveBeenCalled();
  });

  it("refuses a foreign state or postcode", async () => {
    expect((await memberOrder({ ...US_ADDRESS, state: "British Columbia" })).body).toMatchObject({
      code: "shipping_address",
      message: US_STATE_MESSAGE,
    });
    expect((await memberOrder({ ...US_ADDRESS, postalCode: "V6B 1A1" })).body).toMatchObject({
      code: "shipping_address",
      message: US_ZIP_MESSAGE,
    });
    expect(calls.userRpc).not.toHaveBeenCalled();
  });

  it("creates the order for a US address, tidied", async () => {
    const res = await memberOrder({ ...US_ADDRESS, state: "Missouri", postalCode: "63011 1234", country: "United States" });

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ ok: true, orderId: ORDER_ID });
    expect(calls.releaseUserHolds).toHaveBeenCalledWith("member-1");
    expect(orderArgs(calls.userRpc, "checkout_create_order")).toEqual({
      p_shipping_method: "tracked",
      p_store_credit_requested_cents: 0,
      p_ship_recipient: "Jordan Vega",
      p_ship_line1: "123 Main St",
      p_ship_line2: undefined,
      p_ship_city: "Ballwin",
      p_ship_state: "MO",
      p_ship_postal_code: "63011-1234",
      p_ship_country: "US",
    });
  });

  it("doesn't need a recipient: the package is named after the account", async () => {
    const { recipient: _recipient, ...unnamed } = US_ADDRESS;
    const res = await memberOrder(unnamed);
    expect(res.statusCode).toBe(200);
    expect(orderArgs(calls.userRpc, "checkout_create_order")).toMatchObject({
      p_ship_recipient: undefined,
      p_ship_state: "MO",
    });
  });
});

describe("when the database itself refuses the address", () => {
  // The endpoint checks first, so this is the second lock: reached only if
  // the two copies of the rule ever disagree.
  it("says we only ship within the US", async () => {
    calls.adminRpc.mockImplementation(async (fn: string) =>
      fn === "store_ordering_status"
        ? { data: [{ paused: false, message: "" }], error: null }
        : { data: null, error: { message: "us shipping only" } },
    );
    const res = await guestOrder(US_ADDRESS);
    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({
      ok: false,
      code: "shipping_address",
      message: `${US_ONLY_MESSAGE} Please check the state and ZIP code.`,
    });
  });

  it("says the address is incomplete", async () => {
    calls.userRpc.mockImplementation(async (fn: string) =>
      fn === "store_ordering_status"
        ? { data: [{ paused: false, message: "" }], error: null }
        : { data: null, error: { message: "shipping address required" } },
    );
    const res = await memberOrder(US_ADDRESS);
    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({
      ok: false,
      code: "shipping_address",
      message: "Please provide a complete shipping address.",
    });
  });

  it("keeps its other answers as they were", async () => {
    calls.adminRpc.mockImplementation(async (fn: string) =>
      fn === "store_ordering_status"
        ? { data: [{ paused: false, message: "" }], error: null }
        : { data: null, error: { message: "insufficient stock for Gaea's Cradle (sellable 0, need 1)" } },
    );
    const res = await guestOrder(US_ADDRESS);
    expect(res.statusCode).toBe(409);
    expect(res.body).toMatchObject({ ok: false, code: "stock_conflict" });
  });
});
