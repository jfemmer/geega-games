import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { STANDINS, UPSERT } from "./helpers/tradeDbStandins";

// The Trade Center's database (supabase/migrations/20261025200000_trade_center.sql)
// run in PGlite, a real Postgres in WebAssembly, on top of stand-ins for the
// tables and functions it builds on (production's definitions, trimmed to
// what it touches). This is where reservations, deadlines, the deposit's
// states, carrier scans, totals and finishing a trade are tested for real;
// tests/tradeCenterApi.test.ts covers the endpoints around them. The sections
// run in order and build on each other, like the trades they follow.

const MIGRATION = readFileSync(new URL("../supabase/migrations/20261025200000_trade_center.sql", import.meta.url), "utf8");
// Follow-ups that ran on production after it, in order.
const FOLLOW_UPS = [
  readFileSync(new URL("../supabase/migrations/20261026233000_trade_function_search_path.sql", import.meta.url), "utf8"),
  // Local pickup: every shipped-trade test here runs with it in place.
  readFileSync(new URL("../supabase/migrations/20261027230000_trade_local_pickup.sql", import.meta.url), "utf8"),
  readFileSync(new URL("../supabase/migrations/20261028010000_trade_local_terms.sql", import.meta.url), "utf8"),
  readFileSync(new URL("../supabase/migrations/20261028030000_trade_meet_spot.sql", import.meta.url), "utf8"),
];

/** A row: whatever the query selected. */
// oxlint-disable-next-line typescript/no-explicit-any
type Row = Record<string, any>;

let db: PGlite;
const check = (cond: unknown, label: string) => expect.soft(Boolean(cond), label).toBe(true);
async function expectError(statement: string, label: string, code?: string, params?: unknown[]) {
  let error: { code?: string; message?: string } | null = null;
  try {
    await db.query(statement, params);
  } catch (e) {
    error = e as { code?: string; message?: string };
  }
  expect.soft(error, `${label}: it went through`).not.toBeNull();
  if (error && code) expect.soft(error.code, `${label} (${error.message?.split("\n")[0]})`).toBe(code);
}
const one = async (q: string, params?: unknown[]): Promise<Row> => (await db.query<Row>(q, params)).rows[0];
const all = async (q: string, params?: unknown[]): Promise<Row[]> => (await db.query<Row>(q, params)).rows;
const asRole = (role: string) => db.exec(`set test.role = '${role}'`);
const iso = (ms: number) => new Date(ms).toISOString();
const HOUR = 3600000;
const DAY = 24 * HOUR;

const users = {
  ann: "11111111-1111-4111-8111-111111111111",
  bob: "22222222-2222-4222-8222-222222222222",
  cat: "33333333-3333-4333-8333-333333333334",
  dan: "44444444-4444-4444-8444-444444444445",
  eve: "55555555-5555-4555-8555-555555555556",
  fay: "66666666-6666-4666-8666-666666666667",
  gus: "77777777-7777-4777-8777-777777777778",
};
const inv = async (name: string, qty: number, price: number, extra = ""): Promise<string> =>
  (
    await one(`insert into public.inventory_items (card_name, set_code, collector_number, condition, finish, quantity, price_cents${extra ? "," + extra.split("|")[0] : ""})
     values ('${name}', 'cmr', '1', 'NM', 'nonfoil', ${qty}, ${price}${extra ? "," + extra.split("|")[1] : ""}) returning id`)
  ).id;
const items = (...pairs: [string, number][]) => JSON.stringify(pairs.map(([id, q]) => ({ inventory_item_id: id, quantity: q })));
const free = async (invId: string): Promise<number> => (await one(`select public.trade_available($1, null) as n`, [invId])).n;
const tradeRow = (id: string) => one(`select * from public.trade_requests where id = $1`, [id]);
const holds = async (tradeId: string): Promise<number> =>
  (await one(`select coalesce(sum(quantity), 0)::int as q from public.inventory_reservations where trade_request_id = $1 and status = 'active'`, [tradeId])).q;

const card = (over: Row = {}) => ({
  scryfall_id: "66666666-6666-4666-8666-666666666666", card_name: "Sheoldred, the Apocalypse", set_code: "dmu",
  set_name: "Dominaria United", collector_number: "107", finish: "nonfoil", image_url: null, quantity: 1,
  reported_condition: "NM", customer_estimate_cents: null, customer_note: null, reference_price_cents: 8000,
  reference_checked_at: new Date().toISOString(), condition_percent: 100, estimated_unit_cents: 8000,
  eligibility: "eligible", stock_on_hand: 0, ...over,
});

// A trade sent, reviewed and approved: the usual way to get one to confirm.
async function approvedTrade(user: string, pairs: [string, number][], { deposit = 0, confirmBy = Date.now() + 2 * DAY } = {}): Promise<string> {
  const id = (await one(`select public.trade_start($1, $2::jsonb, 'Name', $3) as id`, [user, items(...pairs), `${user}@x.com`])).id;
  await one(`select public.trade_save_offer($1, $2, $3::jsonb) as v`, [id, user, JSON.stringify([card()])]);
  await db.query(`select public.trade_submit($1, $2, null)`, [id, user]);
  const c = await one(`select id from public.trade_offer_cards where trade_request_id = $1`, [id]);
  await db.query(`select public.trade_review_cards($1, $2::jsonb, null, 'jacob')`, [id, JSON.stringify([{ id: c.id, review_status: "approved", approved_quantity: 1, approved_unit_cents: 7000 }])]);
  await db.query(`select public.trade_approve($1, $2::timestamptz, $3, $4, null, null, 'jacob')`, [id, iso(confirmBy), deposit, deposit > 0 ? "threshold" : null]);
  return id;
}
const confirm = (id: string, user: string, { pi = null as string | null, shipBy = Date.now() + 3 * DAY } = {}) =>
  one(`select * from public.trade_confirm($1, $2, 1, 'The terms', 3, $3::timestamptz, $4, '203.0.113.9', 'test agent')`, [id, user, iso(shipBy), pi]);
const reserve = (id: string, pi: string, cents: number, shipBy = Date.now() + 3 * DAY) =>
  one(`select * from public.trade_reserve($1, $2, $3, 3, $4::timestamptz)`, [id, pi, cents, iso(shipBy)]);
const close = (id: string, status: string, from: string[], fault: string | null = null, actor = "customer") =>
  one(`select * from public.trade_close($1, $2, $3::text[], 'why', $4, $5, null, 'x')`, [id, status, from, fault, actor]);
const depositTo = (id: string, to: string, refundId: string | null = null, failure: string | null = null, actor = "system") =>
  one(`select public.trade_deposit_update($1, $2, $3, $4, null, $5, null, 'x') as changed`, [id, to, refundId, failure, actor]);
const expire = (grace = 24, auto = true) => all(`select * from public.trade_expire_due(50, $1, $2)`, [grace, auto]);

// Trades and cards the sections share, in the order they appear.
let ring: string, signet: string, guard: string, t1: string, cat1: string, t3: string, t4: string, t6: string;
let tC: string, eve2: string, tE: string, tX: string, tV: string, many: string, tF: string;

