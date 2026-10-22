import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeState, createFakeSupabase, fakeResponse, type FakeState } from "./helpers/fakeSupabase";

// POST /api/yard-sale — the /yard-sale page on a shopper's phone: send a
// pickup list, add to it, and show it again. The database functions hold
// the cards and number the lists (stood in for here); this checks the
// validation, the list the phone gets back (yard sale prices, totals), the
// token that ties a list to the phone, and the staff notification.

beforeAll(() => {
  process.env.SUPABASE_URL = "https://x.invalid";
  process.env.SUPABASE_SECRET_KEY = "svc";
  process.env.EMAIL_TOKEN_SECRET = "t".repeat(40);
});

let state: FakeState = createFakeState();
vi.mock("../api/_lib/supabaseAdmin.js", () => ({ getSupabaseAdmin: () => createFakeSupabase(state) }));

const pushes = vi.hoisted(() => ({ sent: [] as { key: string; kind: string; title: string; body: string }[] }));
vi.mock("../api/_lib/staffPush.js", () => ({
  notifyStaff: async (event: { key: string; kind: string; title: string; body: string }) => {
    pushes.sent.push(event);
    return { status: "sent", delivered: 1, failed: 0, removed: 0 };
  },
}));

const { default: handler } = await import("../api/yard-sale.ts");
const { yardSaleListToken } = await import("../api/_lib/yardSale.ts");

const SALE = "11111111-1111-4111-8111-111111111111";
const BOLT = "22222222-2222-4222-8222-222222222222";
const GOYF = "33333333-3333-4333-8333-333333333333";
const REQUEST = "44444444-4444-4444-8444-444444444444";

let ipCounter = 0;
let rpcCalls: { name: string; args: Record<string, unknown> }[] = [];
/** A storewide sale's discount on the website price (0 = none), as inventory_live_prices applies it. */
let storewidePercent = 0;

function inventory(id: string, name: string, price: number) {
  return { id, card_name: name, price_cents: price, set_name: "Alpha", set_code: "lea", collector_number: "1", condition: "NM", finish: "nonfoil", image_url: null, status: "active" };
}

beforeEach(() => {
  state = createFakeState();
  pushes.sent = [];
  rpcCalls = [];
  state.tables.yard_sales = [{ id: SALE, discount_percent: 20, ends_at: new Date(Date.now() + 3_600_000).toISOString(), ended_at: null }];
  state.tables.pos_settings = [{ id: 1, sales_tax_bps: 0 }];
  state.tables.inventory_items = [inventory(BOLT, "Lightning Bolt", 500), inventory(GOYF, "Tarmogoyf", 1234)];
  state.tables.pickup_requests = [];
  state.tables.pickup_request_items = [];

  // Stand-ins for the database functions: hold the cards on a numbered list.
  let next = 1;
  const addLines = (requestId: string, items: { inventory_item_id: string; quantity: number }[]) => {
    for (const line of items) {
      const inv = (state.tables.inventory_items as ReturnType<typeof inventory>[]).find((i) => i.id === line.inventory_item_id)!;
      const existing = (state.tables.pickup_request_items as Record<string, unknown>[]).find(
        (i) => i.pickup_request_id === requestId && i.inventory_item_id === inv.id,
      );
      if (existing) existing.quantity = (existing.quantity as number) + line.quantity;
      else
        state.tables.pickup_request_items.push({
          id: `item-${state.tables.pickup_request_items.length + 1}`,
          pickup_request_id: requestId,
          inventory_item_id: inv.id,
          card_name: inv.card_name,
          set_name: inv.set_name,
          set_code: inv.set_code,
          collector_number: inv.collector_number,
          condition: inv.condition,
          finish: inv.finish,
          image_url: null,
          quantity: line.quantity,
          unit_price_cents: inv.price_cents,
          created_at: new Date(Date.now() + state.tables.pickup_request_items.length).toISOString(),
        });
    }
  };
  state.rpc.yard_sale_create_list = (args) => {
    rpcCalls.push({ name: "yard_sale_create_list", args });
    const number = next++;
    state.tables.pickup_requests.push({ id: REQUEST, customer_name: args.p_customer_name, status: "waiting", yard_sale_id: SALE, pickup_number: number });
    addLines(REQUEST, args.p_items as { inventory_item_id: string; quantity: number }[]);
    return { data: [{ request_id: REQUEST, pickup_number: number }], error: null };
  };
  state.rpc.yard_sale_add_to_list = (args) => {
    rpcCalls.push({ name: "yard_sale_add_to_list", args });
    addLines(args.p_request_id as string, args.p_items as { inventory_item_id: string; quantity: number }[]);
    return { data: 1, error: null };
  };
  // What each card sells for now: its price, less a storewide sale when one is on.
  storewidePercent = 0;
  state.rpc.inventory_live_prices = (args) => ({
    data: (state.tables.inventory_items as ReturnType<typeof inventory>[])
      .filter((i) => (args.p_inventory_item_ids as string[]).includes(i.id))
      .map((i) => ({ inventory_item_id: i.id, price_cents: Math.round((i.price_cents * (100 - storewidePercent)) / 100) })),
    error: null,
  });
});

