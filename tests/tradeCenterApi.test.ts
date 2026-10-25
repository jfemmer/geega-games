import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import { createFakeState, createFakeSupabase, fakeId, fakeResponse, type FakeState } from "./helpers/fakeSupabase";

// Trade Center APIs. The database functions themselves (holds, totals,
// finishing a trade, the ledger) are exercised against real Postgres in
// scratchpad PGlite checks; here the rpc calls are stand-ins, and the tests
// are about what the endpoints decide: who may do what, what's taken from
// the browser and what isn't (prices never are), what's sent to the
// database, and which emails, payments and alerts follow.

beforeAll(() => {
  process.env.SUPABASE_URL = "https://x.invalid";
  process.env.SUPABASE_SECRET_KEY = "svc";
  process.env.PUBLIC_SITE_URL = "https://geega-games.com";
  process.env.STRIPE_SECRET_KEY = "sk_test_x";
  process.env.STRIPE_WEBHOOK_SECRET = "whsec_test";
});

let state: FakeState = createFakeState();
vi.mock("../api/_lib/supabaseAdmin.js", () => ({ getSupabaseAdmin: () => createFakeSupabase(state) }));

type SentEmail = { emailType: string; idempotencyKey: string; to: string; subject: string; text: string };
const sent: SentEmail[] = [];
let emailsFail = false;
vi.mock("../api/_lib/emailService.js", () => ({
  sendTrackedEmail: vi.fn(async (args: SentEmail) => {
    sent.push(args);
    return emailsFail ? { status: "failed", error: "boom", deduped: false } : { status: "sent", resendEmailId: "re_1", deduped: false };
  }),
}));

const orderNotices: string[] = [];
vi.mock("../api/_lib/orderConfirmation.js", () => ({
  sendOrderAdminNotification: vi.fn(async (orderId: string) => {
    orderNotices.push(orderId);
    return { status: "sent" };
  }),
  sendOrderConfirmation: vi.fn(async () => ({ status: "sent" })),
}));

const scryfallCards = new Map<string, Record<string, unknown>>();
let scryfallDown = false;
vi.mock("../api/_lib/scryfall.js", () => ({
  scryfallCollection: vi.fn(async (ids: string[]) => {
    if (scryfallDown) throw new Error("Scryfall is down");
    const out = new Map<string, unknown>();
    for (const id of ids) if (scryfallCards.has(id)) out.set(id, scryfallCards.get(id));
    return out;
  }),
}));

type Intent = { id: string; status: string; amount: number; amount_received?: number; metadata: Record<string, string>; client_secret: string };
const stripeState = { intents: new Map<string, Intent>(), created: [] as { params: Record<string, unknown>; key?: string }[], canceled: [] as string[], n: 0 };
let currentEvent: Record<string, unknown> = {};
vi.mock("../api/_lib/stripe.js", () => ({
  getStripe: () => ({
    paymentIntents: {
      create: async (params: { amount: number; metadata: Record<string, string> }, opts?: { idempotencyKey?: string }) => {
        stripeState.n += 1;
        const intent: Intent = {
          id: `pi_test${stripeState.n}`,
          status: "requires_payment_method",
          amount: params.amount,
          metadata: params.metadata,
          client_secret: `pi_test${stripeState.n}_secret`,
        };
        stripeState.intents.set(intent.id, intent);
        stripeState.created.push({ params: params as unknown as Record<string, unknown>, key: opts?.idempotencyKey });
        return intent;
      },
      retrieve: async (id: string) => {
        const intent = stripeState.intents.get(id);
        if (!intent) throw new Error("No such payment_intent");
        return intent;
      },
      cancel: async (id: string) => {
        const intent = stripeState.intents.get(id)!;
        intent.status = "canceled";
        stripeState.canceled.push(id);
        return intent;
      },
    },
    webhooks: { constructEvent: () => currentEvent },
  }),
}));

const { default: customerApi } = await import("../api/trade-center.ts");
const { default: adminApi } = await import("../api/admin/trade-center.ts");
const { default: stripeWebhook } = await import("../api/webhooks/stripe.ts");
const { runTradeWorker } = await import("../api/_lib/tradeExpiry.ts");
const { addBusinessDays } = await import("../src/store/lib/tradeCenter.ts");

const ANN = "11111111-1111-4111-8111-111111111111";
const BOB = "22222222-2222-4222-8222-222222222222";
const RING = "aaaaaaaa-aaaa-4aaa-8aaa-000000000001";
const SIGNET = "aaaaaaaa-aaaa-4aaa-8aaa-000000000002";
const SHEOLDRED = "bbbbbbbb-bbbb-4bbb-8bbb-000000000001";
const ELVES = "bbbbbbbb-bbbb-4bbb-8bbb-000000000002";
const BOLT = "bbbbbbbb-bbbb-4bbb-8bbb-000000000003";

const HOUR = 3_600_000;
const iso = (ms: number) => new Date(ms).toISOString();

function scryfallCard(id: string, name: string, set: string, cn: string, prices: Record<string, string | null>, finishes = ["nonfoil", "foil"]) {
  return {
    object: "card",
    id,
    oracle_id: `cccccccc-cccc-4ccc-8ccc-${id.slice(-12)}`,
    name,
    set,
    set_name: `${set.toUpperCase()} Set`,
    collector_number: cn,
    rarity: "rare",
    lang: "en",
    layout: "normal",
    type_line: "Creature",
    finishes,
    prices: { usd: null, usd_foil: null, usd_etched: null, ...prices },
    image_uris: {
      small: `https://cards.scryfall.io/small/front/${id}.jpg`,
      normal: `https://cards.scryfall.io/normal/front/${id}.jpg`,
      large: `https://cards.scryfall.io/large/front/${id}.jpg`,
      png: `https://cards.scryfall.io/png/front/${id}.png`,
    },
  };
}

function settingsRow(over: Record<string, unknown> = {}) {
  return {
    id: true,
    enabled: true,
    paused: false,
    pause_message: "We're not taking new trades right now.",
    credit_rate_percent: 80,
    min_card_value_cents: 1500,
    condition_nm_percent: 100,
    condition_lp_percent: 90,
    condition_mp_percent: 75,
    condition_hp_percent: 60,
    condition_dmg_percent: 40,
    reservation_hours: 24,
    revision_hours: 48,
    ship_business_days: 5,
    ship_grace_hours: 24,
    transit_alert_days: 10,
    payment_due_days: 7,
    max_active_trades: 2,
    max_wanted_lines: 40,
    max_offered_lines: 100,
    min_trade_value_cents: 0,
    max_trade_value_cents: null,
    max_expired_trades_30d: 3,
    processing_fee_cents: 0,
    cash_payout_enabled: false,
    cash_rate_percent: 50,
    overstock_threshold: 0,
    excluded_set_codes: [],
    excluded_card_names: [],
    notify_customer: true,
    notify_staff: true,
    shipping_paid_by: "customer",
    ship_to_name: "Geega Games",
    ship_to_line1: "100 Test Ave",
    ship_to_line2: null,
    ship_to_city: "Ballwin",
    ship_to_state: "MO",
    ship_to_postal_code: "63011",
    packing_instructions: "Sleeve each card and pack them snugly.",
    return_policy: "If you decline, we'll mail your cards back.",
    updated_at: iso(Date.now()),
    updated_by: null,
    ...over,
  };
}

let tradeNumber = 1001;
function tradeRow(over: Record<string, unknown> = {}) {
  return {
    id: fakeId(),
    trade_number: tradeNumber++,
    user_id: ANN,
    customer_name: "Ann Lee",
    customer_email: "ann@example.com",
    status: "awaiting_trade_list",
    credit_rate_percent: 80,
    min_card_value_cents: 1500,
    condition_percents: { NM: 100, LP: 90, MP: 75, HP: 60, DMG: 40 },
    processing_fee_cents: 0,
    wanted_total_cents: 7999,
    estimated_value_cents: 0,
    approved_value_cents: null,
    final_value_cents: null,
    final_credit_cents: null,
    shipping_cents: null,
    amount_due_cents: null,
    excess_cents: null,
    excess_handling: "store_credit",
    cash_payout_cents: null,
    cash_paid_at: null,
    hold_expires_at: iso(Date.now() + 20 * HOUR),
    ship_by: null,
    payment_due_at: null,
    approval_conditions: null,
    inbound_carrier: null,
    inbound_tracking: null,
    inbound_shipped_at: null,
    return_carrier: null,
    return_tracking: null,
    returned_at: null,
    ship_name: null,
    ship_line1: null,
    ship_line2: null,
    ship_city: null,
    ship_state: null,
    ship_postal_code: null,
    order_id: null,
    payment_reference: null,
    credit_issued_cents: null,
    customer_note: null,
    close_reason: null,
    submitted_at: null,
    approved_at: null,
    received_at: null,
    final_offer_at: null,
    accepted_at: null,
    paid_at: null,
    completed_at: null,
    closed_at: null,
    created_at: iso(Date.now() - HOUR),
    updated_at: iso(Date.now() - HOUR),
    ...over,
  };
}

