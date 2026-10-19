import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeState, createFakeSupabase, fakeResponse, type FakeState } from "./helpers/fakeSupabase";

// Staff side of Yard Sale Mode: the switch (api/admin/yard-sale.ts) and the
// Pickup Requests actions in the admin router (api/admin/index.ts) that take
// a card off a list and complete a yard sale list. The database functions
// are stood in for; this checks who may call them, what they're called
// with, what comes back, and that every change lands in the audit log.

beforeAll(() => {
  process.env.SUPABASE_URL = "https://x.invalid";
  process.env.SUPABASE_SECRET_KEY = "svc";
});

let state: FakeState = createFakeState();
vi.mock("../api/_lib/supabaseAdmin.js", () => ({ getSupabaseAdmin: () => createFakeSupabase(state) }));
vi.mock("../api/_lib/pickupEmails.js", () => ({ sendPickupReadyEmail: async () => ({ status: "skipped" }) }));

const { default: yardSaleHandler } = await import("../api/admin/yard-sale.ts");
const { default: adminRouter } = await import("../api/admin/index.ts");

const STAFF = "staff-token";
const CUSTOMER = "customer-token";
const SALE = "11111111-1111-4111-8111-111111111111";
const OLD_SALE = "22222222-2222-4222-8222-222222222222";
const LIST = "33333333-3333-4333-8333-333333333333";
const KIOSK = "44444444-4444-4444-8444-444444444444";
const ITEM = "55555555-5555-4555-8555-555555555555";
const INV = "66666666-6666-4666-8666-666666666666";

const inHours = (h: number) => new Date(Date.now() + h * 3_600_000).toISOString();

function saleRow(overrides: Record<string, unknown> = {}) {
  return {
    id: SALE,
    started_at: inHours(-2),
    ends_at: inHours(3),
    ended_at: null,
    discount_percent: 20,
    min_price_cents: 300,
    next_pickup_number: 4,
    ...overrides,
  };
}

let calls: { name: string; args: Record<string, unknown> }[] = [];

beforeEach(() => {
  state = createFakeState();
  calls = [];
  state.sessions[STAFF] = { id: "staff-1", email: "jacob@example.com", app_metadata: { role: "staff" } };
  state.sessions[CUSTOMER] = { id: "cust-1", email: "c@example.com", app_metadata: {} };
  state.tables.yard_sales = [];
  state.tables.pickup_requests = [];
  state.tables.pickup_request_items = [];
  state.tables.orders = [];
  state.tables.inventory_items = [];
  state.tables.pos_settings = [{ id: 1, sales_tax_bps: 0 }];
  state.tables.admin_audit_log = [];
  const record = (name: string, result: unknown) => (args: Record<string, unknown>) => {
    calls.push({ name, args });
    return { data: result, error: null };
  };
  state.rpc.yard_sale_start = (args) => {
    calls.push({ name: "yard_sale_start", args });
    const row = saleRow({ ends_at: args.p_ends_at, discount_percent: args.p_discount_percent, min_price_cents: args.p_min_price_cents, next_pickup_number: 1, started_at: new Date().toISOString() });
    state.tables.yard_sales.push(row);
    return { data: row, error: null };
  };
  state.rpc.yard_sale_update = (args) => {
    calls.push({ name: "yard_sale_update", args });
    const row = (state.tables.yard_sales as Record<string, unknown>[]).find((s) => s.id === args.p_sale_id)!;
    if (args.p_discount_percent !== undefined) row.discount_percent = args.p_discount_percent;
    return { data: [row], error: null };
  };
  state.rpc.yard_sale_end = (args) => {
    calls.push({ name: "yard_sale_end", args });
    const row = (state.tables.yard_sales as Record<string, unknown>[]).find((s) => s.id === args.p_sale_id)!;
    row.ended_at = new Date().toISOString();
    return { data: row, error: null };
  };
  state.rpc.pickup_remove_item = record("pickup_remove_item", { request_id: LIST, card_name: "Lightning Bolt", removed: 1, items_left: 2, cancelled: false });
  state.rpc.yard_sale_complete_list = record("yard_sale_complete_list", [
    { order_id: "order-1", subtotal_cents: 2234, discount_cents: 447, tax_cents: 0, total_cents: 1787 },
  ]);
  state.rpc.pos_complete_pickup_sale = record("pos_complete_pickup_sale", [
    { order_id: "order-2", subtotal_cents: 100, tax_cents: 0, total_cents: 100, amount_due_cents: 100 },
  ]);
});

