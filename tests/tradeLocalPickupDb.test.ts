import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { STANDINS, UPSERT } from "./helpers/tradeDbStandins";

// Local pickup trades (supabase/migrations/20261027230000_trade_local_pickup.sql,
// and their own terms, 20261028010000_trade_local_terms.sql) in PGlite, on top
// of the Trade Center migration: starting one, sending it without listing
// their cards, approving it with no review or deposit (which holds our cards
// until it's finished: 20261031010000_trade_local_hold_until_finished.sql),
// taking cards off while they're held, finishing it at the meetup, and local
// pickup's own rate, minimums and cash payouts, and its meeting spot
// (20261028030000_trade_meet_spot.sql).
// tests/tradeCenterDb.test.ts runs every shipped-trade test with this
// update in place too.

const MIGRATIONS = [
  "../supabase/migrations/20261025200000_trade_center.sql",
  "../supabase/migrations/20261026233000_trade_function_search_path.sql",
  "../supabase/migrations/20261027230000_trade_local_pickup.sql",
  "../supabase/migrations/20261028010000_trade_local_terms.sql",
  "../supabase/migrations/20261028030000_trade_meet_spot.sql",
  "../supabase/migrations/20261031010000_trade_local_hold_until_finished.sql",
].map((path) => readFileSync(new URL(path, import.meta.url), "utf8"));

// oxlint-disable-next-line typescript/no-explicit-any
type Row = Record<string, any>;

let db: PGlite;
const one = async (q: string, params?: unknown[]): Promise<Row> => (await db.query<Row>(q, params)).rows[0];
const all = async (q: string, params?: unknown[]): Promise<Row[]> => (await db.query<Row>(q, params)).rows;
async function errorOf(statement: string, params?: unknown[]): Promise<{ code?: string; message?: string } | null> {
  try {
    await db.query(statement, params);
    return null;
  } catch (e) {
    return e as { code?: string; message?: string };
  }
}
const iso = (ms: number) => new Date(ms).toISOString();
const DAY = 24 * 3600000;

const users = {
  lou: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  max: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  ned: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
};
let ring: string;
let bolt: string;

const inv = async (name: string, qty: number, price: number): Promise<string> =>
  (
    await one(
      `insert into public.inventory_items (card_name, set_code, collector_number, condition, finish, quantity, price_cents)
       values ($1, 'cmr', '1', 'NM', 'nonfoil', $2, $3) returning id`,
      [name, qty, price],
    )
  ).id;
const items = (...pairs: [string, number][]) => JSON.stringify(pairs.map(([id, q]) => ({ inventory_item_id: id, quantity: q })));
const tradeRow = (id: string) => one(`select * from public.trade_requests where id = $1`, [id]);
const start = async (user: string, pairs: [string, number][], method?: string) =>
  (
    await one(
      method === undefined
        ? `select public.trade_start($1, $2::jsonb, 'Lou', $3) as id`
        : `select public.trade_start($1, $2::jsonb, 'Lou', $3, $4) as id`,
      method === undefined ? [user, items(...pairs), `${user}@x.com`] : [user, items(...pairs), `${user}@x.com`, method],
    )
  ).id as string;
const approve = (id: string, deposit = 0) =>
  db.query(`select public.trade_approve($1, $2::timestamptz, $3, $4, null, null, 'jacob')`, [id, iso(Date.now() + 2 * DAY), deposit, deposit > 0 ? "trade" : null]);
const held = async (id: string) =>
  (await one(`select coalesce(sum(quantity), 0)::int as n from public.inventory_reservations where trade_request_id = $1 and status = 'active'`, [id])).n as number;
const confirm = (id: string, user: string, meetBy = Date.now() + 7 * DAY) =>
  one(`select * from public.trade_confirm($1, $2, 1, 'Local pickup terms', 7, $3::timestamptz, null, null, null)`, [id, user, iso(meetBy)]);
const complete = (id: string, cards: Row[], paid: number, method: string | null = null, cash = false) =>
  one(`select public.trade_complete_local($1, $2::jsonb, $3, $4, 'at the cafe', $5, null, 'jacob') as order_id`, [
    id,
    JSON.stringify(cards),
    paid,
    method,
    cash,
  ]);