function offerRow(tradeId: string, over: Record<string, unknown> = {}) {
  return {
    id: fakeId(),
    trade_request_id: tradeId,
    position: 1,
    scryfall_id: SHEOLDRED,
    card_name: "Sheoldred, the Apocalypse",
    set_code: "DMU",
    set_name: "Dominaria United",
    collector_number: "107",
    finish: "nonfoil",
    image_url: null,
    quantity: 1,
    reported_condition: "NM",
    customer_estimate_cents: null,
    customer_note: null,
    reference_price_cents: 8000,
    reference_checked_at: iso(Date.now()),
    condition_percent: 100,
    estimated_unit_cents: 8000,
    eligibility: "eligible",
    stock_on_hand: 0,
    review_status: "pending",
    approved_quantity: null,
    approved_unit_cents: null,
    review_note: null,
    internal_note: null,
    received_quantity: null,
    authenticity: "unchecked",
    verified_condition: null,
    final_quantity: null,
    final_unit_cents: null,
    flags: [],
    inspection_note: null,
    inspection_internal_note: null,
    inspected_at: null,
    disposition: "pending",
    imported_inventory_item_id: null,
    created_at: iso(Date.now()),
    updated_at: iso(Date.now()),
    ...over,
  };
}

function itemRow(tradeId: string, over: Record<string, unknown> = {}) {
  return {
    id: fakeId(),
    trade_request_id: tradeId,
    inventory_item_id: RING,
    reservation_id: fakeId(),
    quantity: 1,
    unit_price_cents: 7999,
    card_name: "The One Ring",
    set_code: "LTR",
    set_name: "The Lord of the Rings",
    collector_number: "246",
    condition: "NM",
    finish: "nonfoil",
    variant_type: null,
    image_url: null,
    scryfall_id: null,
    status: "reserved",
    created_at: iso(Date.now()),
    ...over,
  };
}

type Res = ReturnType<typeof fakeResponse> & { body: Record<string, unknown> & { message?: string } };

async function call(handler: typeof customerApi, req: Record<string, unknown>): Promise<Res> {
  const res = fakeResponse();
  await handler({ headers: {}, query: {}, socket: { remoteAddress: `10.0.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}` }, ...req } as never, res as never);
  return res as Res;
}
const as = (token: string | null) => ({
  get: (query: Record<string, string> = {}) =>
    call(customerApi, { method: "GET", query, headers: token ? { authorization: `Bearer ${token}` } : {} }),
  post: (body: Record<string, unknown>) =>
    call(customerApi, { method: "POST", body, headers: token ? { authorization: `Bearer ${token}` } : {} }),
});
const ann = as("ann-token");
const bob = as("bob-token");
const staffCall = (token: string) => ({
  get: (query: Record<string, string> = {}) => call(adminApi, { method: "GET", query, headers: { authorization: `Bearer ${token}` } }),
  post: (body: Record<string, unknown>) => call(adminApi, { method: "POST", body, headers: { authorization: `Bearer ${token}` } }),
});
const staff = staffCall("staff-token");
const owner = staffCall("owner-token");

/** Every rpc call, by name. */
let rpcCalls: { name: string; args: Record<string, unknown> }[] = [];
const rpcArgs = (name: string) => rpcCalls.filter((c) => c.name === name).map((c) => c.args);
const trades = () => state.tables.trade_requests as Record<string, unknown>[];
const emailTypes = () => sent.map((e) => e.emailType);

/** Registers an rpc stand-in that records its calls. */
function rpc(name: string, fn: (args: Record<string, unknown>) => { data: unknown; error: { message: string; code?: string } | null }) {
  state.rpc[name] = (args) => {
    rpcCalls.push({ name, args });
    return fn(args);
  };
}

beforeEach(() => {
  state = createFakeState();
  rpcCalls = [];
  sent.length = 0;
  orderNotices.length = 0;
  emailsFail = false;
  scryfallDown = false;
  scryfallCards.clear();
  stripeState.intents.clear();
  stripeState.created = [];
  stripeState.canceled = [];
  stripeState.n = 0;
  tradeNumber = 1001;
  process.env.STRIPE_SECRET_KEY = "sk_test_x";

  state.sessions["ann-token"] = { id: ANN, email: "ann@example.com", app_metadata: {} };
  state.sessions["bob-token"] = { id: BOB, email: "bob@example.com", app_metadata: {} };
  state.sessions["staff-token"] = { id: "staff-1", email: "pat@geega-games.com", app_metadata: { role: "staff" } };
  state.sessions["owner-token"] = { id: "owner-1", email: "jacob@geega-games.com", app_metadata: { role: "admin" } };
  state.tables.profiles = [{ id: ANN, first_name: "Ann", last_name: "Lee" }];
  state.tables.trade_settings = [settingsRow()];
  state.tables.trade_requests = [];
  state.tables.trade_request_items = [];
  state.tables.trade_offer_cards = [];
  state.tables.trade_events = [];
  state.tables.trade_messages = [];
  state.tables.card_printings = [];
  state.tables.admin_audit_log = [];
  state.tables.addresses = [];
  state.tables.inventory_items = [
    { id: RING, card_name: "The One Ring", scryfall_id: null, quantity: 1, status: "active", price_cents: 7999 },
    { id: SIGNET, card_name: "Arcane Signet", scryfall_id: null, quantity: 3, status: "active", price_cents: 125 },
  ];
  scryfallCards.set(SHEOLDRED, scryfallCard(SHEOLDRED, "Sheoldred, the Apocalypse", "dmu", "107", { usd: "80.00", usd_foil: "95.00" }));
  scryfallCards.set(ELVES, scryfallCard(ELVES, "Llanowar Elves", "dom", "168", { usd: "0.25", usd_foil: "1.00" }));
  scryfallCards.set(BOLT, scryfallCard(BOLT, "Lightning Bolt", "2xm", "117", { usd: "20.00", usd_foil: null }));

  // trade_start: a trade holding the cards asked for (the real one checks availability under row locks).
  rpc("trade_start", (args) => {
    const t = tradeRow({ user_id: args.p_user_id, customer_name: args.p_customer_name, customer_email: args.p_customer_email, created_at: iso(Date.now()) });
    trades().push(t);
    for (const i of args.p_items as { inventory_item_id: string; quantity: number }[]) {
      state.tables.trade_request_items.push(itemRow(t.id, { inventory_item_id: i.inventory_item_id, quantity: i.quantity }));
    }
    return { data: t.id, error: null };
  });
  rpc("trade_save_offer", (args) => {
    const cards = args.p_cards as Record<string, unknown>[];
    state.tables.trade_offer_cards = state.tables.trade_offer_cards.filter((c) => c.trade_request_id !== args.p_trade_id);
    cards.forEach((c, i) => state.tables.trade_offer_cards.push(offerRow(args.p_trade_id as string, { ...c, id: c.id ?? fakeId(), position: i + 1 })));
    return { data: 0, error: null };
  });
  rpc("trade_submit", (args) => {
    const t = trades().find((x) => x.id === args.p_trade_id)!;
    Object.assign(t, { status: "pending_review", submitted_at: iso(Date.now()), hold_expires_at: null });
    return { data: null, error: null };
  });
  rpc("trade_close", (args) => {
    const t = trades().find((x) => x.id === args.p_trade_id)!;
    if (!(args.p_from_statuses as string[]).includes(t.status as string)) return { data: false, error: null };
    Object.assign(t, { status: args.p_status, close_reason: args.p_reason, closed_at: args.p_status === "return_pending" ? null : iso(Date.now()) });
    return { data: true, error: null };
  });
});