async function yardSale(method: string, body: Record<string, unknown> = {}, opts: { token?: string; action?: string } = {}) {
  const res = fakeResponse();
  await yardSaleHandler(
    {
      method,
      headers: { authorization: `Bearer ${opts.token ?? STAFF}` },
      query: opts.action ? { action: opts.action } : {},
      body,
    } as never,
    res as never,
  );
  return res as typeof res & { body: Record<string, any> };
}

async function pickup(action: string, body: Record<string, unknown> = {}, method = "POST") {
  const res = fakeResponse();
  await adminRouter(
    {
      method,
      headers: { authorization: `Bearer ${STAFF}`, "content-type": "application/json" },
      query: { resource: "pickup", action },
      body,
    } as never,
    res as never,
  );
  return res as typeof res & { body: Record<string, any> };
}

const audit = () => (state.tables.admin_audit_log as { action: string; resource_id: string; before: unknown; after: unknown }[]).map((r) => r.action);

describe("the Yard Sale Mode switch", () => {
  it("is staff-only", async () => {
    expect((await yardSale("GET", {}, { token: CUSTOMER })).statusCode).toBe(403);
    expect((await yardSale("GET", {}, { token: "nope" })).statusCode).toBe(401);
  });

  it("shows no sale before the first one", async () => {
    const res = await yardSale("GET");
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ sale: null, openLists: 0, openListsFromEndedSales: 0, completedLists: 0, completedTotalCents: 0 });
  });

  it("starts a sale with the staff member as its author", async () => {
    const endsAt = inHours(4);
    const res = await yardSale("POST", { endsAt, discountPercent: 25, minPriceCents: 500 });
    expect(res.statusCode).toBe(201);
    expect(calls[0]).toEqual({
      name: "yard_sale_start",
      args: { p_ends_at: endsAt, p_discount_percent: 25, p_min_price_cents: 500, p_actor: "staff-1" },
    });
    expect(res.body.sale).toMatchObject({ active: true, discountPercent: 25, minPriceCents: 500, listsSent: 0 });
    expect(audit()).toEqual(["yard_sale.started"]);
  });

  it("checks the settings before calling the database", async () => {
    for (const body of [
      { discountPercent: 10, minPriceCents: 300 },
      { endsAt: "soon", discountPercent: 10, minPriceCents: 300 },
      { endsAt: inHours(3), discountPercent: 95, minPriceCents: 300 },
      { endsAt: inHours(3), discountPercent: 10.5, minPriceCents: 300 },
      { endsAt: inHours(3), discountPercent: 10, minPriceCents: -1 },
      { endsAt: inHours(3), discountPercent: 10 },
    ]) {
      expect((await yardSale("POST", body)).statusCode, JSON.stringify(body)).toBe(400);
    }
    expect(calls).toHaveLength(0);
  });

  it("explains why a sale can't start", async () => {
    state.rpc.yard_sale_start = () => ({ data: null, error: { code: "GGY02", message: "A yard sale is already on." } });
    let res = await yardSale("POST", { endsAt: inHours(3), discountPercent: 0, minPriceCents: 300 });
    expect(res.statusCode).toBe(409);
    expect(res.body.message).toBe("A yard sale is already on.");
    state.rpc.yard_sale_start = () => ({ data: null, error: { code: "23505", message: "duplicate key" } });
    res = await yardSale("POST", { endsAt: inHours(3), discountPercent: 0, minPriceCents: 300 });
    expect(res.statusCode).toBe(409);
    expect(res.body.message).toBe("A yard sale is already on.");
  });

  it("changes the discount during the sale, and ends it", async () => {
    state.tables.yard_sales.push(saleRow());
    let res = await yardSale("PATCH", { saleId: SALE, discountPercent: 50 });
    expect(res.statusCode).toBe(200);
    expect(calls[0]).toEqual({
      name: "yard_sale_update",
      args: { p_sale_id: SALE, p_ends_at: undefined, p_discount_percent: 50, p_min_price_cents: undefined, p_actor: "staff-1" },
    });
    expect(res.body.sale.discountPercent).toBe(50);
    expect((await yardSale("PATCH", { saleId: SALE })).statusCode).toBe(400);

    res = await yardSale("POST", { saleId: SALE }, { action: "end" });
    expect(res.statusCode).toBe(200);
    expect(calls[1]).toEqual({ name: "yard_sale_end", args: { p_sale_id: SALE, p_actor: "staff-1" } });
    expect(res.body.sale).toMatchObject({ active: false });
    expect(audit()).toEqual(["yard_sale.updated", "yard_sale.ended"]);
    const updated = (state.tables.admin_audit_log as { before: { discount_percent: number }; after: { discount_percent: number } }[])[0];
    expect([updated.before.discount_percent, updated.after.discount_percent]).toEqual([20, 50]);
  });

  it("counts lists still open from a sale that's over, and what this sale brought in", async () => {
    state.tables.yard_sales.push(saleRow(), saleRow({ id: OLD_SALE, started_at: inHours(-50), ends_at: inHours(-45), ended_at: inHours(-45) }));
    state.tables.pickup_requests.push(
      { id: "a", yard_sale_id: SALE, status: "waiting" },
      { id: "b", yard_sale_id: OLD_SALE, status: "waiting" },
      { id: "c", yard_sale_id: SALE, status: "completed", order_id: "o1" },
      { id: "d", yard_sale_id: SALE, status: "completed", order_id: "o2" },
      { id: "e", yard_sale_id: null, status: "waiting" },
    );
    state.tables.orders.push({ id: "o1", total_cents: 1200 }, { id: "o2", total_cents: 850 });
    const res = await yardSale("GET");
    expect(res.body).toMatchObject({
      sale: { id: SALE, active: true, listsSent: 3 },
      openLists: 2,
      openListsFromEndedSales: 1,
      completedLists: 2,
      completedTotalCents: 2050,
    });
  });
});