async function post(body: Record<string, unknown>, method = "POST") {
  const res = fakeResponse();
  ipCounter++;
  await handler({ method, headers: { "x-forwarded-for": `10.1.0.${ipCounter}` }, body, query: {} } as never, res as never);
  return res as typeof res & { body: Record<string, any> };
}

const SEND = {
  action: "submit",
  name: "  Ann   Lee ",
  items: [
    { inventoryItemId: BOLT, quantity: 1 },
    { inventoryItemId: GOYF, quantity: 1 },
    { inventoryItemId: BOLT.toUpperCase(), quantity: 1 },
  ],
  website: "",
};

describe("sending a list", () => {
  it("holds the cards, numbers the list and gives the phone its token", async () => {
    const res = await post(SEND);
    expect(res.statusCode).toBe(201);
    expect(rpcCalls).toEqual([
      {
        name: "yard_sale_create_list",
        args: {
          p_customer_name: "Ann Lee",
          p_items: [
            { inventory_item_id: BOLT, quantity: 2 },
            { inventory_item_id: GOYF, quantity: 1 },
          ],
        },
      },
    ]);
    const list = res.body.list;
    expect(list).toMatchObject({ requestId: REQUEST, pickupNumber: 1, customerName: "Ann Lee", status: "open", canAdd: true, discountPercent: 20 });
    // 20% off each card, to the nearest dollar: Bolt $5.00 -> $4 (x2), Goyf $12.34 -> $9.87 -> $10.
    expect(list.lines.map((l: { cardName: string; quantity: number; salePriceCents: number }) => [l.cardName, l.quantity, l.salePriceCents])).toEqual([
      ["Lightning Bolt", 2, 400],
      ["Tarmogoyf", 1, 1000],
    ]);
    expect(list.totals).toEqual({ subtotalCents: 2234, discountCents: 434, cardsCents: 1800, taxCents: 0, totalCents: 1800 });
    expect(res.body.token).toBe(yardSaleListToken(REQUEST));
    expect(pushes.sent).toEqual([
      expect.objectContaining({ kind: "pickup", title: "Yard sale list #1", body: "Ann Lee · 3 cards to grab · $18.00" }),
    ]);
  });

  it("marks a special printing, like an artist proof, on the list", async () => {
    (state.tables.inventory_items as Record<string, unknown>[])[0].variant_type = "Artist Proof";
    (state.tables.inventory_items as Record<string, unknown>[])[1].variant_type = "";
    const res = await post(SEND);
    expect(res.body.list.lines.map((l: { cardName: string; variantType: string | null }) => [l.cardName, l.variantType])).toEqual([
      ["Lightning Bolt", "Artist Proof"],
      ["Tarmogoyf", null],
    ]);
  });

  it("still gives the phone its new list if today's prices can't be loaded", async () => {
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    state.rpc.inventory_live_prices = () => ({ data: null, error: { code: "XX000", message: "boom" } });
    const res = await post(SEND);
    quiet.mockRestore();
    expect(res.statusCode).toBe(201);
    expect(res.body.token).toBe(yardSaleListToken(REQUEST));
    // At the prices the cards were held at.
    expect(res.body.list.totals.totalCents).toBe(1800);
  });

  it("charges the register's tax on top, as Complete will", async () => {
    state.tables.pos_settings = [{ id: 1, sales_tax_bps: 825 }];
    const res = await post({ ...SEND, items: [{ inventoryItemId: GOYF, quantity: 1 }] });
    // $10 at 8.25%: $0.825 of tax, rounded down.
    expect(res.body.list.totals).toMatchObject({ cardsCents: 1000, taxCents: 82, totalCents: 1082 });
  });

  it("needs a name and some cards", async () => {
    for (const body of [
      { ...SEND, name: "  " },
      { ...SEND, name: "x".repeat(61) },
      { ...SEND, items: [] },
      { ...SEND, items: [{ inventoryItemId: "nope", quantity: 1 }] },
      { ...SEND, items: [{ inventoryItemId: BOLT, quantity: 0 }] },
      { ...SEND, items: [{ inventoryItemId: BOLT, quantity: 1.5 }] },
      { ...SEND, items: Array.from({ length: 31 }, () => ({ inventoryItemId: BOLT, quantity: 1 })) },
    ]) {
      const res = await post(body);
      expect(res.statusCode, JSON.stringify(body).slice(0, 80)).toBe(400);
      expect(res.body.code).toBe("invalid");
    }
    expect(rpcCalls).toHaveLength(0);
  });

  it("quietly ignores bots that fill in the hidden field", async () => {
    const res = await post({ ...SEND, website: "http://spam.example" });
    expect(res.statusCode).toBe(200);
    expect(res.body.list).toBeUndefined();
    expect(rpcCalls).toHaveLength(0);
  });

  it("says which card was just taken, or that the sale is over", async () => {
    state.rpc.yard_sale_create_list = () => ({ data: null, error: { code: "GGY05", message: "Someone just took the last Lightning Bolt." } });
    let res = await post(SEND);
    expect(res.statusCode).toBe(409);
    expect(res.body).toMatchObject({ ok: false, code: "unavailable", message: "Someone just took the last Lightning Bolt." });

    state.rpc.yard_sale_create_list = () => ({ data: null, error: { code: "GGY02", message: "The yard sale has ended." } });
    res = await post(SEND);
    expect(res.statusCode).toBe(410);
    expect(res.body.code).toBe("sale_ended");
    expect(pushes.sent).toHaveLength(0);
  });
});