afterEach(() => {
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------

describe("GET /api/trade-center (public terms)", () => {
  it("tells anyone the terms, never the address customers mail to", async () => {
    const res = await as(null).get();
    expect(res.statusCode).toBe(200);
    const terms = res.body.terms as Record<string, unknown>;
    expect(terms).toMatchObject({ enabled: true, paused: false, creditRatePercent: 80, minCardValueCents: 1500, hasShipToAddress: true });
    expect(JSON.stringify(res.body)).not.toContain("100 Test Ave");
  });

  it("needs a session for My Trades and for a trade", async () => {
    expect((await as(null).get({ view: "mine" })).statusCode).toBe(401);
    expect((await as(null).get({ id: fakeId() })).statusCode).toBe(401);
    expect((await as(null).post({ action: "start", items: [] })).statusCode).toBe(401);
  });
});

describe("starting a trade (1, 2)", () => {
  it("holds the cards for the signed-in customer, whoever the body says they are", async () => {
    const res = await ann.post({
      action: "start",
      userId: BOB,
      items: [
        { inventoryItemId: SIGNET, quantity: 1 },
        { inventoryItemId: SIGNET, quantity: 1 },
        { inventoryItemId: RING, quantity: 1 },
      ],
    });
    expect(res.statusCode).toBe(200);
    const [args] = rpcArgs("trade_start");
    expect(args).toMatchObject({ p_user_id: ANN, p_customer_name: "Ann Lee", p_customer_email: "ann@example.com" });
    expect(args.p_items).toEqual([
      { inventory_item_id: SIGNET, quantity: 2 },
      { inventory_item_id: RING, quantity: 1 },
    ]);
    const trade = res.body.trade as Record<string, unknown>;
    expect(trade.status).toBe("awaiting_trade_list");
    expect((trade.wanted as unknown[]).length).toBe(2);
    expect(trade).not.toHaveProperty("userId");
  });

  it("a double tap gets the first trade back instead of holding the cards twice", async () => {
    const body = { action: "start", items: [{ inventoryItemId: RING, quantity: 1 }] };
    const first = await ann.post(body);
    const second = await ann.post(body);
    expect(rpcArgs("trade_start")).toHaveLength(1);
    expect((second.body.trade as { id: string }).id).toBe((first.body.trade as { id: string }).id);
  });

  it("passes the database's refusals through in its words", async () => {
    rpc("trade_start", () => ({ data: null, error: { code: "GT004", message: "The One Ring isn't available right now." } }));
    const taken = await ann.post({ action: "start", items: [{ inventoryItemId: RING, quantity: 1 }] });
    expect(taken.statusCode).toBe(409);
    expect(taken.body.message).toBe("The One Ring isn't available right now.");
    rpc("trade_start", () => ({ data: null, error: { code: "GT001", message: "Back Monday." } }));
    const paused = await ann.post({ action: "start", items: [{ inventoryItemId: SIGNET, quantity: 1 }] });
    expect(paused.statusCode).toBe(503);
    expect(paused.body.message).toBe("Back Monday.");
  });

  it("refuses quantities that aren't whole numbers from 1 to 99", async () => {
    for (const quantity of [0, 100, 1.5, "2"]) {
      const res = await ann.post({ action: "start", items: [{ inventoryItemId: RING, quantity }] });
      expect(res.statusCode).toBe(400);
    }
    expect(rpcArgs("trade_start")).toHaveLength(0);
  });
});

describe("their cards: priced by the server (3, 7)", () => {
  let tradeId: string;
  beforeEach(() => {
    const t = tradeRow();
    tradeId = t.id;
    trades().push(t);
    state.tables.trade_request_items.push(itemRow(tradeId));
  });

  it("takes the name and price from Scryfall, applies the condition, and marks cards under the minimum", async () => {
    const res = await ann.post({
      action: "saveOffer",
      tradeId,
      cards: [
        { scryfallId: SHEOLDRED, finish: "nonfoil", condition: "LP", quantity: 1, cardName: "Black Lotus", estimatedUnitCents: 999999 },
        { scryfallId: ELVES, finish: "nonfoil", condition: "NM", quantity: 4 },
      ],
    });
    expect(res.statusCode).toBe(200);
    const cards = rpcArgs("trade_save_offer")[0].p_cards as Record<string, unknown>[];
    expect(cards[0]).toMatchObject({
      card_name: "Sheoldred, the Apocalypse",
      set_code: "DMU",
      reference_price_cents: 8000,
      condition_percent: 90,
      estimated_unit_cents: 7200,
      eligibility: "eligible",
    });
    expect(cards[1]).toMatchObject({ card_name: "Llanowar Elves", estimated_unit_cents: 25, eligibility: "below_minimum", quantity: 4 });
    expect(JSON.stringify(cards)).not.toContain("Black Lotus");
    expect(JSON.stringify(cards)).not.toContain("999999");
  });

  it("never stands in another finish's price: a foil with no foil price is valued by hand", async () => {
    await ann.post({ action: "saveOffer", tradeId, cards: [{ scryfallId: BOLT, finish: "foil", condition: "NM", quantity: 1 }] });
    const [card] = rpcArgs("trade_save_offer")[0].p_cards as Record<string, unknown>[];
    expect(card).toMatchObject({ reference_price_cents: null, estimated_unit_cents: null, eligibility: "needs_review" });
  });

  it("refuses a finish the printing doesn't come in, and a printing Scryfall doesn't know", async () => {
    const etched = await ann.post({ action: "saveOffer", tradeId, cards: [{ scryfallId: BOLT, finish: "etched", condition: "NM", quantity: 1 }] });
    expect(etched.statusCode).toBe(400);
    expect(etched.body.message).toContain("doesn't come in etched");
    const unknown = await ann.post({ action: "saveOffer", tradeId, cards: [{ scryfallId: fakeId(), finish: "nonfoil", condition: "NM", quantity: 1 }] });
    expect(unknown.statusCode).toBe(400);
    expect(rpcArgs("trade_save_offer")).toHaveLength(0);
  });

  it("applies today's excluded sets and overstock limit", async () => {
    state.tables.trade_settings = [settingsRow({ excluded_set_codes: ["dmu"], overstock_threshold: 2 })];
    state.tables.inventory_items.push(
      { id: fakeId(), card_name: "Lightning Bolt", scryfall_id: BOLT, quantity: 2, status: "active", price_cents: 199 },
    );
    await ann.post({
      action: "saveOffer",
      tradeId,
      cards: [
        { scryfallId: SHEOLDRED, finish: "nonfoil", condition: "NM", quantity: 1 },
        { scryfallId: BOLT, finish: "nonfoil", condition: "NM", quantity: 1 },
      ],
    });
    const cards = rpcArgs("trade_save_offer")[0].p_cards as Record<string, unknown>[];
    expect(cards[0].eligibility).toBe("excluded_set");
    expect(cards[1]).toMatchObject({ eligibility: "overstocked", stock_on_hand: 2 });
  });

  it("uses fresh cached prices without asking Scryfall, and old ones only when Scryfall is down", async () => {
    state.tables.card_printings = [
      {
        scryfall_id: SHEOLDRED,
        card_name: "Sheoldred, the Apocalypse",
        set_code: "DMU",
        set_name: "Dominaria United",
        collector_number: "107",
        available_finishes: ["nonfoil", "foil"],
        images: { normal: "https://cards.scryfall.io/normal/x.jpg" },
        price_usd_cents: 7000,
        price_usd_foil_cents: null,
        price_usd_etched_cents: null,
        prices_updated_at: iso(Date.now() - 2 * HOUR),
      },
    ];
    scryfallDown = true;
    await ann.post({ action: "saveOffer", tradeId, cards: [{ scryfallId: SHEOLDRED, finish: "nonfoil", condition: "NM", quantity: 1 }] });
    expect((rpcArgs("trade_save_offer")[0].p_cards as Record<string, unknown>[])[0].reference_price_cents).toBe(7000);
    (state.tables.card_printings[0] as Record<string, unknown>).prices_updated_at = iso(Date.now() - 48 * HOUR);
    await ann.post({ action: "saveOffer", tradeId, cards: [{ scryfallId: SHEOLDRED, finish: "nonfoil", condition: "NM", quantity: 1 }] });
    expect((rpcArgs("trade_save_offer")[1].p_cards as Record<string, unknown>[])[0].reference_price_cents).toBe(7000);
  });

  it("merges the same printing, finish and condition into one line", async () => {
    await ann.post({
      action: "saveOffer",
      tradeId,
      cards: [
        { scryfallId: SHEOLDRED, finish: "nonfoil", condition: "NM", quantity: 1 },
        { scryfallId: SHEOLDRED, finish: "nonfoil", condition: "NM", quantity: 2 },
        { scryfallId: SHEOLDRED, finish: "foil", condition: "NM", quantity: 1 },
      ],
    });
    const cards = rpcArgs("trade_save_offer")[0].p_cards as Record<string, unknown>[];
    expect(cards.map((c) => [c.finish, c.quantity])).toEqual([
      ["nonfoil", 3],
      ["foil", 1],
    ]);
  });

  it("someone else's trade looks like no trade (15)", async () => {
    const res = await bob.post({ action: "saveOffer", tradeId, cards: [] });
    expect(res.statusCode).toBe(404);
    expect((await bob.get({ id: tradeId })).statusCode).toBe(404);
  });

  it("can't change cards once the list is sent", async () => {
    trades()[0].status = "pending_review";
    const res = await ann.post({ action: "saveOffer", tradeId, cards: [] });
    expect(res.statusCode).toBe(409);
  });

  it("sends the list after pricing it again, and tells the customer and staff", async () => {
    state.tables.trade_offer_cards.push(offerRow(tradeId, { reference_price_cents: 5000, estimated_unit_cents: 5000 }));
    const res = await ann.post({ action: "submit", tradeId, note: "Shipping from Ohio" });
    expect(res.statusCode).toBe(200);
    const saved = rpcArgs("trade_save_offer")[0].p_cards as Record<string, unknown>[];
    expect(saved[0].reference_price_cents).toBe(8000);
    expect(rpcArgs("trade_submit")[0]).toMatchObject({ p_trade_id: tradeId, p_user_id: ANN, p_note: "Shipping from Ohio" });
    expect(emailTypes()).toEqual(["trade_submitted", "trade_staff_submitted"]);
    expect(sent[0].to).toBe("ann@example.com");
    expect(sent[0].text).toContain("Please don't mail anything yet");
  });

  it("still sends the list when an email fails (it's already saved)", async () => {
    state.tables.trade_offer_cards.push(offerRow(tradeId));
    emailsFail = true;
    const res = await ann.post({ action: "submit", tradeId });
    expect(res.statusCode).toBe(200);
    expect(trades()[0].status).toBe("pending_review");
  });
});

describe("canceling, shipping in, and the final offer (5, 8, 14)", () => {
  it("cancels before anything is mailed, and tells staff only once it was sent to them", async () => {
    const building = tradeRow();
    const sentIn = tradeRow({ status: "pending_review" });
    trades().push(building, sentIn);
    await ann.post({ action: "cancel", tradeId: building.id });
    expect(emailTypes()).toEqual(["trade_canceled"]);
    sent.length = 0;
    await ann.post({ action: "cancel", tradeId: sentIn.id, reason: "Found it elsewhere" });
    expect(emailTypes()).toEqual(["trade_canceled", "trade_staff_canceled"]);
    expect(rpcArgs("trade_close")[1]).toMatchObject({ p_status: "canceled", p_reason: "Found it elsewhere", p_actor_id: ANN });
  });

  it("can't cancel once the cards are on their way", async () => {
    const t = tradeRow({ status: "in_transit" });
    trades().push(t);
    const res = await ann.post({ action: "cancel", tradeId: t.id });
    expect(res.statusCode).toBe(409);
    expect(t.status).toBe("in_transit");
  });

  it("shows where to mail the cards only once approved", async () => {
    const t = tradeRow({ status: "pending_review" });
    trades().push(t);
    expect(((await ann.get({ id: t.id })).body.trade as Record<string, unknown>).mailTo).toBeNull();
    t.status = "awaiting_shipment";
    const approved = (await ann.get({ id: t.id })).body.trade as Record<string, unknown>;
    expect(approved.mailTo).toMatchObject({ line1: "100 Test Ave", city: "Ballwin", state: "MO", postalCode: "63011" });
    expect(approved.packingInstructions).toBe("Sleeve each card and pack them snugly.");
  });

  it("takes a tracking number, cleaned up, and the trade is in transit for good", async () => {
    const t = tradeRow({ status: "awaiting_shipment", ship_by: iso(Date.now() + 48 * HOUR), hold_expires_at: iso(Date.now() + 72 * HOUR) });
    trades().push(t);
    expect((await ann.post({ action: "tracking", tradeId: t.id, carrier: "Pigeon", trackingNumber: "9400111" })).statusCode).toBe(400);
    expect((await ann.post({ action: "tracking", tradeId: t.id, carrier: "USPS", trackingNumber: "abc" })).statusCode).toBe(400);
    const res = await ann.post({ action: "tracking", tradeId: t.id, carrier: "USPS", trackingNumber: "9400 1000-0000 0000 0000 00" });
    expect(res.statusCode).toBe(200);
    expect(t).toMatchObject({ status: "in_transit", inbound_carrier: "USPS", inbound_tracking: "9400100000000000000000", hold_expires_at: null });
    expect((state.tables.trade_events as Record<string, unknown>[]).map((e) => e.event)).toContain("tracking_added");
    expect(emailTypes()).toEqual(["trade_tracking_added", "trade_staff_tracking"]);
  });

  it("refuses a tracking number after the shipping deadline", async () => {
    const t = tradeRow({ status: "awaiting_shipment", hold_expires_at: iso(Date.now() - HOUR) });
    trades().push(t);
    const res = await ann.post({ action: "tracking", tradeId: t.id, carrier: "UPS", trackingNumber: "1Z999AA10123456784" });
    expect(res.statusCode).toBe(409);
  });

  it("accepting with a balance asks for payment; the address is checked and stored the US way", async () => {
    const t = tradeRow({ status: "awaiting_final_approval", final_credit_cents: 4000 });
    trades().push(t);
    rpc("trade_accept_final", (args) => {
      Object.assign(t, { status: "awaiting_payment", amount_due_cents: 3999, accepted_at: iso(Date.now()), payment_due_at: iso(Date.now() + 7 * 24 * HOUR) });
      return { data: [{ new_status: "awaiting_payment", due_cents: 3999, new_order_id: null }], error: null, args };
    });
    const abroad = await ann.post({ action: "accept", tradeId: t.id, address: { line1: "1 Main", city: "Toronto", state: "Ontario", postalCode: "M5V" } });
    expect(abroad.statusCode).toBe(400);
    const res = await ann.post({
      action: "accept",
      tradeId: t.id,
      address: { name: "Ann Lee", line1: "1 Main St", city: "St. Louis", state: "missouri", postalCode: "63101" },
    });
    expect(res.statusCode).toBe(200);
    expect(rpcArgs("trade_accept_final")[0]).toMatchObject({ p_user_id: ANN, p_ship_state: "MO", p_ship_postal_code: "63101" });
    expect(res.body.amountDueCents).toBe(3999);
    expect(emailTypes()).toEqual(["trade_awaiting_payment", "trade_staff_accepted"]);
  });

  it("accepting with nothing to pay finishes the trade: the customer hears, staff get an order to pack", async () => {
    const t = tradeRow({ status: "awaiting_final_approval", final_credit_cents: 9000 });
    trades().push(t);
    const orderId = fakeId();
    rpc("trade_accept_final", () => {
      Object.assign(t, { status: "approved_for_fulfillment", order_id: orderId, amount_due_cents: 0, credit_issued_cents: 9000, shipping_cents: 0, excess_cents: 1001 });
      return { data: [{ new_status: "approved_for_fulfillment", due_cents: 0, new_order_id: orderId }], error: null };
    });
    const res = await ann.post({ action: "accept", tradeId: t.id, address: { line1: "1 Main St", city: "St. Louis", state: "MO", postalCode: "63101" } });
    expect(res.statusCode).toBe(200);
    expect(emailTypes()).toEqual(["trade_finalized"]);
    expect(sent[0].text).toContain("Store credit left for you: $10.01");
    expect(orderNotices).toEqual([orderId]);
  });

  it("declining sends their cards back (no forfeit), and staff are told", async () => {
    const t = tradeRow({ status: "awaiting_final_approval", final_credit_cents: 4000 });
    trades().push(t);
    const res = await ann.post({ action: "decline", tradeId: t.id, reason: "Too low" });
    expect(res.statusCode).toBe(200);
    expect(t.status).toBe("return_pending");
    expect(rpcArgs("trade_close")[0]).toMatchObject({ p_status: "return_pending", p_from_statuses: ["awaiting_final_approval", "awaiting_payment"] });
    expect(emailTypes()).toEqual(["trade_return_pending", "trade_staff_declined"]);
  });

  it("asking for an adjustment is a message staff hear about; it's only for a waiting final offer", async () => {
    const t = tradeRow({ status: "awaiting_final_approval", final_credit_cents: 4000 });
    trades().push(t);
    const res = await ann.post({ action: "adjust", tradeId: t.id, message: "The Sheoldred is near mint, please look again" });
    expect(res.statusCode).toBe(200);
    expect((state.tables.trade_messages[0] as Record<string, unknown>).body).toContain("near mint");
    expect(emailTypes()).toEqual(["trade_staff_adjustment"]);
    t.status = "under_inspection";
    expect((await ann.post({ action: "adjust", tradeId: t.id, message: "Again?" })).statusCode).toBe(409);
  });

  it("limits messages per trade per day", async () => {
    const t = tradeRow();
    trades().push(t);
    for (let i = 0; i < 20; i++) {
      state.tables.trade_messages.push({ id: fakeId(), trade_request_id: t.id, author_type: "customer", body: "hi", created_at: iso(Date.now()) });
    }
    expect((await ann.post({ action: "message", tradeId: t.id, body: "one more" })).statusCode).toBe(429);
  });
});

describe("paying the rest by card (9, 17)", () => {
  let t: ReturnType<typeof tradeRow>;
  const orderId = fakeId();
  beforeEach(() => {
    t = tradeRow({ status: "awaiting_payment", final_credit_cents: 4000, amount_due_cents: 3999, accepted_at: iso(Date.now()) });
    trades().push(t);
    rpc("trade_record_payment", (args) => {
      if (t.status !== "awaiting_payment" && !t.order_id) return { data: null, error: { code: "GT009", message: "This trade isn't waiting for a payment." } };
      if ((args.p_paid_cents as number) < 3999) return { data: null, error: { code: "GT008", message: "The trade still needs $39.99 paid." } };
      Object.assign(t, { status: "approved_for_fulfillment", order_id: orderId, credit_issued_cents: 4000, shipping_cents: 0 });
      return { data: orderId, error: null };
    });
  });

  it("charges exactly the amount due, once per trade and amount, and remembers the payment", async () => {
    const res = await ann.post({ action: "pay", tradeId: t.id });
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ clientSecret: "pi_test1_secret", amountDueCents: 3999 });
    expect(stripeState.created[0].params).toMatchObject({ amount: 3999, currency: "usd", payment_method_types: ["card"] });
    expect((stripeState.created[0].params.metadata as Record<string, string>).trade_request_id).toBe(t.id);
    expect(stripeState.created[0].key).toBe(`trade-pi-${t.id}-3999-${t.accepted_at}`);
    expect(t.payment_reference).toBe("pi_test1");
    const again = await ann.post({ action: "pay", tradeId: t.id });
    expect(again.body.clientSecret).toBe("pi_test1_secret");
    expect(stripeState.created).toHaveLength(1);
  });

  it("finishes the trade when the payment went through, once, however often it's reported", async () => {
    await ann.post({ action: "pay", tradeId: t.id });
    const intent = stripeState.intents.get("pi_test1")!;
    Object.assign(intent, { status: "succeeded", amount_received: 3999 });
    const res = await ann.post({ action: "confirmPayment", tradeId: t.id, paymentIntentId: "pi_test1" });
    expect(res.statusCode).toBe(200);
    expect(rpcArgs("trade_record_payment")[0]).toMatchObject({ p_trade_id: t.id, p_paid_cents: 3999, p_reference: "pi_test1" });
    expect(emailTypes()).toEqual(["trade_finalized"]);
    expect(orderNotices).toEqual([orderId]);

    // The webhook arrives too.
    currentEvent = { id: "evt_1", type: "payment_intent.succeeded", data: { object: intent } };
    state.tables.payment_events = [];
    const req = Object.assign(new EventEmitter(), { method: "POST", headers: { "stripe-signature": "sig" } });
    const webhookRes = fakeResponse();
    const done = stripeWebhook(req as never, webhookRes as never);
    req.emit("data", Buffer.from("{}"));
    req.emit("end");
    await done;
    expect(webhookRes.statusCode).toBe(200);
    expect(rpcArgs("trade_record_payment")).toHaveLength(2);
    const paidEvents = (state.tables.trade_events as Record<string, unknown>[]).filter((e) => e.event === "paid");
    expect(paidEvents).toHaveLength(1);
    // The same email key both times: the email service sends it once.
    const keys = sent.filter((e) => e.emailType === "trade_finalized").map((e) => e.idempotencyKey);
    expect(new Set(keys).size).toBe(1);
  });

  it("refuses a payment for another trade and an amount too small for a card", async () => {
    const other = tradeRow({ status: "awaiting_payment", amount_due_cents: 3999, accepted_at: iso(Date.now()) });
    trades().push(other);
    await ann.post({ action: "pay", tradeId: other.id });
    const wrong = await ann.post({ action: "confirmPayment", tradeId: t.id, paymentIntentId: "pi_test1" });
    expect(wrong.statusCode).toBe(400);
    t.amount_due_cents = 30;
    expect((await ann.post({ action: "pay", tradeId: t.id })).statusCode).toBe(409);
  });

  it("can't decline under a payment that's going through; an unused one is retired first", async () => {
    await ann.post({ action: "pay", tradeId: t.id });
    stripeState.intents.get("pi_test1")!.status = "processing";
    const blocked = await ann.post({ action: "decline", tradeId: t.id });
    expect(blocked.statusCode).toBe(409);
    expect(t.status).toBe("awaiting_payment");
    stripeState.intents.get("pi_test1")!.status = "requires_payment_method";
    const res = await ann.post({ action: "decline", tradeId: t.id });
    expect(res.statusCode).toBe(200);
    expect(stripeState.canceled).toEqual(["pi_test1"]);
    expect(t.status).toBe("return_pending");
  });

  it("says plainly when online payment isn't set up", async () => {
    delete process.env.STRIPE_SECRET_KEY;
    const res = await ann.post({ action: "pay", tradeId: t.id });
    expect(res.statusCode).toBe(503);
  });

  it("the webhook leaves a payment it can't apply to staff instead of retrying forever", async () => {
    t.status = "return_pending";
    currentEvent = {
      id: "evt_2",
      type: "payment_intent.succeeded",
      data: { object: { id: "pi_late", status: "succeeded", amount: 3999, amount_received: 3999, metadata: { trade_request_id: t.id } } },
    };
    state.tables.payment_events = [];
    const req = Object.assign(new EventEmitter(), { method: "POST", headers: { "stripe-signature": "sig" } });
    const res = fakeResponse();
    const done = stripeWebhook(req as never, res as never);
    req.emit("data", Buffer.from("{}"));
    req.emit("end");
    await done;
    expect(res.statusCode).toBe(200);
    expect(state.tables.payment_events).toHaveLength(1);
  });
});

