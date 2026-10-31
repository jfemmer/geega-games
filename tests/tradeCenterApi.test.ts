import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import { createFakeState, createFakeSupabase, fakeId, fakeResponse, type FakeState } from "./helpers/fakeSupabase";
import { addQualifyingDays, addQualifyingHours } from "../src/store/lib/tradeDeadlines";

// Trade Center APIs. The database functions themselves (reservations,
// deadlines, the deposit's states, totals, finishing a trade) are exercised
// against real Postgres in tests/tradeCenterDb.test.ts; here the rpc calls
// are stand-ins, and the tests are about what the endpoints decide: who may
// do what, what's taken from the browser and what isn't (prices, deposits
// and deadlines never are), what's sent to the database, how deposits are
// collected and refunded through Stripe, and which emails and alerts follow.

beforeAll(() => {
  process.env.SUPABASE_URL = "https://x.invalid";
  process.env.SUPABASE_SECRET_KEY = "svc";
  process.env.PUBLIC_SITE_URL = "https://geega-games.com";
  process.env.STRIPE_SECRET_KEY = "sk_test_x";
  process.env.STRIPE_WEBHOOK_SECRET = "whsec_test";
  delete process.env.EASYPOST_API_KEY;
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

// The carrier tracking service (EasyPost): off unless a test turns it on.
type Tracker = { id: string; status: string; tracking_details: Record<string, unknown>[] };
const easypost = {
  connected: false,
  fail: false,
  /** By tracking number. */
  trackers: new Map<string, Tracker>(),
  loads: [] as { trackerId: string | null; shipmentId: string | null; trackingNumber: string; carrier: string | null }[],
};
vi.mock("../api/_lib/easypost.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api/_lib/easypost.js")>()),
  isEasyPostConnected: () => easypost.connected,
  loadTracker: async (o: { trackerId: string | null; shipmentId: string | null; trackingNumber: string; carrier: string | null }) => {
    easypost.loads.push(o);
    if (easypost.fail) throw new Error("EasyPost is down");
    const tracker = easypost.trackers.get(o.trackingNumber);
    if (!tracker) throw new Error("No such tracker");
    return { tracker, created: !o.trackerId };
  },
}));

type Intent = {
  id: string;
  status: string;
  amount: number;
  amount_received?: number;
  metadata: Record<string, string>;
  client_secret: string;
  last_payment_error?: { code: string; message: string } | null;
};
type Refund = { id: string; status: string; amount: number; payment_intent: string; metadata: Record<string, string>; failure_reason?: string | null };
const stripeState = {
  intents: new Map<string, Intent>(),
  created: [] as { params: Record<string, unknown>; key?: string }[],
  canceled: [] as string[],
  refunds: new Map<string, Refund>(),
  refundCalls: [] as { params: Record<string, unknown>; key?: string }[],
  /** What the next refunds.create does: succeed at once, stay pending, or find the charge already refunded. */
  refundMode: "succeeded" as "succeeded" | "pending" | "already",
  n: 0,
};
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
      retrieve: async (id: string, opts?: { expand?: string[] }) => {
        const intent = stripeState.intents.get(id);
        if (!intent) throw new Error("No such payment_intent");
        // The fee on the charge, when asked for (deposit bookkeeping).
        return opts?.expand ? { ...intent, latest_charge: { balance_transaction: { fee: 88 } } } : intent;
      },
      cancel: async (id: string) => {
        const intent = stripeState.intents.get(id)!;
        intent.status = "canceled";
        stripeState.canceled.push(id);
        return intent;
      },
    },
    refunds: {
      create: async (params: { payment_intent: string; amount?: number; metadata: Record<string, string> }, opts?: { idempotencyKey?: string }) => {
        stripeState.refundCalls.push({ params: params as unknown as Record<string, unknown>, key: opts?.idempotencyKey });
        if (stripeState.refundMode === "already") throw Object.assign(new Error("Charge already refunded"), { code: "charge_already_refunded" });
        const refund: Refund = {
          id: `re_test${stripeState.refundCalls.length}`,
          status: stripeState.refundMode === "pending" ? "pending" : "succeeded",
          amount: params.amount ?? stripeState.intents.get(params.payment_intent)?.amount ?? 0,
          payment_intent: params.payment_intent,
          metadata: params.metadata,
        };
        stripeState.refunds.set(refund.id, refund);
        return refund;
      },
      retrieve: async (id: string) => {
        const refund = stripeState.refunds.get(id);
        if (!refund) throw new Error("No such refund");
        return refund;
      },
    },
    webhooks: { constructEvent: () => currentEvent },
  }),
}));

const { default: customerApi } = await import("../api/trade-center.ts");
const { default: adminApi } = await import("../api/admin/trade-center.ts");
const { default: stripeWebhook } = await import("../api/webhooks/stripe.ts");
const { runTradeWorker } = await import("../api/_lib/tradeExpiry.ts");

const ANN = "11111111-1111-4111-8111-111111111111";
const BOB = "22222222-2222-4222-8222-222222222222";
const RING = "aaaaaaaa-aaaa-4aaa-8aaa-000000000001";
const SIGNET = "aaaaaaaa-aaaa-4aaa-8aaa-000000000002";
const SHEOLDRED = "bbbbbbbb-bbbb-4bbb-8bbb-000000000001";
const ELVES = "bbbbbbbb-bbbb-4bbb-8bbb-000000000002";
const BOLT = "bbbbbbbb-bbbb-4bbb-8bbb-000000000003";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const iso = (ms: number) => new Date(ms).toISOString();
const DEPOSIT_TERMS = "Refundable once the carrier accepts your package in time. We review every case before keeping a deposit.";

/** "YYYY-MM-DD", `years` years before today: a printing's release date, for its age-based condition. */
const releasedYearsAgo = (years: number) => new Date(Date.now() - years * 365.25 * DAY).toISOString().slice(0, 10);

function scryfallCard(
  id: string,
  name: string,
  set: string,
  cn: string,
  prices: Record<string, string | null>,
  finishes = ["nonfoil", "foil"],
  releasedAt: string | null = releasedYearsAgo(1),
) {
  return {
    object: "card",
    id,
    oracle_id: `cccccccc-cccc-4ccc-8ccc-${id.slice(-12)}`,
    name,
    set,
    set_name: `${set.toUpperCase()} Set`,
    collector_number: cn,
    released_at: releasedAt,
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
    draft_days: 14,
    revision_hours: 168,
    confirmation_hours: 48,
    ship_days_new: 3,
    ship_days_tier1: 4,
    ship_days_tier2: 5,
    loyalty_tier1_trades: 3,
    loyalty_tier2_trades: 10,
    scan_grace_hours: 24,
    excluded_dates: [],
    payment_due_days: 7,
    max_transit_days: 10,
    stall_alert_days: 4,
    confirm_reminder_hours: 12,
    ship_reminder_hours: 24,
    dispute_window_days: 14,
    deposits_enabled: true,
    deposit_threshold_cents: 30000,
    deposit_band1_max_cents: 10000,
    deposit_band2_max_cents: 30000,
    deposit_band3_max_cents: 60000,
    deposit_band1_cents: 500,
    deposit_band2_cents: 1000,
    deposit_band3_cents: 2000,
    deposit_band4_cents: 3000,
    allow_forfeiture: false,
    deposit_terms: DEPOSIT_TERMS,
    deposit_terms_version: 3,
    abandon_limit: 2,
    abandon_window_days: 365,
    abandon_policy: "deposit",
    max_active_trades: 2,
    max_wanted_lines: 40,
    max_offered_lines: 100,
    min_trade_value_cents: 0,
    max_trade_value_cents: null,
    processing_fee_cents: 0,
    cash_payout_enabled: false,
    cash_rate_percent: 50,
    overstock_threshold: 0,
    excluded_set_codes: [],
    excluded_card_names: [],
    notify_customer: true,
    notify_staff: true,
    shipping_paid_by: "customer",
    ship_fee_cents: 399,
    free_ship_threshold_cents: 20000,
    free_ship_fee_cents: 0,
    ship_cost_estimate_cents: 600,
    local_pickup_enabled: true,
    local_pickup_area: "the St. Louis area",
    local_meet_days: 7,
    local_pickup_details: "We'll message you to set a time and a public place to meet.",
    local_meet_spot_name: null as string | null,
    local_meet_spot_address: null as string | null,
    local_credit_rate_percent: 80,
    local_min_card_value_cents: 1500,
    local_min_trade_value_cents: 0,
    local_cash_payout_enabled: false,
    local_cash_rate_percent: 50,
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
    handoff_method: "ship",
    meetup_details: null,
    met_at: null,
    local_payment_method: null,
    local_paid_cents: null,
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
    ship_fee_cents: 399,
    free_ship_threshold_cents: 20000,
    free_ship_fee_cents: 0,
    list_due_at: iso(Date.now() + 14 * DAY),
    confirm_by: null,
    confirm_by_original: null,
    ship_by: null,
    ship_by_original: null,
    ship_days: null,
    payment_due_at: null,
    confirmed_at: null,
    reserved_at: null,
    approval_conditions: null,
    deposit_cents: 0,
    deposit_reason: null,
    deposit_override: "auto",
    deposit_status: "not_required",
    deposit_payment_intent: null,
    deposit_paid_cents: null,
    deposit_paid_at: null,
    deposit_fee_cents: null,
    deposit_refund_id: null,
    deposit_refund_attempts: 0,
    deposit_refund_requested_at: null,
    deposit_refunded_at: null,
    deposit_refund_failure: null,
    deposit_decided_at: null,
    deposit_decided_by: null,
    deposit_decision_note: null,
    inbound_carrier: null,
    inbound_tracking: null,
    inbound_tracking_added_at: null,
    inbound_tracker_id: null,
    inbound_tracking_status: null,
    inbound_tracking_events: [],
    inbound_tracking_checked_at: null,
    inbound_last_event_at: null,
    inbound_accepted_at: null,
    inbound_acceptance_source: null,
    shipped_on_time: null,
    inbound_delivered_at: null,
    inbound_shipped_on: null,
    inbound_packaging_confirmed_at: null,
    outbound_postage_cents: null,
    review_flag: null,
    review_flag_at: null,
    customer_fault: null,
    fault_at: null,
    fault_cleared_at: null,
    fault_cleared_by: null,
    expired_stage: null,
    return_status: "none",
    return_carrier: null,
    return_tracking: null,
    returned_at: null,
    needs_staff: false,
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
type TradeRowT = ReturnType<typeof tradeRow>;

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
    reservation_id: null,
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
    status: "requested",
    created_at: iso(Date.now()),
    ...over,
  };
}

type Res = ReturnType<typeof fakeResponse> & { body: Record<string, unknown> & { message?: string } };