const taken = (over: Row = {}): Row => ({
  scryfall_id: "66666666-6666-4666-8666-666666666666",
  card_name: "Sheoldred, the Apocalypse",
  set_code: "dmu",
  set_name: "Dominaria United",
  collector_number: "107",
  finish: "nonfoil",
  condition: "LP",
  quantity: 1,
  unit_cents: 5000,
  reference_price_cents: 6000,
  ...over,
});

describe("local pickup trades in the database", { timeout: 60_000 }, () => {
  beforeAll(async () => {
    db = new PGlite();
    await db.exec(STANDINS);
    await db.exec(UPSERT);
    for (const sql of MIGRATIONS) {
      await db.exec(sql);
      await db.exec(sql); // safe to run twice
    }
    await db.exec(`insert into auth.users (id, email) values ${Object.entries(users).map(([n, id]) => `('${id}', '${n}@example.com')`).join(", ")}`);
    await db.exec(`update public.trade_settings set enabled = true, max_active_trades = 10`);
    await db.exec(`set test.role = 'service_role'`);
    ring = await inv("Sol Ring", 5, 4000);
    bolt = await inv("Lightning Bolt", 5, 4000);
  }, 60_000);

  afterAll(async () => {
    await db?.close();
  });

  it("starts local pickup's own terms as copies of the shipped ones", async () => {
    const s = await one(`select * from public.trade_settings`);
    expect(s.local_credit_rate_percent).toBe(s.credit_rate_percent);
    expect(s.local_min_card_value_cents).toBe(s.min_card_value_cents);
    expect(s.local_min_trade_value_cents).toBe(s.min_trade_value_cents);
    expect(s.local_cash_payout_enabled).toBe(s.cash_payout_enabled);
    expect(s.local_cash_rate_percent).toBe(s.cash_rate_percent);
    // Running the migration again leaves changed values alone.
    await db.exec(`update public.trade_settings set local_credit_rate_percent = 77`);
    await db.exec(MIGRATIONS[3]);
    expect((await one(`select local_credit_rate_percent from public.trade_settings`)).local_credit_rate_percent).toBe(77);
    expect((await errorOf(`update public.trade_settings set local_credit_rate_percent = 0`))?.code).toBe("23514");
    expect((await errorOf(`update public.trade_settings set local_min_trade_value_cents = -1`))?.code).toBe("23514");
    await db.exec(`update public.trade_settings set local_credit_rate_percent = credit_rate_percent`);
  });

  it("gives local trades their own rate and minimums, and shipped trades theirs", async () => {
    // Shipped: 80% and $15 a card, $75 to start. Local: 90% and $5 a card, $40 to start.
    await db.exec(`update public.trade_settings set credit_rate_percent = 80, min_card_value_cents = 1500, min_trade_value_cents = 7500,
      local_credit_rate_percent = 90, local_min_card_value_cents = 500, local_min_trade_value_cents = 4000`);
    // $40 of our cards: enough for local pickup, not for shipping.
    expect((await errorOf(`select public.trade_start($1, $2::jsonb, 'X', 'x@x.com', 'ship')`, [users.ned, items([bolt, 1])]))?.message).toMatch(/\$75\.00 minimum/);
    const id = await start(users.ned, [[bolt, 1]], "local");
    let t = await tradeRow(id);
    expect(t.credit_rate_percent).toBe(90);
    expect(t.min_card_value_cents).toBe(500);

    // Switching to shipping takes on the shipped terms.
    await db.query(`select public.trade_set_handoff($1, $2, 'ship')`, [id, users.ned]);
    t = await tradeRow(id);
    expect(t.credit_rate_percent).toBe(80);
    expect(t.min_card_value_cents).toBe(1500);
    const switched = await one(`select detail from public.trade_events where trade_request_id = $1 and event = 'handoff_changed'`, [id]);
    expect(switched.detail).toMatchObject({ from: "local", to: "ship", credit_rate_percent: 80, min_card_value_cents: 1500 });

    // And back: local terms again, and it can be sent.
    await db.query(`select public.trade_set_handoff($1, $2, 'local')`, [id, users.ned]);
    t = await tradeRow(id);
    expect(t.credit_rate_percent).toBe(90);
    expect(t.min_card_value_cents).toBe(500);
    await db.query(`select public.trade_submit($1, $2, null)`, [id, users.ned]);
    expect((await tradeRow(id)).status).toBe("pending_review");

    // A local trade under the local minimum can't be sent either.
    await db.exec(`update public.trade_settings set local_min_trade_value_cents = 5000`);
    const small = await start(users.max, [[ring, 2]], "local");
    await db.query(`update public.trade_request_items set quantity = 1 where trade_request_id = $1`, [small]);
    await db.query(`select public.trade_recount_wanted($1)`, [small]);
    expect((await errorOf(`select public.trade_submit($1, $2, null)`, [small, users.max]))?.message).toMatch(/\$50\.00 minimum/);

    for (const [trade, statuses] of [[id, "pending_review"], [small, "awaiting_trade_list"]] as const) {
      await db.query(`select * from public.trade_close($1, 'canceled', array[$2], null, null, 'customer', null, 'x')`, [trade, statuses]);
    }
    await db.exec(`update public.trade_settings set local_credit_rate_percent = 80, local_min_card_value_cents = 1500, local_min_trade_value_cents = 7500`);
  });

  it("adds an optional meeting spot", async () => {
    const s = await one(`select local_meet_spot_name, local_meet_spot_address from public.trade_settings`);
    expect(s).toEqual({ local_meet_spot_name: null, local_meet_spot_address: null });
    await db.exec(`update public.trade_settings set local_meet_spot_name = 'Ballwin Library', local_meet_spot_address = '1600 Clarkson Rd'`);
    expect((await errorOf(`update public.trade_settings set local_meet_spot_name = '  '`))?.code).toBe("23514");
    expect((await errorOf(`update public.trade_settings set local_meet_spot_address = repeat('x', 201)`))?.code).toBe("23514");
    await db.exec(`update public.trade_settings set local_meet_spot_name = null, local_meet_spot_address = null`);
  });

  it("adds the settings, with local pickup on for 7 days", async () => {
    const s = await one(`select local_pickup_enabled, local_meet_days, local_pickup_area, local_pickup_details from public.trade_settings`);
    expect(s.local_pickup_enabled).toBe(true);
    expect(s.local_meet_days).toBe(7);
    expect(s.local_pickup_area).toBe("the St. Louis area");
    expect(s.local_pickup_details).toMatch(/public place/);
  });

  it("starts shipped trades as before, and local ones when asked", async () => {
    const shipped = await start(users.max, [[ring, 2]]);
    expect((await tradeRow(shipped)).handoff_method).toBe("ship");
    const local = await start(users.lou, [[ring, 2]], "local");
    expect((await tradeRow(local)).handoff_method).toBe("local");
    expect((await errorOf(`select public.trade_start($1, $2::jsonb, 'X', 'x@x.com', 'drone')`, [users.ned, items([ring, 2])]))?.code).toBe("GT010");
    await db.exec(`update public.trade_settings set local_pickup_enabled = false`);
    expect((await errorOf(`select public.trade_start($1, $2::jsonb, 'X', 'x@x.com', 'local')`, [users.ned, items([ring, 2])]))?.code).toBe("GT010");
    await db.exec(`update public.trade_settings set local_pickup_enabled = true`);
    // Tidy up so the customers have room for more trades.
    await db.query(`select * from public.trade_close($1, 'canceled', array['awaiting_trade_list'], null, null, 'customer', null, 'x')`, [shipped]);
    await db.query(`select * from public.trade_close($1, 'canceled', array['awaiting_trade_list'], null, null, 'customer', null, 'x')`, [local]);
  });

  it("switches between shipping and local pickup only while the customer can edit", async () => {
    const id = await start(users.lou, [[ring, 2]]);
    await db.query(`select public.trade_set_handoff($1, $2, 'local')`, [id, users.lou]);
    expect((await tradeRow(id)).handoff_method).toBe("local");
    expect((await one(`select count(*)::int as n from public.trade_events where trade_request_id = $1 and event = 'handoff_changed'`, [id])).n).toBe(1);
    expect((await errorOf(`select public.trade_set_handoff($1, $2, 'ship')`, [id, users.max]))?.code).toBe("GT404");
    await db.query(`select public.trade_submit($1, $2, null)`, [id, users.lou]);
    expect((await errorOf(`select public.trade_set_handoff($1, $2, 'ship')`, [id, users.lou]))?.code).toBe("GT009");
    await db.query(`select * from public.trade_close($1, 'rejected', array['pending_review'], 'x', null, 'staff', null, 'x')`, [id]);
  });

  it("sends a local trade without their cards; a shipped one still needs them", async () => {
    const shipped = await start(users.max, [[ring, 2]]);
    expect((await errorOf(`select public.trade_submit($1, $2, null)`, [shipped, users.max]))?.code).toBe("GT010");
    const local = await start(users.lou, [[ring, 2]], "local");
    await db.query(`select public.trade_submit($1, $2, 'Can meet weekends')`, [local, users.lou]);
    const t = await tradeRow(local);
    expect(t.status).toBe("pending_review");
    expect(t.customer_note).toBe("Can meet weekends");
    expect(t.needs_staff).toBe(true);
    await db.query(`select * from public.trade_close($1, 'canceled', array['awaiting_trade_list'], null, null, 'customer', null, 'x')`, [shipped]);
    await db.query(`select * from public.trade_close($1, 'rejected', array['pending_review'], 'x', null, 'staff', null, 'x')`, [local]);
  });

  it("approves a local trade with no review, no mailing address and never a deposit", async () => {
    // No mailing address set: a shipped trade couldn't be approved, a local one can.
    await db.exec(`update public.trade_settings set ship_to_line1 = null`);
    const id = await start(users.lou, [[ring, 2]], "local");
    await db.query(`select public.trade_submit($1, $2, null)`, [id, users.lou]);
    expect((await errorOf(`select public.trade_approve($1, $2::timestamptz, 1000, 'trade', null, null, 'jacob')`, [id, iso(Date.now() + DAY)]))?.code).toBe("GT010");
    // No confirmation deadline needed either: the customer doesn't confirm a local trade.
    await db.query(`select public.trade_approve($1, null, 0, null, null, null, 'jacob')`, [id]);
    const t = await tradeRow(id);
    // Approving holds our cards at once, with no deadline: until it's finished or canceled.
    expect(t.status).toBe("awaiting_shipment");
    expect(t.reserved_at).not.toBeNull();
    expect(t.ship_by).toBeNull();
    expect(t.confirm_by).toBeNull();
    expect(t.approved_value_cents).toBeNull();
    expect(t.deposit_status).toBe("not_required");
    expect(t.needs_staff).toBe(true);
    expect(await held(id)).toBe(2);
    expect((await one(`select public.trade_available($1, null) as n`, [ring])).n).toBe(3);
    expect((await all(`select status from public.trade_request_items where trade_request_id = $1`, [id])).map((r) => r.status)).toEqual(["reserved"]);
    expect((await one(`select event, to_status, detail from public.trade_events where trade_request_id = $1 and event = 'approved'`, [id]))).toMatchObject({
      to_status: "awaiting_shipment",
      detail: expect.objectContaining({ held_until: "finished" }),
    });
    expect((await errorOf(`select public.trade_set_deposit($1, 'required', 1000, 'trade', null, 'jacob')`, [id]))?.code).toBe("GT010");

    // Staff write where to meet.
    await db.query(`select public.trade_set_meetup($1, ' Saturday 2 PM, the library ', null, 'jacob')`, [id]);
    expect((await tradeRow(id)).meetup_details).toBe("Saturday 2 PM, the library");
    await db.query(`select public.trade_set_meetup($1, 'Saturday 2 PM, the library', null, 'jacob')`, [id]);
    expect((await one(`select count(*)::int as n from public.trade_events where trade_request_id = $1 and event = 'meetup_set'`, [id])).n).toBe(1);

    // There's nothing for the customer to confirm.
    expect((await errorOf(`select * from public.trade_confirm($1, $2, 1, 'Local pickup terms', 7, $3::timestamptz, null, null, null)`, [id, users.lou, iso(Date.now() + 7 * DAY)]))?.code).toBe("GT009");
    await db.exec(`update public.trade_settings set ship_to_line1 = '1 Main St'`);
  });

  it("holds nothing when one of our cards sold before approval", async () => {
    const solo = await inv("Mana Crypt", 1, 9000);
    const id = await start(users.ned, [[solo, 1], [bolt, 1]], "local");
    await db.query(`select public.trade_submit($1, $2, null)`, [id, users.ned]);
    await db.query(`update public.inventory_items set quantity = 0 where id = $1`, [solo]);
    expect((await errorOf(`select public.trade_approve($1, null, 0, null, null, null, 'jacob')`, [id]))?.code).toBe("GT004");
    expect((await tradeRow(id)).status).toBe("pending_review");
    expect(await held(id)).toBe(0);
    await db.query(`select * from public.trade_close($1, 'canceled', array['pending_review'], null, null, 'customer', null, 'x')`, [id]);
  });

  it("takes cards the customer changed their mind on off a held trade: each goes straight back on sale", async () => {
    const id = await start(users.ned, [[ring, 1], [bolt, 2]], "local");
    await db.query(`select public.trade_submit($1, $2, null)`, [id, users.ned]);
    await approve(id);
    const freeBolts = (await one(`select public.trade_available($1, null) as n`, [bolt])).n as number;
    expect(await held(id)).toBe(3);

    // They only want one Lightning Bolt, and no Sol Ring.
    await db.query(`select public.trade_set_wanted($1, $2::jsonb, array['awaiting_shipment'], 'staff', null, 'jacob')`, [id, items([bolt, 1])]);
    expect(await held(id)).toBe(1);
    expect((await one(`select public.trade_available($1, null) as n`, [bolt])).n).toBe(freeBolts + 1);
    const lines = await all(`select card_name, status, quantity from public.trade_request_items where trade_request_id = $1 order by card_name`, [id]);
    expect(lines).toEqual([
      { card_name: "Lightning Bolt", status: "reserved", quantity: 1 },
      { card_name: "Sol Ring", status: "removed", quantity: 1 },
    ]);
    expect((await tradeRow(id)).wanted_total_cents).toBe(4000);
    // Taking the last card off isn't allowed: cancel the trade instead.
    expect((await errorOf(`select public.trade_set_wanted($1, '[]'::jsonb, array['awaiting_shipment'], 'staff', null, 'jacob')`, [id]))?.code).toBe("GT010");
    await db.query(`select * from public.trade_close($1, 'canceled_by_store', array['awaiting_shipment'], null, null, 'staff', null, 'jacob')`, [id]);
    expect(await held(id)).toBe(0);
  });

  it("refuses a meetup on a shipped trade", async () => {
    const shipped = await start(users.max, [[bolt, 2]]);
    expect((await errorOf(`select public.trade_set_meetup($1, 'x', null, 'jacob')`, [shipped]))?.code).toBe("GT009");
    expect((await errorOf(`select public.trade_complete_local($1, '[]'::jsonb, 0, null, null, false, null, 'jacob')`, [shipped]))?.code).toBe("GT009");
    await db.query(`select * from public.trade_close($1, 'canceled', array['awaiting_trade_list'], null, null, 'customer', null, 'x')`, [shipped]);
  });

  it("finishes at the meetup: their cards, the difference paid in person, our cards handed over", async () => {
    const id = (await one(`select id from public.trade_requests where handoff_method = 'local' and status = 'awaiting_shipment' and user_id = $1`, [users.lou])).id as string;
    // Our cards: 2 × $40 = $80. Their cards: $50 + 2 × $10 = $70 → $56 credit at 80%. They pay $24.
    const cards = [taken(), taken({ scryfall_id: null, card_name: "Llanowar Elves", set_code: null, finish: "foil", condition: "NM", quantity: 2, unit_cents: 1000, reference_price_cents: null, note: "binder" })];
    expect((await errorOf(`select public.trade_complete_local($1, $2::jsonb, 2400, null, null, false, null, 'jacob')`, [id, JSON.stringify(cards)]))?.code).toBe("GT010");
    // A stale total is reported as the amount, before anything about how they paid.
    expect((await errorOf(`select public.trade_complete_local($1, $2::jsonb, 0, null, null, false, null, 'jacob')`, [id, JSON.stringify(cards)]))?.code).toBe("GT008");
    expect((await errorOf(`select public.trade_complete_local($1, $2::jsonb, 2000, 'cash', null, false, null, 'jacob')`, [id, JSON.stringify(cards)]))?.code).toBe("GT008");
    expect((await errorOf(`select public.trade_complete_local($1, $2::jsonb, 2400, 'cash', null, false, null, 'jacob')`, [id, JSON.stringify([taken({ condition: "Mint" })])]))?.code).toBe("GT010");
    expect((await errorOf(`select public.trade_complete_local($1, $2::jsonb, 2400, 'cash', null, false, null, 'jacob')`, [id, JSON.stringify([taken({ finish: "chrome" })])]))?.code).toBe("GT010");
    expect((await errorOf(`select public.trade_complete_local($1, $2::jsonb, 2400, 'cash', null, false, null, 'jacob')`, [id, JSON.stringify([taken({ quantity: 0 })])]))?.code).toBe("GT010");
    expect((await tradeRow(id)).status).toBe("awaiting_shipment"); // nothing changed on a refusal

    const orderId = (await complete(id, cards, 2400, "cash")).order_id as string;
    const t = await tradeRow(id);
    expect(t.status).toBe("completed");
    expect(t.order_id).toBe(orderId);
    expect(t.final_value_cents).toBe(7000);
    expect(t.final_credit_cents).toBe(5600);
    expect(t.amount_due_cents).toBe(2400);
    expect(t.shipping_cents).toBe(0);
    expect(t.local_payment_method).toBe("cash");
    expect(t.local_paid_cents).toBe(2400);
    expect(t.met_at).not.toBeNull();
    expect(t.completed_at).not.toBeNull();
    expect(t.return_status).toBe("none");
    expect(t.needs_staff).toBe(false);

    const o = await one(`select * from public.orders where id = $1`, [orderId]);
    expect(o.channel).toBe("pos");
    expect(o.shipping_method).toBeNull();
    expect(o.status).toBe("delivered");
    expect(o.delivered_at).not.toBeNull();
    expect(o.payment_provider).toBe("manual");
    expect(o.payment_reference).toBe("local cash: at the cafe");
    expect(o.total_cents).toBe(8000);
    expect(o.store_credit_used_cents).toBe(5600);
    expect(o.amount_due_cents).toBe(2400);
    expect(o.user_id).toBe(users.lou);
    expect(o.ship_line1).toBeNull();

    // Our cards left inventory; their hold was fulfilled.
    expect((await one(`select quantity from public.inventory_items where id = $1`, [ring])).quantity).toBe(3);
    expect((await one(`select count(*)::int as n from public.inventory_reservations where trade_request_id = $1 and status = 'fulfilled'`, [id])).n).toBe(1);
    // The credit was issued and spent on the order.
    expect((await one(`select public.store_credit_balance($1) as b`, [users.lou])).b).toBe(0);

    // Their cards, as staff recorded them, ready to add to inventory.
    const offers = await all(`select * from public.trade_offer_cards where trade_request_id = $1 order by position`, [id]);
    expect(offers).toHaveLength(2);
    expect(offers[0].verified_condition).toBe("LP");
    expect(offers[0].condition_percent).toBe(90);
    expect(offers[0].disposition).toBe("accepted");
    expect(offers[1].finish).toBe("foil");
    expect(offers[1].inspection_internal_note).toBe("binder");
    const imported = await one(`select public.trade_import_card($1, 1200, 'A1', 'jacob') as id`, [offers[1].id]);
    expect(imported.id).toBeTruthy();

    // Once finished, finishing again just returns the order.
    expect((await complete(id, [], 0)).order_id).toBe(orderId);
    const events = (await all(`select event from public.trade_events where trade_request_id = $1 order by created_at`, [id])).map((e) => e.event);
    expect(events).toEqual(expect.arrayContaining(["met_up", "finalized", "completed"]));
  });

  it("keeps credit left over as store credit, and can pay it in cash", async () => {
    // $40 of our cards, $100 of theirs: $80 credit, $40 left over.
    await db.exec(`update public.trade_settings set local_min_trade_value_cents = 0`);
    const a = await start(users.max, [[bolt, 1]], "local");
    await db.query(`select public.trade_submit($1, $2, null)`, [a, users.max]);
    await approve(a);
    await complete(a, [taken({ unit_cents: 10000 })], 0);
    const ta = await tradeRow(a);
    expect(ta.excess_cents).toBe(4000);
    expect(ta.local_payment_method).toBe("none");
    expect((await one(`select public.store_credit_balance($1) as b`, [users.max])).b).toBe(4000);
    expect((await one(`select payment_provider from public.orders where id = $1`, [ta.order_id])).payment_provider).toBe("store_credit");

    // Cash payouts for local pickup are their own setting: on for shipped trades isn't enough.
    await db.exec(`update public.trade_settings set cash_payout_enabled = true, cash_rate_percent = 50`);
    const b = await start(users.ned, [[bolt, 1]], "local");
    await db.query(`select public.trade_submit($1, $2, null)`, [b, users.ned]);
    await approve(b);
    expect(
      (await errorOf(`select public.trade_complete_local($1, $2::jsonb, 0, null, null, true, null, 'jacob')`, [b, JSON.stringify([taken({ unit_cents: 10000 })])]))
        ?.message,
    ).toMatch(/local pickup are turned off/);
    // With them on: the same $40 at the local cash rate (50% / 80%) is $25.
    await db.exec(`update public.trade_settings set cash_payout_enabled = false, local_cash_payout_enabled = true, local_cash_rate_percent = 50`);
    await complete(b, [taken({ unit_cents: 10000 })], 0, null, true);
    const tb = await tradeRow(b);
    expect(tb.excess_handling).toBe("cash");
    expect(tb.cash_payout_cents).toBe(2500);
    expect((await one(`select public.store_credit_balance($1) as b`, [users.ned])).b).toBe(0);
    await db.exec(`update public.trade_settings set local_cash_payout_enabled = false, local_min_trade_value_cents = 7500`);
  });

  it("buys our cards outright when they bring nothing we take", async () => {
    const id = await start(users.lou, [[bolt, 2]], "local");
    await db.query(`select public.trade_submit($1, $2, null)`, [id, users.lou]);
    await approve(id);
    await complete(id, [], 8000, "card");
    const t = await tradeRow(id);
    expect(t.status).toBe("completed");
    expect(t.final_value_cents).toBe(0);
    expect(t.local_payment_method).toBe("card");
    expect((await one(`select count(*)::int as n from public.trade_offer_cards where trade_request_id = $1`, [id])).n).toBe(0);
  });

  it("never lets a local trade's hold run out, even one confirmed under the old flow", async () => {
    const signet = await inv("Arcane Signet", 10, 4000);
    const crypt = await inv("Mind Stone", 10, 4000);
    const id = await start(users.max, [[signet, 2]], "local");
    await db.query(`select public.trade_submit($1, $2, null)`, [id, users.max]);
    await approve(id);
    // A local trade approved before this update, confirmed with a meetup deadline that has passed.
    const old = await start(users.max, [[crypt, 2]], "local");
    await db.query(`select public.trade_submit($1, $2, null)`, [old, users.max]);
    await db.query(`update public.trade_requests set status = 'awaiting_confirmation', confirm_by = now() + interval '1 day' where id = $1`, [old]);
    await db.query(`update public.trade_request_items set status = 'requested' where trade_request_id = $1`, [old]);
    expect((await confirm(old, users.max)).result).toBe("reserved");
    await db.query(`update public.trade_requests set ship_by = now() - interval '1 minute' where id = $1`, [old]);

    const expired = (await all(`select * from public.trade_expire_due(50, 24, true)`)).map((e) => e.expired_trade_id);
    expect(expired).not.toContain(id);
    expect(expired).not.toContain(old);
    expect((await tradeRow(id)).status).toBe("awaiting_shipment");
    expect((await tradeRow(old)).status).toBe("awaiting_shipment");
    expect(await held(id)).toBe(2);
    expect(await held(old)).toBe(2);

    // A shipped trade past its shipping deadline still expires.
    const shipped = await start(users.max, [[crypt, 2]]);
    await db.query(`update public.trade_requests set status = 'awaiting_shipment', ship_by = now() - interval '1 minute' where id = $1`, [shipped]);
    expect((await all(`select * from public.trade_expire_due(50, 24, true)`)).map((e) => e.expired_trade_id)).toContain(shipped);

    for (const t of [id, old]) {
      await db.query(`select * from public.trade_close($1, 'canceled', array['awaiting_shipment'], null, null, 'customer', null, 'x')`, [t]);
    }
  });

  it("only the server can call the new functions", async () => {
    await db.exec(`set test.role = 'authenticated'`);
    for (const statement of [
      `select public.trade_set_handoff(gen_random_uuid(), gen_random_uuid(), 'local')`,
      `select public.trade_set_meetup(gen_random_uuid(), 'x', null, 'x')`,
      `select public.trade_complete_local(gen_random_uuid(), '[]'::jsonb, 0, null, null, false, null, 'x')`,
    ]) {
      expect((await errorOf(statement))?.code).toBe("42501");
    }
    await db.exec(`set test.role = 'service_role'`);
  });
});