describe("My Trades", () => {
  it("keeps staff's review private until they decide, and the inspection until the final offer", async () => {
    const offered = async (id: string) => ((await ann.get({ id })).body.trade as { offered: Record<string, unknown>[] }).offered[0];
    const t = tradeRow({ status: "pending_review" });
    trades().push(t);
    state.tables.trade_offer_cards.push(offerRow(t.id, { review_status: "rejected", approved_quantity: 0, review_note: "Not this one" }));
    expect(await offered(t.id)).toMatchObject({ reviewStatus: "pending", approvedQuantity: null, reviewNote: null });
    t.status = "revision_requested";
    expect(await offered(t.id)).toMatchObject({ reviewStatus: "rejected", reviewNote: "Not this one" });

    const u = tradeRow({ status: "under_inspection" });
    trades().push(u);
    state.tables.trade_offer_cards.push(
      offerRow(u.id, {
        review_status: "approved",
        approved_quantity: 1,
        approved_unit_cents: 8000,
        received_quantity: 1,
        final_quantity: 1,
        final_unit_cents: 6000,
        verified_condition: "LP",
        inspection_note: "Whitening on the back",
        inspected_at: iso(Date.now()),
        flags: ["damaged"],
      }),
    );
    expect(await offered(u.id)).toMatchObject({
      reviewStatus: "approved",
      approvedUnitCents: 8000,
      inspected: false,
      finalUnitCents: null,
      verifiedCondition: null,
      inspectionNote: null,
      flags: [],
    });
    u.status = "awaiting_final_approval";
    expect(await offered(u.id)).toMatchObject({ inspected: true, finalUnitCents: 6000, verifiedCondition: "LP", inspectionNote: "Whitening on the back", flags: ["damaged"] });
  });

  it("lists only the customer's own trades, with card counts", async () => {
    const mine = tradeRow();
    const theirs = tradeRow({ user_id: BOB });
    trades().push(mine, theirs);
    state.tables.trade_request_items.push(itemRow(mine.id, { quantity: 2 }), itemRow(theirs.id));
    state.tables.trade_offer_cards.push(offerRow(mine.id, { quantity: 3 }));
    const res = await ann.get({ view: "mine" });
    const list = res.body.trades as Record<string, unknown>[];
    expect(list.map((t) => t.id)).toEqual([mine.id]);
    expect(list[0]).toMatchObject({ wantedCount: 2, offeredCount: 3 });
  });

  it("never shows staff-only notes or internal messages", async () => {
    const t = tradeRow({ status: "under_inspection" });
    trades().push(t);
    state.tables.trade_offer_cards.push(offerRow(t.id, { internal_note: "looks resealed", inspection_internal_note: "corner ding", authenticity: "unsure" }));
    state.tables.trade_messages.push(
      { id: fakeId(), trade_request_id: t.id, author_type: "staff", author_label: "pat@geega-games.com", body: "Check this one twice", visible_to_customer: false, created_at: iso(Date.now()) },
      { id: fakeId(), trade_request_id: t.id, author_type: "staff", author_label: "pat@geega-games.com", body: "Looking great so far!", visible_to_customer: true, created_at: iso(Date.now()) },
    );
    state.tables.trade_events.push({ id: fakeId(), trade_request_id: t.id, actor_type: "staff", event: "cards_inspected", detail: {}, created_at: iso(Date.now()) });
    const body = JSON.stringify((await ann.get({ id: t.id })).body);
    expect(body).not.toContain("resealed");
    expect(body).not.toContain("corner ding");
    expect(body).not.toContain("Check this one twice");
    expect(body).not.toContain("pat@geega-games.com");
    expect(body).not.toContain("cards_inspected");
    expect(body).toContain("Looking great so far!");
  });
});