describe("the Trade Center database", { timeout: 60_000 }, () => {
  it("refuses to run over the earlier draft, before changing anything", async () => {
    const old = new PGlite();
    try {
      await old.exec(STANDINS);
      await old.exec(`create table public.trade_requests (id uuid primary key, status text)`);
      await expect(old.exec(MIGRATION)).rejects.toThrow(/earlier draft/);
    } finally {
      await old.close();
    }
  });

  beforeAll(async () => {
    db = new PGlite();
    await db.exec(STANDINS);
    await db.exec(UPSERT);
    await db.exec(`insert into public.inventory_items (id, card_name, set_code, collector_number, condition, finish, quantity, price_cents)
      values ('99999999-9999-4999-8999-999999999999', 'Sol Ring', 'cmr', '472', 'NM', 'nonfoil', 5, 150)`);
    await db.exec(`insert into public.inventory_reservations (inventory_item_id, customer_id, quantity) values ('99999999-9999-4999-8999-999999999999', gen_random_uuid(), 1)`);
    await db.exec(`insert into public.inventory_reservations (inventory_item_id, pickup_request_id, quantity) values ('99999999-9999-4999-8999-999999999999', gen_random_uuid(), 1)`);
  }, 60_000);

  afterAll(async () => {
    await db?.close();
  });

  it("runs, and running it again changes nothing", async () => {
    await db.exec(MIGRATION);
    await db.exec(MIGRATION);
    for (const sql of FOLLOW_UPS) {
      await db.exec(sql);
      await db.exec(sql);
    }
    await db.exec(`insert into auth.users (id, email) values ${Object.entries(users).map(([n, id]) => `('${id}', '${n}@example.com')`).join(", ")}`);
  });

  it("keeps existing holds; one settings row with the defaults", async () => {
    check((await one(`select count(*)::int as n from public.inventory_reservations where trade_request_id is null`)).n === 2, "a customer's and a pickup's holds are still there");
    await expectError(`insert into public.inventory_reservations (inventory_item_id, quantity) values ('99999999-9999-4999-8999-999999999999', 1)`, "a hold with no holder is still refused", "23514");
    const s0 = await one("select * from public.trade_settings");
    check(s0.enabled === false && s0.credit_rate_percent === 80 && s0.min_card_value_cents === 1500, "one row: off, 80%, $15 minimum");
    check(s0.min_trade_value_cents === 7500, "trades start at $75 of our cards");
    check(s0.ship_fee_cents === 399 && s0.free_ship_threshold_cents === 20000 && s0.free_ship_fee_cents === 0 && s0.ship_cost_estimate_cents === 600,
      "shipping our cards: $3.99, free from $200; $6 is what a shipment costs us");
    check(s0.confirmation_hours === 48 && s0.ship_days_new === 3 && s0.ship_days_tier1 === 4 && s0.ship_days_tier2 === 5, "48 hours to confirm; 3, 4 or 5 days to ship");
    check(s0.loyalty_tier1_trades === 3 && s0.loyalty_tier2_trades === 10, "more time after 3 and 10 completed trades");
    check(s0.deposits_enabled && s0.deposit_threshold_cents === 30000 && s0.deposit_band1_cents === 500 && s0.deposit_band2_cents === 1000
       && s0.deposit_band3_cents === 2000 && s0.deposit_band4_cents === 3000, "deposits from $300: $5 / $10 / $20 / $30 bands");
    check(s0.deposit_band1_max_cents === 10000 && s0.deposit_band2_max_cents === 30000 && s0.deposit_band3_max_cents === 60000, "bands break at $100, $300 and $600");
    check(s0.allow_forfeiture === false, "keeping a deposit is off until the owner turns it on");
    check(s0.excluded_dates.length === 0 && s0.scan_grace_hours === 24, "no extra excluded days; a day's grace for a carrier scan");
    check(/refunded in full/.test(s0.deposit_terms) && /Sundays do not count/.test(s0.deposit_terms) && s0.deposit_terms_version === 1, "the deposit terms customers agree to");
    await expectError(`update public.trade_settings set deposit_band2_max_cents = 5000`, "deposit bands must go up", "23514");
    await expectError(`update public.trade_settings set free_ship_fee_cents = 500`, "shipping from the threshold up can't cost more than below it", "23514");
    await expectError(`update public.trade_settings set ship_fee_cents = -1`, "no negative shipping fee", "23514");
    const bucket = await one(`select public, file_size_limit, allowed_mime_types from storage.buckets where id = 'trade-dispute-files'`);
    check(bucket && bucket.public === false && bucket.allowed_mime_types.includes("application/pdf"), "a private bucket for proof of shipping");
  });

  it("only the server can call it; nothing starts while trading is off or paused", async () => {
    await asRole("authenticated");
    ring = await inv("The One Ring", 1, 7999);
    await expectError(`select public.trade_start('${users.ann}', '${items([ring, 1])}', 'Ann', 'ann@example.com')`, "a signed-in customer can't call trade_start directly", "42501");
    await expectError(`select public.trade_customer_stats('${users.ann}', 365)`, "or read anyone's record", "42501");
    await asRole("service_role");
    await expectError(`select public.trade_start('${users.ann}', '${items([ring, 1])}', 'Ann', 'ann@example.com')`, "nothing starts while trading is off", "GT001");
    await db.exec("update public.trade_settings set enabled = true, paused = true, pause_message = 'Back Monday.'");
    await expectError(`select public.trade_start('${users.ann}', '${items([ring, 1])}', 'Ann', 'ann@example.com')`, "or while it's paused, with its message", "GT001");
    await db.exec("update public.trade_settings set paused = false");
    // The trades below use cheap cards; the $75 minimum has its own section.
    await db.exec("update public.trade_settings set min_trade_value_cents = 0");
  });

  it("asking for cards holds nothing", async () => {
    signet = await inv("Arcane Signet", 3, 125);
    guard = await inv("Fierce Guardianship", 2, 2728, "original_price_cents, is_deal|3410, true");
    t1 = (await one(`select public.trade_start('${users.ann}', '${items([guard, 1], [signet, 2])}', 'Ann Lee', 'ann@example.com') as id`)).id;
    const tr1 = await tradeRow(t1);
    check(tr1.trade_number === 1001 && tr1.status === "awaiting_trade_list", "TR-1001, a draft");
    check(tr1.wanted_total_cents === 3410 + 250, "our cards at their regular price: the deal's price before the discount");
    check(Math.abs((new Date(tr1.list_due_at) - new Date(tr1.created_at)) / DAY - 14) < 0.01, "a draft lapses after 14 days");
    check((await holds(t1)) === 0, "nothing is reserved");
    check((await free(signet)) === 3 && (await free(guard)) === 2, "all 3 Signets and both Guardianships are still for sale");
    const lines1 = await all(`select status, reservation_id from public.trade_request_items where trade_request_id = $1`, [t1]);
    check(lines1.length === 2 && lines1.every((l) => l.status === "requested" && l.reservation_id === null), "the cards are requested, not held");
    await expectError(`select public.trade_start('${users.bob}', '${items([signet, 4])}', 'Bob', 'bob@example.com')`, "nobody can ask for more than we have", "GT004");
    const t2 = (await one(`select public.trade_start('${users.bob}', '${items([signet, 3])}', 'Bob', 'bob@example.com') as id`)).id;
    check(!!t2, "Bob can ask for all 3 Signets even though Ann asked for 2: nothing is reserved yet");
  });

  it("applies the limits on open trades and trade value", async () => {
    await db.exec("update public.trade_settings set max_active_trades = 1");
    await expectError(`select public.trade_start('${users.ann}', '${items([ring, 1])}', 'Ann', 'ann@example.com')`, "one open trade at a time when the limit is 1", "GT002");
    await db.exec("update public.trade_settings set max_active_trades = 5, max_trade_value_cents = 1000");
    await expectError(`select public.trade_start('${users.ann}', '${items([guard, 1])}', 'Ann', 'ann@example.com')`, "a trade over the maximum value is refused", "GT006");
    await db.exec("update public.trade_settings set max_trade_value_cents = null");
  });

  it("changing our cards on a draft; a lapsed draft closes, not counted against anyone", async () => {
    const total2 = (await one(`select public.trade_set_wanted('${t1}', '${items([guard, 2])}', array['awaiting_trade_list'], 'customer', '${users.ann}', 'ann') as t`)).t;
    check(total2 === 6820, "two Guardianships at $34.10; the Signets came off");
    check((await all(`select 1 from public.trade_request_items where trade_request_id = $1 and inventory_item_id = $2`, [t1, signet])).length === 0, "a card taken off a draft is simply gone");
    await db.exec(`update public.inventory_items set price_cents = 2000, original_price_cents = 4000 where id = '${guard}'`);
    check((await one(`select public.trade_set_wanted('${t1}', '${items([guard, 1])}', array['awaiting_trade_list'], 'customer', '${users.ann}', 'ann') as t`)).t === 3410, "a card already on the trade keeps the price it had");
    await expectError(`select public.trade_set_wanted('${t1}', '[]', array['awaiting_trade_list'], 'customer', '${users.ann}', 'ann')`, "a trade can't be emptied (cancel instead)", "GT010");
    await db.exec(`update public.trade_requests set list_due_at = now() - interval '1 minute' where id = '${t1}'`);
    await expectError(`select public.trade_set_wanted('${t1}', '${items([guard, 1])}', array['awaiting_trade_list'], 'customer', '${users.ann}', 'ann')`, "not once the draft has lapsed", "GT012");
    const lapsed = await expire();
    check(lapsed.some((r) => r.expired_trade_id === t1 && r.expired_stage === "draft"), "the worker closes the lapsed draft");
    check((await tradeRow(t1)).status === "offer_expired" && (await tradeRow(t1)).customer_fault === null, "as offer_expired, with nothing counted against Ann");
  });

  it("review and approval reserve nothing", async () => {
    await db.exec(`update public.trade_settings set ship_to_name = 'Geega Games', ship_to_line1 = '1 Test St', ship_to_city = 'Ballwin', ship_to_state = 'MO', ship_to_postal_code = '63011'`);
    cat1 = await inv("Mana Crypt", 2, 15000);
    t3 = (await one(`select public.trade_start('${users.cat}', '${items([cat1, 2])}', 'Cat', 'cat@example.com') as id`)).id;
    await one(`select public.trade_save_offer($1, $2, $3::jsonb) as v`, [t3, users.cat, JSON.stringify([card()])]);
    await db.query(`select public.trade_submit($1, $2, 'Pack carefully')`, [t3, users.cat]);
    const t3a = await tradeRow(t3);
    check(t3a.status === "pending_review" && t3a.list_due_at === null && (await holds(t3)) === 0, "sent for review: no deadline, still nothing held");
    const c3 = (await one(`select id from public.trade_offer_cards where trade_request_id = $1`, [t3])).id;
    await db.query(`select public.trade_review_cards($1, $2::jsonb, null, 'jacob')`, [t3, JSON.stringify([{ id: c3, review_status: "approved", approved_quantity: 1, approved_unit_cents: 7000 }])]);
    await expectError(`select public.trade_approve('${t3}', now() - interval '1 hour', 0, null, null, null, 'jacob')`, "a confirmation deadline in the past is refused", "GT010");
    await expectError(`select public.trade_approve('${t3}', now() + interval '2 days', 25, 'threshold', null, null, 'jacob')`, "a deposit under 50 cents is refused", "GT010");
    await expectError(`select public.trade_approve('${t3}', now() + interval '2 days', 3000, null, null, null, 'jacob')`, "a deposit needs a reason", "GT010");
    // Someone checks out one Mana Crypt meanwhile: only 1 is left.
    await db.exec(`insert into public.inventory_reservations (inventory_item_id, customer_id, quantity) values ('${cat1}', gen_random_uuid(), 1)`);
    await expectError(`select public.trade_approve('${t3}', now() + interval '2 days', 3000, 'threshold', null, null, 'jacob')`, "approving is refused once a card isn't available in that quantity", "GT004");
    await db.exec(`update public.inventory_reservations set status = 'released' where inventory_item_id = '${cat1}' and customer_id is not null`);
    const confirmBy3 = Date.now() + 2 * DAY;
    const approvedValue = (await one(`select public.trade_approve($1, $2::timestamptz, 3000, 'threshold', 'Near mint only', null, 'jacob') as v`, [t3, iso(confirmBy3)])).v;
    const t3b = await tradeRow(t3);
    check(approvedValue === 7000 && t3b.status === "awaiting_confirmation", "approved: waiting for the customer to confirm");
    check(Math.abs(new Date(t3b.confirm_by) - confirmBy3) < 1000 && t3b.confirm_by_original !== null, "the confirmation deadline the server worked out is kept");
    check(t3b.deposit_cents === 3000 && t3b.deposit_status === "payment_pending" && t3b.deposit_reason === "threshold", "a $30 deposit is due on $300 of cards");
    check((await holds(t3)) === 0 && (await free(cat1)) === 2, "approving reserves nothing: both Mana Crypts are still for sale");
  });

  it("a card that sells before the customer confirms sends the trade back to them", async () => {
    await db.exec(`insert into public.inventory_reservations (inventory_item_id, customer_id, quantity) values ('${cat1}', gen_random_uuid(), 1)`);
    const shortNow = (await one(`select public.trade_short_lines($1) as s`, [t3])).s;
    check(shortNow.length === 1 && shortNow[0].wanted === 2 && shortNow[0].available === 1, "the trade knows 1 of the 2 is left");
    const marked = (await one(`select public.trade_mark_unavailable($1) as s`, [t3])).s;
    const t3c = await tradeRow(t3);
    check(marked && t3c.status === "revision_requested" && t3c.list_due_at, "it goes back to the customer to update their selection");
    check(t3c.deposit_status === "not_required" && t3c.deposit_payment_intent === null, "and no deposit is due (nothing was charged)");
    const sysMsg = await one(`select author_type, body from public.trade_messages where trade_request_id = $1 order by created_at desc limit 1`, [t3]);
    check(sysMsg.author_type === "system" && /1 left of the 2 you picked/.test(sysMsg.body), "with a message saying which card and how many are left");
    check((await one(`select public.trade_mark_unavailable($1) as s`, [t3])).s === null, "marking it again changes nothing");
  });

  it("confirming with no deposit reserves at once and keeps what was agreed", async () => {
    const dan1 = await inv("Rhystic Study", 3, 4000);
    t4 = await approvedTrade(users.dan, [[dan1, 2]]);
    await expectError(`select * from public.trade_confirm('${t4}', '${users.ann}', 1, 'The terms', 3, now() + interval '3 days', null, null, null)`, "only Dan can confirm his trade", "GT404");
    await expectError(`select * from public.trade_confirm('${t4}', '${users.dan}', 1, '  ', 3, now() + interval '3 days', null, null, null)`, "agreeing to the terms is required", "GT010");
    const shipBy4 = Date.now() + 3 * DAY;
    const c4 = await confirm(t4, users.dan, { shipBy: shipBy4 });
    const t4a = await tradeRow(t4);
    check(c4.result === "reserved" && t4a.status === "awaiting_shipment", "confirmed and reserved");
    check(Math.abs(new Date(t4a.ship_by) - shipBy4) < 1000 && t4a.ship_days === 3 && t4a.reserved_at && t4a.confirmed_at, "the shipping deadline starts now: 3 qualifying days");
    check((await holds(t4)) === 2 && (await free(dan1)) === 1, "both copies are held: only 1 Rhystic Study is left for sale");
    const consent = await one(`select terms_version, terms_text, deposit_cents, ship_days, ip, user_agent from public.trade_consents where trade_request_id = $1`, [t4]);
    check(consent.terms_text === "The terms" && consent.deposit_cents === 0 && consent.ship_days === 3 && consent.ip === "203.0.113.9", "what Dan agreed to is kept");
    await expectError(`select * from public.trade_confirm('${t4}', '${users.dan}', 1, 'The terms', 3, now() + interval '3 days', null, null, null)`, "confirming twice is refused", "GT009");
    const resLog = await one(`select detail from public.trade_events where trade_request_id = $1 and event = 'reserved'`, [t4]);
    check(resLog && resLog.detail.lines.length === 1 && resLog.detail.lines[0].quantity === 2, "the reservation is in the trade's history, line by line");
  });

  it("confirming at the deadline counts; a second later it's refused and the approval closes", async () => {
    const eve1 = await inv("Smothering Tithe", 2, 3000);
    const t5 = await approvedTrade(users.eve, [[eve1, 1]]);
    await db.exec("begin");
    await db.exec(`update public.trade_requests set confirm_by = now() where id = '${t5}'`);
    const atDeadline = await one(`select * from public.trade_confirm('${t5}', '${users.eve}', 1, 'The terms', 3, now() + interval '3 days', null, null, null)`);
    await db.exec("rollback");
    check(atDeadline.result === "reserved", "confirming at the deadline itself still counts");
    await db.exec(`update public.trade_requests set confirm_by = now() - interval '1 second' where id = '${t5}'`);
    await expectError(`select * from public.trade_confirm('${t5}', '${users.eve}', 1, 'The terms', 3, now() + interval '3 days', null, null, null)`, "a second after, it's refused", "GT012");
    const expiredOffers = await expire();
    check(expiredOffers.some((r) => r.expired_trade_id === t5 && r.expired_stage === "confirmation"), "the worker closes the unconfirmed approval");
    check((await tradeRow(t5)).status === "offer_expired" && (await tradeRow(t5)).customer_fault === null, "as offer_expired, not counted against Eve");
  });

  it("with a deposit, nothing is held until it's paid (a short or stray payment is refunded)", async () => {
    const fay1 = await inv("Jeweled Lotus", 1, 32000);
    t6 = await approvedTrade(users.fay, [[fay1, 1]], { deposit: 2000 });
    await expectError(`select * from public.trade_confirm('${t6}', '${users.fay}', 1, 'The terms', 3, now() + interval '3 days', null, null, null)`, "confirming a trade with a deposit needs its payment", "GT010");
    const c6 = await confirm(t6, users.fay, { pi: "pi_fay_1" });
    const t6a = await tradeRow(t6);
    check(c6.result === "awaiting_deposit" && t6a.status === "awaiting_deposit" && t6a.deposit_payment_intent === "pi_fay_1", "waiting for the deposit payment");
    check((await holds(t6)) === 0 && (await free(fay1)) === 1, "the Lotus is still for sale until the deposit is paid");
    check((await reserve(t6, "pi_someone_else", 2000)).result === "other_payment", "a payment that isn't this trade's deposit isn't used for it");
    check((await reserve(t6, "pi_fay_1", 1500)).result === "refund", "a short payment reserves nothing and is refunded");
    check((await tradeRow(t6)).deposit_status === "refund_pending" && (await holds(t6)) === 0, "(the refund is due; nothing held)");
    // Start again properly.
    await db.exec(`update public.trade_requests set deposit_status = 'payment_pending', deposit_paid_at = null, deposit_paid_cents = null, deposit_refund_requested_at = null where id = '${t6}'`);
    const r6 = await reserve(t6, "pi_fay_1", 2000);
    const t6b = await tradeRow(t6);
    check(r6.result === "reserved" && t6b.status === "awaiting_shipment" && t6b.deposit_status === "paid" && t6b.deposit_paid_cents === 2000, "paid: the Lotus is reserved and the deposit is held");
    check((await holds(t6)) === 1 && (await free(fay1)) === 0, "the Lotus can't be bought by anyone else now");
    check((await reserve(t6, "pi_fay_1", 2000)).result === "already", "the webhook arriving too changes nothing");
    check((await one(`select count(*)::int as n from public.inventory_reservations where trade_request_id = $1`, [t6])).n === 1, "and never holds it twice");
  });

  it("two customers paying for the last copy: one reservation, the other refunded", async () => {
    const gus1 = await inv("Mox Opal", 1, 9000);
    const tA = await approvedTrade(users.gus, [[gus1, 1]], { deposit: 500 });
    const tB = await approvedTrade(users.bob, [[gus1, 1]], { deposit: 500 });
    await confirm(tA, users.gus, { pi: "pi_a" });
    await confirm(tB, users.bob, { pi: "pi_b" });
    check((await reserve(tA, "pi_a", 500)).result === "reserved", "the first payment reserves the Mox");
    const rB = await reserve(tB, "pi_b", 500);
    const tBr = await tradeRow(tB);
    check(rB.result === "conflict" && rB.short_lines[0].available === 0, "the second can't: nothing is held for it");
    check(tBr.status === "revision_requested" && tBr.deposit_status === "refund_pending" && tBr.deposit_paid_cents === 500, "its deposit is to be refunded and the trade goes back to the customer");
    check((await holds(tB)) === 0 && (await holds(tA)) === 1, "only one reservation exists for the one copy");
    const conflictMsg = await one(`select body from public.trade_messages where trade_request_id = $1 order by created_at desc limit 1`, [tB]);
    check(/refunded in full/.test(conflictMsg.body), "Bob is told his deposit is being refunded in full");
    await expectError(`select public.trade_approve('${tB}', now() + interval '2 days', 0, null, null, null, 'jacob')`, "it can't be approved again until that refund is settled", "GT009");
  });

  it("a deposit paid after the trade closed is refunded, nothing reserved", async () => {
    const late1 = await inv("Dockside Extortionist", 1, 5000);
    const tL = await approvedTrade(users.cat, [[late1, 1]], { deposit: 500 });
    await confirm(tL, users.cat, { pi: "pi_late" });
    await db.exec(`select * from public.trade_close('${tL}', 'canceled', array['awaiting_deposit'], 'x', null, 'customer', null, 'cat')`);
    check((await tradeRow(tL)).deposit_status === "canceled", "canceling before paying: the deposit was never collected");
    const rL = await reserve(tL, "pi_late", 500);
    check(rL.result === "refund" && (await tradeRow(tL)).deposit_status === "refund_pending" && (await holds(tL)) === 0, "the payment that arrives anyway is refunded, and nothing is reserved");
  });

  it("tracking numbers: checked, and shipped only once the carrier scans it", async () => {
    await expectError(`select public.trade_record_tracking('${t4}', 'DHL', '9400111202555842355555', true, null, 'customer', null, 'dan')`, "an unknown carrier is refused", "GT010");
    await expectError(`select public.trade_record_tracking('${t4}', 'USPS', 'abc', true, null, 'customer', null, 'dan')`, "so is a malformed number", "GT010");
    await expectError(`select public.trade_record_tracking('${t4}', 'USPS', '9400111202555842355555', false, null, 'customer', null, 'dan')`,
      "not without confirming the cards are packaged securely and tracked", "GT010");
    await expectError(`select public.trade_record_tracking('${t4}', 'USPS', '9400111202555842355555', true, (now() + interval '3 days')::date, 'customer', null, 'dan')`,
      "a ship date in the future is refused", "GT010");
    check((await one(`select public.trade_record_tracking('${t4}', 'USPS', '9400111202555842355555', true, null, 'customer', null, 'dan') as r`)).r === "added", "Dan's tracking number is added");
    const t4b = await tradeRow(t4);
    check(t4b.status === "tracking_submitted" && t4b.inbound_accepted_at === null && t4b.shipped_on_time === null, "it isn't shipped until the carrier scans it");
    check(t4b.inbound_packaging_confirmed_at !== null && t4b.inbound_shipped_on === null, "his packaging confirmation is kept, with its time");
    check((await one(`select public.trade_record_tracking('${t4}', 'USPS', '9400111202555842355555', false, null, 'customer', null, 'dan') as r`)).r === "unchanged",
      "sending it again changes nothing, and needs no new confirmation");
    check((await one(`select public.trade_record_tracking('${t4}', 'USPS', '9400111202555842355555', false, (now() at time zone 'America/Chicago')::date, 'customer', null, 'dan') as r`)).r === "unchanged"
      && (await tradeRow(t4)).inbound_shipped_on !== null, "the day he shipped can be added later");
    await expectError(`select public.trade_record_tracking('${t6}', 'USPS', '9400111202555842355555', true, null, 'customer', null, 'fay')`, "the same number on another customer's trade is refused", "GT010");
  });

  it("carrier scans: an acceptance in time verifies the shipment and refunds the deposit", async () => {
    await db.exec(`update public.trade_requests set approved_at = now() - interval '2 days', ship_by = now() + interval '1 day' where id = '${t4}'`);
    const preTransit = [{ status: "pre_transit", message: "Shipping Label Created", at: iso(Date.now() - HOUR) }];
    check((await one(`select public.trade_record_scan($1, $2, 'trk_1', 'pre_transit', $3::jsonb, null, null, $4::timestamptz) as r`, [t4, "9400111202555842355555", JSON.stringify(preTransit), iso(Date.now() - HOUR)])).r === "updated", "a label being made is saved, nothing more");
    check((await tradeRow(t4)).status === "tracking_submitted" && (await tradeRow(t4)).inbound_tracker_id === "trk_1", "still waiting for an acceptance scan");
    check((await one(`select public.trade_record_scan($1, 'OTHER123456', 'trk_1', 'in_transit', '[]'::jsonb, now(), null, now()) as r`, [t4])).r === "stale", "scans for a number that's since changed are ignored");
    const accepted = iso(Date.now() - 30 * 60000);
    check((await one(`select public.trade_record_scan($1, $2, 'trk_1', 'in_transit', '[]'::jsonb, $3::timestamptz, null, now()) as r`, [t4, "9400111202555842355555", accepted])).r === "verified", "an acceptance scan before the deadline verifies the shipment");
    const t4c = await tradeRow(t4);
    check(t4c.status === "in_transit" && t4c.shipped_on_time === true && t4c.inbound_acceptance_source === "carrier", "shipped on time: in transit");
    check(t4c.deposit_status === "not_required" && (await holds(t4)) === 2, "no deposit to refund; the reservation stays");
    check((await one(`select public.trade_record_scan($1, $2, 'trk_1', 'delivered', '[]'::jsonb, $3::timestamptz, now(), now()) as r`, [t4, "9400111202555842355555", accepted])).r === "delivered", "delivered");
    check((await tradeRow(t4)).status === "received" && (await tradeRow(t4)).needs_staff === true, "waiting for inspection, on staff's list");

    // The deposit comes back on a timely scan.
    await db.query(`select public.trade_record_tracking($1, 'UPS', '1Z999AA10123456784', true, null, 'customer', null, 'fay')`, [t6]);
    await db.exec(`update public.trade_requests set approved_at = now() - interval '1 day', ship_by = now() + interval '1 hour' where id = '${t6}'`);
    check((await one(`select public.trade_record_scan($1, '1Z999AA10123456784', 'trk_6', 'in_transit', '[]'::jsonb, now() - interval '5 minutes', null, now()) as r`, [t6])).r === "verified", "Fay's package is accepted in time");
    check((await tradeRow(t6)).deposit_status === "refund_pending" && (await tradeRow(t6)).deposit_refund_requested_at, "her whole deposit is to be refunded");
  });

  it("refunds: retried with a new attempt, recorded once", async () => {
    check((await depositTo(t6, "refund_pending", "re_1")).changed === true, "the refund is created (its id kept)");
    check((await depositTo(t6, "refund_pending", "re_1")).changed === false, "recording it again changes nothing");
    check((await depositTo(t6, "refund_failed", "re_1", "expired_or_canceled_card")).changed === true, "the card network refuses it: refund failed");
    const t6f = await tradeRow(t6);
    check(t6f.deposit_status === "refund_failed" && t6f.deposit_refund_failure === "expired_or_canceled_card" && t6f.needs_staff === true, "staff see a failed refund, with why");
    check((await depositTo(t6, "refund_pending", null, null, "staff")).changed === true, "staff try again");
    const t6g = await tradeRow(t6);
    check(t6g.deposit_status === "refund_pending" && t6g.deposit_refund_attempts === 1 && t6g.deposit_refund_id === null, "a new attempt (a new refund, its own idempotency key)");
    await depositTo(t6, "refund_pending", "re_2");
    check((await depositTo(t6, "refunded", "re_2")).changed === true && (await tradeRow(t6)).deposit_status === "refunded", "refunded");
    check((await depositTo(t6, "refunded", "re_2")).changed === false, "a repeated webhook changes nothing");
    await expectError(`select public.trade_deposit_update('${t6}', 'forfeited', null, null, null, 'staff', null, 'x')`, "a refunded deposit can't be kept", "GT009");
  });

  it("canceling while reserved: the deposit goes to staff, kept only with it turned on", async () => {
    const bob2 = await inv("Cyclonic Rift", 2, 3000);
    tC = await approvedTrade(users.bob, [[bob2, 1]], { deposit: 1000 });
    await confirm(tC, users.bob, { pi: "pi_c" });
    await reserve(tC, "pi_c", 1000);
    const cc = await close(tC, "canceled", ["awaiting_shipment"], "canceled_while_reserved");
    const tCr = await tradeRow(tC);
    check(cc.closed === true && cc.deposit_after === "forfeiture_review", "canceled: the deposit goes to staff review, not kept automatically");
    check(tCr.customer_fault === "canceled_while_reserved" && tCr.fault_at && (await holds(tC)) === 0 && (await free(bob2)) === 2, "counted as abandoned; the card is for sale again");
    check((await close(tC, "canceled", ["awaiting_shipment"])).closed === false, "canceling twice changes nothing");
    await expectError(`select public.trade_deposit_update('${tC}', 'forfeited', null, null, 'no-show', 'staff', null, 'jacob')`, "keeping it is refused while that's turned off", "GT009");
    await db.exec(`update public.trade_settings set allow_forfeiture = true`);
    await expectError(`select public.trade_deposit_update('${tC}', 'forfeited', null, null, 'x', 'system', null, 'worker')`, "and only staff can keep one", "42501");
    check((await one(`select public.trade_deposit_update('${tC}', 'forfeited', null, null, 'Canceled after reserving', 'staff', null, 'jacob') as c`)).c === true, "with it on, staff can keep it");
    check((await tradeRow(tC)).deposit_status === "forfeited" && (await tradeRow(tC)).deposit_decided_by === "jacob", "kept, with who decided");
    check((await depositTo(tC, "refund_pending", null, null, "staff")).changed === true, "staff can still change their mind and refund it");
    await db.exec(`update public.trade_settings set allow_forfeiture = false`);
  });

  it("missing the shipping deadline releases the cards (not while proof of shipping is open)", async () => {
    eve2 = await inv("Esper Sentinel", 2, 2000);
    tE = await approvedTrade(users.eve, [[eve2, 2]], { deposit: 500 });
    await confirm(tE, users.eve, { pi: "pi_e" });
    await reserve(tE, "pi_e", 500);
    await db.exec(`update public.trade_requests set ship_by = now() - interval '1 minute' where id = '${tE}'`);
    // Proof of shipping is open: it doesn't expire.
    const dispute = (await one(`select public.trade_open_dispute($1, $2, 'Dropped it at the post office Tuesday', '[]'::jsonb) as id`, [tE, users.eve])).id;
    check((await tradeRow(tE)).review_flag === "dispute" && (await tradeRow(tE)).needs_staff, "Eve sends proof of shipping: staff are asked to look");
    await expectError(`select public.trade_open_dispute('${tE}', '${users.eve}', 'again', '[]'::jsonb)`, "one open proof at a time", "GT009");
    check(!(await expire()).some((r) => r.expired_trade_id === tE), "while it's open the reservation doesn't expire");
    await db.query(`select public.trade_resolve_dispute($1, 'rejected', 'No scan and no receipt', null, 'jacob')`, [dispute]);
    check((await tradeRow(tE)).review_flag === null, "rejected: the deadline stands");
    const expE = await expire();
    check(expE.some((r) => r.expired_trade_id === tE && r.expired_stage === "shipping" && r.expired_deposit_status === "forfeiture_review"), "now it expires: no tracking by the deadline");
    const tEr = await tradeRow(tE);
    check(tEr.status === "expired" && tEr.customer_fault === "missed_deadline" && (await holds(tE)) === 0 && (await free(eve2)) === 2, "the reservation is released: both cards are for sale again");
    check(tEr.deposit_status === "forfeiture_review" && tEr.needs_staff, "the deposit waits for staff, never kept automatically");
    const relLog = await all(`select status, released_by from public.inventory_reservations where trade_request_id = $1`, [tE]);
    check(relLog.length === 1 && relLog[0].status === "released" && relLog[0].released_by === "expiry", "the release is recorded on the reservation");
  });

  it("reinstating an expired reservation, unless a card has sold", async () => {
    const tEre = await one(`select * from public.trade_reinstate($1, 'awaiting_shipment', now() + interval '2 days', null, true, null, 'jacob')`, [tE]);
    const tEr2 = await tradeRow(tE);
    check(tEre.result === "reinstated" && tEr2.status === "awaiting_shipment" && (await holds(tE)) === 2, "staff reinstate it: both cards held again");
    check(tEr2.deposit_status === "paid" && tEr2.customer_fault === null && tEr2.closed_at === null, "the deposit is held again; the fault is cleared");
    await db.exec(`update public.trade_requests set ship_by = now() - interval '1 minute' where id = '${tE}'`);
    await expire();
    await db.exec(`insert into public.inventory_reservations (inventory_item_id, customer_id, quantity) values ('${eve2}', gen_random_uuid(), 1)`);
    const tEre2 = await one(`select * from public.trade_reinstate($1, 'awaiting_shipment', now() + interval '2 days', null, false, null, 'jacob')`, [tE]);
    check(tEre2.result === "unavailable" && (await tradeRow(tE)).status === "expired" && (await holds(tE)) === 0, "once a card has sold it can't be reinstated, and nothing is half-held");
  });

  it("tracking but no scan: the grace for a scan, and never expired without automatic tracking", async () => {
    const dan2 = await inv("Demonic Tutor", 2, 3000);
    const tT = await approvedTrade(users.dan, [[dan2, 1]], { deposit: 500 });
    await confirm(tT, users.dan, { pi: "pi_t" });
    await reserve(tT, "pi_t", 500);
    await db.query(`select public.trade_record_tracking($1, 'USPS', '9400111202555842399999', true, null, 'customer', null, 'dan')`, [tT]);
    await db.exec(`update public.trade_requests set ship_by = now() - interval '2 hours' where id = '${tT}'`);
    check(!(await expire(24)).some((r) => r.expired_trade_id === tT), "past the deadline but inside the grace for a scan: not expired");
    check(!(await expire(1, false)).some((r) => r.expired_trade_id === tT), "with no automatic tracking, never expired (staff check it)");
    const expT = await expire(1, true);
    check(expT.some((r) => r.expired_trade_id === tT && r.expired_stage === "scan"), "past the grace with no scan: expired");
    check((await tradeRow(tT)).return_status === "none", "nothing was ever accepted, so nothing to return");
  });

  it("a late scan waits for staff: nothing released or refunded until they decide", async () => {
    const cat2 = await inv("Enlightened Tutor", 2, 3000);
    const tLate = await approvedTrade(users.cat, [[cat2, 1]], { deposit: 500 });
    await confirm(tLate, users.cat, { pi: "pi_late2" });
    await reserve(tLate, "pi_late2", 500);
    await db.query(`select public.trade_record_tracking($1, 'USPS', '9400111202555842388888', true, null, 'customer', null, 'cat')`, [tLate]);
    await db.exec(`update public.trade_requests set approved_at = now() - interval '3 days', ship_by = now() - interval '3 hours' where id = '${tLate}'`);
    check((await one(`select public.trade_record_scan($1, '9400111202555842388888', 'trk_l', 'in_transit', '[]'::jsonb, now() - interval '1 hour', null, now()) as r`, [tLate])).r === "late", "the first scan came two hours after the deadline");
    const tLater = await tradeRow(tLate);
    check(tLater.status === "tracking_submitted" && tLater.review_flag === "late_acceptance" && (await holds(tLate)) === 1, "staff decide: nothing released, nothing refunded");
    check(!(await expire(1, true)).some((r) => r.expired_trade_id === tLate), "the worker leaves it for staff");
    await expectError(`select public.trade_mark_received('${tLate}', null, 'jacob')`, "a late scan is decided before the package is marked received", "GT009");
    const vLate = (await one(`select public.trade_verify_shipment($1, now() - interval '1 hour', false, false, 'Dropped off late', null, 'jacob') as d`, [tLate])).d;
    const tLv = await tradeRow(tLate);
    check(vLate === "forfeiture_review" && tLv.status === "in_transit" && tLv.shipped_on_time === false && tLv.customer_fault === "late_shipment", "counted late: the trade goes on, the deposit goes to review");
  });

  it("a scan from before the approval doesn't count; deciding proof leaves it with staff", async () => {
    const gus2 = await inv("Vampiric Tutor", 1, 4000);
    const tEarly = await approvedTrade(users.gus, [[gus2, 1]]);
    await confirm(tEarly, users.gus);
    await db.query(`select public.trade_record_tracking($1, 'USPS', '9400111202555842377777', true, null, 'customer', null, 'gus')`, [tEarly]);
    check((await one(`select public.trade_record_scan($1, '9400111202555842377777', 'trk_e', 'in_transit', '[]'::jsonb, now() - interval '30 days', null, now()) as r`, [tEarly])).r === "early", "an old package's scan doesn't count");
    check((await tradeRow(tEarly)).review_flag === "early_scan" && (await tradeRow(tEarly)).status === "tracking_submitted", "staff check it");
    const eDispute = (await one(`select public.trade_open_dispute($1, $2, 'I shipped it this week', '[]'::jsonb) as id`, [tEarly, users.gus])).id;
    check((await tradeRow(tEarly)).review_flag === "dispute", "proof of shipping takes the flag over");
    await db.query(`select public.trade_resolve_dispute($1, 'accepted', 'Receipt checks out', null, 'jacob')`, [eDispute]);
    const tEarlyR = await tradeRow(tEarly);
    check(tEarlyR.review_flag === "early_scan" && tEarlyR.needs_staff && tEarlyR.review_flag_at !== null, "deciding the proof leaves the early scan with staff");
    check(!(await expire(1, true)).some((r) => r.expired_trade_id === tEarly), "and the worker still leaves it alone");
  });

  it("extensions move the running deadline and are recorded", async () => {
    const fay2 = await inv("Mystic Remora", 2, 1000);
    tX = await approvedTrade(users.fay, [[fay2, 1]]);
    await confirm(tX, users.fay);
    const oldShip = (await tradeRow(tX)).ship_by;
    await expectError(`select public.trade_extend('${tX}', 'shipping', '${iso(new Date(oldShip).getTime() - HOUR)}'::timestamptz, 24, true, null, null, 'jacob')`, "an extension has to move the deadline later", "GT010");
    await expectError(`select public.trade_extend('${tX}', 'confirmation', now() + interval '3 days', 24, false, null, null, 'jacob')`, "there's no confirmation deadline once reserved", "GT009");
    await db.query(`select public.trade_extend($1, 'shipping', $2::timestamptz + interval '1 day', 24, true, 'Asked for a day', null, 'jacob')`, [tX, oldShip]);
    const ext = await one(`select kind, customer_requested, from_deadline, to_deadline from public.trade_extensions where trade_request_id = $1`, [tX]);
    check(ext.kind === "shipping" && ext.customer_requested === true && new Date(ext.to_deadline) - new Date(ext.from_deadline) === DAY, "a day more, recorded as the customer's request");
    await db.exec(`update public.trade_requests set ship_by_original = now() - interval '1 hour' where id = '${tX}'`);
    check(!(await expire()).some((r) => r.expired_trade_id === tX), "past the original deadline, the extension keeps it from expiring");
  });

  it("a package that arrives without a scan counts as shipped on time", async () => {
    const dReceived = (await one(`select public.trade_mark_received($1, null, 'jacob') as d`, [tX])).d;
    const tXr = await tradeRow(tX);
    check(tXr.status === "received" && tXr.shipped_on_time === true && tXr.inbound_acceptance_source === "received", "the package is here: shipped, on time");
    check(dReceived === "not_required", "(no deposit on this one)");
  });

  it("staff verify a shipment by hand", async () => {
    const ann2 = await inv("Force of Will", 2, 9000);
    tV = await approvedTrade(users.ann, [[ann2, 1]], { deposit: 500 });
    await confirm(tV, users.ann, { pi: "pi_v" });
    await reserve(tV, "pi_v", 500);
    await db.query(`select public.trade_record_tracking($1, 'Other', 'LOCALCOURIER123', true, null, 'customer', null, 'ann')`, [tV]);
    await expectError(`select public.trade_verify_shipment('${tV}', now() + interval '1 day', true, true, null, null, 'jacob')`, "an acceptance date in the future is refused", "GT010");
    const vOk = (await one(`select public.trade_verify_shipment($1, now() - interval '1 hour', true, true, 'Courier receipt', null, 'jacob') as d`, [tV])).d;
    check(vOk === "refund_pending" && (await tradeRow(tV)).inbound_acceptance_source === "staff", "verified on time by staff: the deposit is refunded");
  });

  it("declining after inspection: no penalty, cards back, deposit refunded", async () => {
    await db.exec(`update public.trade_requests set status = 'awaiting_final_approval', final_value_cents = 3000, final_credit_cents = 2400 where id = '${tV}'`);
    const dec = await close(tV, "declined_after_inspection", ["awaiting_final_approval", "awaiting_payment"]);
    const tVd = await tradeRow(tV);
    check(dec.closed && tVd.status === "declined_after_inspection" && tVd.customer_fault === null, "declined, with nothing counted against Ann");
    check(tVd.return_status === "pending" && tVd.needs_staff && (await holds(tV)) === 0, "her cards are to go back; our card is for sale again");
    check(tVd.deposit_status === "refund_pending", "the deposit refund carries on (never kept for declining)");
    check(tVd.shipping_cents === null && tVd.amount_due_cents === null && tVd.order_id === null, "no shipping charged, no order: nothing was fulfilled");
  });

  it("the store canceling refunds the deposit", async () => {
    const bob3 = await inv("Toxic Deluge", 2, 3000);
    const tS = await approvedTrade(users.bob, [[bob3, 1]], { deposit: 500 });
    await confirm(tS, users.bob, { pi: "pi_s" });
    await reserve(tS, "pi_s", 500);
    const cs = await close(tS, "canceled_by_store", ["awaiting_shipment", "tracking_submitted"], null, "staff");
    check(cs.deposit_after === "refund_pending" && (await tradeRow(tS)).return_status === "none", "a store cancellation refunds the deposit (nothing was mailed yet)");
  });

  it("reliability: records, the block and deposit policies, clearing a fault", async () => {
    await db.exec(`update public.trade_settings set abandon_limit = 2`);
    const statsBob = (await one(`select public.trade_customer_stats($1, 365) as s`, [users.bob])).s;
    check(statsBob.abandoned_reservations === 1 && statsBob.store_canceled === 1 && statsBob.recent_faults === 1, "Bob: 1 abandoned reservation, 1 store cancellation (not his fault)");
    const statsAnn = (await one(`select public.trade_customer_stats($1, 365) as s`, [users.ann])).s;
    check(statsAnn.declined_after_inspection === 1 && statsAnn.recent_faults === 0 && statsAnn.on_time_shipments === 1, "Ann: a decline after inspection and an on-time shipment, nothing against her");
    const statsFay = (await one(`select public.trade_customer_stats($1, 365) as s`, [users.fay])).s;
    check(statsFay.extension_requests === 1, "Fay asked for one extension");
    await db.exec(`update public.trade_settings set abandon_policy = 'block', abandon_limit = 1`);
    const bob4 = await inv("Brainstorm", 4, 200);
    await expectError(`select public.trade_start('${users.bob}', '${items([bob4, 1])}', 'Bob', 'bob@example.com')`, "with the block policy, Bob can't start a new trade", "GT003");
    await db.query(`select public.trade_clear_fault($1, null, 'jacob')`, [tC]);
    check((await one(`select public.trade_customer_stats($1, 365) as s`, [users.bob])).s.recent_faults === 0, "staff clear it: it no longer counts");
    const tNew = (await one(`select public.trade_start($1, $2::jsonb, 'Bob', 'bob@example.com') as id`, [users.bob, items([bob4, 1])])).id;
    check(!!tNew, "and Bob can trade again");
    await db.exec(`insert into public.trade_customer_flags (user_id, blocked) values ('${users.ann}', true)`);
    await expectError(`select public.trade_start('${users.ann}', '${items([bob4, 1])}', 'Ann', 'ann@example.com')`, "staff can pause one customer by hand", "GT003");
    await db.exec(`update public.trade_settings set abandon_policy = 'deposit', abandon_limit = 2`);
    const list = await all(`select * from public.trade_customer_list(100)`);
    check(list.length >= 6 && list.every((r) => r.stats && typeof r.stats.completed_trades === "number"), "everyone who traded, with their record");
  });

  it("multiple copies of a card", async () => {
    many = await inv("Lightning Bolt", 3, 300);
    const tM1 = await approvedTrade(users.gus, [[many, 2]]);
    await confirm(tM1, users.gus);
    check((await holds(tM1)) === 2 && (await free(many)) === 1, "2 of 3 reserved: 1 left");
    const tM2 = (await one(`select public.trade_start($1, $2::jsonb, 'Cat', 'c') as id`, [users.cat, items([many, 1])])).id;
    check(!!tM2, "someone can still ask for the last one");
    await expectError(`select public.trade_start('${users.dan}', '${items([many, 2])}', 'Dan', 'd')`, "but not for 2", "GT004");
    await db.exec(`update public.trade_settings set max_wanted_lines = 40`);
    const changed = (await one(`select public.trade_set_wanted($1, $2::jsonb, array['awaiting_shipment'], 'staff', null, 'jacob') as t`, [tM1, items([many, 1])])).t;
    check(changed === 300 && (await holds(tM1)) === 1 && (await free(many)) === 2, "staff take one copy off a reserved trade: it's for sale again");
  });

  it("inspection, the final offer and finishing the trade with store credit", async () => {
    tF = await approvedTrade(users.eve, [[many, 1]]);
    await confirm(tF, users.eve);
    await db.exec(`update public.trade_requests set status = 'received' where id = '${tF}'`);
    const cF = (await one(`select id from public.trade_offer_cards where trade_request_id = $1`, [tF])).id;
    await db.query(`select public.trade_inspect_cards($1, $2::jsonb, null, 'jacob')`, [tF, JSON.stringify([{ id: cF, received_quantity: 1, authenticity: "authentic", verified_condition: "NM", final_quantity: 1, final_unit_cents: 6000 }])]);
    await expectError(`select public.trade_send_final_offer('${tF}', false, null, 'jacob')`, "a changed value needs its reason", "GT010");
    await db.query(`select public.trade_inspect_cards($1, $2::jsonb, null, 'jacob')`, [tF, JSON.stringify([{ id: cF, received_quantity: 1, authenticity: "authentic", verified_condition: "LP", final_quantity: 1, final_unit_cents: 6000, inspection_note: "Light edge wear" }])]);
    const credit = (await one(`select public.trade_send_final_offer($1, false, null, 'jacob') as c`, [tF])).c;
    check(credit === 4800 && (await tradeRow(tF)).status === "awaiting_final_approval", "the final offer: $60.00 at 80% = $48.00 credit");
    const acc = await one(`select * from public.trade_accept_final($1, $2, 'Eve', '1 Main St', null, 'St. Louis', 'MO', '63101')`, [tF, users.eve]);
    check(acc.new_status === "awaiting_payment" && acc.due_cents === 399, "accepted: the credit covers the cards, the $3.99 shipping is paid by card");
    const tFa = await tradeRow(tF);
    check(tFa.shipping_cents === 399 && tFa.amount_due_cents === 399 && tFa.excess_cents === 4800 - 300, "the credit beyond our cards is left over (shipping isn't taken out of it)");
    const orderId = (await one(`select public.trade_record_payment($1, 399, 'pi_ship_eve') as o`, [tF])).o;
    const order = await one(`select * from public.orders where id = $1`, [orderId]);
    check(order.subtotal_cents === 300 && order.shipping_cents === 399 && order.store_credit_used_cents === 300 && order.amount_due_cents === 399
      && order.payment_provider === "stripe", "the order: $3.00 of cards paid with credit, $3.99 shipping paid by card");
    check((await one(`select status from public.inventory_reservations where trade_request_id = $1 and status <> 'released'`, [tF])).status === "fulfilled", "the reservation became the order");
    check((await one(`select public.store_credit_balance($1) as b`, [users.eve])).b === 4800 - 300, "the rest of the credit stays as store credit");
    await db.exec(`update public.orders set status = 'shipped' where id = '${orderId}'`);
    check((await tradeRow(tF)).status === "completed", "complete when the order ships");
    check((await one(`select public.trade_customer_stats($1, 365) as s`, [users.eve])).s.completed_trades === 1, "and it counts toward Eve's completed trades");
  });

  it("paying the rest, and adding a trade-in to inventory at its cost", async () => {
    const tP = await approvedTrade(users.dan, [[many, 1]]);
    await confirm(tP, users.dan);
    await db.exec(`update public.trade_requests set status = 'awaiting_final_approval', final_value_cents = 100, final_credit_cents = 80 where id = '${tP}'`);
    const accP = await one(`select * from public.trade_accept_final($1, $2, 'Dan', '4 Pine', null, 'Ballwin', 'MO', '63011')`, [tP, users.dan]);
    check(accP.new_status === "awaiting_payment" && accP.due_cents === 300 - 80 + 399, "$3.00 of cards less $0.80 credit, plus $3.99 shipping: $6.19 to pay");
    await expectError(`select public.trade_record_payment('${tP}', 100, 'pi_short')`, "a payment short of what's due doesn't finish it", "GT008");
    const oP = (await one(`select public.trade_record_payment($1, $2, 'pi_123') as o`, [tP, accP.due_cents])).o;
    check((await one(`select public.trade_record_payment($1, $2, 'pi_123') as o`, [tP, accP.due_cents])).o === oP, "the webhook arriving too finds the same order");
    const sheol = await one(`select id from public.trade_offer_cards where trade_request_id = $1`, [tF]);
    const newInv = (await one(`select public.trade_import_card($1, 7499, 'Binder 3', 'jacob') as i`, [sheol.id])).i;
    const added = await one(`select quantity, price_cents, cost_cents from public.inventory_items where id = $1`, [newInv]);
    check(added.quantity === 1 && added.price_cents === 7499 && added.cost_cents === 4800, "a trade-in goes into inventory at its cost (80% of $60.00)");
  });

  it("declining with the payment still due charges nothing: no shipping, no order, no credit", async () => {
    const dz = await inv("Dark Ritual", 1, 1500);
    const tDz = await approvedTrade(users.dan, [[dz, 1]]);
    await confirm(tDz, users.dan);
    await db.exec(`update public.trade_requests set status = 'awaiting_final_approval', final_value_cents = 1000, final_credit_cents = 800 where id = '${tDz}'`);
    const acc = await one(`select * from public.trade_accept_final($1, $2, 'Dan', '4 Pine', null, 'Ballwin', 'MO', '63011')`, [tDz, users.dan]);
    check(acc.new_status === "awaiting_payment" && acc.due_cents === 1500 - 800 + 399, "$15.00 of cards less $8.00 credit, plus $3.99 shipping: $10.99 due");
    const before = (await one(`select public.store_credit_balance($1) as b`, [users.dan])).b;
    const dec = await close(tDz, "declined_after_inspection", ["awaiting_final_approval", "awaiting_payment"]);
    const row = await tradeRow(tDz);
    check(dec.closed && row.status === "declined_after_inspection" && row.order_id === null && row.paid_at === null, "declined before paying: no order, nothing collected");
    check((await one(`select public.store_credit_balance($1) as b`, [users.dan])).b === before, "and no trade credit issued");
    check((await holds(tDz)) === 0, "our card is for sale again");
    await expectError(`select public.trade_record_payment('${tDz}', ${acc.due_cents}, 'pi_after_decline')`, "a payment after it closed doesn't finish it", "GT009");
  });

  it("shipping our cards: $3.99 under $200, free from $200, on the trade's own terms", async () => {
    const fee = async (cents: number) => (await one(`select public.trade_shipping_fee($1::int, 399, 20000, 0) as f`, [cents])).f;
    check((await fee(7500)) === 399 && (await fee(10000)) === 399 && (await fee(19999)) === 399, "$75, $100 and $199.99 of cards: $3.99");
    check((await fee(20000)) === 0 && (await fee(50000)) === 0, "$200 and $500: free");
    check((await fee(0)) === 0, "no cards, no shipping");

    const big = await inv("City of Traitors", 1, 20000);
    const tB2 = await approvedTrade(users.eve, [[big, 1]]);
    await confirm(tB2, users.eve);
    await db.exec(`update public.trade_requests set status = 'awaiting_final_approval', final_value_cents = 25000, final_credit_cents = 20000 where id = '${tB2}'`);
    const accB = await one(`select * from public.trade_accept_final($1, $2, 'Eve', '1 Main St', null, 'St. Louis', 'MO', '63101')`, [tB2, users.eve]);
    check(accB.new_status === "approved_for_fulfillment" && accB.due_cents === 0, "$250 of cards at 80% covers $200: free shipping, nothing to pay, finished at once");
    const orderB = await one(`select * from public.orders where id = $1`, [accB.new_order_id]);
    check(orderB.shipping_cents === 0 && orderB.store_credit_used_cents === 20000 && orderB.payment_provider === "store_credit", "the order ships free, paid with the trade credit");

    // Under $200, shipping is paid by card even when the credit covers the cards,
    // at the rate the trade started with.
    const mid = await inv("Mana Vault", 1, 15000);
    const tM3 = await approvedTrade(users.eve, [[mid, 1]]);
    check((await tradeRow(tM3)).ship_fee_cents === 399, "the trade keeps the shipping terms it started on");
    await db.exec(`update public.trade_settings set ship_fee_cents = 599`);
    await confirm(tM3, users.eve);
    await db.exec(`update public.trade_requests set status = 'awaiting_final_approval', final_value_cents = 18750, final_credit_cents = 15000 where id = '${tM3}'`);
    const accM = await one(`select * from public.trade_accept_final($1, $2, 'Eve', '1 Main St', null, 'St. Louis', 'MO', '63101')`, [tM3, users.eve]);
    check(accM.new_status === "awaiting_payment" && accM.due_cents === 399,
      "$150 of cards, $187.50 accepted at 80% = $150 credit: $0 for cards, $3.99 shipping (a later change to the rate doesn't apply)");
    check((await tradeRow(tM3)).excess_cents === 0, "nothing left over");
    await db.exec(`update public.trade_settings set ship_fee_cents = 399`);
  });

  it("the minimum trade value: $74.99 can't start or be sent, $75 can", async () => {
    await db.exec(`update public.trade_settings set min_trade_value_cents = 7500`);
    const under = await inv("Chrome Mox", 1, 7499);
    const exact = await inv("Grim Monolith", 1, 7500);
    const half = await inv("Mox Amber", 1, 5000);
    await expectError(`select public.trade_start('${users.eve}', '${items([under, 1])}', 'Eve', 'eve@example.com')`,
      "$74.99 of our cards can't start a trade", "GT005");
    try {
      await db.query(`select public.trade_start($1, $2::jsonb, 'Eve', 'e')`, [users.eve, items([half, 1])]);
    } catch (e) {
      check((e as Error).message === "Add $25.00 more in cards to reach the $75.00 minimum trade value.", "it says how much more to add");
    }
    const tMin = (await one(`select public.trade_start($1, $2::jsonb, 'Eve', 'e') as id`, [users.eve, items([exact, 1])])).id;
    check(!!tMin && (await tradeRow(tMin)).wanted_total_cents === 7500, "$75.00 can");
    await one(`select public.trade_save_offer($1, $2, $3::jsonb) as v`, [tMin, users.eve, JSON.stringify([card()])]);
    // Swapping to cheaper cards on the draft is allowed; sending it isn't.
    check((await one(`select public.trade_set_wanted($1, $2::jsonb, array['awaiting_trade_list'], 'customer', $3, 'eve') as t`, [tMin, items([half, 1]), users.eve])).t === 5000,
      "a draft can go under the minimum while they shop");
    await expectError(`select public.trade_submit('${tMin}', '${users.eve}', null)`, "but can't be sent under it", "GT005");
    await one(`select public.trade_set_wanted($1, $2::jsonb, array['awaiting_trade_list'], 'customer', $3, 'eve') as t`, [tMin, items([half, 1], [exact, 1]), users.eve]);
    await db.query(`select public.trade_submit($1, $2, null)`, [tMin, users.eve]);
    check((await tradeRow(tMin)).status === "pending_review", "back over it, it's sent");
    await db.exec(`update public.trade_settings set min_trade_value_cents = 0`);
  });

  it("packaging confirmation for a replacement shipment", async () => {
    const pk = await inv("Ancient Tomb", 1, 4000);
    const tPk = await approvedTrade(users.eve, [[pk, 1]]);
    await confirm(tPk, users.eve);
    await db.query(`select public.trade_record_tracking($1, 'USPS', '9400111202555842311111', true, null, 'customer', null, 'eve')`, [tPk]);
    const first = (await tradeRow(tPk)).inbound_packaging_confirmed_at;
    await expectError(`select public.trade_record_tracking('${tPk}', 'USPS', '9400111202555842322222', false, null, 'customer', null, 'eve')`,
      "a new tracking number (a replacement shipment) needs the confirmation again", "GT010");
    check((await one(`select public.trade_record_tracking($1, 'Other', '9400111202555842311111', false, null, 'customer', null, 'eve') as r`, [tPk])).r === "changed",
      "fixing only the carrier is the same package: no new confirmation");
    check(new Date((await tradeRow(tPk)).inbound_packaging_confirmed_at).getTime() === new Date(first).getTime(), "(the first confirmation stands)");
    check((await one(`select public.trade_record_tracking($1, 'USPS', '9400111202555842322222', true, null, 'customer', null, 'eve') as r`, [tPk])).r === "changed",
      "a replacement shipment, confirmed again");
    check(new Date((await tradeRow(tPk)).inbound_packaging_confirmed_at).getTime() >= new Date(first).getTime(), "with a new confirmation time");
  });

  it("staff's list, push alerts, RLS and grants", async () => {
    const badges = await one(`select public.admin_nav_badges(null) as b`);
    const waiting = await one(`select count(*)::int as n from public.trade_requests where needs_staff`);
    check(badges.b.trades_waiting === waiting.n && waiting.n > 0, `the sidebar counts the ${waiting.n} trades waiting on staff`);
    const subs = await one(`select kinds from public.staff_push_subscriptions limit 1`);
    check(subs.kinds.filter((k) => k === "trade").length === 1, "devices with notifications on get trade alerts, once");
    const rls = await all(`select relname from pg_class where relname like 'trade\\_%' and relkind = 'r' and relrowsecurity`);
    check(rls.length === 10, "RLS is on for all ten tables");
    const grants = await all(`select table_name from information_schema.role_table_grants where table_name like 'trade\\_%' and grantee in ('anon','authenticated')`);
    check(grants.length === 0, "anon and authenticated have no table access");
    const fnGrants = await all(`select p.proname from pg_proc p where p.proname like 'trade\\_%' and has_function_privilege('authenticated', p.oid, 'execute') and p.proname <> 'trade_regular_price'`);
    check(fnGrants.length === 0, `and can't run any trade function${fnGrants.length ? ": " + fnGrants.map((f) => f.proname).join(", ") : ""}`);
    // Supabase's advisor flags a function without a fixed search path (function_search_path_mutable).
    const loose = await all(`select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and (p.proname like 'trade\\_%' or p.proname = 'tg_trade_order_shipped')
        and not exists (select 1 from unnest(coalesce(p.proconfig, '{}'::text[])) c where c like 'search_path=%')`);
    check(loose.length === 0, `every trade function pins its search path${loose.length ? ": " + loose.map((f) => f.proname).join(", ") : ""}`);
  });
});
