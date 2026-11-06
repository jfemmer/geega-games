import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { STANDINS, UPSERT } from "./helpers/tradeDbStandins";

// Review holds (supabase/migrations/20261106010000_trade_review_holds.sql) in
// PGlite, a real Postgres, switched on: a trade's cards are held from the
// moment it's sent, through review and the confirmation window, until the
// hold becomes the trade's reservation. Every check below counts the actual
// active inventory_reservations rows, the same rows the shop, the cart and
// checkout subtract from stock.

const MIGRATIONS = [
  "../supabase/migrations/20261025200000_trade_center.sql",
  "../supabase/migrations/20261026233000_trade_function_search_path.sql",
  "../supabase/migrations/20261027230000_trade_local_pickup.sql",
  "../supabase/migrations/20261028010000_trade_local_terms.sql",
  "../supabase/migrations/20261028030000_trade_meet_spot.sql",
  "../supabase/migrations/20261031010000_trade_local_hold_until_finished.sql",
  "../supabase/migrations/20261031030000_trade_meetup_draft.sql",
  "../supabase/migrations/20261031050000_trade_import_condition_price.sql",
  "../supabase/migrations/20261106010000_trade_review_holds.sql",
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
const HOUR = 3600000;
const DAY = 24 * HOUR;

const users = {
  amy: "a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1",
  ben: "b2b2b2b2-b2b2-4b2b-8b2b-b2b2b2b2b2b2",
  cal: "c3c3c3c3-c3c3-4c3c-8c3c-c3c3c3c3c3c3",
  dee: "d4d4d4d4-d4d4-4d4d-8d4d-d4d4d4d4d4d4",
  eli: "e5e5e5e5-e5e5-4e5e-8e5e-e5e5e5e5e5e5",
  flo: "f6f6f6f6-f6f6-4f6f-8f6f-f6f6f6f6f6f6",
  gil: "a7a7a7a7-a7a7-4a7a-8a7a-a7a7a7a7a7a7",
  hal: "b8b8b8b8-b8b8-4b8b-8b8b-b8b8b8b8b8b8",
};

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
/** What every stock calculation subtracts: active holds on the card. */
const free = async (invId: string): Promise<number> => (await one(`select public.trade_available($1, null) as n`, [invId])).n;
const held = async (tradeId: string) =>
  (await one(`select coalesce(sum(quantity), 0)::int as n from public.inventory_reservations where trade_request_id = $1 and status = 'active'`, [tradeId])).n as number;
const lineStatuses = async (tradeId: string) =>
  (await all(`select status from public.trade_request_items where trade_request_id = $1 order by card_name`, [tradeId])).map((r) => r.status);

const offerCard = {
  scryfall_id: "66666666-6666-4666-8666-666666666666", card_name: "Sheoldred, the Apocalypse", set_code: "dmu",
  set_name: "Dominaria United", collector_number: "107", finish: "nonfoil", image_url: null, quantity: 1,
  reported_condition: "NM", customer_estimate_cents: null, customer_note: null, reference_price_cents: 8000,
  reference_checked_at: new Date().toISOString(), condition_percent: 100, estimated_unit_cents: 8000,
  eligibility: "eligible", stock_on_hand: 0,
};

async function draft(user: string, pairs: [string, number][], method = "ship"): Promise<string> {
  const id = (await one(`select public.trade_start($1, $2::jsonb, 'Name', $3, $4) as id`, [user, items(...pairs), `${user}@x.com`, method])).id as string;
  await one(`select public.trade_save_offer($1, $2, $3::jsonb) as v`, [id, user, JSON.stringify([offerCard])]);
  return id;
}
const submit = (id: string, user: string) => db.query(`select public.trade_submit($1, $2, null)`, [id, user]);
async function reviewAll(id: string) {
  const c = await one(`select id from public.trade_offer_cards where trade_request_id = $1`, [id]);
  await db.query(`select public.trade_review_cards($1, $2::jsonb, null, 'jacob')`, [
    id,
    JSON.stringify([{ id: c.id, review_status: "approved", approved_quantity: 1, approved_unit_cents: 7000 }]),
  ]);
}
const approve = (id: string, { deposit = 0, confirmBy = Date.now() + DAY } = {}) =>
  db.query(`select public.trade_approve($1, $2::timestamptz, $3, $4, null, null, 'jacob')`, [id, iso(confirmBy), deposit, deposit > 0 ? "threshold" : null]);
const confirm = (id: string, user: string, pi: string | null = null) =>
  one(`select * from public.trade_confirm($1, $2, 1, 'The terms', 2, $3::timestamptz, $4, null, null)`, [id, user, iso(Date.now() + 2 * DAY), pi]);
const releaseExpired = () => all(`select * from public.trade_release_expired_holds(50)`);
const backdateHold = (id: string, ms = HOUR) => db.query(`update public.trade_requests set hold_expires_at = now() - make_interval(secs => $2::double precision / 1000) where id = $1`, [id, ms]);

describe("review holds in the database", { timeout: 60_000 }, () => {
  beforeAll(async () => {
    db = new PGlite();
    await db.exec(STANDINS);
    await db.exec(UPSERT);
    for (const sql of MIGRATIONS) {
      await db.exec(sql);
      await db.exec(sql); // safe to run twice
    }
    await db.exec(`insert into auth.users (id, email) values ${Object.entries(users).map(([n, id]) => `('${id}', '${n}@example.com')`).join(", ")}`);
    await db.exec(`update public.trade_settings set enabled = true, max_active_trades = 10,
      ship_to_line1 = '225 St. Joseph St.', ship_to_city = 'Sainte Genevieve', ship_to_state = 'MO', ship_to_postal_code = '63670'`);
    await db.exec(`set test.role = 'service_role'`);
  }, 60_000);

  afterAll(async () => {
    await db?.close();
  });

  it("starts with holds on: 12 hours, up to $500, one held trade per customer", async () => {
    const s = await one(`select * from public.trade_settings`);
    expect(s.review_holds_enabled).toBe(true);
    expect(s.review_hold_hours).toBe(12);
    expect(s.review_hold_max_cents).toBe(50000);
    expect(s.review_holds_per_customer).toBe(1);
    expect((await errorOf(`update public.trade_settings set review_hold_hours = 0`))?.code).toBe("23514");
    expect((await errorOf(`update public.trade_settings set review_holds_per_customer = 0`))?.code).toBe("23514");
  });

  it("holds every card when the trade is sent, for 12 hours, and nobody else can take them", async () => {
    const ring = await inv("Sol Ring", 2, 5000);
    const bolt = await inv("Lightning Bolt", 1, 4000);
    const id = await draft(users.amy, [[ring, 2], [bolt, 1]]);
    expect(await held(id)).toBe(0);
    await submit(id, users.amy);
    const t = await tradeRow(id);
    expect(t.status).toBe("pending_review");
    expect(t.hold_stage).toBe("review");
    const hours = (new Date(t.hold_expires_at).getTime() - Date.now()) / HOUR;
    expect(hours).toBeGreaterThan(11.9);
    expect(hours).toBeLessThanOrEqual(12);
    expect(await held(id)).toBe(3);
    expect(await lineStatuses(id)).toEqual(["reserved", "reserved"]);
    expect(await free(ring)).toBe(0);
    expect(await free(bolt)).toBe(0);
    // Someone else's trade can't get the same copies.
    const err = await errorOf(`select public.trade_start($1, $2::jsonb, 'Ben', 'ben@x.com', 'ship')`, [users.ben, items([ring, 1], [bolt, 1])]);
    expect(err?.code).toBe("GT004");
    const log = await one(`select detail from public.trade_events where trade_request_id = $1 and event = 'hold_placed'`, [id]);
    expect(log.detail.stage).toBe("review");
  });

  it("refuses to send a trade whose card already sold, naming it, and holds nothing", async () => {
    const card = await inv("Rhystic Study", 1, 9000);
    const id = await draft(users.ben, [[card, 1]]);
    // The last copy goes to another customer's trade first.
    const other = await draft(users.cal, [[card, 1]]);
    await submit(other, users.cal);
    const err = await errorOf(`select public.trade_submit($1, $2, null)`, [id, users.ben]);
    expect(err?.code).toBe("GT004");
    expect(err?.message).toContain("Rhystic Study");
    const t = await tradeRow(id);
    expect(t.status).toBe("awaiting_trade_list");
    expect(t.hold_stage).toBeNull();
    expect(await held(id)).toBe(0);
    expect(await held(other)).toBe(1);
  });

  it("sends a trade over the limit without a hold; approving it then holds the cards", async () => {
    const big = await inv("Mana Crypt", 1, 60000);
    const id = await draft(users.dee, [[big, 1]]);
    await submit(id, users.dee);
    let t = await tradeRow(id);
    expect(t.status).toBe("pending_review");
    expect(t.hold_stage).toBeNull();
    expect(await held(id)).toBe(0);
    await reviewAll(id);
    const confirmBy = Date.now() + DAY;
    await approve(id, { confirmBy });
    t = await tradeRow(id);
    expect(t.status).toBe("awaiting_confirmation");
    expect(t.hold_stage).toBe("confirmation");
    expect(new Date(t.hold_expires_at).getTime()).toBe(new Date(iso(confirmBy)).getTime());
    expect(await held(id)).toBe(1);
  });

  it("holds one trade per customer at a time; the next goes to review unheld", async () => {
    const a = await inv("Arcane Signet", 3, 8000);
    const first = await draft(users.eli, [[a, 1]]);
    const second = await draft(users.eli, [[a, 1]]);
    await submit(first, users.eli);
    await submit(second, users.eli);
    expect((await tradeRow(first)).hold_stage).toBe("review");
    expect((await tradeRow(second)).hold_stage).toBeNull();
    expect(await held(first)).toBe(1);
    expect(await held(second)).toBe(0);
  });

  it("turns a review hold into a confirmation hold on approval, then into the reservation, without holding twice", async () => {
    const card = await inv("Smothering Tithe", 2, 7000);
    const id = await draft(users.flo, [[card, 2]]);
    await submit(id, users.flo);
    const before = await all(`select id from public.inventory_reservations where trade_request_id = $1 and status = 'active'`, [id]);
    await reviewAll(id);
    await approve(id);
    let t = await tradeRow(id);
    expect(t.hold_stage).toBe("confirmation");
    expect(new Date(t.hold_expires_at).getTime()).toBe(new Date(t.confirm_by).getTime());
    const during = await all(`select id from public.inventory_reservations where trade_request_id = $1 and status = 'active'`, [id]);
    expect(during.map((r) => r.id)).toEqual(before.map((r) => r.id)); // the same hold rows, not new ones
    const res = await confirm(id, users.flo);
    expect(res.result).toBe("reserved");
    t = await tradeRow(id);
    expect(t.status).toBe("awaiting_shipment");
    expect(t.hold_stage).toBeNull();
    expect(t.hold_expires_at).toBeNull();
    expect(await held(id)).toBe(2);
    expect(await free(card)).toBe(0);
    const after = await all(`select id from public.inventory_reservations where trade_request_id = $1 and status = 'active'`, [id]);
    expect(after.map((r) => r.id)).toEqual(before.map((r) => r.id));
  });

  it("keeps the confirmation hold while a deposit is paid, then reserves", async () => {
    const card = await inv("Esper Sentinel", 1, 9000);
    const id = await draft(users.gil, [[card, 1]]);
    await submit(id, users.gil);
    await reviewAll(id);
    await approve(id, { deposit: 1000 });
    const res = await confirm(id, users.gil, "pi_test_review_hold_1");
    expect(res.result).toBe("awaiting_deposit");
    let t = await tradeRow(id);
    expect(t.status).toBe("awaiting_deposit");
    expect(t.hold_stage).toBe("confirmation");
    expect(await held(id)).toBe(1);
    const r = await one(`select * from public.trade_reserve($1, 'pi_test_review_hold_1', 1000, 2, $2::timestamptz)`, [id, iso(Date.now() + 2 * DAY)]);
    expect(r.result).toBe("reserved");
    t = await tradeRow(id);
    expect(t.status).toBe("awaiting_shipment");
    expect(t.hold_stage).toBeNull();
    expect(await held(id)).toBe(1);
  });

  it("lets an expired review hold go, puts the stock back, and leaves the trade in review", async () => {
    const card = await inv("Dockside Extortionist", 1, 9000);
    const id = await draft(users.hal, [[card, 1]]);
    await submit(id, users.hal);
    expect(await free(card)).toBe(0);
    await backdateHold(id);
    const released = await releaseExpired();
    expect(released.map((r) => r.released_trade_id)).toContain(id);
    const t = await tradeRow(id);
    expect(t.status).toBe("pending_review");
    expect(t.hold_stage).toBeNull();
    expect(await held(id)).toBe(0);
    expect(await lineStatuses(id)).toEqual(["requested"]);
    expect(await free(card)).toBe(1);
    // Running again changes nothing.
    expect((await releaseExpired()).map((r) => r.released_trade_id)).not.toContain(id);
    const log = await one(`select detail from public.trade_events where trade_request_id = $1 and event = 'hold_expired'`, [id]);
    expect(log.detail.lines).toBe(1);
    // Approving later holds the card again if it's still there.
    await reviewAll(id);
    await approve(id);
    expect((await tradeRow(id)).hold_stage).toBe("confirmation");
    expect(await held(id)).toBe(1);
  });

  it("refuses an approval after the hold ended and the card sold, and holds nothing", async () => {
    const card = await inv("Grim Monolith", 1, 9000);
    const id = await draft(users.amy, [[card, 1]]);
    await db.query(`update public.trade_settings set review_holds_per_customer = 5`);
    await submit(id, users.amy);
    await backdateHold(id);
    await releaseExpired();
    // The copy sells (a customer's hold at checkout).
    await db.query(`insert into public.inventory_reservations (inventory_item_id, customer_id, quantity) values ($1, gen_random_uuid(), 1)`, [card]);
    await reviewAll(id);
    const err = await errorOf(`select public.trade_approve($1, $2::timestamptz, 0, null, null, null, 'jacob')`, [id, iso(Date.now() + DAY)]);
    expect(err?.code).toBe("GT004");
    expect(err?.message).toContain("Grim Monolith");
    const t = await tradeRow(id);
    expect(t.status).toBe("pending_review");
    expect(t.hold_stage).toBeNull();
    expect(await held(id)).toBe(0);
    await db.query(`update public.trade_settings set review_holds_per_customer = 1`);
  });

  it("never lets a confirmed reservation go when holds expire", async () => {
    const card = await inv("Jeweled Lotus", 1, 9000);
    const id = await draft(users.ben, [[card, 1]]);
    await submit(id, users.ben);
    await reviewAll(id);
    await approve(id);
    await confirm(id, users.ben);
    // Even a stray old timestamp can't come back: the guard clears it.
    const err = await errorOf(`update public.trade_requests set hold_stage = 'review', hold_expires_at = now() - interval '1 hour' where id = $1`, [id]);
    expect(err).toBeNull();
    expect((await tradeRow(id)).hold_stage).toBeNull();
    await releaseExpired();
    expect((await tradeRow(id)).status).toBe("awaiting_shipment");
    expect(await held(id)).toBe(1);
  });

  it("keeps cards held while the trade is edited under a review hold, and drops the hold past the limit", async () => {
    const a = await inv("Fierce Guardianship", 3, 6000);
    const b = await inv("Deflecting Swat", 2, 5000);
    const big = await inv("Gaea's Cradle", 1, 45000);
    const id = await draft(users.cal, [[a, 2]]);
    await db.query(`update public.trade_settings set review_holds_per_customer = 5`);
    await submit(id, users.cal);
    expect(await held(id)).toBe(2);
    const setWanted = (pairs: [string, number][]) =>
      db.query(`select public.trade_set_wanted($1, $2::jsonb, array['pending_review','revision_requested']::text[], 'staff', null, 'jacob')`, [id, items(...pairs)]);
    await setWanted([[a, 1], [b, 1]]);
    expect(await held(id)).toBe(2);
    expect(await free(a)).toBe(2);
    expect(await free(b)).toBe(1);
    expect((await tradeRow(id)).hold_stage).toBe("review");
    // Over $500 of our cards: the hold ends, the trade stays in review.
    await setWanted([[a, 1], [b, 1], [big, 1]]);
    const t = await tradeRow(id);
    expect(t.hold_stage).toBeNull();
    expect(t.status).toBe("pending_review");
    expect(await held(id)).toBe(0);
    expect(await free(big)).toBe(1);
    await db.query(`update public.trade_settings set review_holds_per_customer = 1`);
  });

  it("keeps the hold, as a review hold, when an approval is taken back for changes, and on resending keeps its clock", async () => {
    const card = await inv("Enlightened Tutor", 1, 9000);
    const id = await draft(users.dee, [[card, 1]]);
    await db.query(`update public.trade_settings set review_holds_per_customer = 5`);
    await submit(id, users.dee);
    await reviewAll(id);
    await approve(id);
    const confirmBy = (await tradeRow(id)).confirm_by;
    await db.query(`select public.trade_request_revision($1, 'Swap the foil please', null, 'jacob')`, [id]);
    let t = await tradeRow(id);
    expect(t.status).toBe("revision_requested");
    expect(t.hold_stage).toBe("review");
    expect(new Date(t.hold_expires_at).getTime()).toBe(new Date(confirmBy).getTime());
    expect(await held(id)).toBe(1);
    await submit(id, users.dee);
    t = await tradeRow(id);
    expect(t.status).toBe("pending_review");
    expect(t.hold_stage).toBe("review");
    expect(new Date(t.hold_expires_at).getTime()).toBe(new Date(confirmBy).getTime());
    expect(await held(id)).toBe(1);
    await db.query(`update public.trade_settings set review_holds_per_customer = 1`);
  });

  it("lets everything go when the customer cancels during review", async () => {
    const card = await inv("Mox Opal", 1, 9000);
    const id = await draft(users.eli, [[card, 1]]);
    await db.query(`update public.trade_settings set review_holds_per_customer = 5`);
    await submit(id, users.eli);
    expect(await free(card)).toBe(0);
    const r = await one(`select * from public.trade_close($1, 'canceled', array['pending_review']::text[], 'changed my mind', null, 'customer', null, 'eli')`, [id]);
    expect(r.closed).toBe(true);
    const t = await tradeRow(id);
    expect(t.hold_stage).toBeNull();
    expect(t.customer_fault).toBeNull();
    expect(await held(id)).toBe(0);
    expect(await free(card)).toBe(1);
    await db.query(`update public.trade_settings set review_holds_per_customer = 1`);
  });

  it("lets staff extend a review hold, and a confirmation extension moves the hold with it", async () => {
    const card = await inv("Teferi's Protection", 2, 8000);
    const id = await draft(users.flo, [[card, 1]]);
    await db.query(`update public.trade_settings set review_holds_per_customer = 5`);
    await submit(id, users.flo);
    const to = Date.now() + 20 * HOUR;
    await db.query(`select public.trade_extend($1, 'hold', $2::timestamptz, 8, false, 'Still pricing a foil', null, 'jacob')`, [id, iso(to)]);
    expect(new Date((await tradeRow(id)).hold_expires_at).getTime()).toBe(new Date(iso(to)).getTime());
    const ext = await one(`select kind, reason from public.trade_extensions where trade_request_id = $1`, [id]);
    expect(ext.kind).toBe("hold");
    await reviewAll(id);
    await approve(id);
    const later = Date.now() + 2 * DAY;
    await db.query(`select public.trade_extend($1, 'confirmation', $2::timestamptz, 24, true, 'Asked for a day', null, 'jacob')`, [id, iso(later)]);
    const t = await tradeRow(id);
    expect(new Date(t.confirm_by).getTime()).toBe(new Date(iso(later)).getTime());
    expect(new Date(t.hold_expires_at).getTime()).toBe(new Date(iso(later)).getTime());
    // No hold to extend on a trade that isn't held.
    const unheld = await draft(users.flo, [[card, 1]]);
    expect((await errorOf(`select public.trade_extend($1, 'hold', $2::timestamptz, 8, false, null, null, 'jacob')`, [unheld, iso(to)]))?.code).toBe("GT009");
    await db.query(`update public.trade_settings set review_holds_per_customer = 1`);
  });

  it("lets staff release a hold on purpose", async () => {
    const card = await inv("Demonic Tutor", 1, 9000);
    const id = await draft(users.gil, [[card, 1]]);
    await db.query(`update public.trade_settings set review_holds_per_customer = 5`);
    await submit(id, users.gil);
    const n = (await one(`select public.trade_hold_release($1, 'Customer asked', null, 'jacob') as n`, [id])).n;
    expect(n).toBe(1);
    expect((await tradeRow(id)).hold_stage).toBeNull();
    expect(await free(card)).toBe(1);
    expect((await errorOf(`select public.trade_hold_release($1, null, null, 'jacob')`, [id]))?.code).toBe("GT009");
    await db.query(`update public.trade_settings set review_holds_per_customer = 1`);
  });

  it("closes an unconfirmed approval at its deadline and lets its hold go", async () => {
    const card = await inv("Vampiric Tutor", 1, 9000);
    const id = await draft(users.hal, [[card, 1]]);
    await db.query(`update public.trade_settings set review_holds_per_customer = 5`);
    await submit(id, users.hal);
    await reviewAll(id);
    await approve(id);
    await db.query(`update public.trade_requests set confirm_by = now() - interval '1 minute', hold_expires_at = now() - interval '1 minute' where id = $1`, [id]);
    const expired = await all(`select * from public.trade_expire_due(50, 24, true)`);
    expect(expired.map((e) => e.expired_trade_id)).toContain(id);
    const t = await tradeRow(id);
    expect(t.status).toBe("offer_expired");
    expect(t.hold_stage).toBeNull();
    expect(await held(id)).toBe(0);
    expect(await free(card)).toBe(1);
    await db.query(`update public.trade_settings set review_holds_per_customer = 1`);
  });

  it("holds a local pickup trade from sending through to the meetup", async () => {
    const card = await inv("Chrome Mox", 1, 9000);
    const id = await draft(users.amy, [[card, 1]], "local");
    await db.query(`update public.trade_settings set review_holds_per_customer = 5`);
    await submit(id, users.amy);
    expect((await tradeRow(id)).hold_stage).toBe("review");
    expect(await held(id)).toBe(1);
    await db.query(`select public.trade_approve($1, null, 0, null, null, null, 'jacob')`, [id]);
    const t = await tradeRow(id);
    expect(t.status).toBe("awaiting_shipment");
    expect(t.hold_stage).toBeNull();
    expect(await held(id)).toBe(1);
    await db.query(`update public.trade_settings set review_holds_per_customer = 1`);
  });

  it("works as before with holds switched off", async () => {
    await db.query(`update public.trade_settings set review_holds_enabled = false, review_holds_per_customer = 5`);
    const card = await inv("Mystic Remora", 1, 9000);
    const id = await draft(users.ben, [[card, 1]]);
    await submit(id, users.ben);
    expect((await tradeRow(id)).hold_stage).toBeNull();
    expect(await held(id)).toBe(0);
    await reviewAll(id);
    await approve(id);
    expect((await tradeRow(id)).hold_stage).toBeNull();
    expect(await held(id)).toBe(0);
    await confirm(id, users.ben);
    expect(await held(id)).toBe(1);
    await db.query(`update public.trade_settings set review_holds_enabled = true, review_holds_per_customer = 1`);
  });

  it("only the server can let holds go", async () => {
    await db.exec(`set test.role = 'authenticated'`);
    expect((await errorOf(`select * from public.trade_release_expired_holds(50)`))?.code).toBe("42501");
    expect((await errorOf(`select public.trade_hold_release(gen_random_uuid(), null, null, 'x')`))?.code).toBe("42501");
    await db.exec(`set test.role = 'service_role'`);
  });
});