// ---------------------------------------------------------------------------

describe("admin Trades: access (15)", () => {
  it("is staff only", async () => {
    expect((await call(adminApi, { method: "GET", query: {} })).statusCode).toBe(401);
    const asCustomer = staffCall("ann-token");
    expect((await asCustomer.get()).statusCode).toBe(403);
    expect((await asCustomer.post({ action: "approve", tradeId: fakeId() })).statusCode).toBe(403);
  });

  it("keeps settings, recorded payments and cash payouts for the owner", async () => {
    for (const action of ["saveSettings", "recordPayment", "markCashPaid"]) {
      expect((await staff.post({ action, tradeId: fakeId(), settings: {} })).statusCode).toBe(403);
    }
  });
});

describe("admin Trades: the list and a trade", () => {
  it("lists open trades by default, finds one by number or name, and counts each status", async () => {
    trades().push(
      tradeRow({ status: "pending_review", customer_name: "Ann Lee" }),
      tradeRow({ status: "completed", customer_name: "Ann Lee" }),
      tradeRow({ status: "in_transit", customer_name: "Sam Rivera", customer_email: "sam@example.com" }),
    );
    const open = await staff.get();
    expect((open.body.trades as unknown[]).length).toBe(2);
    expect(open.body.counts).toMatchObject({ open: 2, all: 3, completed: 1, pending_review: 1 });
    const byNumber = await staff.get({ filter: "all", q: "TR-1002" });
    expect((byNumber.body.trades as { tradeNumber: number }[]).map((t) => t.tradeNumber)).toEqual([1002]);
    const byName = await staff.get({ filter: "all", q: "sam" });
    expect((byName.body.trades as { customerName: string }[]).map((t) => t.customerName)).toEqual(["Sam Rivera"]);
  });

  it("filters to what's waiting on staff, and says whether the caller is the owner", async () => {
    trades().push(
      tradeRow({ status: "pending_review" }),
      tradeRow({ status: "received" }),
      tradeRow({ status: "return_pending" }),
      tradeRow({ status: "awaiting_shipment" }),
      tradeRow({ status: "completed" }),
    );
    const waiting = await staff.get({ filter: "waiting" });
    expect((waiting.body.trades as { status: string }[]).map((t) => t.status).sort()).toEqual(["pending_review", "received", "return_pending"]);
    expect(waiting.body.counts).toMatchObject({ waiting: 3, open: 4, all: 5 });
    expect(waiting.body.owner).toBe(false);
    expect((await owner.get({ view: "settings" })).body.owner).toBe(true);
    expect((await owner.get({ id: (trades()[0] as { id: string }).id })).body.owner).toBe(true);
  });

  it("tells staff to run the database update when the settings aren't there yet", async () => {
    state.tables.trade_settings = [];
    const res = await staff.get();
    expect(res.statusCode).toBe(503);
    expect(res.body.message).toBe("Trade settings aren't set up yet. Run the Trade Center database update first.");
  });

  it("shows staff everything, notes and history included", async () => {
    const t = tradeRow({ status: "under_inspection" });
    trades().push(t);
    state.tables.trade_offer_cards.push(offerRow(t.id, { internal_note: "looks resealed" }));
    const res = await staff.get({ id: t.id });
    const trade = res.body.trade as { offered: { internalNote: string }[]; customerEmail: string };
    expect(trade.offered[0].internalNote).toBe("looks resealed");
    expect(trade.customerEmail).toBe("ann@example.com");
  });
});