describe("Pickup Requests: yard sale lists", () => {
  beforeEach(() => {
    state.tables.yard_sales.push(saleRow());
    state.tables.pickup_requests.push(
      { id: LIST, customer_name: "Ann", status: "waiting", yard_sale_id: SALE, pickup_number: 3, created_at: inHours(-1) },
      { id: KIOSK, customer_name: "Kim", status: "ready", yard_sale_id: null, pickup_number: null, created_at: inHours(-1) },
    );
    state.tables.pickup_request_items.push({
      id: ITEM, pickup_request_id: LIST, inventory_item_id: INV, card_name: "Lightning Bolt", quantity: 2, unit_price_cents: 500, pulled: false, created_at: inHours(-1),
    });
    state.tables.inventory_items.push({ id: INV, price_cents: 600, storage_location: "Box A3", status: "active" });
    // The website price now: $6.00 less a 10% storewide sale (inventory_live_prices).
    livePrice = 540;
    state.rpc.inventory_live_prices = (args) => ({
      data: (args.p_inventory_item_ids as string[]).includes(INV) ? [{ inventory_item_id: INV, price_cents: livePrice }] : [],
      error: null,
    });
  });

  let livePrice: number | null = null;

  it("lists them with where each card is kept, its price now, and the sale", async () => {
    const res = await pickup("list", {}, "GET");
    expect(res.statusCode).toBe(200);
    const list = res.body.rows.find((r: { id: string }) => r.id === LIST);
    expect(list.items[0]).toMatchObject({ storage_location: "Box A3", current_price_cents: 540, available: true });
    expect(res.body.yardSales).toEqual([expect.objectContaining({ id: SALE, discount_percent: 20, active: true })]);
    expect(res.body.taxBps).toBe(0);
  });

  it("flags a card that's no longer for sale", async () => {
    livePrice = null;
    let res = await pickup("list", {}, "GET");
    let item = res.body.rows.find((r: { id: string }) => r.id === LIST).items[0];
    expect(item).toMatchObject({ current_price_cents: null, available: false });

    livePrice = 540;
    (state.tables.inventory_items as Record<string, unknown>[])[0].status = "archived";
    res = await pickup("list", {}, "GET");
    item = res.body.rows.find((r: { id: string }) => r.id === LIST).items[0];
    expect(item).toMatchObject({ current_price_cents: 540, available: false });
  });

  it("takes a card off a list", async () => {
    let res = await pickup("remove-item", { itemId: ITEM, quantity: 1 });
    expect(res.statusCode).toBe(200);
    expect(calls).toEqual([{ name: "pickup_remove_item", args: { p_item_id: ITEM, p_quantity: 1 } }]);
    expect(res.body.result).toEqual({ cardName: "Lightning Bolt", removed: 1, itemsLeft: 2, listClosed: false });
    expect(audit()).toEqual(["pickup.item_removed"]);

    expect((await pickup("remove-item", { itemId: "nope" })).statusCode).toBe(400);
    expect((await pickup("remove-item", { itemId: ITEM, quantity: 0 })).statusCode).toBe(400);
    state.rpc.pickup_remove_item = () => ({ data: null, error: { code: "GGY02", message: "This list is already closed." } });
    res = await pickup("remove-item", { itemId: ITEM });
    expect(res.statusCode).toBe(409);
    expect(res.body.message).toBe("This list is already closed.");
  });

  it("completes a list paid in cash or Venmo, and records it", async () => {
    const res = await pickup("complete-yard-sale", { requestId: LIST, paymentMethod: "venmo" });
    expect(res.statusCode).toBe(200);
    expect(calls).toEqual([{ name: "yard_sale_complete_list", args: { p_request_id: LIST, p_payment_method: "venmo" } }]);
    expect(res.body.sale).toEqual({ orderId: "order-1", subtotalCents: 2234, discountCents: 447, taxCents: 0, totalCents: 1787 });
    const entry = (state.tables.admin_audit_log as { action: string; after: Record<string, unknown> }[])[0];
    expect(entry).toMatchObject({ action: "yard_sale.list_completed", after: { order_id: "order-1", payment_method: "venmo", total_cents: 1787 } });
  });

  it("only takes cash or Venmo, and passes on why a list can't be completed", async () => {
    expect((await pickup("complete-yard-sale", { requestId: LIST, paymentMethod: "card" })).statusCode).toBe(400);
    state.rpc.yard_sale_complete_list = () => ({
      data: null,
      error: { code: "GGY05", message: "Lightning Bolt is no longer in inventory. Take it off the list, then complete." },
    });
    const res = await pickup("complete-yard-sale", { requestId: LIST, paymentMethod: "cash" });
    expect(res.statusCode).toBe(409);
    expect(res.body.message).toMatch(/no longer in inventory/);
  });

  it("never rings a yard sale list up at the register", async () => {
    const res = await pickup("complete-sale", { requestId: LIST });
    expect(res.statusCode).toBe(409);
    expect(calls).toHaveLength(0);
    const kiosk = await pickup("complete-sale", { requestId: KIOSK });
    expect(kiosk.statusCode).toBe(200);
    expect(calls[0].name).toBe("pos_complete_pickup_sale");
  });
});