describe("adding to a list and showing it again", () => {
  beforeEach(async () => {
    await post(SEND);
    pushes.sent = [];
    rpcCalls = [];
  });

  it("adds cards to the phone's own list", async () => {
    const res = await post({ action: "add", requestId: REQUEST, token: yardSaleListToken(REQUEST), items: [{ inventoryItemId: GOYF, quantity: 1 }] });
    expect(res.statusCode).toBe(200);
    expect(rpcCalls[0]).toEqual({ name: "yard_sale_add_to_list", args: { p_request_id: REQUEST, p_items: [{ inventory_item_id: GOYF, quantity: 1 }] } });
    expect(res.body.list.lines.find((l: { cardName: string }) => l.cardName === "Tarmogoyf").quantity).toBe(2);
    expect(pushes.sent[0]).toMatchObject({ title: "List #1: 1 card added" });
  });

  it("won't touch a list without its token", async () => {
    for (const token of [undefined, "x".repeat(43), yardSaleListToken(SALE)]) {
      const res = await post({ action: "add", requestId: REQUEST, token, items: [{ inventoryItemId: GOYF, quantity: 1 }] });
      expect(res.statusCode).toBe(404);
      expect(res.body.code).toBe("not_found");
    }
    expect(rpcCalls).toHaveLength(0);
  });

  it("tells the phone when the list was already paid for", async () => {
    state.rpc.yard_sale_add_to_list = () => ({ data: null, error: { code: "GGY02", message: "This list has already been paid for. Start a new one for more cards." } });
    const res = await post({ action: "add", requestId: REQUEST, token: yardSaleListToken(REQUEST), items: [{ inventoryItemId: GOYF, quantity: 1 }] });
    expect(res.statusCode).toBe(409);
    expect(res.body.code).toBe("list_closed");
  });

  it("shows the list at today's prices and discount", async () => {
    (state.tables.inventory_items as Record<string, unknown>[])[0].price_cents = 600;
    (state.tables.yard_sales as Record<string, unknown>[])[0].discount_percent = 50;
    const res = await post({ action: "get", requestId: REQUEST, token: yardSaleListToken(REQUEST) });
    expect(res.statusCode).toBe(200);
    const bolt = res.body.list.lines.find((l: { cardName: string }) => l.cardName === "Lightning Bolt");
    expect(bolt).toMatchObject({ priceCents: 600, salePriceCents: 300, quantity: 2 });
  });

  it("prices cards as the website does, a storewide sale included", async () => {
    storewidePercent = 10;
    const res = await post({ action: "get", requestId: REQUEST, token: yardSaleListToken(REQUEST) });
    const bolt = res.body.list.lines.find((l: { cardName: string }) => l.cardName === "Lightning Bolt");
    // $5.00 on the website is $4.50 during the storewide sale; the yard sale's 20% comes off
    // that ($3.60), rounded to the nearest dollar.
    expect(bolt).toMatchObject({ priceCents: 450, salePriceCents: 400, quantity: 2 });
  });

  it("can't add once the sale is over, and says the list is closed once it's completed", async () => {
    (state.tables.yard_sales as Record<string, unknown>[])[0].ended_at = new Date().toISOString();
    let res = await post({ action: "get", requestId: REQUEST, token: yardSaleListToken(REQUEST) });
    expect(res.body.list).toMatchObject({ status: "open", canAdd: false });
    (state.tables.pickup_requests as Record<string, unknown>[])[0].status = "completed";
    res = await post({ action: "get", requestId: REQUEST, token: yardSaleListToken(REQUEST) });
    expect(res.body.list).toMatchObject({ status: "completed", canAdd: false });
  });

  it("says when the list is gone", async () => {
    state.tables.pickup_requests = [];
    const res = await post({ action: "get", requestId: REQUEST, token: yardSaleListToken(REQUEST) });
    expect(res.statusCode).toBe(404);
  });
});

describe("the endpoint", () => {
  it("only takes POSTs with a known action", async () => {
    expect((await post({}, "GET")).statusCode).toBe(405);
    const res = await post({ action: "delete" });
    expect(res.statusCode).toBe(400);
  });
});