describe("admin Trades: review and approval (4, 5)", () => {
  let t: ReturnType<typeof tradeRow>;
  let card: ReturnType<typeof offerRow>;
  let other: ReturnType<typeof offerRow>;
  beforeEach(() => {
    t = tradeRow({ status: "pending_review", submitted_at: iso(Date.now()) });
    trades().push(t);
    card = offerRow(t.id);
    other = offerRow(t.id, { scryfall_id: ELVES, card_name: "Llanowar Elves", position: 2 });
    state.tables.trade_offer_cards.push(card, other);
    rpc("trade_review_cards", () => ({ data: null, error: null }));
    rpc("trade_approve", () => {
      Object.assign(t, { status: "awaiting_shipment", approved_value_cents: 7000, approved_at: iso(Date.now()), ship_by: iso(Date.now() + 120 * HOUR) });
      Object.assign(card, { review_status: "approved", approved_quantity: 1, approved_unit_cents: 7000 });
      Object.assign(other, { review_status: "rejected", approved_quantity: 0 });
      return { data: 7000, error: null };
    });
  });

  it("saves per-card decisions, quantities and values", async () => {
    const res = await staff.post({
      action: "review",
      tradeId: t.id,
      cards: [
        { id: card.id, reviewStatus: "approved", approvedQuantity: 1, approvedUnitCents: 7000, reviewNote: "Great copy", internalNote: "check edges" },
        { id: other.id, reviewStatus: "rejected", reviewNote: "Under our minimum" },
      ],
    });
    expect(res.statusCode).toBe(200);
    expect(rpcArgs("trade_review_cards")[0].p_cards).toEqual([
      { id: card.id, review_status: "approved", approved_quantity: 1, approved_unit_cents: 7000, review_note: "Great copy", internal_note: "check edges" },
      { id: other.id, review_status: "rejected", approved_quantity: null, approved_unit_cents: null, review_note: "Under our minimum" },
    ]);
    expect(rpcArgs("trade_review_cards")[0]).toMatchObject({ p_actor_id: "staff-1", p_actor_label: "pat@geega-games.com" });
    expect(state.tables.admin_audit_log).toHaveLength(1);
  });

  it("refuses a card that isn't on the trade", async () => {
    const res = await staff.post({ action: "review", tradeId: t.id, cards: [{ id: fakeId(), reviewStatus: "approved" }] });
    expect(res.statusCode).toBe(400);
    expect(rpcArgs("trade_review_cards")).toHaveLength(0);
  });

  it("approves with a ship-by date five business days out, and emails the shipping instructions", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-23T15:00:00Z")); // a Friday
    const res = await staff.post({ action: "approve", tradeId: t.id, conditions: "Near mint only" });
    expect(res.statusCode).toBe(200);
    const args = rpcArgs("trade_approve")[0];
    expect(args.p_ship_by).toBe(new Date(addBusinessDays(Date.now(), 5)).toISOString());
    expect(args.p_ship_by).toBe("2026-10-31T04:59:59.000Z"); // Fri Oct 30, 11:59:59 pm CT
    expect(args.p_conditions).toBe("Near mint only");
    expect(emailTypes()).toEqual(["trade_approved"]);
    const email = sent[0];
    expect(email.subject).toBe("Trade TR-1001 is approved: ship your cards");
    expect(email.text).toContain("100 Test Ave");
    expect(email.text).toContain("Ballwin, MO 63011");
    expect(email.text).toContain("Sleeve each card and pack them snugly.");
    expect(email.text).toContain("trade ID, TR-1001");
    expect(email.text).toContain("Leave out the card we didn't approve");
  });

  it("says what happened to the customer's email: sent, failed, or off", async () => {
    const approved = await staff.post({ action: "approve", tradeId: t.id });
    expect(approved.body.customerEmail).toEqual({ status: "sent" });
    Object.assign(t, { status: "pending_review" });
    emailsFail = true;
    expect((await staff.post({ action: "approve", tradeId: t.id })).body.customerEmail).toEqual({ status: "failed" });
    Object.assign(t, { status: "pending_review" });
    state.tables.trade_settings = [settingsRow({ notify_customer: false })];
    expect((await staff.post({ action: "approve", tradeId: t.id })).body.customerEmail).toEqual({ status: "skipped", reason: "customer-emails-off" });
    // A change that sends no email says nothing about one.
    expect((await staff.post({ action: "extend", tradeId: t.id, hours: 24 })).body.customerEmail ?? null).toBeNull();
  });

  it("explains when the address customers mail to isn't set", async () => {
    rpc("trade_approve", () => ({ data: null, error: { code: "GT011", message: "Add the address customers mail their cards to (Trades, Settings) before approving a trade." } }));
    const res = await staff.post({ action: "approve", tradeId: t.id });
    expect(res.statusCode).toBe(409);
    expect(res.body.message).toContain("Add the address customers mail their cards to");
    expect(sent).toHaveLength(0);
  });

  it("asks for changes with a message the customer gets", async () => {
    rpc("trade_request_revision", () => {
      Object.assign(t, { status: "revision_requested", hold_expires_at: iso(Date.now() + 48 * HOUR) });
      return { data: t.hold_expires_at, error: null };
    });
    expect((await staff.post({ action: "requestRevision", tradeId: t.id, message: " " })).statusCode).toBe(400);
    const res = await staff.post({ action: "requestRevision", tradeId: t.id, message: "Is the Sheoldred the foil?" });
    expect(res.statusCode).toBe(200);
    expect(emailTypes()).toEqual(["trade_revision_requested"]);
    expect(sent[0].text).toContain("Is the Sheoldred the foil?");
  });

  it("rejects before shipping (closed) and after (their cards go back)", async () => {
    expect((await staff.post({ action: "reject", tradeId: t.id })).statusCode).toBe(400);
    await staff.post({ action: "reject", tradeId: t.id, reason: "Mostly bulk" });
    expect(rpcArgs("trade_close")[0]).toMatchObject({ p_status: "rejected", p_actor_type: "staff" });
    expect(emailTypes()).toEqual(["trade_rejected"]);
    const shipped = tradeRow({ status: "under_inspection" });
    trades().push(shipped);
    sent.length = 0;
    await staff.post({ action: "reject", tradeId: shipped.id, reason: "Counterfeits" });
    expect(rpcArgs("trade_close")[1]).toMatchObject({ p_status: "return_pending" });
    expect(emailTypes()).toEqual(["trade_return_pending"]);
  });
});