async function call(handler: typeof customerApi, req: Record<string, unknown>): Promise<Res> {
  const res = fakeResponse();
  await handler(
    { headers: {}, query: {}, socket: { remoteAddress: `10.0.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}` }, ...req } as never,
    res as never,
  );
  return res as Res;
}
const as = (token: string | null) => ({
  get: (query: Record<string, string> = {}) => call(customerApi, { method: "GET", query, headers: token ? { authorization: `Bearer ${token}` } : {} }),
  post: (body: Record<string, unknown>) =>
    call(customerApi, { method: "POST", body, headers: token ? { authorization: `Bearer ${token}`, "user-agent": "TestBrowser/1.0" } : {} }),
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
const trades = () => state.tables.trade_requests as TradeRowT[];
const find = (id: unknown) => trades().find((t) => t.id === id) as TradeRowT;
const settings = () => state.tables.trade_settings[0] as ReturnType<typeof settingsRow>;
const emailTypes = () => sent.map((e) => e.emailType);
const eventNames = (tradeId?: string) =>
  (state.tables.trade_events as Record<string, unknown>[]).filter((e) => !tradeId || e.trade_request_id === tradeId).map((e) => e.event);
/** trade_customer_stats, by customer (missing: a new customer). */
let customerStats: Record<string, Record<string, unknown>> = {};

/** Registers an rpc stand-in that records its calls. */
function rpc(name: string, fn: (args: Record<string, unknown>) => { data: unknown; error: { message: string; code?: string } | null }) {
  state.rpc[name] = (args) => {
    rpcCalls.push({ name, args });
    return fn(args);
  };
}

/** What closing does to the deposit (trade_deposit_after_close). */
function depositAfterClose(dep: string, close: string): string {
  if (dep === "payment_pending") return "canceled";
  if (close === "canceled" || close === "expired") return dep === "paid" ? "forfeiture_review" : dep;
  return dep === "paid" || dep === "forfeiture_review" ? "refund_pending" : dep;
}

/** Sends a Stripe webhook event through the real handler. */
async function webhook(event: Record<string, unknown>) {
  currentEvent = event;
  state.tables.payment_events ??= [];
  const req = Object.assign(new EventEmitter(), { method: "POST", headers: { "stripe-signature": "sig" } });
  const res = fakeResponse();
  const done = stripeWebhook(req as never, res as never);
  req.emit("data", Buffer.from("{}"));
  req.emit("end");
  await done;
  return res;
}

beforeEach(() => {
  state = createFakeState();
  rpcCalls = [];
  customerStats = {};
  sent.length = 0;
  orderNotices.length = 0;
  emailsFail = false;
  scryfallDown = false;
  scryfallCards.clear();
  stripeState.intents.clear();
  stripeState.created = [];
  stripeState.canceled = [];
  stripeState.refunds.clear();
  stripeState.refundCalls = [];
  stripeState.refundMode = "succeeded";
  stripeState.n = 0;
  easypost.connected = false;
  easypost.fail = false;
  easypost.trackers.clear();
  easypost.loads = [];
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
  state.tables.trade_disputes = [];
  state.tables.trade_extensions = [];
  state.tables.trade_consents = [];
  state.tables.trade_customer_flags = [];
  state.tables.inventory_reservations = [];
  state.tables.card_printings = [];
  state.tables.admin_audit_log = [];
  state.tables.addresses = [];
  state.tables.payment_events = [];
  state.tables.inventory_items = [
    { id: RING, card_name: "The One Ring", scryfall_id: null, quantity: 1, status: "active", price_cents: 7999, original_price_cents: null, is_deal: false },
    { id: SIGNET, card_name: "Arcane Signet", scryfall_id: null, quantity: 3, status: "active", price_cents: 125, original_price_cents: null, is_deal: false },
  ];
  // Sheoldred came out 4½ years ago, so it's listed Lightly Played; the others are under 3 years old (Near Mint).
  scryfallCards.set(
    SHEOLDRED,
    scryfallCard(SHEOLDRED, "Sheoldred, the Apocalypse", "dmu", "107", { usd: "80.00", usd_foil: "95.00" }, ["nonfoil", "foil"], releasedYearsAgo(4.5)),
  );
  scryfallCards.set(ELVES, scryfallCard(ELVES, "Llanowar Elves", "dom", "168", { usd: "0.25", usd_foil: "1.00" }));
  scryfallCards.set(BOLT, scryfallCard(BOLT, "Lightning Bolt", "2xm", "117", { usd: "20.00", usd_foil: null }));

  // trade_start: a draft with the cards asked for, nothing held (the real one checks they're on sale).
  rpc("trade_start", (args) => {
    const t = tradeRow({
      user_id: args.p_user_id,
      customer_name: args.p_customer_name,
      customer_email: args.p_customer_email,
      handoff_method: args.p_handoff_method ?? "ship",
      created_at: iso(Date.now()),
    });
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
    Object.assign(find(args.p_trade_id), { status: "pending_review", submitted_at: iso(Date.now()), list_due_at: null });
    return { data: null, error: null };
  });
  rpc("trade_close", (args) => {
    const t = find(args.p_trade_id);
    if (!(args.p_from_statuses as string[]).includes(t.status)) return { data: [{ closed: false, deposit_after: t.deposit_status }], error: null };
    const dep = depositAfterClose(t.deposit_status, args.p_status as string);
    const shipped = t.inbound_accepted_at !== null || t.received_at !== null;
    Object.assign(t, {
      status: args.p_status,
      close_reason: args.p_reason,
      closed_at: iso(Date.now()),
      deposit_status: dep,
      customer_fault: args.p_fault ?? t.customer_fault,
      expired_stage: args.p_stage ?? null,
      return_status: shipped && ["canceled_after_shipment", "declined_after_inspection", "canceled_by_store"].includes(args.p_status as string) ? "pending" : t.return_status,
    });
    return { data: [{ closed: true, deposit_after: dep }], error: null };
  });
  rpc("trade_customer_stats", (args) => ({ data: customerStats[args.p_user_id as string] ?? {}, error: null }));
  rpc("trade_short_lines", () => ({ data: [], error: null }));
  rpc("trade_mark_unavailable", () => ({ data: null, error: null }));
  rpc("trade_expire_due", () => ({ data: [], error: null }));
  // As the database does it (tradeCenterDb.test.ts runs the real one): a new
  // number needs the packaging confirmation; the same one only takes a date.
  rpc("trade_record_tracking", (args) => {
    const t = find(args.p_trade_id);
    const was = t.inbound_tracking;
    const newShipment = was !== args.p_tracking;
    if (newShipment && args.p_packaging_confirmed !== true) {
      return { data: null, error: { code: "GT010", message: "Confirm that your cards are securely packaged and shipped with tracking." } };
    }
    if (!newShipment && t.inbound_carrier === args.p_carrier) {
      if (args.p_shipped_on) t.inbound_shipped_on = args.p_shipped_on;
      return { data: "unchanged", error: null };
    }
    Object.assign(t, {
      status: "tracking_submitted",
      inbound_carrier: args.p_carrier,
      inbound_tracking: args.p_tracking,
      inbound_tracking_added_at: iso(Date.now()),
      inbound_shipped_on: newShipment ? (args.p_shipped_on ?? null) : (args.p_shipped_on ?? t.inbound_shipped_on),
      inbound_packaging_confirmed_at: newShipment ? iso(Date.now()) : t.inbound_packaging_confirmed_at,
    });
    return { data: was ? "changed" : "added", error: null };
  });
  // The deposit's paths (trade_deposit_update): anything else is refused.
  rpc("trade_deposit_update", (args) => {
    const t = find(args.p_trade_id);
    const from = t.deposit_status;
    const to = args.p_to as string;
    const now = iso(Date.now());
    if (to === "refund_pending" && (["paid", "forfeiture_review", "refund_failed"].includes(from) || (from === "forfeited" && args.p_actor_type === "staff"))) {
      Object.assign(t, {
        deposit_status: "refund_pending",
        deposit_refund_requested_at: now,
        deposit_refund_failure: null,
        deposit_refund_id: null,
        deposit_refund_attempts: from === "refund_failed" ? t.deposit_refund_attempts + 1 : t.deposit_refund_attempts,
        ...(args.p_actor_type === "staff" ? { deposit_decided_at: now, deposit_decided_by: args.p_actor_label, deposit_decision_note: args.p_note } : {}),
      });
    } else if (to === "refund_pending" && from === "refund_pending") {
      if (!args.p_refund_id || t.deposit_refund_id === args.p_refund_id) return { data: false, error: null };
      t.deposit_refund_id = args.p_refund_id as string;
    } else if (to === "refunded" && from === "refund_pending") {
      Object.assign(t, { deposit_status: "refunded", deposit_refunded_at: now, deposit_refund_id: args.p_refund_id ?? t.deposit_refund_id });
    } else if (to === "refund_failed" && from === "refund_pending") {
      Object.assign(t, { deposit_status: "refund_failed", deposit_refund_failure: args.p_failure ?? "unknown", deposit_refund_id: args.p_refund_id ?? t.deposit_refund_id });
    } else if (to === "forfeited" && from === "forfeiture_review") {
      if (!settings().allow_forfeiture) return { data: null, error: { code: "GT009", message: "Keeping deposits is turned off (Trades, Settings)." } };
      Object.assign(t, { deposit_status: "forfeited", deposit_decided_at: now, deposit_decided_by: args.p_actor_label, deposit_decision_note: args.p_note });
    } else if (to === from) {
      return { data: false, error: null };
    } else {
      return { data: null, error: { code: "GT009", message: `The deposit can't go from ${from} to ${to}.` } };
    }
    return { data: true, error: null };
  });
});

afterEach(() => {
  vi.useRealTimers();
});

/** An approved trade waiting for the customer to confirm (nothing held yet). */
function approvedTrade(over: Record<string, unknown> = {}) {
  const t = tradeRow({
    status: "awaiting_confirmation",
    approved_value_cents: 8000,
    approved_at: iso(Date.now() - HOUR),
    submitted_at: iso(Date.now() - 2 * HOUR),
    confirm_by: iso(Date.now() + 40 * HOUR),
    confirm_by_original: iso(Date.now() + 40 * HOUR),
    list_due_at: null,
    ...over,
  });
  trades().push(t);
  state.tables.trade_request_items.push(itemRow(t.id));
  state.tables.trade_offer_cards.push(offerRow(t.id, { review_status: "approved", approved_quantity: 1, approved_unit_cents: 8000 }));
  return t;
}

/** trade_confirm as the database does it: the consent, then reserved (no deposit) or waiting for the deposit. */
function confirmStandIn(result: "auto" | "unavailable" = "auto") {
  rpc("trade_confirm", (args) => {
    const t = find(args.p_trade_id);
    if (result === "unavailable") {
      Object.assign(t, { status: "revision_requested", list_due_at: iso(Date.now() + 168 * HOUR), deposit_status: t.deposit_status === "payment_pending" ? "not_required" : t.deposit_status, deposit_payment_intent: null });
      return { data: [{ result: "unavailable", short_lines: [{ card_name: "The One Ring", wanted: 1, available: 0 }] }], error: null };
    }
    state.tables.trade_consents.push({
      id: fakeId(),
      trade_request_id: t.id,
      user_id: args.p_user_id,
      terms_version: args.p_terms_version,
      terms_text: args.p_terms_text,
      deposit_cents: t.deposit_cents,
      ship_days: args.p_ship_days,
      confirm_by: t.confirm_by,
      ip: args.p_ip,
      user_agent: args.p_user_agent,
      created_at: iso(Date.now()),
    });
    if (t.deposit_cents > 0) {
      Object.assign(t, { status: "awaiting_deposit", deposit_status: "payment_pending", deposit_payment_intent: args.p_payment_intent, confirmed_at: iso(Date.now()), ship_days: args.p_ship_days });
      return { data: [{ result: "awaiting_deposit", short_lines: null }], error: null };
    }
    Object.assign(t, { status: "awaiting_shipment", confirmed_at: iso(Date.now()), reserved_at: iso(Date.now()), ship_days: args.p_ship_days, ship_by: args.p_ship_by, ship_by_original: args.p_ship_by });
    for (const i of state.tables.trade_request_items.filter((x) => x.trade_request_id === t.id)) i.status = "reserved";
    return { data: [{ result: "reserved", short_lines: null }], error: null };
  });
}

/** trade_reserve: a deposit that went through reserves the cards (or a card sold first: conflict). */
function reserveStandIn(result: "reserved" | "conflict" = "reserved") {
  rpc("trade_reserve", (args) => {
    const t = find(args.p_trade_id);
    if (t.deposit_payment_intent !== args.p_payment_intent) return { data: [{ result: "other_payment", short_lines: null }], error: null };
    if (t.deposit_paid_at) return { data: [{ result: "already", short_lines: null }], error: null };
    const paid = { deposit_paid_cents: args.p_paid_cents, deposit_paid_at: iso(Date.now()) };
    if (result === "conflict") {
      Object.assign(t, { ...paid, status: "revision_requested", deposit_status: "refund_pending", deposit_refund_requested_at: iso(Date.now()) });
      return { data: [{ result: "conflict", short_lines: [{ card_name: "The One Ring", wanted: 1, available: 0 }] }], error: null };
    }
    Object.assign(t, { ...paid, status: "awaiting_shipment", deposit_status: "paid", reserved_at: iso(Date.now()), ship_days: args.p_ship_days, ship_by: args.p_ship_by, ship_by_original: args.p_ship_by });
    return { data: [{ result: "reserved", short_lines: null }], error: null };
  });
}

// ---------------------------------------------------------------------------

describe("GET /api/trade-center (public terms)", () => {
  it("tells anyone the terms, the deadlines and the deposit, never the address customers mail to", async () => {
    const res = await as(null).get();
    expect(res.statusCode).toBe(200);
    const terms = res.body.terms as Record<string, unknown>;
    expect(terms).toMatchObject({
      enabled: true,
      paused: false,
      creditRatePercent: 80,
      minCardValueCents: 1500,
      hasShipToAddress: true,
      confirmationHours: 48,
      shipDaysNew: 3,
      depositsEnabled: true,
      depositThresholdCents: 30000,
      depositBand3Cents: 2000,
      depositTerms: DEPOSIT_TERMS,
      depositTermsVersion: 3,
      minTradeValueCents: 0,
      shipFeeCents: 399,
      freeShipThresholdCents: 20000,
      freeShipFeeCents: 0,
    });
    expect(terms).not.toHaveProperty("allowForfeiture");
    // What shipping costs the store is for staff only.
    expect(terms).not.toHaveProperty("shipCostEstimateCents");
    expect(JSON.stringify(res.body)).not.toContain("100 Test Ave");
  });

  it("needs a session for My Trades and for a trade", async () => {
    expect((await as(null).get({ view: "mine" })).statusCode).toBe(401);
    expect((await as(null).get({ id: fakeId() })).statusCode).toBe(401);
    expect((await as(null).post({ action: "start", items: [] })).statusCode).toBe(401);
  });
});

describe("starting and building a trade (1, 2, 3)", () => {
  it("opens a draft for the signed-in customer, whoever the body says they are: nothing is reserved", async () => {
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
    const trade = res.body.trade as { status: string; wanted: { status: string; available: number | null }[] };
    expect(trade.status).toBe("awaiting_trade_list");
    // Requested, not held, with how many are free right now.
    expect(trade.wanted.map((w) => [w.status, w.available])).toEqual([
      ["requested", 3],
      ["requested", 1],
    ]);
    expect(trade).not.toHaveProperty("userId");
    expect(state.tables.inventory_reservations).toHaveLength(0);
  });

  it("a double tap gets the first trade back", async () => {
    const body = { action: "start", items: [{ inventoryItemId: RING, quantity: 1 }] };
    const first = await ann.post(body);
    const second = await ann.post(body);
    expect(rpcArgs("trade_start")).toHaveLength(1);
    expect((second.body.trade as { id: string }).id).toBe((first.body.trade as { id: string }).id);
  });

  it("passes the database's refusals through in its words", async () => {
    rpc("trade_start", () => ({ data: null, error: { code: "GT004", message: "The One Ring isn't for sale right now." } }));
    const taken = await ann.post({ action: "start", items: [{ inventoryItemId: RING, quantity: 1 }] });
    expect(taken.statusCode).toBe(409);
    expect(taken.body.message).toBe("The One Ring isn't for sale right now.");
    rpc("trade_start", () => ({ data: null, error: { code: "GT003", message: "Trading is paused for your account. Message us." } }));
    expect((await ann.post({ action: "start", items: [{ inventoryItemId: SIGNET, quantity: 1 }] })).body.message).toBe(
      "Trading is paused for your account. Message us.",
    );
    // Under the minimum (the database checks our cards' total at their trade prices).
    rpc("trade_start", () => ({ data: null, error: { code: "GT005", message: "Add $73.75 more in cards to reach the $75.00 minimum trade value." } }));
    const small = await ann.post({ action: "start", items: [{ inventoryItemId: SIGNET, quantity: 1 }] });
    expect(small.statusCode).toBe(400);
    expect(small.body.message).toBe("Add $73.75 more in cards to reach the $75.00 minimum trade value.");
  });

  it("won't send a trade for review under the minimum, in the database's words", async () => {
    const t = tradeRow({ wanted_total_cents: 7499 });
    trades().push(t);
    state.tables.trade_offer_cards.push(offerRow(t.id));
    rpc("trade_submit", () => ({ data: null, error: { code: "GT005", message: "Add $0.01 more in cards to reach the $75.00 minimum trade value." } }));
    const res = await ann.post({ action: "submit", tradeId: t.id });
    expect(res.statusCode).toBe(400);
    expect(res.body.message).toBe("Add $0.01 more in cards to reach the $75.00 minimum trade value.");
    expect(t.status).toBe("awaiting_trade_list");
    expect(sent).toHaveLength(0);
  });

  it("refuses quantities that aren't whole numbers from 1 to 99", async () => {
    for (const quantity of [0, 100, 1.5, "2"]) {
      const res = await ann.post({ action: "start", items: [{ inventoryItemId: RING, quantity }] });
      expect(res.statusCode).toBe(400);
    }
    expect(rpcArgs("trade_start")).toHaveLength(0);
  });

  it("shows a draft's sold-out lines: how many are left once someone else bought or reserved them", async () => {
    const t = tradeRow();
    trades().push(t);
    state.tables.trade_request_items.push(itemRow(t.id, { inventory_item_id: SIGNET, quantity: 3 }));
    state.tables.inventory_reservations.push({ id: fakeId(), inventory_item_id: SIGNET, quantity: 2, status: "active", trade_request_id: fakeId() });
    const view = (await ann.get({ id: t.id })).body.trade as { wanted: { available: number }[]; listDueAt: string };
    expect(view.wanted[0].available).toBe(1);
    expect(view.listDueAt).toBe(t.list_due_at);
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

  it("takes the name and price from Scryfall, sets the condition from the card's age, and marks cards under the minimum", async () => {
    const res = await ann.post({
      action: "saveOffer",
      tradeId,
      cards: [
        // Whatever the browser sends for the name, the estimate or the condition, the server decides them.
        { scryfallId: SHEOLDRED, finish: "nonfoil", condition: "NM", quantity: 1, cardName: "Black Lotus", estimatedUnitCents: 999999 },
        { scryfallId: ELVES, finish: "nonfoil", condition: "HP", quantity: 4 },
      ],
    });
    expect(res.statusCode).toBe(200);
    const cards = rpcArgs("trade_save_offer")[0].p_cards as Record<string, unknown>[];
    // 4½ years old: Lightly Played, at 90% of its $80 market price.
    expect(cards[0]).toMatchObject({
      card_name: "Sheoldred, the Apocalypse",
      set_code: "DMU",
      reported_condition: "LP",
      reference_price_cents: 8000,
      condition_percent: 90,
      estimated_unit_cents: 7200,
      eligibility: "eligible",
    });
    // A year old: Near Mint.
    expect(cards[1]).toMatchObject({ card_name: "Llanowar Elves", reported_condition: "NM", condition_percent: 100, estimated_unit_cents: 25, eligibility: "below_minimum", quantity: 4 });
    expect(JSON.stringify(cards)).not.toContain("Black Lotus");
    expect(JSON.stringify(cards)).not.toContain("999999");
  });

  it("lists each card at the condition its age gives, and a card with no release date as Near Mint", async () => {
    scryfallCards.set(ELVES, scryfallCard(ELVES, "Llanowar Elves", "dom", "168", { usd: "30.00" }, ["nonfoil"], releasedYearsAgo(12)));
    scryfallCards.set(BOLT, scryfallCard(BOLT, "Lightning Bolt", "2xm", "117", { usd: "40.00" }, ["nonfoil"], releasedYearsAgo(25)));
    const lotus = fakeId();
    scryfallCards.set(lotus, scryfallCard(lotus, "Mox Opal", "som", "179", { usd: "50.00" }, ["nonfoil"], null));
    await ann.post({
      action: "saveOffer",
      tradeId,
      cards: [
        { scryfallId: ELVES, finish: "nonfoil", quantity: 1 },
        { scryfallId: BOLT, finish: "nonfoil", quantity: 1 },
        { scryfallId: lotus, finish: "nonfoil", quantity: 1 },
      ],
    });
    const cards = rpcArgs("trade_save_offer")[0].p_cards as Record<string, unknown>[];
    expect(cards.map((c) => [c.card_name, c.reported_condition, c.condition_percent, c.estimated_unit_cents])).toEqual([
      ["Llanowar Elves", "MP", 75, 2250],
      ["Lightning Bolt", "HP", 60, 2400],
      ["Mox Opal", "NM", 100, 5000],
    ]);
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
    state.tables.inventory_items.push({ id: fakeId(), card_name: "Lightning Bolt", scryfall_id: BOLT, quantity: 2, status: "active", price_cents: 199 });
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

  it("merges the same printing and finish into one line (the condition comes from the card's age)", async () => {
    await ann.post({
      action: "saveOffer",
      tradeId,
      cards: [
        { scryfallId: SHEOLDRED, finish: "nonfoil", condition: "NM", quantity: 1 },
        { scryfallId: SHEOLDRED, finish: "nonfoil", condition: "HP", quantity: 2 },
        { scryfallId: SHEOLDRED, finish: "foil", quantity: 1 },
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

  it("can't change cards once the trade is sent", async () => {
    trades()[0].status = "pending_review";
    expect((await ann.post({ action: "saveOffer", tradeId, cards: [] })).statusCode).toBe(409);
    expect((await ann.post({ action: "setWanted", tradeId, items: [{ inventoryItemId: RING, quantity: 1 }] })).statusCode).toBe(409);
  });

  it("sends the trade after pricing it again, and tells the customer (nothing reserved yet) and staff", async () => {
    state.tables.trade_offer_cards.push(offerRow(tradeId, { reference_price_cents: 5000, estimated_unit_cents: 5000 }));
    const res = await ann.post({ action: "submit", tradeId, note: "Shipping from Ohio" });
    expect(res.statusCode).toBe(200);
    const saved = rpcArgs("trade_save_offer")[0].p_cards as Record<string, unknown>[];
    expect(saved[0].reference_price_cents).toBe(8000);
    expect(rpcArgs("trade_submit")[0]).toMatchObject({ p_trade_id: tradeId, p_user_id: ANN, p_note: "Shipping from Ohio" });
    expect(emailTypes()).toEqual(["trade_submitted", "trade_staff_submitted"]);
    expect(sent[0].to).toBe("ann@example.com");
    expect(sent[0].text).toContain("Our cards aren't reserved yet");
    expect(sent[0].text).toContain("Please don't mail anything yet");
  });

  it("still sends the trade when an email fails (it's already saved)", async () => {
    state.tables.trade_offer_cards.push(offerRow(tradeId));
    emailsFail = true;
    const res = await ann.post({ action: "submit", tradeId });
    expect(res.statusCode).toBe(200);
    expect(trades()[0].status).toBe("pending_review");
  });
});

describe("confirming an approved trade (6, 7)", () => {
  beforeEach(() => {
    confirmStandIn();
  });

  it("gives the confirmation page everything it shows, worked out on the server", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-24T19:00:00Z")); // Saturday 2 PM in St. Louis
    customerStats[ANN] = { completed_trades: 3 };
    const t = approvedTrade({ deposit_cents: 2000, deposit_status: "payment_pending", deposit_reason: "threshold", wanted_total_cents: 32000 });
    const view = (await ann.get({ id: t.id })).body.trade as { confirmation: Record<string, unknown> };
    expect(view.confirmation).toEqual({
      confirmBy: t.confirm_by,
      depositCents: 2000,
      depositReason: "threshold",
      termsText: DEPOSIT_TERMS,
      termsVersion: 3,
      // Three completed trades: a returning customer gets 4 days. From Saturday 2 PM that's Thursday 2 PM (Sunday doesn't count).
      shipDays: 4,
      shipByIfConfirmedNow: "2026-10-29T19:00:00.000Z",
      canPayOnline: true,
      local: false,
    });
  });

  it("reserves at once with no deposit: the consent recorded, the shipping deadline in qualifying days, instructions emailed", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-22T19:00:00Z")); // Thursday 2 PM
    const t = approvedTrade();
    const res = await ann.post({ action: "confirm", tradeId: t.id, acknowledged: true, termsVersion: 3 });
    expect(res.statusCode).toBe(200);
    const [args] = rpcArgs("trade_confirm");
    expect(args).toMatchObject({
      p_trade_id: t.id,
      p_user_id: ANN,
      p_terms_version: 3,
      p_terms_text: DEPOSIT_TERMS,
      p_ship_days: 3,
      // Thursday 2 PM + 3 days, skipping Sunday: Monday 2 PM.
      p_ship_by: "2026-10-26T19:00:00.000Z",
      p_payment_intent: null,
      p_user_agent: "TestBrowser/1.0",
    });
    expect(args.p_ship_by).toBe(iso(addQualifyingDays(Date.now(), 3)));
    expect(t.status).toBe("awaiting_shipment");
    expect(state.tables.trade_consents).toHaveLength(1);
    expect(stripeState.created).toHaveLength(0);
    expect(emailTypes()).toEqual(["trade_reserved", "trade_staff_reserved"]);
    expect(sent[0].text).toContain("100 Test Ave");
    expect(sent[0].text).toContain("Ballwin, MO 63011");
    expect(sent[0].text).toContain("trade ID, TR-1001");
    expect(sent[0].text).toContain("a label on its own doesn't count");
    const view = res.body.trade as { mailTo: Record<string, unknown> };
    expect(view.mailTo).toMatchObject({ line1: "100 Test Ave" });
  });

  it("won't confirm without the box ticked, on terms the customer didn't see, or after the deadline", async () => {
    const t = approvedTrade();
    const unticked = await ann.post({ action: "confirm", tradeId: t.id, termsVersion: 3 });
    expect(unticked.statusCode).toBe(400);
    const stale = await ann.post({ action: "confirm", tradeId: t.id, acknowledged: true, termsVersion: 2 });
    expect(stale.statusCode).toBe(409);
    expect(stale.body.message).toBe("Our deposit terms were just updated. Review them and confirm again.");
    t.confirm_by = iso(Date.now() - 1000);
    const late = await ann.post({ action: "confirm", tradeId: t.id, acknowledged: true, termsVersion: 3 });
    expect(late.statusCode).toBe(409);
    expect(late.body.message).toContain("The time to confirm this trade ran out");
    expect(rpcArgs("trade_confirm")).toHaveLength(0);
    const draft = tradeRow();
    trades().push(draft);
    expect((await ann.post({ action: "confirm", tradeId: draft.id, acknowledged: true, termsVersion: 3 })).statusCode).toBe(409);
  });

  it("with a deposit: a PaymentIntent for exactly the trade's deposit, nothing reserved until it's paid", async () => {
    const t = approvedTrade({ deposit_cents: 2000, deposit_status: "payment_pending", deposit_reason: "threshold", wanted_total_cents: 32000 });
    const res = await ann.post({ action: "confirm", tradeId: t.id, acknowledged: true, termsVersion: 3, depositCents: 1 });
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ clientSecret: "pi_test1_secret", depositCents: 2000 });
    expect(stripeState.created[0].params).toMatchObject({
      amount: 2000,
      currency: "usd",
      payment_method_types: ["card"],
      metadata: { kind: "trade_deposit", trade_request_id: t.id, trade_number: "1001" },
    });
    expect(stripeState.created[0].key).toBe(`trade-deposit-${t.id}-2000-${t.approved_at}-first`);
    expect(rpcArgs("trade_confirm")[0]).toMatchObject({ p_payment_intent: "pi_test1" });
    expect(t).toMatchObject({ status: "awaiting_deposit", deposit_status: "payment_pending", deposit_payment_intent: "pi_test1" });
    expect(sent).toHaveLength(0);
    // Coming back to pay reuses the same payment.
    const again = await ann.post({ action: "confirm", tradeId: t.id, acknowledged: true, termsVersion: 3 });
    expect(again.body.clientSecret).toBe("pi_test1_secret");
    expect(stripeState.created).toHaveLength(1);
  });

  it("says plainly when the deposit can't be paid online", async () => {
    delete process.env.STRIPE_SECRET_KEY;
    const t = approvedTrade({ deposit_cents: 2000, deposit_status: "payment_pending" });
    const res = await ann.post({ action: "confirm", tradeId: t.id, acknowledged: true, termsVersion: 3 });
    expect(res.statusCode).toBe(503);
    expect(t.status).toBe("awaiting_confirmation");
  });

  it("when a card sold before confirming: nothing reserved or charged, the payment canceled, the trade back with the customer", async () => {
    confirmStandIn("unavailable");
    const t = approvedTrade({ deposit_cents: 2000, deposit_status: "payment_pending" });
    const res = await ann.post({ action: "confirm", tradeId: t.id, acknowledged: true, termsVersion: 3 });
    expect(res.statusCode).toBe(200);
    expect(res.body.notice).toContain("sold before you confirmed");
    expect(res.body).not.toHaveProperty("clientSecret");
    expect(stripeState.canceled).toEqual(["pi_test1"]);
    expect(t.status).toBe("revision_requested");
    expect(emailTypes()).toEqual(["trade_cards_unavailable", "trade_staff_cards_unavailable"]);
    expect(sent[0].text).toContain("The One Ring: sold");
    expect(sent[0].text).toContain("Nothing was reserved or charged.");
  });
});

describe("the deposit payment (7, security)", () => {
  let t: TradeRowT;
  beforeEach(async () => {
    confirmStandIn();
    reserveStandIn();
    t = approvedTrade({ deposit_cents: 2000, deposit_status: "payment_pending", deposit_reason: "threshold", wanted_total_cents: 32000 });
    await ann.post({ action: "confirm", tradeId: t.id, acknowledged: true, termsVersion: 3 });
    sent.length = 0;
  });

  it("reserves the cards once Stripe says it went through, once, whether the page or the webhook reports it", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-23T19:00:00Z")); // Friday 2 PM
    const intent = stripeState.intents.get("pi_test1")!;
    Object.assign(intent, { status: "succeeded", amount_received: 2000 });
    const res = await ann.post({ action: "confirmDeposit", tradeId: t.id, paymentIntentId: "pi_test1" });
    expect(res.statusCode).toBe(200);
    expect(res.body.paymentStatus).toBe("succeeded");
    // Friday 2 PM + 3 days, Sunday skipped: Tuesday 2 PM.
    expect(rpcArgs("trade_reserve")[0]).toMatchObject({ p_trade_id: t.id, p_payment_intent: "pi_test1", p_paid_cents: 2000, p_ship_days: 3, p_ship_by: "2026-10-27T19:00:00.000Z" });
    expect(t).toMatchObject({ status: "awaiting_shipment", deposit_status: "paid", deposit_fee_cents: 88 });
    expect(emailTypes()).toEqual(["trade_reserved", "trade_staff_reserved"]);
    expect(sent[0].text).toContain("your $20.00 deposit is paid");

    const webhookRes = await webhook({ id: "evt_d1", type: "payment_intent.succeeded", data: { object: intent } });
    expect(webhookRes.statusCode).toBe(200);
    expect(rpcArgs("trade_reserve")).toHaveLength(2); // the second finds it already done
    expect(emailTypes()).toEqual(["trade_reserved", "trade_staff_reserved"]);
  });

  it("refuses a payment that isn't this trade's deposit", async () => {
    const other = approvedTrade({ deposit_cents: 1000, deposit_status: "payment_pending" });
    await ann.post({ action: "confirm", tradeId: other.id, acknowledged: true, termsVersion: 3 });
    const res = await ann.post({ action: "confirmDeposit", tradeId: t.id, paymentIntentId: "pi_test2" });
    expect(res.statusCode).toBe(400);
    expect((await ann.post({ action: "confirmDeposit", tradeId: t.id, paymentIntentId: "not-a-pi" })).statusCode).toBe(400);
    expect(rpcArgs("trade_reserve")).toHaveLength(0);
  });

  it("a card that sold while it went through: nothing reserved, the deposit refunded in full at once", async () => {
    reserveStandIn("conflict");
    const intent = stripeState.intents.get("pi_test1")!;
    Object.assign(intent, { status: "succeeded", amount_received: 2000 });
    const res = await ann.post({ action: "confirmDeposit", tradeId: t.id, paymentIntentId: "pi_test1" });
    expect(res.statusCode).toBe(200);
    expect(stripeState.refundCalls).toHaveLength(1);
    expect(stripeState.refundCalls[0]).toMatchObject({
      params: { payment_intent: "pi_test1", amount: 2000, metadata: { kind: "trade_deposit_refund", trade_request_id: t.id, attempt: "0" } },
      key: `trade-deposit-refund-${t.id}-0`,
    });
    expect(t).toMatchObject({ status: "revision_requested", deposit_status: "refunded", deposit_refund_id: "re_test1" });
    expect(emailTypes()).toEqual(["trade_cards_unavailable", "trade_staff_payment_refunded", "trade_deposit_refunded"]);
    expect(sent[0].text).toContain("your $20.00 deposit is being refunded in full");
  });

  it("a payment still processing reserves nothing yet, and says so", async () => {
    stripeState.intents.get("pi_test1")!.status = "processing";
    const res = await ann.post({ action: "confirmDeposit", tradeId: t.id, paymentIntentId: "pi_test1" });
    expect(res.body.paymentStatus).toBe("processing");
    expect(t.status).toBe("awaiting_deposit");
    // And can't be replaced meanwhile.
    expect((await ann.post({ action: "confirm", tradeId: t.id, acknowledged: true, termsVersion: 3 })).statusCode).toBe(409);
  });

  it("a declined card is noted on the trade (the customer can try again)", async () => {
    const intent = { ...stripeState.intents.get("pi_test1")!, status: "requires_payment_method", last_payment_error: { code: "card_declined", message: "Your card was declined." } };
    const res = await webhook({ id: "evt_f", type: "payment_intent.payment_failed", data: { object: intent } });
    expect(res.statusCode).toBe(200);
    const e = (state.tables.trade_events as Record<string, unknown>[]).find((x) => x.event === "deposit_payment_failed") as { detail: Record<string, unknown> };
    expect(e.detail).toMatchObject({ payment_intent: "pi_test1", code: "card_declined" });
    expect(t.status).toBe("awaiting_deposit");
  });

  it("refunds a stray second payment for the same trade, once", async () => {
    // A payment left over from an earlier attempt, paid after it was replaced.
    stripeState.intents.set("pi_old", { id: "pi_old", status: "succeeded", amount: 2000, amount_received: 2000, metadata: { kind: "trade_deposit", trade_request_id: t.id }, client_secret: "x" });
    await webhook({ id: "evt_s", type: "payment_intent.succeeded", data: { object: stripeState.intents.get("pi_old") } });
    expect(stripeState.refundCalls).toEqual([
      { params: { payment_intent: "pi_old", reason: "duplicate", metadata: { kind: "trade_deposit_refund", trade_request_id: t.id, stray: "true" } }, key: "trade-stray-refund-pi_old" },
    ]);
    expect(eventNames(t.id)).toContain("deposit_duplicate_refunded");
    expect(t.status).toBe("awaiting_deposit");
  });
});

describe("shipping, tracking and proof of shipping (8, 9, 10)", () => {
  it("shows where to mail the cards only once they're reserved", async () => {
    const t = approvedTrade();
    expect(((await ann.get({ id: t.id })).body.trade as Record<string, unknown>).mailTo).toBeNull();
    t.status = "awaiting_shipment";
    const reserved = (await ann.get({ id: t.id })).body.trade as Record<string, unknown>;
    expect(reserved.mailTo).toMatchObject({ line1: "100 Test Ave", city: "Ballwin", state: "MO", postalCode: "63011" });
    expect(reserved.packingInstructions).toBe("Sleeve each card and pack them snugly.");
  });

  it("checks the tracking number against the carrier, then records it: it counts once the carrier scans it", async () => {
    const t = approvedTrade({ status: "awaiting_shipment", ship_by: iso(Date.now() + 48 * HOUR) });
    expect((await ann.post({ action: "tracking", tradeId: t.id, carrier: "Pigeon", trackingNumber: "9400111899223197428490" })).statusCode).toBe(400);
    expect((await ann.post({ action: "tracking", tradeId: t.id, carrier: "USPS", trackingNumber: "abc" })).statusCode).toBe(400);
    const mismatch = await ann.post({ action: "tracking", tradeId: t.id, carrier: "USPS", trackingNumber: "1Z999AA10123456784" });
    expect(mismatch.statusCode).toBe(400);
    expect(mismatch.body.message).toBe("That looks like a UPS tracking number. Choose UPS, or check the number.");
    // Not without their confirmation that it's packaged securely and tracked.
    const unconfirmed = await ann.post({ action: "tracking", tradeId: t.id, carrier: "USPS", trackingNumber: "9400 1118 9922-3197 4284 90" });
    expect(unconfirmed.statusCode).toBe(400);
    expect(unconfirmed.body.message).toBe("Confirm that your cards are securely packaged and shipped with tracking.");
    expect(rpcArgs("trade_record_tracking")).toHaveLength(0);
    // A ship date that isn't a real date is refused before anything is saved.
    const badDate = await ann.post({ action: "tracking", tradeId: t.id, carrier: "USPS", trackingNumber: "9400111899223197428490", packagingConfirmed: true, shippedOn: "2026-02-30" });
    expect(badDate.statusCode).toBe(400);
    expect(badDate.body.message).toBe("Enter the date you shipped, or leave it blank.");
    const res = await ann.post({
      action: "tracking",
      tradeId: t.id,
      carrier: "USPS",
      trackingNumber: "9400 1118 9922-3197 4284 90",
      packagingConfirmed: true,
      shippedOn: "2026-10-24",
    });
    expect(res.statusCode).toBe(200);
    expect(rpcArgs("trade_record_tracking")[0]).toMatchObject({
      p_carrier: "USPS",
      p_tracking: "9400111899223197428490",
      p_packaging_confirmed: true,
      p_shipped_on: "2026-10-24",
      p_actor_type: "customer",
      p_actor_id: ANN,
    });
    expect(t).toMatchObject({ status: "tracking_submitted", inbound_tracking: "9400111899223197428490", inbound_shipped_on: "2026-10-24" });
    const shipmentView = (res.body.trade as { shipment: { shippedOn: string | null; packagingConfirmedAt: string | null } }).shipment;
    expect(shipmentView.shippedOn).toBe("2026-10-24");
    expect(shipmentView.packagingConfirmedAt).not.toBeNull();
    expect(emailTypes()).toEqual(["trade_tracking_added", "trade_staff_tracking"]);
    expect(sent[0].text).toContain("Your shipment counts once the carrier scans the package");
    // The same number again needs no new confirmation, changes nothing and emails nobody.
    sent.length = 0;
    const again = await ann.post({ action: "tracking", tradeId: t.id, carrier: "USPS", trackingNumber: "9400111899223197428490" });
    expect(again.statusCode).toBe(200);
    expect(rpcArgs("trade_record_tracking")[1]).toMatchObject({ p_packaging_confirmed: false, p_shipped_on: null });
    expect(sent).toHaveLength(0);
    // A replacement number does need it again.
    const replacement = await ann.post({ action: "tracking", tradeId: t.id, carrier: "USPS", trackingNumber: "9400111899223197428491" });
    expect(replacement.statusCode).toBe(400);
    expect(t.inbound_tracking).toBe("9400111899223197428490");
    // Not checked automatically here (no tracking service configured): the page says staff verify it.
    expect(((res.body.trade as { shipment: { autoTracked: boolean } }).shipment.autoTracked)).toBe(false);
  });

  it("won't take a tracking number before the cards are reserved, or once the carrier has the package", async () => {
    const t = approvedTrade();
    expect((await ann.post({ action: "tracking", tradeId: t.id, carrier: "UPS", trackingNumber: "1Z999AA10123456784" })).statusCode).toBe(409);
    t.status = "in_transit";
    expect((await ann.post({ action: "tracking", tradeId: t.id, carrier: "UPS", trackingNumber: "1Z999AA10123456784" })).statusCode).toBe(409);
  });

  it("takes proof of shipping: files straight to private storage, then the note; it pauses expiry for staff", async () => {
    const t = approvedTrade({ status: "tracking_submitted", ship_by: iso(Date.now() - HOUR), inbound_carrier: "USPS", inbound_tracking: "9400111899223197428490" });
    rpc("trade_open_dispute", (args) => {
      const id = fakeId();
      state.tables.trade_disputes.push({ id, trade_request_id: args.p_trade_id, user_id: args.p_user_id, status: "open", note: args.p_note, files: args.p_files, created_at: iso(Date.now()), resolved_at: null, staff_note: null, resolved_by: null, resolved_by_label: null });
      Object.assign(find(args.p_trade_id), { review_flag: "dispute" });
      return { data: id, error: null };
    });
    const draftId = "6f1c2a10-0000-4000-8000-0000000000aa";
    const bad = await ann.post({ action: "proofUploads", tradeId: t.id, draftId, files: [{ fileName: "x.exe", mimeType: "application/x-msdownload", sizeBytes: 100 }] });
    expect(bad.statusCode).toBe(400);
    const big = await ann.post({ action: "proofUploads", tradeId: t.id, draftId, files: [{ fileName: "r.jpg", mimeType: "image/jpeg", sizeBytes: 11 * 1024 * 1024 }] });
    expect(big.statusCode).toBe(400);
    const ok = await ann.post({ action: "proofUploads", tradeId: t.id, draftId, files: [{ fileName: "post office receipt.jpg", mimeType: "image/jpeg", sizeBytes: 2048 }] });
    expect(ok.statusCode).toBe(200);
    const [upload] = ok.body.uploads as { path: string; signedUrl: string }[];
    expect(upload.path).toMatch(new RegExp(`^${t.id}/${draftId}/[0-9a-f-]{36}-post_office_receipt\\.jpg$`));
    // The browser uploads it (here, straight into the fake bucket).
    state.files[upload.path] = { data: Buffer.alloc(2048), contentType: "image/jpeg" };

    expect((await ann.post({ action: "proof", tradeId: t.id, draftId, note: " " })).statusCode).toBe(400);
    const res = await ann.post({ action: "proof", tradeId: t.id, draftId, note: "Dropped off Tuesday at the Main St post office" });
    expect(res.statusCode).toBe(200);
    expect(rpcArgs("trade_open_dispute")[0]).toMatchObject({
      p_trade_id: t.id,
      p_user_id: ANN,
      p_note: "Dropped off Tuesday at the Main St post office",
      p_files: [{ path: upload.path, name: "post_office_receipt.jpg", size: 2048, type: "image/jpeg" }],
    });
    expect(emailTypes()).toEqual(["trade_dispute_received", "trade_staff_dispute"]);
    const view = res.body.trade as { disputes: { status: string; files: { name: string; url?: string }[] }[]; canSendProof: boolean };
    expect(view.disputes[0]).toMatchObject({ status: "open" });
    // Customers never get links to the stored files.
    expect(view.disputes[0].files[0].url ?? null).toBeNull();
    expect(view.canSendProof).toBe(false);
  });

  it("takes proof for an expired reservation only within the window", async () => {
    const t = approvedTrade({ status: "expired", closed_at: iso(Date.now() - 20 * DAY), expired_stage: "shipping" });
    const res = await ann.post({ action: "proofUploads", tradeId: t.id, draftId: "6f1c2a10-0000-4000-8000-0000000000bb", files: [{ fileName: "r.pdf", mimeType: "application/pdf", sizeBytes: 10 }] });
    expect(res.statusCode).toBe(200); // the endpoint lets the upload start; the database refuses the proof itself after the window
    const view = (await ann.get({ id: t.id })).body.trade as { canSendProof: boolean };
    expect(view.canSendProof).toBe(false);
    t.closed_at = iso(Date.now() - 2 * DAY);
    expect(((await ann.get({ id: t.id })).body.trade as { canSendProof: boolean }).canSendProof).toBe(true);
  });

  it("asks staff for more time as a message, without moving the deadline", async () => {
    const shipBy = iso(Date.now() + 10 * HOUR);
    const t = approvedTrade({ status: "awaiting_shipment", ship_by: shipBy, ship_by_original: shipBy });
    const res = await ann.post({ action: "askForTime", tradeId: t.id, note: "Post office is closed Monday" });
    expect(res.statusCode).toBe(200);
    expect((state.tables.trade_messages[0] as Record<string, unknown>).body).toBe("I'd like more time to ship: Post office is closed Monday");
    expect(eventNames(t.id)).toContain("extension_requested");
    expect(emailTypes()).toEqual(["trade_staff_message"]);
    expect(t.ship_by).toBe(shipBy);
    expect(rpcArgs("trade_extend")).toHaveLength(0);
    t.status = "in_transit";
    expect((await ann.post({ action: "askForTime", tradeId: t.id, note: "?" })).statusCode).toBe(409);
  });
});

describe("automatic carrier tracking (9)", () => {
  const USPS = "9400111899223197428490";
  const UPS = "1Z999AA10123456784";

  it("checks a new tracking number at once: an acceptance scan in time verifies the shipment and refunds the deposit in full", async () => {
    easypost.connected = true;
    const t = approvedTrade({ status: "awaiting_shipment", ship_by: iso(Date.now() + 48 * HOUR), deposit_cents: 2000, deposit_status: "paid", deposit_paid_cents: 2000, deposit_payment_intent: "pi_ship" });
    stripeState.intents.set("pi_ship", { id: "pi_ship", status: "succeeded", amount: 2000, metadata: {}, client_secret: "x" });
    const labelAt = iso(Date.now() - 3 * HOUR);
    const acceptedAt = iso(Date.now() - 2 * HOUR);
    const latestAt = iso(Date.now() - HOUR);
    easypost.trackers.set(USPS, {
      id: "trk_1",
      status: "in_transit",
      // As EasyPost sends them (not necessarily in order): the label being made is no scan.
      tracking_details: [
        { status: "in_transit", status_detail: "arrived_at_facility", message: "Arrived at USPS Regional Facility", datetime: latestAt, tracking_location: { city: "ST LOUIS", state: "MO" } },
        { status: "pre_transit", status_detail: "label_created", message: "Shipping Label Created, USPS Awaiting Item", datetime: labelAt },
        { status: "in_transit", status_detail: "arrived_at_facility", message: "USPS picked up item", datetime: acceptedAt, tracking_location: { city: "BALLWIN", state: "MO" } },
      ],
    });
    rpc("trade_record_scan", (args) => {
      const row = find(args.p_trade_id);
      Object.assign(row, {
        status: "in_transit",
        inbound_tracker_id: args.p_tracker_id,
        inbound_accepted_at: args.p_accepted_at,
        inbound_acceptance_source: "carrier",
        shipped_on_time: true,
        deposit_status: row.deposit_status === "paid" ? "refund_pending" : row.deposit_status,
      });
      return { data: "verified", error: null };
    });

    const res = await ann.post({ action: "tracking", tradeId: t.id, carrier: "USPS", trackingNumber: USPS, packagingConfirmed: true });
    expect(res.statusCode).toBe(200);
    // A new tracker for the number (EasyPost bills per tracker: its id is kept).
    expect(easypost.loads).toEqual([{ trackerId: null, shipmentId: null, trackingNumber: USPS, carrier: "USPS" }]);
    const [scan] = rpcArgs("trade_record_scan");
    expect(scan).toMatchObject({ p_trade_id: t.id, p_tracking: USPS, p_tracker_id: "trk_1", p_status: "in_transit", p_accepted_at: acceptedAt, p_delivered_at: null, p_last_event_at: latestAt });
    const events = scan.p_events as { status: string; at: string; location: string | null }[];
    expect(events.map((e) => [e.status, e.at])).toEqual([
      ["pre_transit", labelAt],
      ["in_transit", acceptedAt],
      ["in_transit", latestAt],
    ]);
    expect(events[1].location).toBe("BALLWIN, MO");
    expect(t).toMatchObject({ status: "in_transit", deposit_status: "refunded" });
    expect(stripeState.refundCalls[0].params).toMatchObject({ payment_intent: "pi_ship", amount: 2000 });
    expect(emailTypes()).toEqual(["trade_tracking_added", "trade_staff_tracking", "trade_shipment_verified", "trade_deposit_refunded"]);
  });

  it("a label with no scan yet verifies nothing", async () => {
    easypost.connected = true;
    const t = approvedTrade({ status: "awaiting_shipment", ship_by: iso(Date.now() + 48 * HOUR) });
    easypost.trackers.set(USPS, { id: "trk_2", status: "pre_transit", tracking_details: [{ status: "pre_transit", status_detail: "label_created", message: "Shipping Label Created", datetime: iso(Date.now() - HOUR) }] });
    rpc("trade_record_scan", () => ({ data: "updated", error: null }));
    await ann.post({ action: "tracking", tradeId: t.id, carrier: "USPS", trackingNumber: USPS, packagingConfirmed: true });
    expect(rpcArgs("trade_record_scan")[0]).toMatchObject({ p_accepted_at: null, p_status: "pre_transit" });
    expect(emailTypes()).toEqual(["trade_tracking_added", "trade_staff_tracking"]);
  });

  it("the worker reads the trade's own tracker: a first scan after the deadline goes to staff, nothing released or refunded", async () => {
    easypost.connected = true;
    const t = approvedTrade({
      status: "tracking_submitted",
      ship_by: iso(Date.now() - 5 * HOUR),
      inbound_carrier: "UPS",
      inbound_tracking: UPS,
      inbound_tracker_id: "trk_9",
      deposit_cents: 2000,
      deposit_status: "paid",
      deposit_paid_cents: 2000,
      deposit_payment_intent: "pi_late",
    });
    easypost.trackers.set(UPS, { id: "trk_9", status: "in_transit", tracking_details: [{ status: "in_transit", message: "Origin Scan", datetime: iso(Date.now() - 2 * HOUR) }] });
    rpc("trade_record_scan", (args) => {
      Object.assign(find(args.p_trade_id), { review_flag: "late_acceptance", inbound_accepted_at: args.p_accepted_at, inbound_tracking_checked_at: iso(Date.now()) });
      return { data: "late", error: null };
    });
    const counts = await runTradeWorker();
    expect(counts.tradeScansChecked).toBe(1);
    expect(easypost.loads).toEqual([{ trackerId: "trk_9", shipmentId: null, trackingNumber: UPS, carrier: "UPS" }]);
    expect(emailTypes()).toEqual(["trade_staff_late_scan"]);
    expect(t).toMatchObject({ status: "tracking_submitted", deposit_status: "paid" });
    expect(stripeState.refundCalls).toHaveLength(0);
    // Checked again only after a while.
    sent.length = 0;
    expect((await runTradeWorker()).tradeScansChecked).toBe(0);
  });

  it("tells the customer and staff when the package is delivered", async () => {
    easypost.connected = true;
    const t = approvedTrade({ status: "in_transit", inbound_carrier: "USPS", inbound_tracking: USPS, inbound_tracker_id: "trk_3", inbound_accepted_at: iso(Date.now() - 2 * DAY), shipped_on_time: true });
    const deliveredAt = iso(Date.now() - HOUR);
    easypost.trackers.set(USPS, {
      id: "trk_3",
      status: "delivered",
      tracking_details: [
        { status: "in_transit", message: "USPS picked up item", datetime: iso(Date.now() - 2 * DAY) },
        { status: "delivered", message: "Delivered, In/At Mailbox", datetime: deliveredAt },
      ],
    });
    rpc("trade_record_scan", (args) => {
      Object.assign(find(args.p_trade_id), { status: "received", inbound_delivered_at: args.p_delivered_at, received_at: args.p_delivered_at });
      return { data: "delivered", error: null };
    });
    await runTradeWorker();
    expect(rpcArgs("trade_record_scan")[0]).toMatchObject({ p_delivered_at: deliveredAt });
    expect(emailTypes()).toEqual(["trade_delivered", "trade_staff_delivered"]);
    expect(t.status).toBe("received");
  });

  it("checks nothing for a carrier it can't track, or when the tracking service fails (staff verify by hand)", async () => {
    easypost.connected = true;
    const other = approvedTrade({ status: "awaiting_shipment", ship_by: iso(Date.now() + 48 * HOUR) });
    await ann.post({ action: "tracking", tradeId: other.id, carrier: "Other", trackingNumber: "LOCALCOURIER123", packagingConfirmed: true });
    expect(easypost.loads).toHaveLength(0);
    expect(other.status).toBe("tracking_submitted");

    easypost.fail = true;
    const t = approvedTrade({ status: "awaiting_shipment", ship_by: iso(Date.now() + 48 * HOUR) });
    const res = await ann.post({ action: "tracking", tradeId: t.id, carrier: "USPS", trackingNumber: USPS, packagingConfirmed: true });
    expect(res.statusCode).toBe(200);
    expect(rpcArgs("trade_record_scan")).toHaveLength(0);
    expect(t.status).toBe("tracking_submitted");
  });
});

describe("canceling and withdrawing (5, 11)", () => {
  it("cancels before confirming at no cost, and tells staff only once it was sent to them", async () => {
    const building = tradeRow();
    const sentIn = tradeRow({ status: "pending_review" });
    trades().push(building, sentIn);
    await ann.post({ action: "cancel", tradeId: building.id });
    expect(emailTypes()).toEqual(["trade_canceled"]);
    sent.length = 0;
    await ann.post({ action: "cancel", tradeId: sentIn.id, reason: "Found it elsewhere" });
    expect(emailTypes()).toEqual(["trade_canceled", "trade_staff_canceled"]);
    expect(rpcArgs("trade_close")[1]).toMatchObject({ p_status: "canceled", p_reason: "Found it elsewhere", p_actor_id: ANN, p_fault: null });
  });

  it("canceling while the deposit is being paid retires the payment first", async () => {
    confirmStandIn();
    const t = approvedTrade({ deposit_cents: 2000, deposit_status: "payment_pending" });
    await ann.post({ action: "confirm", tradeId: t.id, acknowledged: true, termsVersion: 3 });
    const res = await ann.post({ action: "cancel", tradeId: t.id });
    expect(res.statusCode).toBe(200);
    expect(stripeState.canceled).toEqual(["pi_test1"]);
    expect(t).toMatchObject({ status: "canceled", deposit_status: "canceled" });
    expect(t.customer_fault).toBeNull();
  });

  it("canceling after the reservation with a paid deposit: they must accept the review; it counts against them; staff decide", async () => {
    const t = approvedTrade({ status: "awaiting_shipment", deposit_cents: 2000, deposit_status: "paid", deposit_paid_cents: 2000, deposit_payment_intent: "pi_x" });
    const refused = await ann.post({ action: "cancel", tradeId: t.id });
    expect(refused.statusCode).toBe(400);
    expect(refused.body.message).toContain("may cost your deposit");
    expect(t.status).toBe("awaiting_shipment");
    const res = await ann.post({ action: "cancel", tradeId: t.id, acceptDepositReview: true });
    expect(res.statusCode).toBe(200);
    expect(rpcArgs("trade_close")[0]).toMatchObject({ p_status: "canceled", p_fault: "canceled_while_reserved" });
    // Never kept automatically: it waits for staff, and nothing is refunded or kept yet.
    expect(t.deposit_status).toBe("forfeiture_review");
    expect(stripeState.refundCalls).toHaveLength(0);
    expect(emailTypes()).toEqual(["trade_canceled", "trade_staff_canceled", "trade_staff_forfeiture_review"]);
  });

  it("can't cancel online once tracking is in: it says to message staff", async () => {
    const t = approvedTrade({ status: "tracking_submitted" });
    const res = await ann.post({ action: "cancel", tradeId: t.id });
    expect(res.statusCode).toBe(409);
    expect(res.body.message).toContain("Message us");
  });

  it("withdrawing after the carrier has the package: no penalty, the deposit refunded, the cards to come back", async () => {
    const t = approvedTrade({ status: "in_transit", inbound_accepted_at: iso(Date.now() - DAY), deposit_cents: 2000, deposit_status: "paid", deposit_paid_cents: 2000, deposit_payment_intent: "pi_w" });
    stripeState.intents.set("pi_w", { id: "pi_w", status: "succeeded", amount: 2000, metadata: {}, client_secret: "x" });
    const res = await ann.post({ action: "withdraw", tradeId: t.id, reason: "Changed my mind" });
    expect(res.statusCode).toBe(200);
    expect(rpcArgs("trade_close")[0]).toMatchObject({ p_status: "canceled_after_shipment", p_fault: null });
    expect(t).toMatchObject({ status: "canceled_after_shipment", return_status: "pending", deposit_status: "refunded" });
    expect(stripeState.refundCalls[0].params).toMatchObject({ payment_intent: "pi_w", amount: 2000 });
    expect(emailTypes()).toEqual(["trade_withdrawn", "trade_staff_withdrawn", "trade_deposit_refunded"]);
    const awaiting = approvedTrade({ status: "awaiting_shipment" });
    expect((await ann.post({ action: "withdraw", tradeId: awaiting.id })).statusCode).toBe(409);
  });
});

describe("the final offer and paying the rest (12, 13)", () => {
  it("accepting with a balance asks for payment; the address is checked and stored the US way", async () => {
    const t = tradeRow({ status: "awaiting_final_approval", final_credit_cents: 4000 });
    trades().push(t);
    rpc("trade_accept_final", () => {
      Object.assign(t, { status: "awaiting_payment", amount_due_cents: 3999, accepted_at: iso(Date.now()), payment_due_at: iso(Date.now() + 7 * DAY) });
      return { data: [{ new_status: "awaiting_payment", due_cents: 3999, new_order_id: null }], error: null };
    });
    const abroad = await ann.post({ action: "accept", tradeId: t.id, address: { line1: "1 Main", city: "Toronto", state: "Ontario", postalCode: "M5V" } });
    expect(abroad.statusCode).toBe(400);
    const res = await ann.post({ action: "accept", tradeId: t.id, address: { name: "Ann Lee", line1: "1 Main St", city: "St. Louis", state: "missouri", postalCode: "63101" } });
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

  it("declining after inspection costs nothing: their cards come back and any deposit still held is refunded", async () => {
    const t = tradeRow({ status: "awaiting_final_approval", final_credit_cents: 4000, received_at: iso(Date.now() - DAY), deposit_cents: 2000, deposit_status: "paid", deposit_paid_cents: 2000, deposit_payment_intent: "pi_dec" });
    trades().push(t);
    stripeState.intents.set("pi_dec", { id: "pi_dec", status: "succeeded", amount: 2000, metadata: {}, client_secret: "x" });
    const res = await ann.post({ action: "decline", tradeId: t.id, reason: "Too low" });
    expect(res.statusCode).toBe(200);
    expect(rpcArgs("trade_close")[0]).toMatchObject({ p_status: "declined_after_inspection", p_from_statuses: ["awaiting_final_approval", "awaiting_payment"], p_fault: null });
    expect(t).toMatchObject({ status: "declined_after_inspection", return_status: "pending", deposit_status: "refunded" });
    expect(emailTypes()).toEqual(["trade_declined", "trade_staff_declined", "trade_deposit_refunded"]);
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

  it("asks for shipping by card even when the credit covers our cards, and says what the payment is for", async () => {
    // $150 of our cards, $187.50 of theirs accepted: $150 of credit covers the cards; $3.99 shipping is paid by card.
    const t = tradeRow({ status: "awaiting_final_approval", wanted_total_cents: 15000, final_value_cents: 18750, final_credit_cents: 15000 });
    trades().push(t);
    rpc("trade_accept_final", () => {
      Object.assign(t, {
        status: "awaiting_payment",
        shipping_cents: 399,
        amount_due_cents: 399,
        excess_cents: 0,
        accepted_at: iso(Date.now()),
        payment_due_at: iso(Date.now() + 7 * DAY),
      });
      return { data: [{ new_status: "awaiting_payment", due_cents: 399, new_order_id: null }], error: null };
    });
    const res = await ann.post({ action: "accept", tradeId: t.id, address: { line1: "1 Main St", city: "St. Louis", state: "MO", postalCode: "63101" } });
    expect(res.statusCode).toBe(200);
    expect(res.body.amountDueCents).toBe(399);
    const view = res.body.trade as Record<string, unknown>;
    expect(view).toMatchObject({ shippingCents: 399, amountDueCents: 399, shipFeeCents: 399, freeShipThresholdCents: 20000, freeShipFeeCents: 0 });
    const email = sent.find((e) => e.emailType === "trade_awaiting_payment")!;
    expect(email.text).toContain("Your trade credit covers our cards; $3.99 is due by card");
    expect(email.text).toContain("Shipping our cards to you");
    expect(email.text).not.toContain("Left to pay for our cards");
    // The card payment says what it's for: shipping, nothing for the cards.
    expect((await ann.post({ action: "pay", tradeId: t.id })).statusCode).toBe(200);
    expect(stripeState.created[0].params).toMatchObject({
      amount: 399,
      metadata: { kind: "trade", trade_request_id: t.id, shipping_cents: "399", cards_cents: "0" },
    });
  });

  describe("paying the rest by card", () => {
    let t: TradeRowT;
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

    it("charges exactly the amount due, once per trade and amount, kept apart from deposits", async () => {
      const res = await ann.post({ action: "pay", tradeId: t.id });
      expect(res.statusCode).toBe(200);
      expect(res.body).toMatchObject({ clientSecret: "pi_test1_secret", amountDueCents: 3999 });
      expect(stripeState.created[0].params).toMatchObject({ amount: 3999, currency: "usd", payment_method_types: ["card"], metadata: { kind: "trade", trade_request_id: t.id } });
      expect(stripeState.created[0].key).toBe(`trade-pi-${t.id}-3999-${t.accepted_at}`);
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
      const webhookRes = await webhook({ id: "evt_1", type: "payment_intent.succeeded", data: { object: intent } });
      expect(webhookRes.statusCode).toBe(200);
      expect((state.tables.trade_events as Record<string, unknown>[]).filter((e) => e.event === "paid")).toHaveLength(1);
      const keys = sent.filter((e) => e.emailType === "trade_finalized").map((e) => e.idempotencyKey);
      expect(new Set(keys).size).toBe(1);
    });

    it("won't take a deposit payment as the rest of the trade", async () => {
      stripeState.intents.set("pi_dep", { id: "pi_dep", status: "succeeded", amount: 3999, metadata: { kind: "trade_deposit", trade_request_id: t.id }, client_secret: "x" });
      expect((await ann.post({ action: "confirmPayment", tradeId: t.id, paymentIntentId: "pi_dep" })).statusCode).toBe(400);
      expect(rpcArgs("trade_record_payment")).toHaveLength(0);
    });

    it("can't decline under a payment that's going through; an unused one is retired first", async () => {
      await ann.post({ action: "pay", tradeId: t.id });
      stripeState.intents.get("pi_test1")!.status = "processing";
      expect((await ann.post({ action: "decline", tradeId: t.id })).statusCode).toBe(409);
      expect(t.status).toBe("awaiting_payment");
      stripeState.intents.get("pi_test1")!.status = "requires_payment_method";
      expect((await ann.post({ action: "decline", tradeId: t.id })).statusCode).toBe(200);
      expect(stripeState.canceled).toEqual(["pi_test1"]);
      expect(t.status).toBe("declined_after_inspection");
    });

    it("says plainly when online payment isn't set up", async () => {
      delete process.env.STRIPE_SECRET_KEY;
      expect((await ann.post({ action: "pay", tradeId: t.id })).statusCode).toBe(503);
    });
  });
});

describe("My Trades and privacy (15)", () => {
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
      offerRow(u.id, { review_status: "approved", approved_quantity: 1, approved_unit_cents: 8000, received_quantity: 1, final_quantity: 1, final_unit_cents: 6000, verified_condition: "LP", inspection_note: "Whitening on the back", inspected_at: iso(Date.now()), flags: ["damaged"] }),
    );
    expect(await offered(u.id)).toMatchObject({ reviewStatus: "approved", approvedUnitCents: 8000, inspected: false, finalUnitCents: null, verifiedCondition: null, inspectionNote: null, flags: [] });
    u.status = "awaiting_final_approval";
    expect(await offered(u.id)).toMatchObject({ inspected: true, finalUnitCents: 6000, verifiedCondition: "LP", inspectionNote: "Whitening on the back", flags: ["damaged"] });
  });

  it("lists only the customer's own trades, with card counts, deadlines and the deposit", async () => {
    const mine = tradeRow({ status: "awaiting_shipment", ship_by: iso(Date.now() + DAY), deposit_status: "paid", deposit_cents: 2000 });
    const theirs = tradeRow({ user_id: BOB });
    trades().push(mine, theirs);
    state.tables.trade_request_items.push(itemRow(mine.id, { quantity: 2 }), itemRow(theirs.id));
    state.tables.trade_offer_cards.push(offerRow(mine.id, { quantity: 3 }));
    const list = (await ann.get({ view: "mine" })).body.trades as Record<string, unknown>[];
    expect(list.map((t) => t.id)).toEqual([mine.id]);
    expect(list[0]).toMatchObject({ wantedCount: 2, offeredCount: 3, shipBy: mine.ship_by, depositStatus: "paid", depositCents: 2000 });
  });

  it("never shows staff-only notes, internal messages, the customer's record, or Stripe ids", async () => {
    const t = tradeRow({ status: "under_inspection", deposit_status: "paid", deposit_payment_intent: "pi_secret_id", deposit_decision_note: "watch this one", customer_fault: "late_shipment", review_flag: "late_acceptance" });
    trades().push(t);
    state.tables.trade_offer_cards.push(offerRow(t.id, { internal_note: "looks resealed", inspection_internal_note: "corner ding", authenticity: "unsure" }));
    state.tables.trade_messages.push(
      { id: fakeId(), trade_request_id: t.id, author_type: "staff", author_label: "pat@geega-games.com", body: "Check this one twice", visible_to_customer: false, created_at: iso(Date.now()) },
      { id: fakeId(), trade_request_id: t.id, author_type: "staff", author_label: "pat@geega-games.com", body: "Looking great so far!", visible_to_customer: true, created_at: iso(Date.now()) },
    );
    state.tables.trade_events.push({ id: fakeId(), trade_request_id: t.id, actor_type: "staff", event: "cards_inspected", detail: {}, created_at: iso(Date.now()) });
    const body = JSON.stringify((await ann.get({ id: t.id })).body);
    for (const secret of ["resealed", "corner ding", "Check this one twice", "pat@geega-games.com", "cards_inspected", "pi_secret_id", "watch this one", "late_shipment", "late_acceptance"]) {
      expect(body).not.toContain(secret);
    }
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

  it("keeps settings, payments, cash, keeping deposits, customer rules and clearing faults for the owner", async () => {
    for (const action of ["saveSettings", "recordPayment", "markCashPaid", "forfeitDeposit", "setCustomerFlags", "clearFault"]) {
      expect((await staff.post({ action, tradeId: fakeId(), settings: {} })).statusCode).toBe(403);
    }
  });
});

describe("admin Trades: the list, the views and a trade", () => {
  it("lists open trades by default, finds one by number or name, and counts each status", async () => {
    trades().push(
      tradeRow({ status: "pending_review", customer_name: "Ann Lee" }),
      tradeRow({ status: "completed", customer_name: "Ann Lee" }),
      tradeRow({ status: "in_transit", customer_name: "Sam Rivera", customer_email: "sam@example.com" }),
    );
    const open = await staff.get();
    expect((open.body.trades as unknown[]).length).toBe(2);
    expect(open.body.counts).toMatchObject({ open: 2, all: 3, finished: 1, completed: 1, pending_review: 1 });
    const byNumber = await staff.get({ filter: "all", q: "TR-1002" });
    expect((byNumber.body.trades as { tradeNumber: number }[]).map((t) => t.tradeNumber)).toEqual([1002]);
    const byName = await staff.get({ filter: "all", q: "sam" });
    expect((byName.body.trades as { customerName: string }[]).map((t) => t.customerName)).toEqual(["Sam Rivera"]);
  });

  it("filters to what needs staff, deposits, reservations and abandonment, and says whether the caller is the owner", async () => {
    trades().push(
      tradeRow({ status: "pending_review", needs_staff: true }),
      tradeRow({ status: "tracking_submitted", needs_staff: true, review_flag: "late_acceptance", deposit_status: "paid", deposit_cents: 2000 }),
      tradeRow({ status: "expired", needs_staff: true, deposit_status: "forfeiture_review", deposit_cents: 2000, customer_fault: "missed_deadline" }),
      tradeRow({ status: "awaiting_shipment" }),
      tradeRow({ status: "completed" }),
    );
    const waiting = await staff.get({ filter: "waiting" });
    expect((waiting.body.trades as { status: string }[]).map((t) => t.status).sort()).toEqual(["expired", "pending_review", "tracking_submitted"]);
    expect(waiting.body.counts).toMatchObject({ waiting: 3, open: 3, all: 5, deposits: 2, reserved: 2, abandoned: 1, finished: 1, completed: 1 });
    expect(waiting.body.owner).toBe(false);
    const review = await staff.get({ filter: "deposits", deposit: "forfeiture_review" });
    expect((review.body.trades as { status: string }[]).map((t) => t.status)).toEqual(["expired"]);
    const summary = (waiting.body.trades as Record<string, unknown>[]).find((t) => t.status === "tracking_submitted")!;
    expect(summary).toMatchObject({ reviewFlag: "late_acceptance", depositStatus: "paid", depositCents: 2000, needsStaff: true });
    expect((await owner.get({ view: "settings" })).body.owner).toBe(true);
  });

  it("adds up deposits by where the money is, Stripe's fees included", async () => {
    trades().push(
      tradeRow({ deposit_status: "paid", deposit_cents: 2000, deposit_paid_cents: 2000, deposit_fee_cents: 88 }),
      tradeRow({ deposit_status: "refunded", deposit_cents: 1000, deposit_paid_cents: 1000, deposit_fee_cents: 59 }),
      tradeRow({ deposit_status: "forfeiture_review", deposit_cents: 3000, deposit_paid_cents: 3000 }),
      tradeRow({ deposit_status: "not_required" }),
    );
    const res = await staff.get({ view: "deposits" });
    expect(res.body.totals).toMatchObject({ heldCents: 2000, refundedCents: 1000, reviewCents: 3000, feesCents: 147, failedCents: 0 });
    expect((res.body.trades as unknown[]).length).toBe(3);
  });

  it("lists our cards reserved for trades, with each trade's deadline", async () => {
    const t = tradeRow({ status: "awaiting_shipment", ship_by: iso(Date.now() + DAY) });
    const draft = tradeRow();
    trades().push(t, draft);
    state.tables.trade_request_items.push(itemRow(t.id, { status: "reserved" }), itemRow(draft.id));
    const lines = (await staff.get({ view: "reserved" })).body.lines as Record<string, unknown>[];
    expect(lines).toEqual([expect.objectContaining({ tradeId: t.id, cardName: "The One Ring", quantity: 1, shipBy: t.ship_by, shippedAt: null })]);
  });

  it("lists customers with their record and what it earns them; the owner can require a deposit or pause them", async () => {
    trades().push(tradeRow());
    rpc("trade_customer_list", () => ({
      data: [{ customer_user_id: ANN, customer_name: "Ann Lee", customer_email: "ann@example.com", last_trade_at: iso(Date.now()), stats: { completed_trades: 10, on_time_shipments: 9, late_shipments: 1 } }],
      error: null,
    }));
    const res = await staff.get({ view: "customers" });
    expect(res.body.customers).toEqual([
      expect.objectContaining({ userId: ANN, record: expect.objectContaining({ completedTrades: 10 }), privileges: expect.objectContaining({ tier: "tier2", shipDays: 5 }) }),
    ]);
    const saved = await owner.post({ action: "setCustomerFlags", userId: ANN, depositRequired: true, blocked: false, note: "Two late ones" });
    expect(saved.statusCode).toBe(200);
    expect(state.tables.trade_customer_flags).toEqual([expect.objectContaining({ user_id: ANN, deposit_required: true, blocked: false, note: "Two late ones", updated_by: "owner-1" })]);
    expect((await owner.post({ action: "setCustomerFlags", userId: BOB, depositRequired: true })).statusCode).toBe(404);
  });

  it("tells staff to run the database update when the settings aren't there yet", async () => {
    state.tables.trade_settings = [];
    const res = await staff.get();
    expect(res.statusCode).toBe(503);
    expect(res.body.message).toBe("Trade settings aren't set up yet. Run the Trade Center database update first.");
  });

  it("shows staff everything: notes, history, the customer's record, consents and signed links to proof files", async () => {
    customerStats[ANN] = { completed_trades: 3, recent_faults: 2, deposit_required: true };
    const t = tradeRow({ status: "tracking_submitted", review_flag: "dispute" });
    trades().push(t);
    state.tables.trade_offer_cards.push(offerRow(t.id, { internal_note: "looks resealed" }));
    state.tables.trade_disputes.push({
      id: fakeId(),
      trade_request_id: t.id,
      status: "open",
      note: "Dropped off Tuesday",
      files: [{ path: `${t.id}/d1/receipt.jpg`, name: "receipt.jpg", size: 100, type: "image/jpeg" }],
      created_at: iso(Date.now()),
    });
    state.tables.trade_consents.push({ id: fakeId(), trade_request_id: t.id, terms_version: 3, terms_text: DEPOSIT_TERMS, deposit_cents: 0, ship_days: 4, confirm_by: null, ip: "203.0.113.9", user_agent: "Safari", created_at: iso(Date.now()) });
    const trade = (await staff.get({ id: t.id })).body.trade as Record<string, unknown> & {
      offered: { internalNote: string }[];
      disputes: { files: { url: string }[] }[];
      consents: { ip: string }[];
      customerRecord: { completedTrades: number; depositRequired: boolean };
      privileges: { reliabilityDeposit: boolean; shipDays: number };
    };
    expect(trade.offered[0].internalNote).toBe("looks resealed");
    expect(trade.customerEmail).toBe("ann@example.com");
    expect(trade.reviewFlag).toBe("dispute");
    expect(trade.disputes[0].files[0].url).toBe(`https://signed.example/${t.id}/d1/receipt.jpg`);
    expect(trade.consents[0].ip).toBe("203.0.113.9");
    expect(trade.customerRecord).toMatchObject({ completedTrades: 3, depositRequired: true });
    // Over the abandonment limit: back to the new-customer window, with a deposit on every trade.
    expect(trade.privileges).toMatchObject({ reliabilityDeposit: true, shipDays: 3 });
  });

  it("sends staff each of our cards' colors and type line, for sorting; the customer's view has neither", async () => {
    const inv = state.tables.inventory_items as Record<string, unknown>[];
    Object.assign(inv.find((i) => i.id === RING)!, { colors: [], type_line: "Legendary Artifact" });
    Object.assign(inv.find((i) => i.id === SIGNET)!, { colors: [], type_line: "Artifact" });
    const t = tradeRow({ status: "pending_review", submitted_at: iso(Date.now() - HOUR) });
    trades().push(t);
    state.tables.trade_request_items.push(
      itemRow(t.id),
      itemRow(t.id, { inventory_item_id: SIGNET, card_name: "Arcane Signet", quantity: 2 }),
      // An inventory line that's since gone: colors unknown.
      itemRow(t.id, { inventory_item_id: null, card_name: "Old card" }),
    );
    const staffView = (await staff.get({ id: t.id })).body.trade as { wanted: { cardName: string; colors: string[] | null; typeLine: string | null }[] };
    expect(staffView.wanted.map((w) => [w.cardName, w.colors, w.typeLine])).toEqual([
      ["The One Ring", [], "Legendary Artifact"],
      ["Arcane Signet", [], "Artifact"],
      ["Old card", null, null],
    ]);

    const customerView = (await ann.get({ id: t.id })).body.trade as { wanted: Record<string, unknown>[] };
    expect(customerView.wanted.every((w) => !("colors" in w) && !("typeLine" in w))).toBe(true);
  });
});

describe("admin Trades: review and approval (4, 5)", () => {
  let t: TradeRowT;
  let card: ReturnType<typeof offerRow>;
  let other: ReturnType<typeof offerRow>;
  beforeEach(() => {
    t = tradeRow({ status: "pending_review", submitted_at: iso(Date.now()), list_due_at: null });
    trades().push(t);
    card = offerRow(t.id);
    other = offerRow(t.id, { scryfall_id: ELVES, card_name: "Llanowar Elves", position: 2 });
    state.tables.trade_offer_cards.push(card, other);
    rpc("trade_review_cards", () => ({ data: null, error: null }));
    rpc("trade_approve", (args) => {
      Object.assign(t, {
        status: "awaiting_confirmation",
        approved_value_cents: 7000,
        approved_at: iso(Date.now()),
        confirm_by: args.p_confirm_by,
        confirm_by_original: args.p_confirm_by,
        deposit_cents: args.p_deposit_cents,
        deposit_reason: args.p_deposit_reason,
        deposit_status: (args.p_deposit_cents as number) > 0 ? "payment_pending" : "not_required",
        approval_conditions: args.p_conditions,
      });
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

  it("approves with 48 qualifying hours to confirm (Sundays don't count) and emails the customer", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-24T19:00:00Z")); // Saturday 2 PM in St. Louis
    const res = await staff.post({ action: "approve", tradeId: t.id, conditions: "Near mint only" });
    expect(res.statusCode).toBe(200);
    const args = rpcArgs("trade_approve")[0];
    // Saturday 2 PM → Tuesday 2 PM.
    expect(args.p_confirm_by).toBe("2026-10-27T19:00:00.000Z");
    expect(args.p_confirm_by).toBe(iso(addQualifyingHours(Date.now(), 48)));
    expect(args).toMatchObject({ p_deposit_cents: 0, p_deposit_reason: null, p_conditions: "Near mint only" });
    expect(emailTypes()).toEqual(["trade_approved"]);
    const email = sent[0];
    expect(email.subject).toBe("Trade TR-1001 is approved: confirm by Tue, Oct 27, 2:00 PM CT");
    expect(email.text).toContain("not counting Sundays");
    expect(email.text).toContain("We priced your cards at TCG low:");
    expect(email.text).toContain("When they arrive we check each card's condition, so the final value can go up or down.");
    expect(email.text).toContain("No deposit is needed for this trade.");
    expect(email.text).toContain("Until you confirm, our cards stay on sale.");
    // No mailing address before the trade is confirmed.
    expect(email.text).not.toContain("100 Test Ave");
  });

  it("works out the deposit from the bands, the customer's record and an override: never from the browser", async () => {
    t.wanted_total_cents = 32000;
    await staff.post({ action: "approve", tradeId: t.id, depositCents: 1 });
    expect(rpcArgs("trade_approve")[0]).toMatchObject({ p_deposit_cents: 2000, p_deposit_reason: "threshold" });
    expect(sent[0].text).toContain("Confirming takes a refundable $20.00 deposit.");

    Object.assign(t, { status: "pending_review", wanted_total_cents: 8899 });
    customerStats[ANN] = { recent_faults: 2 };
    await staff.post({ action: "approve", tradeId: t.id });
    expect(rpcArgs("trade_approve")[1]).toMatchObject({ p_deposit_cents: 500, p_deposit_reason: "reliability" });

    Object.assign(t, { status: "pending_review" });
    await staff.post({ action: "approve", tradeId: t.id, depositOverride: "waived" });
    expect(rpcArgs("trade_approve")[2]).toMatchObject({ p_deposit_cents: 0, p_deposit_reason: null });
    expect(t.deposit_override).toBe("waived");
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
  });

  it("explains when the address customers mail to isn't set", async () => {
    rpc("trade_approve", () => ({ data: null, error: { code: "GT011", message: "Add the address customers mail their cards to (Trades, Settings) before approving a trade." } }));
    const res = await staff.post({ action: "approve", tradeId: t.id });
    expect(res.statusCode).toBe(409);
    expect(res.body.message).toContain("Add the address customers mail their cards to");
    expect(sent).toHaveLength(0);
  });

  it("asks for changes with a message the customer gets, even after approving (retiring an unpaid deposit payment)", async () => {
    rpc("trade_request_revision", () => {
      Object.assign(t, { status: "revision_requested", list_due_at: iso(Date.now() + 168 * HOUR) });
      return { data: t.list_due_at, error: null };
    });
    expect((await staff.post({ action: "requestRevision", tradeId: t.id, message: " " })).statusCode).toBe(400);
    const res = await staff.post({ action: "requestRevision", tradeId: t.id, message: "Is the Sheoldred the foil?" });
    expect(res.statusCode).toBe(200);
    expect(emailTypes()).toEqual(["trade_revision_requested"]);
    expect(sent[0].text).toContain("Is the Sheoldred the foil?");

    // Waiting for the deposit: the open payment is canceled first.
    stripeState.intents.set("pi_open", { id: "pi_open", status: "requires_payment_method", amount: 2000, metadata: { kind: "trade_deposit", trade_request_id: t.id }, client_secret: "x" });
    Object.assign(t, { status: "awaiting_deposit", deposit_payment_intent: "pi_open", deposit_status: "payment_pending" });
    await staff.post({ action: "requestRevision", tradeId: t.id, message: "One more thing" });
    expect(stripeState.canceled).toEqual(["pi_open"]);
  });

  it("rejects only before the trade is confirmed; a confirmed trade is canceled instead", async () => {
    expect((await staff.post({ action: "reject", tradeId: t.id })).statusCode).toBe(400);
    await staff.post({ action: "reject", tradeId: t.id, reason: "Mostly bulk" });
    expect(rpcArgs("trade_close")[0]).toMatchObject({ p_status: "rejected", p_actor_type: "staff" });
    expect(emailTypes()).toEqual(["trade_rejected"]);
    const reserved = tradeRow({ status: "awaiting_shipment" });
    trades().push(reserved);
    const res = await staff.post({ action: "reject", tradeId: reserved.id, reason: "Counterfeits" });
    expect(res.statusCode).toBe(409);
    expect(res.body.message).toContain("cancel it instead");
  });

  it("changes the deposit before it's paid, and tells the customer when the amount changes", async () => {
    Object.assign(t, { status: "awaiting_confirmation", wanted_total_cents: 32000, deposit_cents: 2000, deposit_status: "payment_pending", deposit_reason: "threshold" });
    rpc("trade_set_deposit", (args) => {
      Object.assign(t, { deposit_override: args.p_override, deposit_cents: args.p_deposit_cents, deposit_reason: args.p_reason, deposit_status: (args.p_deposit_cents as number) > 0 ? "payment_pending" : "not_required" });
      return { data: null, error: null };
    });
    const res = await staff.post({ action: "setDeposit", tradeId: t.id, override: "waived" });
    expect(res.statusCode).toBe(200);
    expect(rpcArgs("trade_set_deposit")[0]).toMatchObject({ p_override: "waived", p_deposit_cents: 0, p_reason: null });
    expect((state.tables.trade_messages[0] as Record<string, unknown>).body).toBe("This trade no longer needs a deposit. You can confirm it without paying anything.");
    expect(emailTypes()).toEqual(["trade_message"]);
    expect((await staff.post({ action: "setDeposit", tradeId: t.id, override: "maybe" })).statusCode).toBe(400);
  });
});

describe("admin Trades: the shipment (8, 9, 10)", () => {
  it("verifies a shipment by hand: on time refunds the deposit; late counts against them with the deposit to review", async () => {
    const onTime = approvedTrade({ status: "tracking_submitted", ship_by: iso(Date.now() + HOUR), deposit_cents: 2000, deposit_status: "paid", deposit_paid_cents: 2000, deposit_payment_intent: "pi_v" });
    stripeState.intents.set("pi_v", { id: "pi_v", status: "succeeded", amount: 2000, metadata: {}, client_secret: "x" });
    rpc("trade_verify_shipment", (args) => {
      const t = find(args.p_trade_id);
      const dep = t.deposit_status !== "paid" ? t.deposit_status : args.p_on_time || args.p_refund ? "refund_pending" : "forfeiture_review";
      Object.assign(t, { status: "in_transit", inbound_accepted_at: args.p_accepted_at, shipped_on_time: args.p_on_time, deposit_status: dep, customer_fault: args.p_on_time ? t.customer_fault : "late_shipment" });
      return { data: dep, error: null };
    });
    const acceptedAt = iso(Date.now() - 2 * HOUR);
    const res = await staff.post({ action: "verifyShipment", tradeId: onTime.id, acceptedAt, onTime: true, note: "Receipt shows Tuesday" });
    expect(res.statusCode).toBe(200);
    expect(rpcArgs("trade_verify_shipment")[0]).toMatchObject({ p_accepted_at: acceptedAt, p_on_time: true, p_refund: true, p_note: "Receipt shows Tuesday" });
    expect(onTime).toMatchObject({ status: "in_transit", deposit_status: "refunded" });
    expect(emailTypes()).toEqual(["trade_shipment_verified", "trade_deposit_refunded"]);
    expect(res.body.customerEmail).toEqual({ status: "sent" });

    sent.length = 0;
    const late = approvedTrade({ status: "tracking_submitted", ship_by: iso(Date.now() - 5 * HOUR), deposit_cents: 2000, deposit_status: "paid", deposit_paid_cents: 2000 });
    await staff.post({ action: "verifyShipment", tradeId: late.id, acceptedAt: iso(Date.now() - HOUR), onTime: false });
    expect(late).toMatchObject({ deposit_status: "forfeiture_review", customer_fault: "late_shipment" });
    expect(emailTypes()).toEqual(["trade_shipment_verified", "trade_staff_forfeiture_review"]);
    // A time in the future, or nonsense, is refused.
    expect((await staff.post({ action: "verifyShipment", tradeId: late.id, acceptedAt: iso(Date.now() + DAY) })).statusCode).toBe(400);
  });

  it("marks the package received: arriving proves it shipped in time, and a held deposit is refunded", async () => {
    const t = approvedTrade({ status: "tracking_submitted", deposit_cents: 2000, deposit_status: "paid", deposit_paid_cents: 2000, deposit_payment_intent: "pi_r" });
    stripeState.intents.set("pi_r", { id: "pi_r", status: "succeeded", amount: 2000, metadata: {}, client_secret: "x" });
    rpc("trade_mark_received", (args) => {
      const row = find(args.p_trade_id);
      if (!["awaiting_shipment", "tracking_submitted", "in_transit"].includes(row.status)) {
        return { data: null, error: { code: "GT009", message: "Only a trade waiting for its package can be marked received." } };
      }
      const dep = row.status !== "in_transit" && row.deposit_status === "paid" ? "refund_pending" : row.deposit_status;
      Object.assign(row, { status: "received", received_at: iso(Date.now()), deposit_status: dep });
      return { data: dep, error: null };
    });
    const res = await staff.post({ action: "markReceived", tradeId: t.id });
    expect(res.statusCode).toBe(200);
    expect(t).toMatchObject({ status: "received", deposit_status: "refunded" });
    expect(emailTypes()).toEqual(["trade_received", "trade_deposit_refunded"]);
    expect((await staff.post({ action: "markReceived", tradeId: t.id })).statusCode).toBe(409);
  });

  it("gives more time on the running deadline, in qualifying hours for shipping, recorded with who asked", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-24T15:00:00Z")); // Saturday morning
    const shipBy = "2026-10-24T19:00:00.000Z"; // Saturday 2 PM
    const t = approvedTrade({ status: "awaiting_shipment", ship_by: shipBy, ship_by_original: shipBy });
    rpc("trade_extend", (args) => {
      Object.assign(find(args.p_trade_id), { ship_by: args.p_new_deadline });
      return { data: args.p_new_deadline, error: null };
    });
    const res = await staff.post({ action: "extend", tradeId: t.id, kind: "shipping", hours: 24, customerRequested: true, reason: "Post office closed" });
    expect(res.statusCode).toBe(200);
    // 24 qualifying hours from Saturday 2 PM: Monday 2 PM (Sunday doesn't count).
    expect(rpcArgs("trade_extend")[0]).toMatchObject({ p_kind: "shipping", p_new_deadline: "2026-10-26T19:00:00.000Z", p_hours: 24, p_customer_requested: true, p_reason: "Post office closed" });
    expect(emailTypes()).toEqual(["trade_extended"]);
    expect((await staff.post({ action: "extend", tradeId: t.id, kind: "shipping", hours: 0 })).statusCode).toBe(400);
    expect((await staff.post({ action: "extend", tradeId: t.id, kind: "forever", hours: 24 })).statusCode).toBe(400);
  });

  it("releases an unshipped reservation early, counted against the customer unless staff say otherwise", async () => {
    const t = approvedTrade({ status: "awaiting_shipment", deposit_cents: 2000, deposit_status: "paid", deposit_paid_cents: 2000 });
    expect((await staff.post({ action: "expireNow", tradeId: t.id })).statusCode).toBe(400);
    const res = await staff.post({ action: "expireNow", tradeId: t.id, reason: "Customer said they won't ship" });
    expect(res.statusCode).toBe(200);
    expect(rpcArgs("trade_close")[0]).toMatchObject({ p_status: "expired", p_fault: "missed_deadline", p_stage: "shipping" });
    expect(t.deposit_status).toBe("forfeiture_review");
    expect(emailTypes()).toEqual(["trade_reservation_expired"]);
    const other = approvedTrade({ status: "awaiting_shipment" });
    await staff.post({ action: "expireNow", tradeId: other.id, reason: "Our mistake", countAgainst: false });
    expect(rpcArgs("trade_close")[1]).toMatchObject({ p_fault: null });
    const shipped = approvedTrade({ status: "in_transit" });
    expect((await staff.post({ action: "expireNow", tradeId: shipped.id, reason: "x" })).statusCode).toBe(409);
  });

  it("reinstates an expired reservation with a fresh deadline in qualifying days", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-23T19:00:00Z")); // Friday 2 PM
    const t = approvedTrade({ status: "expired", expired_stage: "shipping", customer_fault: "missed_deadline" });
    rpc("trade_reinstate", (args) => {
      Object.assign(find(args.p_trade_id), { status: args.p_mode, ship_by: args.p_ship_by, customer_fault: args.p_clear_fault ? null : "missed_deadline" });
      return { data: [{ result: "reinstated", short_lines: null }], error: null };
    });
    const res = await staff.post({ action: "reinstate", tradeId: t.id, mode: "awaiting_shipment", shipDays: 3, clearFault: true });
    expect(res.statusCode).toBe(200);
    expect(rpcArgs("trade_reinstate")[0]).toMatchObject({ p_mode: "awaiting_shipment", p_ship_by: "2026-10-27T19:00:00.000Z", p_clear_fault: true });
    expect(t).toMatchObject({ status: "awaiting_shipment", customer_fault: null });
    expect(emailTypes()).toEqual(["trade_reinstated"]);
    rpc("trade_reinstate", () => ({ data: [{ result: "unavailable", short_lines: [{ card_name: "The One Ring" }] }], error: null }));
    const short = await staff.post({ action: "reinstate", tradeId: t.id, mode: "received" });
    expect(short.statusCode).toBe(409);
    expect(short.body.message).toContain("The One Ring isn't available any more");
  });

  it("notes a package that arrived after its reservation expired, to mail back or reinstate", async () => {
    const t = approvedTrade({ status: "expired" });
    const res = await staff.post({ action: "cardsArrived", tradeId: t.id });
    expect(res.statusCode).toBe(200);
    expect(t).toMatchObject({ return_status: "pending" });
    expect(t.received_at).toBeTruthy();
    expect(eventNames(t.id)).toContain("arrived_after_expiry");
    const waiting = approvedTrade({ status: "tracking_submitted" });
    expect((await staff.post({ action: "cardsArrived", tradeId: waiting.id })).statusCode).toBe(409);
  });

  it("cancels a confirmed trade on the store's side: the deposit refunded in full, cards that reached us to go back", async () => {
    const t = approvedTrade({ status: "under_inspection", received_at: iso(Date.now()), deposit_cents: 2000, deposit_status: "paid", deposit_paid_cents: 2000, deposit_payment_intent: "pi_c" });
    stripeState.intents.set("pi_c", { id: "pi_c", status: "succeeded", amount: 2000, metadata: {}, client_secret: "x" });
    expect((await staff.post({ action: "cancelByStore", tradeId: t.id })).statusCode).toBe(400);
    const res = await staff.post({ action: "cancelByStore", tradeId: t.id, reason: "We found a pricing error" });
    expect(res.statusCode).toBe(200);
    expect(rpcArgs("trade_close")[0]).toMatchObject({ p_status: "canceled_by_store", p_fault: null });
    expect(t).toMatchObject({ status: "canceled_by_store", return_status: "pending", deposit_status: "refunded" });
    expect(emailTypes()).toEqual(["trade_canceled_by_store", "trade_deposit_refunded"]);
    const pending = tradeRow({ status: "pending_review" });
    trades().push(pending);
    expect((await staff.post({ action: "cancelByStore", tradeId: pending.id, reason: "x" })).statusCode).toBe(409);
  });
});

describe("admin Trades: deposits and proof of shipping (11)", () => {
  it("refunds a deposit in full (Stripe's fee is ours), with a key per attempt so a retry never refunds twice", async () => {
    const t = approvedTrade({ status: "expired", deposit_cents: 2000, deposit_status: "forfeiture_review", deposit_paid_cents: 2000, deposit_payment_intent: "pi_f" });
    stripeState.intents.set("pi_f", { id: "pi_f", status: "succeeded", amount: 2000, metadata: {}, client_secret: "x" });
    stripeState.refundMode = "pending";
    const res = await staff.post({ action: "refundDeposit", tradeId: t.id, note: "Goodwill" });
    expect(res.statusCode).toBe(200);
    expect(stripeState.refundCalls[0]).toMatchObject({ params: { payment_intent: "pi_f", amount: 2000, reason: "requested_by_customer" }, key: `trade-deposit-refund-${t.id}-0` });
    expect(t).toMatchObject({ deposit_status: "refund_pending", deposit_refund_id: "re_test1", deposit_decision_note: "Goodwill" });
    expect(emailTypes()).toEqual(["trade_deposit_refund_started"]);
    expect(sent[0].text).toContain("because we reviewed it");

    // Stripe confirms it later.
    sent.length = 0;
    stripeState.refunds.get("re_test1")!.status = "succeeded";
    await webhook({ id: "evt_r1", type: "refund.updated", data: { object: stripeState.refunds.get("re_test1") } });
    expect(t.deposit_status).toBe("refunded");
    expect(emailTypes()).toEqual(["trade_deposit_refunded"]);
    // Delivered twice: recorded once.
    await webhook({ id: "evt_r1", type: "refund.updated", data: { object: stripeState.refunds.get("re_test1") } });
    expect(emailTypes()).toEqual(["trade_deposit_refunded"]);
  });

  it("a refund the bank refuses goes to staff; trying again makes a new attempt", async () => {
    const t = approvedTrade({ status: "completed", deposit_cents: 2000, deposit_status: "refund_pending", deposit_paid_cents: 2000, deposit_payment_intent: "pi_g", deposit_refund_id: "re_old" });
    stripeState.refunds.set("re_old", { id: "re_old", status: "failed", amount: 2000, payment_intent: "pi_g", metadata: { kind: "trade_deposit_refund", trade_request_id: t.id }, failure_reason: "expired_or_canceled_card" });
    await webhook({ id: "evt_r2", type: "refund.failed", data: { object: stripeState.refunds.get("re_old") } });
    expect(t).toMatchObject({ deposit_status: "refund_failed", deposit_refund_failure: "expired_or_canceled_card" });
    expect(emailTypes()).toEqual(["trade_staff_refund_failed"]);
    const retry = await staff.post({ action: "retryRefund", tradeId: t.id });
    expect(retry.statusCode).toBe(200);
    expect(stripeState.refundCalls[0].key).toBe(`trade-deposit-refund-${t.id}-1`);
    expect(t.deposit_status).toBe("refunded");
    expect((await staff.post({ action: "retryRefund", tradeId: t.id })).statusCode).toBe(409);
  });

  it("keeps a deposit only for the owner, only with keeping deposits turned on, with a reason the customer sees", async () => {
    const t = approvedTrade({ status: "expired", customer_fault: "missed_deadline", deposit_cents: 2000, deposit_status: "forfeiture_review", deposit_paid_cents: 2000 });
    expect((await staff.post({ action: "forfeitDeposit", tradeId: t.id, note: "Never shipped" })).statusCode).toBe(403);
    expect((await owner.post({ action: "forfeitDeposit", tradeId: t.id })).statusCode).toBe(400);
    const off = await owner.post({ action: "forfeitDeposit", tradeId: t.id, note: "Never shipped" });
    expect(off.statusCode).toBe(409);
    expect(off.body.message).toContain("Keeping deposits is turned off");
    expect(t.deposit_status).toBe("forfeiture_review");
    state.tables.trade_settings = [settingsRow({ allow_forfeiture: true })];
    const kept = await owner.post({ action: "forfeitDeposit", tradeId: t.id, note: "Never shipped" });
    expect(kept.statusCode).toBe(200);
    expect(t).toMatchObject({ deposit_status: "forfeited", deposit_decision_note: "Never shipped" });
    expect(emailTypes()).toEqual(["trade_deposit_kept"]);
    expect(sent[0].text).toContain("your cards weren't shipped by the deadline");
    expect(sent[0].text).toContain("Never shipped");
    expect(stripeState.refundCalls).toHaveLength(0);
  });

  it("decides on proof of shipping", async () => {
    const t = approvedTrade({ status: "tracking_submitted", review_flag: "dispute" });
    const disputeId = fakeId();
    state.tables.trade_disputes.push({ id: disputeId, trade_request_id: t.id, status: "open", note: "Dropped off Tuesday", files: [], created_at: iso(Date.now()) });
    rpc("trade_resolve_dispute", () => ({ data: t.id, error: null }));
    expect((await staff.post({ action: "resolveDispute", tradeId: t.id, disputeId: fakeId(), outcome: "accepted" })).statusCode).toBe(400);
    expect((await staff.post({ action: "resolveDispute", tradeId: t.id, disputeId, outcome: "maybe" })).statusCode).toBe(400);
    const res = await staff.post({ action: "resolveDispute", tradeId: t.id, disputeId, outcome: "accepted", note: "Receipt checks out" });
    expect(res.statusCode).toBe(200);
    expect(rpcArgs("trade_resolve_dispute")[0]).toMatchObject({ p_dispute_id: disputeId, p_outcome: "accepted", p_note: "Receipt checks out", p_actor_id: "staff-1" });
  });

  it("clears a customer's fault on a trade (the owner)", async () => {
    const t = approvedTrade({ status: "canceled", customer_fault: "canceled_while_reserved" });
    rpc("trade_clear_fault", (args) => {
      Object.assign(find(args.p_trade_id), { customer_fault: null, fault_cleared_at: iso(Date.now()), fault_cleared_by: args.p_actor_label });
      return { data: null, error: null };
    });
    const res = await owner.post({ action: "clearFault", tradeId: t.id });
    expect(res.statusCode).toBe(200);
    expect(t).toMatchObject({ customer_fault: null, fault_cleared_by: "jacob@geega-games.com" });
    expect((state.tables.admin_audit_log[0] as Record<string, unknown>).action).toBe("trade.clear_fault");
  });
});

describe("refunds made in the Stripe dashboard", () => {
  const chargeRefunded = (pi: string, refunded = true) => ({ id: "ch_1", object: "charge", payment_intent: pi, refunded, amount_refunded: refunded ? 2000 : 500 });

  it("records a held deposit refunded in full in Stripe as refunded, once, and tells the customer", async () => {
    const t = approvedTrade({ status: "awaiting_shipment", deposit_cents: 2000, deposit_status: "paid", deposit_paid_cents: 2000, deposit_payment_intent: "pi_dash" });
    stripeState.intents.set("pi_dash", { id: "pi_dash", status: "succeeded", amount: 2000, metadata: { kind: "trade_deposit", trade_request_id: t.id }, client_secret: "x" });
    const res = await webhook({ id: "evt_c1", type: "charge.refunded", data: { object: chargeRefunded("pi_dash") } });
    expect(res.statusCode).toBe(200);
    expect(rpcArgs("trade_deposit_update").map((a) => [a.p_to, a.p_actor_type, a.p_actor_label])).toEqual([
      ["refund_pending", "system", "Stripe dashboard"],
      ["refunded", "system", "stripe"],
    ]);
    expect(t.deposit_status).toBe("refunded");
    // No second refund through the API: the money already went back.
    expect(stripeState.refundCalls).toHaveLength(0);
    expect(emailTypes()).toEqual(["trade_deposit_refunded"]);
    // The same news again (a new event for the same charge) changes nothing.
    await webhook({ id: "evt_c2", type: "charge.refunded", data: { object: chargeRefunded("pi_dash") } });
    expect(emailTypes()).toEqual(["trade_deposit_refunded"]);
  });

  it("a kept deposit refunded in Stripe is recorded as staff undoing it", async () => {
    const t = approvedTrade({ status: "expired", deposit_cents: 2000, deposit_status: "forfeited", deposit_paid_cents: 2000, deposit_payment_intent: "pi_kept" });
    await webhook({ id: "evt_c3", type: "charge.refunded", data: { object: chargeRefunded("pi_kept") } });
    expect(rpcArgs("trade_deposit_update")[0]).toMatchObject({ p_to: "refund_pending", p_actor_type: "staff", p_note: "Refunded in the Stripe dashboard" });
    expect(t.deposit_status).toBe("refunded");
  });

  it("a partial refund, or a charge that isn't a deposit, changes nothing", async () => {
    const t = approvedTrade({ status: "awaiting_shipment", deposit_cents: 2000, deposit_status: "paid", deposit_paid_cents: 2000, deposit_payment_intent: "pi_part" });
    await webhook({ id: "evt_c4", type: "charge.refunded", data: { object: chargeRefunded("pi_part", false) } });
    await webhook({ id: "evt_c5", type: "charge.refunded", data: { object: chargeRefunded("pi_some_order") } });
    expect(rpcArgs("trade_deposit_update")).toHaveLength(0);
    expect(t.deposit_status).toBe("paid");
    expect(sent).toHaveLength(0);
  });

  it("a refund we started that Stripe reports through the charge is checked and recorded", async () => {
    const t = approvedTrade({ status: "completed", deposit_cents: 2000, deposit_status: "refund_pending", deposit_paid_cents: 2000, deposit_payment_intent: "pi_ours" });
    stripeState.refundMode = "already";
    await webhook({ id: "evt_c6", type: "charge.refunded", data: { object: chargeRefunded("pi_ours") } });
    expect(t.deposit_status).toBe("refunded");
    expect(emailTypes()).toEqual(["trade_deposit_refunded"]);
  });
});

describe("admin Trades: inspection and the final offer (12)", () => {
  let t: TradeRowT;
  let card: ReturnType<typeof offerRow>;
  beforeEach(() => {
    t = tradeRow({ status: "received", received_at: iso(Date.now()), approved_value_cents: 14000, inbound_tracking: "9400111899223197428490", inbound_carrier: "USPS" });
    trades().push(t);
    card = offerRow(t.id, { review_status: "approved", approved_quantity: 2, approved_unit_cents: 7000, quantity: 2 });
    state.tables.trade_offer_cards.push(card, offerRow(t.id, { review_status: "rejected", approved_quantity: 0, card_name: "Llanowar Elves" }));
    rpc("trade_inspect_cards", () => ({ data: null, error: null }));
  });

  it("confirms the approved cards as described in one go", async () => {
    await staff.post({ action: "confirmAsDescribed", tradeId: t.id });
    expect(rpcArgs("trade_inspect_cards")[0].p_cards).toEqual([
      { id: card.id, received_quantity: 2, authenticity: "authentic", verified_condition: "NM", final_quantity: 2, final_unit_cents: 7000, flags: [] },
    ]);
  });

  it("saves an inspection: condition, quantity, value and flags", async () => {
    await staff.post({
      action: "inspect",
      tradeId: t.id,
      cards: [
        { id: card.id, receivedQuantity: 2, authenticity: "authentic", verifiedCondition: "LP", finalQuantity: 2, finalUnitCents: 6300, flags: ["damaged", "bogus"], inspectionNote: "Light wear: valued as LP", inspectionInternalNote: "corner ding" },
      ],
    });
    expect(rpcArgs("trade_inspect_cards")[0].p_cards).toEqual([
      { id: card.id, received_quantity: 2, authenticity: "authentic", verified_condition: "LP", final_quantity: 2, final_unit_cents: 6300, flags: ["damaged"], inspection_note: "Light wear: valued as LP", inspection_internal_note: "corner ding" },
    ]);
  });

  it("sends the final offer with the estimate, the final value, every change and why, and that declining costs nothing", async () => {
    t.status = "under_inspection";
    Object.assign(card, { inspected_at: iso(Date.now()), received_quantity: 2, verified_condition: "LP", final_quantity: 2, final_unit_cents: 6300, inspection_note: "Light wear: valued as LP" });
    rpc("trade_send_final_offer", () => {
      Object.assign(t, { status: "awaiting_final_approval", final_value_cents: 12600, final_credit_cents: 10080, final_offer_at: iso(Date.now()) });
      return { data: 10080, error: null };
    });
    const res = await staff.post({ action: "sendFinalOffer", tradeId: t.id, cashForExcess: false });
    expect(res.statusCode).toBe(200);
    expect(rpcArgs("trade_send_final_offer")[0]).toMatchObject({ p_cash_for_excess: false });
    expect(emailTypes()).toEqual(["trade_final_offer"]);
    const text = sent[0].text;
    expect(text).toContain("Your revised offer is ready");
    expect(text).toContain("A few things changed from the $140.00 we approved before you shipped");
    expect(text).toContain("Your cards are now valued at $126.00");
    expect(text).toContain("Condition: Lightly Played (listed as Near Mint)");
    expect(text).toContain("Light wear: valued as LP");
    expect(text).toContain("You'll never lose your deposit for declining an offer after your cards arrive");
  });

  it("refuses to send a final offer with an unexplained change (the database's words pass through)", async () => {
    t.status = "under_inspection";
    rpc("trade_send_final_offer", () => ({ data: null, error: { code: "GT010", message: "Say why these changed from what was approved (a note for the customer, a flag or the condition): Sheoldred, the Apocalypse" } }));
    const res = await staff.post({ action: "sendFinalOffer", tradeId: t.id });
    expect(res.statusCode).toBe(400);
    expect(res.body.message).toContain("Say why these changed");
    expect(sent).toHaveLength(0);
  });

  it("takes a final offer back to revise it, only while it's waiting on the customer", async () => {
    t.status = "awaiting_final_approval";
    expect((await staff.post({ action: "reopenInspection", tradeId: t.id })).statusCode).toBe(200);
    expect(t.status).toBe("under_inspection");
    expect((await staff.post({ action: "reopenInspection", tradeId: t.id })).statusCode).toBe(409);
  });
});

describe("admin Trades: after the trade (13, 14)", () => {
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

  it("marks cards returned from a closed trade with their tracking, and tells the customer", async () => {
    const t = tradeRow({ status: "declined_after_inspection", return_status: "pending", received_at: iso(Date.now()) });
    trades().push(t);
    const card = offerRow(t.id);
    state.tables.trade_offer_cards.push(card);
    const res = await staff.post({ action: "markReturned", tradeId: t.id, carrier: "USPS", trackingNumber: "9400 2222 3333 4444 5555 66" });
    expect(res.statusCode).toBe(200);
    expect(t).toMatchObject({ status: "declined_after_inspection", return_status: "returned", return_carrier: "USPS", return_tracking: "9400222233334444555566" });
    expect(card.disposition).toBe("returned");
    expect(emailTypes()).toEqual(["trade_returned"]);
  });

  it("mails back only what arrived and wasn't taken from a finished trade, once", async () => {
    const t = tradeRow({ status: "completed", return_status: "pending" });
    trades().push(t);
    const inspected = iso(Date.now());
    const partly = offerRow(t.id, { review_status: "approved", received_quantity: 3, final_quantity: 2, final_unit_cents: 7000, inspected_at: inspected, disposition: "imported" });
    const none = offerRow(t.id, { review_status: "approved", received_quantity: 1, final_quantity: 0, inspected_at: inspected, disposition: "rejected" });
    const neverSent = offerRow(t.id, { review_status: "rejected", approved_quantity: 0, disposition: "rejected" });
    state.tables.trade_offer_cards.push(partly, none, neverSent);
    const res = await staff.post({ action: "markReturned", tradeId: t.id, carrier: "USPS", trackingNumber: "9400111899223197428490" });
    expect(res.statusCode).toBe(200);
    expect(t).toMatchObject({ status: "completed", return_status: "returned", return_carrier: "USPS", return_tracking: "9400111899223197428490" });
    expect([partly.disposition, none.disposition, neverSent.disposition]).toEqual(["imported", "returned", "rejected"]);
    const event = state.tables.trade_events.find((e) => e.event === "returned") as { detail: Record<string, unknown> };
    expect(event.detail).toMatchObject({ carrier: "USPS", copies: 2 });
    expect(emailTypes()).toEqual(["trade_returned"]);
    const again = await staff.post({ action: "markReturned", tradeId: t.id });
    expect(again.statusCode).toBe(409);
    expect(again.body.message).toBe("These cards were already marked returned.");
  });

  it("has nothing to mail back when nothing is waiting to go back", async () => {
    const t = tradeRow({ status: "approved_for_fulfillment" });
    trades().push(t);
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

  it("records what shipping our cards cost on a finished trade, for the economics; clears it; not before it's finished", async () => {
    const t = tradeRow({ status: "approved_for_fulfillment", final_value_cents: 25000, wanted_total_cents: 20000, shipping_cents: 0 });
    trades().push(t);
    expect((await staff.post({ action: "setPostage", tradeId: t.id, postageCents: -5 })).statusCode).toBe(400);
    expect((await staff.post({ action: "setPostage", tradeId: t.id, postageCents: 100001 })).statusCode).toBe(400);
    expect((await staff.post({ action: "setPostage", tradeId: t.id, postageCents: "5.40" })).statusCode).toBe(400);
    const res = await staff.post({ action: "setPostage", tradeId: t.id, postageCents: 540 });
    expect(res.statusCode).toBe(200);
    expect(t.outbound_postage_cents).toBe(540);
    expect((res.body.trade as { outboundPostageCents: number | null }).outboundPostageCents).toBe(540);
    expect(eventNames(t.id)).toContain("postage_recorded");
    expect((state.tables.admin_audit_log.at(-1) as Record<string, unknown>).action).toBe("trade.set_postage");
    expect(sent).toHaveLength(0);
    await staff.post({ action: "setPostage", tradeId: t.id, postageCents: null });
    expect(t.outbound_postage_cents).toBeNull();
    const open = tradeRow({ status: "under_inspection" });
    trades().push(open);
    const early = await staff.post({ action: "setPostage", tradeId: open.id, postageCents: 540 });
    expect(early.statusCode).toBe(409);
    expect(early.body.message).toBe("Postage is recorded once the trade is finished.");
    expect(open.outbound_postage_cents).toBeNull();
  });

  it("sends a message to the customer, or keeps a note for staff", async () => {
    const t = tradeRow({ status: "pending_review" });
    trades().push(t);
    await staff.post({ action: "message", tradeId: t.id, body: "Note to self", visibleToCustomer: false });
    expect(sent).toHaveLength(0);
    await staff.post({ action: "message", tradeId: t.id, body: "We'll have an answer tomorrow.", visibleToCustomer: true });
    expect(emailTypes()).toEqual(["trade_message"]);
  });
});

describe("admin Trades: economics (16)", () => {
  it("adds up finished trades: market value in, retail value out, and shipping cost against what was charged", async () => {
    const now = Date.now();
    // $250 in, $200 out, free shipping, no label or postage: counted at the $6 estimate, so $44 after shipping.
    const a = tradeRow({ status: "completed", final_value_cents: 25000, wanted_total_cents: 20000, shipping_cents: 0, paid_at: iso(now - DAY) });
    // $187.50 in, $150 out, $3.99 charged, a label bought here for $5.10.
    const order = { id: fakeId(), postage_cost_cents: 510 };
    const b = tradeRow({ status: "approved_for_fulfillment", final_value_cents: 18750, wanted_total_cents: 15000, shipping_cents: 399, order_id: order.id, paid_at: iso(now - 2 * DAY) });
    // Postage staff recorded by hand.
    const c = tradeRow({ status: "completed", final_value_cents: 10000, wanted_total_cents: 9000, shipping_cents: 399, outbound_postage_cents: 450, paid_at: iso(now - 3 * DAY) });
    // Long ago: only counted for all time.
    const old = tradeRow({ status: "completed", final_value_cents: 5000, wanted_total_cents: 7500, shipping_cents: 399, paid_at: iso(now - 200 * DAY) });
    // Not finished, or closed: never counted.
    const open = tradeRow({ status: "awaiting_payment", final_value_cents: 9000, wanted_total_cents: 8000, paid_at: null });
    const declined = tradeRow({ status: "declined_after_inspection", final_value_cents: 9000, wanted_total_cents: 8000, paid_at: null });
    trades().push(a, b, c, old, open, declined);
    (state.tables.orders ??= []).push(order);
    // Two $80 Sheoldreds (one listing), a $12 card (under the $15 minimum: a listing, not a $15+ single), one not taken.
    state.tables.trade_offer_cards.push(
      offerRow(a.id, { quantity: 2, final_quantity: 2, final_unit_cents: 8000, verified_condition: "NM", inspected_at: iso(now) }),
      offerRow(b.id, { scryfall_id: ELVES, card_name: "Llanowar Elves", final_quantity: 1, final_unit_cents: 1200, inspected_at: iso(now) }),
      offerRow(c.id, { final_quantity: 0, final_unit_cents: 0, inspected_at: iso(now) }),
      offerRow(open.id, { final_quantity: 3, final_unit_cents: 3000, inspected_at: iso(now) }),
    );

    const res = await staff.get({ view: "economics", days: "90" });
    expect(res.statusCode).toBe(200);
    expect(res.body.days).toBe(90);
    expect(res.body.totals).toEqual({
      trades: 3,
      incomingMarketCents: 53750,
      outgoingRetailCents: 44000,
      grossDifferenceCents: 9750,
      shippingChargedCents: 798,
      shippingCostCents: 1560,
      estimatedShipments: 1,
      netShippingCents: 762,
      adjustedDifferenceCents: 8988,
      averageOutgoingCents: 14667,
      acceptedSingles: 2,
      uniqueListings: 2,
    });
    const rows = res.body.trades as { id: string; tradeNumber: number; economics: Record<string, unknown> }[];
    expect(rows.map((r) => r.id)).toEqual([a.id, b.id, c.id]);
    expect(rows[0].economics).toEqual({
      incomingMarketCents: 25000,
      outgoingRetailCents: 20000,
      grossDifferenceCents: 5000,
      shippingChargedCents: 0,
      shippingCostCents: 600,
      shippingCostSource: "estimate",
      netShippingCents: 600,
      adjustedDifferenceCents: 4400,
    });
    expect(rows[1].economics).toMatchObject({ shippingCostCents: 510, shippingCostSource: "label", netShippingCents: 111 });
    expect(rows[2].economics).toMatchObject({ shippingCostCents: 450, shippingCostSource: "recorded", netShippingCents: 51 });
    // The estimate comes from Settings.
    expect((res.body.settings as { shipCostEstimateCents: number }).shipCostEstimateCents).toBe(600);

    const all = await staff.get({ view: "economics" });
    expect(all.body.days).toBeNull();
    expect((all.body.totals as { trades: number }).trades).toBe(4);
    // A period it doesn't offer means all time.
    expect((await staff.get({ view: "economics", days: "7" })).body.days).toBeNull();
    // Customers never see it.
    expect((await ann.get({ view: "economics" })).body).not.toHaveProperty("totals");
  });
});

describe("admin Trades: settings (16)", () => {
  const valid = {
    enabled: true,
    paused: false,
    pauseMessage: "Back soon.",
    creditRatePercent: 80,
    minCardValueCents: 1500,
    conditionPercents: { NM: 100, LP: 90, MP: 75, HP: 60, DMG: 40 },
    draftDays: 14,
    revisionHours: 168,
    confirmationHours: 48,
    shipDaysNew: 3,
    shipDaysTier1: 4,
    shipDaysTier2: 5,
    loyaltyTier1Trades: 3,
    loyaltyTier2Trades: 10,
    scanGraceHours: 24,
    excludedDates: ["2026-12-25", "2026-11-26", "2026-12-25"],
    paymentDueDays: 7,
    maxTransitDays: 10,
    stallAlertDays: 4,
    confirmReminderHours: 12,
    shipReminderHours: 24,
    disputeWindowDays: 14,
    depositsEnabled: true,
    depositThresholdCents: 30000,
    depositBand1MaxCents: 10000,
    depositBand2MaxCents: 30000,
    depositBand3MaxCents: 60000,
    depositBand1Cents: 500,
    depositBand2Cents: 1000,
    depositBand3Cents: 2000,
    depositBand4Cents: 3000,
    allowForfeiture: false,
    depositTerms: DEPOSIT_TERMS,
    abandonLimit: 2,
    abandonWindowDays: 365,
    abandonPolicy: "deposit",
    maxActiveTrades: 2,
    maxWantedLines: 40,
    maxOfferedLines: 100,
    minTradeValueCents: 0,
    maxTradeValueCents: null,
    processingFeeCents: 0,
    cashPayoutEnabled: false,
    cashRatePercent: 50,
    overstockThreshold: 0,
    excludedSetCodes: ["lea", "lea", ""],
    excludedCardNames: ["Black Lotus"],
    notifyCustomer: true,
    notifyStaff: true,
    shippingPaidBy: "customer",
    shipFeeCents: 399,
    freeShipThresholdCents: 20000,
    freeShipFeeCents: 0,
    shipCostEstimateCents: 600,
    shipTo: { name: "Geega Games", line1: "200 New St", city: "Ballwin", state: "missouri", postalCode: "63011" },
    packingInstructions: "Sleeve them.",
    returnPolicy: "We mail them back.",
  };

  it("saves valid settings, normalized, with an audit entry; the terms version only moves when the text does", async () => {
    const res = await owner.post({ action: "saveSettings", settings: { ...valid, minTradeValueCents: 7500, shipFeeCents: 450, shipCostEstimateCents: 650 } });
    expect(res.statusCode).toBe(200);
    const row = settings();
    expect(row).toMatchObject({
      min_trade_value_cents: 7500,
      ship_fee_cents: 450,
      free_ship_threshold_cents: 20000,
      free_ship_fee_cents: 0,
      ship_cost_estimate_cents: 650,
      ship_to_line1: "200 New St",
      ship_to_state: "MO",
      excluded_set_codes: ["LEA"],
      excluded_dates: ["2026-11-26", "2026-12-25"],
      confirmation_hours: 48,
      deposit_band3_cents: 2000,
      allow_forfeiture: false,
      deposit_terms_version: 3,
      updated_by: "owner-1",
    });
    expect((state.tables.admin_audit_log[0] as Record<string, unknown>).action).toBe("trade.settings");
    await owner.post({ action: "saveSettings", settings: { ...valid, depositTerms: `${DEPOSIT_TERMS} Questions? Reply to any email.` } });
    expect(settings().deposit_terms_version).toBe(4);
  });

  it("won't turn trading on without the address customers mail to, or take nonsense", async () => {
    const bad = async (over: Record<string, unknown>) => (await owner.post({ action: "saveSettings", settings: { ...valid, ...over } })).statusCode;
    expect(await bad({ shipTo: null })).toBe(400);
    expect(await bad({ creditRatePercent: 0 })).toBe(400);
    expect(await bad({ conditionPercents: { ...valid.conditionPercents, LP: 120 } })).toBe(400);
    expect(await bad({ minTradeValueCents: 5000, maxTradeValueCents: 1000 })).toBe(400);
    expect(await bad({ depositBand2MaxCents: 5000 })).toBe(400);
    expect(await bad({ loyaltyTier1Trades: 10 })).toBe(400);
    expect(await bad({ depositBand1Cents: 10 })).toBe(400);
    expect(await bad({ confirmationHours: 0 })).toBe(400);
    expect(await bad({ depositTerms: "  " })).toBe(400);
    // Shipping: no negative fees, a real threshold at or above the minimum, never dearer from the threshold up.
    const shipping = async (over: Record<string, unknown>) => (await owner.post({ action: "saveSettings", settings: { ...valid, ...over } })).body.message;
    expect(await shipping({ shipFeeCents: -1 })).toBe("Shipping under the free-shipping threshold: enter a whole number from 0 to 10000.");
    expect(await shipping({ freeShipFeeCents: -50 })).toMatch(/^Shipping from the threshold up:/);
    expect(await shipping({ freeShipThresholdCents: 0 })).toMatch(/^Free shipping from:/);
    expect(await shipping({ shipCostEstimateCents: 10001 })).toMatch(/^What shipping costs us:/);
    expect(await shipping({ shipFeeCents: 399, freeShipFeeCents: 500 })).toBe("Shipping from the free-shipping threshold up can't cost more than below it.");
    expect(await shipping({ minTradeValueCents: 7500, freeShipThresholdCents: 5000 })).toBe("Free shipping has to start at or above the minimum trade.");
    expect(await bad({ shipFeeCents: "3.99" })).toBe(400);
    // An impossible date is refused, not a server error.
    const impossible = await owner.post({ action: "saveSettings", settings: { ...valid, excludedDates: ["2026-13-01"] } });
    expect(impossible.statusCode).toBe(400);
    expect(impossible.body.message).toBe("Excluded days: 2026-13-01 isn't a date (use YYYY-MM-DD).");
    // Off, no address is fine.
    expect(await bad({ enabled: false, shipTo: null })).toBe(200);
  });
});

describe("the worker (deadlines, scans, deposits, reminders)", () => {
  it("closes what ran out: an expired reservation emails the customer and puts a held deposit in front of staff", async () => {
    const gone = approvedTrade({ status: "expired", expired_stage: "shipping", deposit_status: "forfeiture_review", deposit_cents: 2000, deposit_paid_cents: 2000 });
    const draft = tradeRow({ status: "offer_expired", expired_stage: "draft" });
    trades().push(draft);
    let firstRun = true;
    rpc("trade_expire_due", () => {
      const rows = firstRun
        ? [
            { expired_trade_id: gone.id, expired_trade_number: gone.trade_number, expired_from_status: "awaiting_shipment", expired_stage: "shipping", expired_deposit_status: "forfeiture_review" },
            { expired_trade_id: draft.id, expired_trade_number: draft.trade_number, expired_from_status: "awaiting_trade_list", expired_stage: "draft", expired_deposit_status: "not_required" },
          ]
        : [];
      firstRun = false;
      return { data: rows, error: null };
    });
    const counts = await runTradeWorker();
    expect(counts).toMatchObject({ tradesExpired: 2 });
    // The scan grace and whether scans are checked automatically go to the database.
    expect(rpcArgs("trade_expire_due")[0]).toMatchObject({ p_scan_grace_hours: 24, p_auto_tracking: false });
    expect(emailTypes()).toEqual(["trade_reservation_expired", "trade_staff_forfeiture_review", "trade_offer_expired"]);
    sent.length = 0;
    expect((await runTradeWorker()).tradesExpired).toBe(0);
    expect(sent).toHaveLength(0);
  });

  it("reminds customers once per deadline: sending the trade, confirming and shipping", async () => {
    const list = tradeRow({ status: "awaiting_trade_list", list_due_at: iso(Date.now() + 3 * HOUR) });
    const later = tradeRow({ status: "awaiting_trade_list", list_due_at: iso(Date.now() + 30 * HOUR) });
    trades().push(list, later);
    approvedTrade({ confirm_by: iso(Date.now() + 5 * HOUR) });
    approvedTrade({ status: "awaiting_shipment", ship_by: iso(Date.now() + 10 * HOUR) });
    const counts = await runTradeWorker();
    expect(counts.tradeReminders).toBe(3);
    expect(emailTypes().sort()).toEqual(["trade_reminder_confirm_by", "trade_reminder_list_due", "trade_reminder_ship_by"]);
    sent.length = 0;
    expect((await runTradeWorker()).tradeReminders).toBe(0);
    expect(sent).toHaveLength(0);
  });

  it("past the shipping deadline with no scan: asks the customer for proof, and flags a number nothing checks for staff", async () => {
    const t = approvedTrade({ status: "tracking_submitted", ship_by: iso(Date.now() - 2 * HOUR), inbound_carrier: "USPS", inbound_tracking: "9400111899223197428490" });
    const counts = await runTradeWorker();
    expect(counts).toMatchObject({ tradeReminders: 1, tradeAlerts: 1 });
    expect(emailTypes()).toEqual(["trade_no_scan_yet", "trade_staff_tracking_check"]);
    expect(t.review_flag).toBe("tracking_check");
    sent.length = 0;
    await runTradeWorker();
    expect(sent).toHaveLength(0);
  });

  it("sends a trade whose cards sold before confirmation back to the customer", async () => {
    const t = approvedTrade();
    rpc("trade_short_lines", (args) => ({ data: args.p_trade_id === t.id ? [{ card_name: "The One Ring", wanted: 1, available: 0 }] : [], error: null }));
    rpc("trade_mark_unavailable", (args) => {
      Object.assign(find(args.p_trade_id), { status: "revision_requested", list_due_at: iso(Date.now() + 168 * HOUR) });
      return { data: [{ card_name: "The One Ring", wanted: 1, available: 0 }], error: null };
    });
    const counts = await runTradeWorker();
    expect(counts.tradeAlerts).toBe(1);
    expect(t.status).toBe("revision_requested");
    expect(emailTypes()).toEqual(["trade_cards_unavailable", "trade_staff_cards_unavailable"]);
  });

  it("records a deposit the webhook missed, closes an unpaid one past the deadline, and finishes refunds", async () => {
    reserveStandIn();
    const paid = approvedTrade({ status: "awaiting_deposit", deposit_cents: 2000, deposit_status: "payment_pending", deposit_payment_intent: "pi_missed", updated_at: iso(Date.now() - 10 * 60_000) });
    stripeState.intents.set("pi_missed", { id: "pi_missed", status: "succeeded", amount: 2000, amount_received: 2000, metadata: { kind: "trade_deposit", trade_request_id: paid.id }, client_secret: "x" });
    const unpaid = approvedTrade({ status: "awaiting_deposit", confirm_by: iso(Date.now() - HOUR), deposit_cents: 2000, deposit_status: "payment_pending", deposit_payment_intent: "pi_unpaid", updated_at: iso(Date.now() - 10 * 60_000) });
    stripeState.intents.set("pi_unpaid", { id: "pi_unpaid", status: "requires_payment_method", amount: 2000, metadata: { kind: "trade_deposit", trade_request_id: unpaid.id }, client_secret: "x" });
    const refunding = approvedTrade({ status: "in_transit", deposit_cents: 2000, deposit_status: "refund_pending", deposit_paid_cents: 2000, deposit_payment_intent: "pi_ref" });
    stripeState.intents.set("pi_ref", { id: "pi_ref", status: "succeeded", amount: 2000, metadata: {}, client_secret: "x" });

    const counts = await runTradeWorker();
    expect(counts.tradeDepositsReconciled).toBe(3);
    expect(paid).toMatchObject({ status: "awaiting_shipment", deposit_status: "paid" });
    expect(stripeState.canceled).toEqual(["pi_unpaid"]);
    expect(unpaid).toMatchObject({ status: "offer_expired", expired_stage: "deposit", deposit_status: "canceled" });
    expect(refunding.deposit_status).toBe("refunded");
    expect(emailTypes()).toEqual(expect.arrayContaining(["trade_reserved", "trade_offer_expired", "trade_deposit_refunded"]));
  });

  it("alerts staff about a package in transit too long or gone quiet (nothing is released)", async () => {
    const t = approvedTrade({ status: "in_transit", inbound_tracking: "9400111899223197428490", inbound_accepted_at: iso(Date.now() - 11 * DAY), inbound_last_event_at: iso(Date.now() - 5 * DAY) });
    const counts = await runTradeWorker();
    expect(counts.tradeAlerts).toBe(2);
    expect(emailTypes().sort()).toEqual(["trade_staff_stalled", "trade_staff_transit_overdue"]);
    expect(t.status).toBe("in_transit");
  });

  it("does nothing (and doesn't fail) where the Trade Center isn't set up", async () => {
    state.tables.trade_settings = [];
    expect(await runTradeWorker()).toEqual({ tradesExpired: 0, tradeReminders: 0, tradeAlerts: 0, tradeScansChecked: 0, tradeDepositsReconciled: 0 });
  });
});

describe("local pickup trades", () => {
  /** A local pickup trade at `status` (our cards on it; nothing of theirs listed). */
  function localTrade(over: Record<string, unknown> = {}) {
    const t = tradeRow({ handoff_method: "local", estimated_value_cents: 0, ...over });
    trades().push(t);
    state.tables.trade_request_items.push(itemRow(t.id, { status: (over.status as string) === "awaiting_shipment" ? "reserved" : "requested" }));
    return t;
  }

  it("starts a local pickup trade when asked, and a shipped one otherwise", async () => {
    const local = await ann.post({ action: "start", items: [{ inventoryItemId: RING, quantity: 1 }], handoffMethod: "local" });
    expect(local.statusCode).toBe(200);
    expect(rpcArgs("trade_start")[0]).toMatchObject({ p_handoff_method: "local" });
    expect((local.body.trade as { handoffMethod: string }).handoffMethod).toBe("local");
    const shipped = await bob.post({ action: "start", items: [{ inventoryItemId: SIGNET, quantity: 1 }] });
    expect(rpcArgs("trade_start")[1]).toMatchObject({ p_handoff_method: "ship" });
    expect((shipped.body.trade as { handoffMethod: string }).handoffMethod).toBe("ship");
    const bad = await ann.post({ action: "start", items: [{ inventoryItemId: SIGNET, quantity: 1 }], handoffMethod: "drone" });
    expect(bad.statusCode).toBe(400);
  });

  it("switches a draft between shipping and local pickup", async () => {
    const t = tradeRow({ user_id: ANN });
    trades().push(t);
    rpc("trade_set_handoff", (args) => {
      find(args.p_trade_id).handoff_method = args.p_handoff_method as string;
      return { data: null, error: null };
    });
    const res = await ann.post({ action: "setHandoff", tradeId: t.id, handoffMethod: "local" });
    expect(res.statusCode).toBe(200);
    expect(rpcArgs("trade_set_handoff")).toEqual([{ p_trade_id: t.id, p_user_id: ANN, p_handoff_method: "local" }]);
    expect((await ann.post({ action: "setHandoff", tradeId: t.id, handoffMethod: "mail" })).statusCode).toBe(400);
    t.status = "pending_review";
    expect((await ann.post({ action: "setHandoff", tradeId: t.id, handoffMethod: "ship" })).statusCode).toBe(409);
  });

  it("checks a saved card list against shipping's per-card minimum when a local draft switches to shipping", async () => {
    const t = localTrade({ user_id: ANN, status: "awaiting_trade_list", min_card_value_cents: 500 });
    state.tables.trade_offer_cards.push(offerRow(t.id));
    // Like the database: the trade takes on shipping's terms ($100 a card here).
    rpc("trade_set_handoff", (args) => {
      const row = find(args.p_trade_id);
      row.handoff_method = args.p_handoff_method as string;
      row.min_card_value_cents = args.p_handoff_method === "ship" ? 10000 : 500;
      return { data: null, error: null };
    });
    expect((await ann.post({ action: "setHandoff", tradeId: t.id, handoffMethod: "ship" })).statusCode).toBe(200);
    const saved = rpcArgs("trade_save_offer")[0].p_cards as Record<string, unknown>[];
    expect(saved[0]).toMatchObject({ card_name: "Sheoldred, the Apocalypse", eligibility: "below_minimum" });

    // Switching to local pickup prices nothing: their cards are valued when we meet.
    rpcCalls = [];
    expect((await ann.post({ action: "setHandoff", tradeId: t.id, handoffMethod: "local" })).statusCode).toBe(200);
    expect(rpcArgs("trade_save_offer")).toEqual([]);
  });

  it("sends a local trade without pricing their cards, with its own emails", async () => {
    const t = localTrade({ user_id: ANN });
    const res = await ann.post({ action: "submit", tradeId: t.id, note: "Free Saturdays" });
    expect(res.statusCode).toBe(200);
    expect(rpcArgs("trade_save_offer")).toEqual([]);
    expect(rpcArgs("trade_submit")[0]).toMatchObject({ p_note: "Free Saturdays" });
    const customer = sent.find((e) => e.emailType === "trade_submitted");
    expect(customer?.text).toMatch(/local pickup/);
    expect(customer?.text).not.toMatch(/mail anything/);
    expect(sent.find((e) => e.emailType === "trade_staff_submitted")?.subject).toMatch(/local pickup trade is waiting/);
  });

  it("names the meeting spot in what the customer agrees to and in their emails, once one is saved", async () => {
    confirmStandIn();
    Object.assign(settings(), { local_meet_spot_name: "Ballwin Library", local_meet_spot_address: "1600 Clarkson Rd, Ballwin, MO" });
    const t = localTrade({ user_id: ANN, status: "awaiting_confirmation", confirm_by: iso(Date.now() + 40 * HOUR), approved_at: iso(Date.now() - HOUR) });
    const view = (await ann.get({ id: t.id })).body.trade as { confirmation: Record<string, unknown> };
    expect(view.confirmation.termsText).toContain("meet at our meeting spot: Ballwin Library, 1600 Clarkson Rd, Ballwin, MO.");
    expect((await ann.post({ action: "confirm", tradeId: t.id, acknowledged: true, termsVersion: 1 })).statusCode).toBe(200);
    const reserved = sent.find((e) => e.emailType === "trade_reserved");
    expect(reserved?.text).toContain("Ballwin Library, 1600 Clarkson Rd, Ballwin, MO");
  });

  it("saves the meeting spot, clears it when blank, and keeps it when a page leaves it out", async () => {
    const view = (await owner.get({ view: "settings" })).body.settings as Record<string, unknown>;
    expect(view).toMatchObject({ localMeetSpotName: null, localMeetSpotAddress: null });
    const save = (over: Record<string, unknown>) => owner.post({ action: "saveSettings", settings: { ...view, ...over } });
    expect((await save({ localMeetSpotName: "  Ballwin Library ", localMeetSpotAddress: "1600 Clarkson Rd, Ballwin, MO" })).statusCode).toBe(200);
    expect(settings()).toMatchObject({ local_meet_spot_name: "Ballwin Library", local_meet_spot_address: "1600 Clarkson Rd, Ballwin, MO" });
    const terms = (await as(null).get({})).body.terms as Record<string, unknown>;
    expect(terms).toMatchObject({ localMeetSpotName: "Ballwin Library", localMeetSpotAddress: "1600 Clarkson Rd, Ballwin, MO" });
    const { localMeetSpotName: _n, localMeetSpotAddress: _a, ...older } = view;
    expect((await owner.post({ action: "saveSettings", settings: older })).statusCode).toBe(200);
    expect(settings().local_meet_spot_name).toBe("Ballwin Library");
    expect((await save({ localMeetSpotName: " ", localMeetSpotAddress: "" })).statusCode).toBe(200);
    expect(settings()).toMatchObject({ local_meet_spot_name: null, local_meet_spot_address: null });
  });

  it("confirms with no deposit and the local pickup terms, holding our cards for the meetup", async () => {
    confirmStandIn();
    const t = localTrade({ user_id: ANN, status: "awaiting_confirmation", confirm_by: iso(Date.now() + 40 * HOUR), approved_at: iso(Date.now() - HOUR) });
    const view = (await ann.get({ id: t.id })).body.trade as { confirmation: Record<string, unknown> };
    expect(view.confirmation).toMatchObject({ local: true, depositCents: 0, shipDays: 7 });
    expect(view.confirmation.termsText).toMatch(/hold.*7 days/s);
    // Local terms don't depend on the deposit terms' version.
    const res = await ann.post({ action: "confirm", tradeId: t.id, acknowledged: true, termsVersion: 1 });
    expect(res.statusCode).toBe(200);
    const args = rpcArgs("trade_confirm")[0];
    expect(args).toMatchObject({ p_ship_days: 7, p_payment_intent: null });
    expect(args.p_terms_text).toMatch(/no deposit/);
    // local_meet_days (7) qualifying days from now: Sundays don't count.
    expect(Math.abs(Date.parse(args.p_ship_by as string) - addQualifyingDays(Date.now(), 7, []))).toBeLessThan(60_000);
    expect(stripeState.created).toEqual([]);
    expect(find(t.id).status).toBe("awaiting_shipment");
    expect(emailTypes()).toEqual(expect.arrayContaining(["trade_reserved", "trade_staff_reserved"]));
    expect(sent.find((e) => e.emailType === "trade_reserved")?.subject).toMatch(/Let's meet up/);
    expect((await ann.post({ action: "confirm", tradeId: t.id, acknowledged: false, termsVersion: 3 })).statusCode).toBe(409);
  });

  it("refuses tracking and proof of shipping on a local trade", async () => {
    const t = localTrade({ user_id: ANN, status: "awaiting_shipment", ship_by: iso(Date.now() + 3 * DAY) });
    const tracking = await ann.post({ action: "tracking", tradeId: t.id, carrier: "USPS", trackingNumber: "9400111899223197428490", packagingConfirmed: true });
    expect(tracking.statusCode).toBe(409);
    expect((await ann.post({ action: "proof", tradeId: t.id, note: "x" })).statusCode).toBe(409);
    expect(rpcArgs("trade_record_tracking")).toEqual([]);
  });

  it("cancels a reserved local trade without counting it against them", async () => {
    const t = localTrade({ user_id: ANN, status: "awaiting_shipment", ship_by: iso(Date.now() + 3 * DAY), reserved_at: iso(Date.now()) });
    const res = await ann.post({ action: "cancel", tradeId: t.id, reason: "Can't make it" });
    expect(res.statusCode).toBe(200);
    expect(rpcArgs("trade_close")[0]).toMatchObject({ p_status: "canceled", p_fault: null });
    expect(sent.find((e) => e.emailType === "trade_canceled")?.text).toMatch(/went back on sale/);
  });

  it("approves a local trade with no deposit and the meetup details, holding our cards until it's finished, and emails both", async () => {
    const t = localTrade({ status: "pending_review", wanted_total_cents: 40000 });
    rpc("trade_set_meetup", (args) => {
      find(args.p_trade_id).meetup_details = args.p_details as string;
      return { data: null, error: null };
    });
    rpc("trade_approve", (args) => {
      Object.assign(find(args.p_trade_id), { status: "awaiting_shipment", approved_at: iso(Date.now()), reserved_at: iso(Date.now()), confirm_by: null, ship_by: null });
      return { data: 0, error: null };
    });
    const res = await staff.post({ action: "approve", tradeId: t.id, meetupDetails: "Sat 2 PM, Ballwin library", depositOverride: "required" });
    expect(res.statusCode).toBe(200);
    expect(rpcArgs("trade_set_meetup")[0]).toMatchObject({ p_details: "Sat 2 PM, Ballwin library" });
    // Nothing for the customer to confirm: no confirmation deadline.
    expect(rpcArgs("trade_approve")[0]).toMatchObject({ p_confirm_by: null, p_deposit_cents: 0, p_deposit_reason: null });
    const email = sent.find((e) => e.emailType === "trade_approved");
    expect(email?.subject).toMatch(/our cards are held for you/);
    expect(email?.text).toMatch(/held for you until we meet/);
    expect(email?.text).not.toMatch(/confirm/i);
    expect(email?.text).toMatch(/Ballwin library/);
    expect(email?.text).toMatch(/no deposit/i);
    expect(email?.text).toMatch(/Changed your mind about any of our cards/);
    // There's no deadline to give more time on.
    expect((await staff.post({ action: "extend", tradeId: t.id, kind: "shipping", hours: 24 })).statusCode).toBe(409);
    expect((await staff.post({ action: "setDeposit", tradeId: t.id, override: "required" })).statusCode).toBe(409);
  });

  it("emails the customer when staff change the meetup on an approved trade", async () => {
    const t = localTrade({ status: "awaiting_shipment", ship_by: iso(Date.now() + 3 * DAY) });
    rpc("trade_set_meetup", (args) => {
      find(args.p_trade_id).meetup_details = args.p_details as string;
      return { data: null, error: null };
    });
    const res = await staff.post({ action: "setMeetup", tradeId: t.id, details: "Sunday noon, the cafe" });
    expect(res.statusCode).toBe(200);
    expect(sent.find((e) => e.emailType === "trade_meetup_set")?.text).toMatch(/Sunday noon, the cafe/);
    const shipped = approvedTrade();
    expect((await staff.post({ action: "setMeetup", tradeId: shipped.id, details: "x" })).statusCode).toBe(409);
  });

  it("refuses shipping steps on a local trade", async () => {
    const t = localTrade({ status: "awaiting_shipment" });
    for (const action of ["markReceived", "verifyShipment", "sendFinalOffer", "inspect", "recordPayment", "setPostage"]) {
      const res = await owner.post({ action, tradeId: t.id });
      expect(res.statusCode, action).toBe(409);
    }
  });

  it("finishes at the meetup: checks the cards and payment, sends them to the database, and emails a receipt", async () => {
    const t = localTrade({ user_id: ANN, status: "awaiting_shipment", ship_by: iso(Date.now() + 3 * DAY), wanted_total_cents: 7999 });
    rpc("trade_complete_local", (args) => {
      Object.assign(find(args.p_trade_id), {
        status: "completed",
        order_id: "order-1",
        final_value_cents: 5000,
        final_credit_cents: 4000,
        credit_issued_cents: 4000,
        local_paid_cents: args.p_paid_cents,
        local_payment_method: args.p_payment_method ?? "none",
        met_at: iso(Date.now()),
      });
      return { data: "order-1", error: null };
    });
    const card = {
      scryfallId: SHEOLDRED,
      cardName: "Sheoldred, the Apocalypse",
      setCode: "dmu",
      setName: "Dominaria United",
      collectorNumber: "107",
      finish: "nonfoil",
      imageUrl: "https://cards.scryfall.io/normal/front/x.jpg",
      condition: "LP",
      quantity: 1,
      unitCents: 5000,
      referencePriceCents: 6000,
      note: null,
    };
    // Like recording a payment by hand: the owner's call.
    expect((await staff.post({ action: "completeLocal", tradeId: t.id, cards: [card], paidCents: 3999, paymentMethod: "cash" })).statusCode).toBe(403);
    expect((await owner.post({ action: "completeLocal", tradeId: t.id, cards: [{ ...card, condition: "Mint" }], paidCents: 3999, paymentMethod: "cash" })).statusCode).toBe(400);
    expect((await owner.post({ action: "completeLocal", tradeId: t.id, cards: [{ ...card, finish: "chrome" }], paidCents: 3999, paymentMethod: "cash" })).statusCode).toBe(400);
    expect((await owner.post({ action: "completeLocal", tradeId: t.id, cards: [card], paidCents: 3999 })).statusCode).toBe(400);
    expect(rpcArgs("trade_complete_local")).toEqual([]);

    const res = await owner.post({ action: "completeLocal", tradeId: t.id, cards: [card], paidCents: 3999, paymentMethod: "cash", paymentNote: "at the cafe" });
    expect(res.statusCode).toBe(200);
    const args = rpcArgs("trade_complete_local")[0];
    expect(args).toMatchObject({ p_paid_cents: 3999, p_payment_method: "cash", p_payment_note: "at the cafe", p_cash_for_excess: false });
    expect(args.p_cards).toEqual([
      {
        scryfall_id: SHEOLDRED,
        card_name: "Sheoldred, the Apocalypse",
        set_code: "dmu",
        set_name: "Dominaria United",
        collector_number: "107",
        finish: "nonfoil",
        image_url: "https://cards.scryfall.io/normal/front/x.jpg",
        condition: "LP",
        quantity: 1,
        unit_cents: 5000,
        reference_price_cents: 6000,
        note: null,
      },
    ]);
    const receipt = sent.find((e) => e.emailType === "trade_completed");
    expect(receipt?.text).toMatch(/Paid when we met \(cash\)/);
    expect(res.body.customerEmail).toMatchObject({ status: "sent" });
    expect((state.tables.admin_audit_log as { action: string }[]).map((a) => a.action)).toContain("trade.complete_local");
  });

  it("never reminds a local customer of a hold ending, and tells them when staff stop holding our cards", async () => {
    // A local trade confirmed under the old flow still has a meetup deadline stored: it's ignored.
    const soon = localTrade({ user_id: ANN, status: "awaiting_shipment", ship_by: iso(Date.now() + 3 * HOUR), meetup_details: "Sat 2 PM, the library" });
    await runTradeWorker();
    expect(sent.find((e) => e.emailType === "trade_reminder_ship_by")).toBeUndefined();
    expect(soon.status).toBe("awaiting_shipment");

    // Staff release it early: the customer hears that we've stopped holding our cards.
    rpc("trade_close", (args) => {
      Object.assign(find(args.p_trade_id), { status: "expired", closed_at: iso(Date.now()), customer_fault: args.p_fault ?? null });
      return { data: [{ closed: true, deposit_after: "not_required" }], error: null };
    });
    const res = await staff.post({ action: "expireNow", tradeId: soon.id, reason: "They stopped answering", countAgainst: false });
    expect(res.statusCode).toBe(200);
    const released = sent.find((e) => e.emailType === "trade_reservation_expired");
    expect(released?.subject).toMatch(/we've stopped holding our cards/);
    expect(released?.text).toMatch(/doesn't count against you/);
    expect(released?.text).not.toMatch(/proof of shipping/i);
  });

  it("reinstates a released local trade by holding our cards again, with no deadline", async () => {
    const t = localTrade({ user_id: ANN, status: "expired", expired_stage: "shipping", closed_at: iso(Date.now()) });
    rpc("trade_reinstate", (args) => {
      Object.assign(find(args.p_trade_id), { status: "awaiting_shipment", ship_by: args.p_ship_by });
      return { data: [{ result: "reinstated", short_lines: null }], error: null };
    });
    const res = await staff.post({ action: "reinstate", tradeId: t.id, mode: "awaiting_shipment", clearFault: true });
    expect(res.statusCode).toBe(200);
    expect(rpcArgs("trade_reinstate")[0]).toMatchObject({ p_mode: "awaiting_shipment", p_ship_by: null });
    expect(find(t.id).ship_by).toBeNull();
  });

  it("lists local pickup trades on their own", async () => {
    localTrade({ status: "pending_review" });
    approvedTrade();
    const res = await staff.get({ view: "list", filter: "local" });
    expect((res.body.trades as unknown[]).length).toBe(1);
    expect((res.body.counts as Record<string, number>).local).toBe(1);
  });

  it("keeps local pickup settings when an older page leaves them out, and saves them when sent", async () => {
    const before = settings();
    const { local_pickup_enabled: _e, local_pickup_area: _a, local_meet_days: _d, local_pickup_details: _p, ...rest } = before;
    void rest;
    const res = await owner.get({ view: "settings" });
    const view = res.body.settings as Record<string, unknown>;
    expect(view).toMatchObject({ localPickupEnabled: true, localMeetDays: 7, localPickupArea: "the St. Louis area" });
    const { localPickupEnabled: _x, localPickupArea: _y, localMeetDays: _z, localPickupDetails: _w, updatedAt: _u, ...older } = view;
    expect((await owner.post({ action: "saveSettings", settings: older })).statusCode).toBe(200);
    expect(settings()).toMatchObject({ local_pickup_enabled: true, local_meet_days: 7 });
    const saved = await owner.post({ action: "saveSettings", settings: { ...view, localPickupEnabled: false, localMeetDays: 5, localPickupArea: " Ballwin " } });
    expect(saved.statusCode).toBe(200);
    expect(settings()).toMatchObject({ local_pickup_enabled: false, local_meet_days: 5, local_pickup_area: "Ballwin" });
    expect((await owner.post({ action: "saveSettings", settings: { ...view, localMeetDays: 31 } })).statusCode).toBe(400);
  });

  it("saves local pickup's own terms apart from shipping's, and keeps them when a page leaves them out", async () => {
    const view = (await owner.get({ view: "settings" })).body.settings as Record<string, unknown>;
    expect(view).toMatchObject({ localCreditRatePercent: 80, localMinCardValueCents: 1500, localMinTradeValueCents: 0, localCashPayoutEnabled: false, localCashRatePercent: 50 });
    const res = await owner.post({
      action: "saveSettings",
      settings: { ...view, localCreditRatePercent: 90, localMinCardValueCents: 500, localMinTradeValueCents: 4000, localCashPayoutEnabled: true, localCashRatePercent: 60 },
    });
    expect(res.statusCode).toBe(200);
    expect(settings()).toMatchObject({
      credit_rate_percent: 80,
      min_card_value_cents: 1500,
      min_trade_value_cents: 0,
      cash_payout_enabled: false,
      local_credit_rate_percent: 90,
      local_min_card_value_cents: 500,
      local_min_trade_value_cents: 4000,
      local_cash_payout_enabled: true,
      local_cash_rate_percent: 60,
    });
    // The storefront sees local pickup's terms, never the cash rate.
    const terms = (await as(null).get({})).body.terms as Record<string, unknown>;
    expect(terms).toMatchObject({ creditRatePercent: 80, localCreditRatePercent: 90, localMinCardValueCents: 500, localMinTradeValueCents: 4000, localCashPayoutEnabled: true });
    expect(terms).not.toHaveProperty("localCashRatePercent");

    // A page from before these settings keeps them as saved.
    const { localCreditRatePercent: _a, localMinCardValueCents: _b, localMinTradeValueCents: _c, localCashPayoutEnabled: _d, localCashRatePercent: _e, ...older } = (
      await owner.get({ view: "settings" })
    ).body.settings as Record<string, unknown>;
    expect((await owner.post({ action: "saveSettings", settings: older })).statusCode).toBe(200);
    expect(settings()).toMatchObject({ local_credit_rate_percent: 90, local_min_trade_value_cents: 4000, local_cash_payout_enabled: true });

    // Out of range, or a largest trade under the local minimum, is refused.
    expect((await owner.post({ action: "saveSettings", settings: { ...view, localCreditRatePercent: 0 } })).statusCode).toBe(400);
    expect((await owner.post({ action: "saveSettings", settings: { ...view, localMinTradeValueCents: 5000, maxTradeValueCents: 4000 } })).statusCode).toBe(400);
  });
});