describe("admin Trades: receiving, inspection and the final offer (6, 7)", () => {
  let t: ReturnType<typeof tradeRow>;
  let card: ReturnType<typeof offerRow>;
  beforeEach(() => {
    t = tradeRow({ status: "in_transit", approved_value_cents: 14000, inbound_tracking: "9400111", inbound_carrier: "USPS" });
    trades().push(t);
    card = offerRow(t.id, { review_status: "approved", approved_quantity: 2, approved_unit_cents: 7000, quantity: 2 });
    state.tables.trade_offer_cards.push(card, offerRow(t.id, { review_status: "rejected", approved_quantity: 0, card_name: "Llanowar Elves" }));
    rpc("trade_inspect_cards", () => ({ data: null, error: null }));
  });

  it("marks the package received once, and tells the customer", async () => {
    const res = await staff.post({ action: "markReceived", tradeId: t.id });
    expect(res.statusCode).toBe(200);
    expect(t.status).toBe("received");
    expect(emailTypes()).toEqual(["trade_received"]);
    expect((await staff.post({ action: "markReceived", tradeId: t.id })).statusCode).toBe(409);
  });

  it("confirms the approved cards as described in one go", async () => {
    t.status = "received";
    await staff.post({ action: "confirmAsDescribed", tradeId: t.id });
    expect(rpcArgs("trade_inspect_cards")[0].p_cards).toEqual([
      { id: card.id, received_quantity: 2, authenticity: "authentic", verified_condition: "NM", final_quantity: 2, final_unit_cents: 7000, flags: [] },
    ]);
  });

  it("saves an inspection: condition, quantity, value and flags", async () => {
    t.status = "received";
    await staff.post({
      action: "inspect",
      tradeId: t.id,
      cards: [
        {
          id: card.id,
          receivedQuantity: 2,
          authenticity: "authentic",
          verifiedCondition: "LP",
          finalQuantity: 2,
          finalUnitCents: 6300,
          flags: ["damaged", "bogus"],
          inspectionNote: "Light wear: valued as LP",
          inspectionInternalNote: "corner ding",
        },
      ],
    });
    expect(rpcArgs("trade_inspect_cards")[0].p_cards).toEqual([
      {
        id: card.id,
        received_quantity: 2,
        authenticity: "authentic",
        verified_condition: "LP",
        final_quantity: 2,
        final_unit_cents: 6300,
        flags: ["damaged"],
        inspection_note: "Light wear: valued as LP",
        inspection_internal_note: "corner ding",
      },
    ]);
  });

  it("sends the final offer with what changed and why", async () => {
    t.status = "under_inspection";
    Object.assign(card, { inspected_at: iso(Date.now()), received_quantity: 2, final_quantity: 2, final_unit_cents: 6300, inspection_note: "Light wear: valued as LP" });
    rpc("trade_send_final_offer", (args) => {
      Object.assign(t, { status: "awaiting_final_approval", final_value_cents: 12600, final_credit_cents: 10080, final_offer_at: iso(Date.now()) });
      return { data: 10080, error: null, args };
    });
    const res = await staff.post({ action: "sendFinalOffer", tradeId: t.id, cashForExcess: false });
    expect(res.statusCode).toBe(200);
    expect(rpcArgs("trade_send_final_offer")[0]).toMatchObject({ p_cash_for_excess: false });
    expect(emailTypes()).toEqual(["trade_final_offer"]);
    const text = sent[0].text;
    expect(text).toContain("now $63.00 each (was $70.00). Light wear: valued as LP");
    expect(text).toContain("Your cards (final value): $126.00");
    expect(text).toContain("Trade credit at 80%: $100.80");
    expect(text).toContain("Trade credit left over: $20.81");
  });

  it("takes a final offer back to revise it, only while it's waiting on the customer", async () => {
    t.status = "awaiting_final_approval";
    const res = await staff.post({ action: "reopenInspection", tradeId: t.id });
    expect(res.statusCode).toBe(200);
    expect(t.status).toBe("under_inspection");
    expect((await staff.post({ action: "reopenInspection", tradeId: t.id })).statusCode).toBe(409);
  });
});

describe("admin Trades: after the trade (10, 11, 14)", () => {
  it("records a payment taken another way (owner), and finishes the trade", async () => {
    const t = tradeRow({ status: "awaiting_payment", amount_due_cents: 595, final_credit_cents: 80 });
    trades().push(t);
    rpc("trade_record_payment", () => {
      Object.assign(t, { status: "approved_for_fulfillment", order_id: fakeId() });
      return { data: t.order_id, error: null };
    });
    expect((await owner.post({ action: "recordPayment", tradeId: t.id })).statusCode).toBe(400);
    const res = await owner.post({ action: "recordPayment", tradeId: t.id, note: "Cash at the counter" });
    expect(res.statusCode).toBe(200);
    expect(rpcArgs("trade_record_payment")[0]).toMatchObject({ p_paid_cents: 595, p_reference: "manual: Cash at the counter" });
    expect(emailTypes()).toContain("trade_finalized");
  });

  it("marks cash for left-over credit paid, once", async () => {
    const t = tradeRow({ status: "approved_for_fulfillment", excess_handling: "cash", cash_payout_cents: 4081 });
    trades().push(t);
    expect((await owner.post({ action: "markCashPaid", tradeId: t.id, note: "Venmo" })).statusCode).toBe(200);
    expect(t.cash_paid_at).toBeTruthy();
    expect((await owner.post({ action: "markCashPaid", tradeId: t.id })).statusCode).toBe(409);
  });

  it("marks returned cards with their tracking, and tells the customer", async () => {
    const t = tradeRow({ status: "return_pending" });
    trades().push(t);
    const card = offerRow(t.id);
    state.tables.trade_offer_cards.push(card);
    const res = await staff.post({ action: "markReturned", tradeId: t.id, carrier: "USPS", trackingNumber: "9400 2222 3333 4444 5555 66" });
    expect(res.statusCode).toBe(200);
    expect(t).toMatchObject({ status: "returned", return_carrier: "USPS", return_tracking: "9400222233334444555566" });
    expect(card.disposition).toBe("returned");
    expect(emailTypes()).toEqual(["trade_returned"]);
  });

  it("mails back only what arrived and wasn't taken from a finished trade, once", async () => {
    const t = tradeRow({ status: "completed" });
    trades().push(t);
    const inspected = iso(Date.now());
    const partly = offerRow(t.id, { review_status: "approved", received_quantity: 3, final_quantity: 2, final_unit_cents: 7000, inspected_at: inspected, disposition: "imported" });
    const none = offerRow(t.id, { review_status: "approved", received_quantity: 1, final_quantity: 0, inspected_at: inspected, disposition: "rejected" });
    const neverSent = offerRow(t.id, { review_status: "rejected", approved_quantity: 0, disposition: "rejected" });
    state.tables.trade_offer_cards.push(partly, none, neverSent);
    const res = await staff.post({ action: "markReturned", tradeId: t.id, carrier: "USPS", trackingNumber: "9400111899223197428490" });
    expect(res.statusCode).toBe(200);
    expect(t).toMatchObject({ status: "completed", return_carrier: "USPS", return_tracking: "9400111899223197428490" });
    expect(t.returned_at).toBeTruthy();
    // The card we took two of stays ours; the one we took none of went back; the one never sent is untouched.
    expect([partly.disposition, none.disposition, neverSent.disposition]).toEqual(["imported", "returned", "rejected"]);
    const event = state.tables.trade_events.find((e) => e.event === "returned") as { detail: Record<string, unknown> };
    expect(event.detail).toMatchObject({ carrier: "USPS", cards: 2, copies: 2 });
    expect(emailTypes()).toEqual(["trade_returned"]);
    expect(sent[0].text).toContain("the cards we didn't take");
    const again = await staff.post({ action: "markReturned", tradeId: t.id });
    expect(again.statusCode).toBe(409);
    expect(again.body.message).toBe("These cards were already marked returned.");
  });

  it("has nothing to mail back when everything that arrived was taken", async () => {
    const t = tradeRow({ status: "approved_for_fulfillment" });
    trades().push(t);
    state.tables.trade_offer_cards.push(
      offerRow(t.id, { review_status: "approved", received_quantity: 1, final_quantity: 1, final_unit_cents: 7000, inspected_at: iso(Date.now()), disposition: "accepted" }),
      offerRow(t.id, { review_status: "rejected", approved_quantity: 0, disposition: "rejected" }),
    );
    const res = await staff.post({ action: "markReturned", tradeId: t.id });
    expect(res.statusCode).toBe(409);
    expect(res.body.message).toBe("Nothing on this trade is waiting to go back to the customer.");
    expect(sent).toHaveLength(0);
  });

  it("adds an accepted card to inventory through the database, logged", async () => {
    const t = tradeRow({ status: "completed" });
    trades().push(t);
    const card = offerRow(t.id, { disposition: "accepted", final_quantity: 1 });
    state.tables.trade_offer_cards.push(card);
    const inventoryId = fakeId();
    rpc("trade_import_card", () => ({ data: inventoryId, error: null }));
    expect((await staff.post({ action: "importCard", offerCardId: card.id })).statusCode).toBe(400);
    const res = await staff.post({ action: "importCard", offerCardId: card.id, priceCents: 7499, storageLocation: "Binder 3" });
    expect(res.statusCode).toBe(200);
    expect(rpcArgs("trade_import_card")[0]).toMatchObject({ p_offer_card_id: card.id, p_price_cents: 7499, p_storage_location: "Binder 3" });
    expect((state.tables.admin_audit_log[0] as Record<string, unknown>).action).toBe("trade.import_card");
  });

  it("sends a message to the customer, or keeps a note for staff", async () => {
    const t = tradeRow({ status: "pending_review" });
    trades().push(t);
    await staff.post({ action: "message", tradeId: t.id, body: "Note to self", visibleToCustomer: false });
    expect(sent).toHaveLength(0);
    await staff.post({ action: "message", tradeId: t.id, body: "We'll have an answer tomorrow.", visibleToCustomer: true });
    expect(emailTypes()).toEqual(["trade_message"]);
  });

  it("extends the current deadline", async () => {
    const t = tradeRow({ hold_expires_at: iso(Date.now() + HOUR) });
    trades().push(t);
    await staff.post({ action: "extend", tradeId: t.id, hours: 24 });
    expect(Date.parse(t.hold_expires_at as string)).toBeGreaterThan(Date.now() + 24 * HOUR);
    expect((await staff.post({ action: "extend", tradeId: t.id, hours: 0 })).statusCode).toBe(400);
  });
});

describe("admin Trades: settings", () => {
  const valid = {
    enabled: true,
    paused: false,
    pauseMessage: "Back soon.",
    creditRatePercent: 80,
    minCardValueCents: 1500,
    conditionPercents: { NM: 100, LP: 90, MP: 75, HP: 60, DMG: 40 },
    reservationHours: 24,
    revisionHours: 48,
    shipBusinessDays: 5,
    shipGraceHours: 24,
    transitAlertDays: 10,
    paymentDueDays: 7,
    maxActiveTrades: 2,
    maxWantedLines: 40,
    maxOfferedLines: 100,
    minTradeValueCents: 0,
    maxTradeValueCents: null,
    maxExpiredTrades30d: 3,
    processingFeeCents: 0,
    cashPayoutEnabled: false,
    cashRatePercent: 50,
    overstockThreshold: 0,
    excludedSetCodes: ["lea", "lea", ""],
    excludedCardNames: ["Black Lotus"],
    notifyCustomer: true,
    notifyStaff: true,
    shippingPaidBy: "customer",
    shipTo: { name: "Geega Games", line1: "200 New St", city: "Ballwin", state: "missouri", postalCode: "63011" },
    packingInstructions: "Sleeve them.",
    returnPolicy: "We mail them back.",
  };

  it("saves valid settings, normalized, with an audit entry", async () => {
    const res = await owner.post({ action: "saveSettings", settings: valid });
    expect(res.statusCode).toBe(200);
    const row = state.tables.trade_settings[0] as Record<string, unknown>;
    expect(row).toMatchObject({ ship_to_line1: "200 New St", ship_to_state: "MO", excluded_set_codes: ["LEA"], updated_by: "owner-1" });
    expect((state.tables.admin_audit_log[0] as Record<string, unknown>).action).toBe("trade.settings");
  });

  it("won't turn trading on without the address customers mail to, or take nonsense", async () => {
    expect((await owner.post({ action: "saveSettings", settings: { ...valid, shipTo: null } })).statusCode).toBe(400);
    expect((await owner.post({ action: "saveSettings", settings: { ...valid, creditRatePercent: 0 } })).statusCode).toBe(400);
    expect((await owner.post({ action: "saveSettings", settings: { ...valid, conditionPercents: { ...valid.conditionPercents, LP: 120 } } })).statusCode).toBe(400);
    expect((await owner.post({ action: "saveSettings", settings: { ...valid, minTradeValueCents: 5000, maxTradeValueCents: 1000 } })).statusCode).toBe(400);
    // Off, no address is fine.
    expect((await owner.post({ action: "saveSettings", settings: { ...valid, enabled: false, shipTo: null } })).statusCode).toBe(200);
  });
});

describe("the worker: expiry and reminders (13)", () => {
  it("emails customers whose trades expired, and reminds others once per deadline", async () => {
    const gone = tradeRow({ status: "expired" });
    const soon = tradeRow({ status: "awaiting_trade_list", hold_expires_at: iso(Date.now() + 3 * HOUR) });
    const later = tradeRow({ status: "awaiting_trade_list", hold_expires_at: iso(Date.now() + 20 * HOUR) });
    trades().push(gone, soon, later);
    let firstRun = true;
    rpc("trade_expire_due", () => {
      const rows = firstRun ? [{ expired_trade_id: gone.id, expired_trade_number: gone.trade_number, expired_from_status: "awaiting_trade_list" }] : [];
      firstRun = false;
      return { data: rows, error: null };
    });
    const counts = await runTradeWorker();
    expect(counts).toEqual({ tradesExpired: 1, tradeReminders: 1, tradeAlerts: 0 });
    expect(emailTypes()).toEqual(["trade_expired", "trade_reminder_list_due"]);
    expect(sent[0].text).toContain("your card list wasn't sent in time");
    sent.length = 0;
    const again = await runTradeWorker();
    expect(again).toEqual({ tradesExpired: 0, tradeReminders: 0, tradeAlerts: 0 });
    expect(sent).toHaveLength(0);
  });

  it("alerts staff about a package in transit too long (nothing is released)", async () => {
    const t = tradeRow({ status: "in_transit", inbound_tracking: "9400111", inbound_shipped_at: iso(Date.now() - 11 * 24 * HOUR), hold_expires_at: null });
    trades().push(t);
    rpc("trade_expire_due", () => ({ data: [], error: null }));
    const counts = await runTradeWorker();
    expect(counts.tradeAlerts).toBe(1);
    expect(emailTypes()).toEqual(["trade_staff_transit_overdue"]);
    expect(t.status).toBe("in_transit");
  });

  it("does nothing (and doesn't fail) where the Trade Center isn't set up", async () => {
    state.tables.trade_settings = [];
    expect(await runTradeWorker()).toEqual({ tradesExpired: 0, tradeReminders: 0, tradeAlerts: 0 });
  });
});
