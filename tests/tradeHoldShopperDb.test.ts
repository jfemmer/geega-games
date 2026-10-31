import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { STANDINS, UPSERT } from "./helpers/tradeDbStandins";

// Shoppers and copies held for a trade
// (supabase/migrations/20261031080000_trade_hold_shopper_notices.sql), run in
// PGlite on the Trade Center's migrations: the public lookup of held copies,
// and the queue of shoppers who asked to hear if one is released.

const read = (f: string) => readFileSync(new URL(`../supabase/migrations/${f}`, import.meta.url), "utf8");
const MIGRATIONS = [
  "20261025200000_trade_center.sql",
  "20261026233000_trade_function_search_path.sql",
  "20261027230000_trade_local_pickup.sql",
  "20261028010000_trade_local_terms.sql",
  "20261028030000_trade_meet_spot.sql",
  "20261031010000_trade_local_hold_until_finished.sql",
  "20261031050000_trade_import_condition_price.sql",
  "20261031070000_trade_hold_from_sending.sql",
  "20261031080000_trade_hold_shopper_notices.sql",
].map(read);

// Production's storefront price (a deal's price, or the listed one); the
// lookup only passes it through.
const PRICE_STANDIN = `
create function public.storefront_effective_price(p_price_cents integer, p_original_price_cents integer, p_is_deal boolean, p_ownership text)
returns integer language sql immutable as $$ select p_price_cents $$;`;

// oxlint-disable-next-line typescript/no-explicit-any
type Row = Record<string, any>;
let db: PGlite;
const one = async (q: string, params?: unknown[]): Promise<Row> => (await db.query<Row>(q, params)).rows[0];
const all = async (q: string, params?: unknown[]): Promise<Row[]> => (await db.query<Row>(q, params)).rows;

const ORACLE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ann = "11111111-1111-4111-8111-111111111111";
const bob = "22222222-2222-4222-8222-222222222222";

const card = {
  scryfall_id: "66666666-6666-4666-8666-666666666666", card_name: "Sheoldred, the Apocalypse", set_code: "dmu",
  set_name: "Dominaria United", collector_number: "107", finish: "nonfoil", image_url: null, quantity: 1,
  reported_condition: "NM", customer_estimate_cents: null, customer_note: null, reference_price_cents: 8000,
  reference_checked_at: new Date().toISOString(), condition_percent: 100, estimated_unit_cents: 8000,
  eligibility: "eligible", stock_on_hand: 0,
};
const inv = async (name: string, qty: number, extra: { oracle?: string; set?: string; condition?: string } = {}) =>
  (
    await one(
      `insert into public.inventory_items (oracle_id, card_name, set_code, set_name, collector_number, condition, finish, quantity, price_cents)
       values ($1, $2, $3, 'Test Set', '1', $4, 'nonfoil', $5, 500) returning id`,
      [extra.oracle ?? null, name, extra.set ?? "tst", extra.condition ?? "NM", qty],
    )
  ).id as string;
const items = (...pairs: [string, number][]) => JSON.stringify(pairs.map(([id, q]) => ({ inventory_item_id: id, quantity: q })));
async function sentTrade(user: string, pairs: [string, number][]): Promise<string> {
  const id = (await one(`select public.trade_start($1, $2::jsonb, 'Name', $3) as id`, [user, items(...pairs), `${user}@x.com`])).id;
  await one(`select public.trade_save_offer($1, $2, $3::jsonb) as v`, [id, user, JSON.stringify([card])]);
  await db.query(`select public.trade_submit($1, $2, null)`, [id, user]);
  return id;
}
const cancel = (id: string) =>
  db.query(`select * from public.trade_close($1, 'canceled', array['pending_review'], 'changed my mind', null, 'customer', null, 'x')`, [id]);
const watch = (item: string, email: string, createdAt = "now()") =>
  db.query(`insert into public.trade_hold_watchers (inventory_item_id, card_name, email, created_at) values ($1, 'x', $2, ${createdAt})`, [item, email]);
const due = async () => all(`select * from public.trade_hold_watchers_due(50)`);

describe("copies held for a trade, as shoppers see them", { timeout: 60_000 }, () => {
  beforeAll(async () => {
    db = new PGlite();
    await db.exec(STANDINS);
    await db.exec(UPSERT);
    await db.exec(PRICE_STANDIN);
    for (const sql of MIGRATIONS) await db.exec(sql);
    await db.exec(MIGRATIONS[MIGRATIONS.length - 1]); // safe to run twice
    await db.exec(`insert into auth.users (id, email) values ('${ann}', 'ann@example.com'), ('${bob}', 'bob@example.com')`);
    await db.exec(`set test.role = 'service_role'`);
    await db.exec("update public.trade_settings set enabled = true, paused = false, min_trade_value_cents = 0");
  }, 60_000);

  afterAll(async () => {
    await db?.close();
  });

  it("only the lookup is public; the watchers and their queue are server-only", async () => {
    const can = async (role: string, fn: string) =>
      (await one(`select has_function_privilege($1, $2, 'execute') as ok`, [role, fn])).ok;
    expect(await can("anon", "public.trade_held_copies(uuid, uuid[])")).toBe(true);
    expect(await can("authenticated", "public.trade_held_copies(uuid, uuid[])")).toBe(true);
    expect(await can("anon", "public.trade_hold_watchers_due(integer)")).toBe(false);
    expect(await can("authenticated", "public.trade_hold_watchers_due(integer)")).toBe(false);
    expect(await can("service_role", "public.trade_hold_watchers_due(integer)")).toBe(true);
    const t = await one(`select relrowsecurity as rls, has_table_privilege('anon', 'public.trade_hold_watchers', 'select') as anon_read,
      has_table_privilege('authenticated', 'public.trade_hold_watchers', 'insert') as auth_write from pg_class where oid = 'public.trade_hold_watchers'::regclass`);
    expect(t).toEqual({ rls: true, anon_read: false, auth_write: false });
  });

  it("shows the copies a sent trade holds, counts only", async () => {
    const bolt = await inv("Lightning Bolt", 1, { oracle: ORACLE, set: "lea" });
    const boltLp = await inv("Lightning Bolt", 3, { oracle: ORACLE, set: "m10", condition: "LP" });
    const free = await inv("Lightning Bolt", 2, { oracle: ORACLE, set: "2xm" });
    expect(await all(`select * from public.trade_held_copies($1, null)`, [ORACLE])).toEqual([]);

    const t = await sentTrade(ann, [[bolt, 1], [boltLp, 1]]);
    const held = await all(`select * from public.trade_held_copies($1, null)`, [ORACLE]);
    const by = Object.fromEntries(held.map((r) => [r.id, r]));
    expect(held).toHaveLength(2);
    expect(by[bolt]).toMatchObject({ card_name: "Lightning Bolt", held_quantity: 1, sellable_quantity: 0, price_cents: 500 });
    expect(by[boltLp]).toMatchObject({ held_quantity: 1, sellable_quantity: 2, condition: "LP" });
    expect(by[free]).toBeUndefined();
    expect(Object.keys(held[0]).sort()).toEqual(
      ["card_name", "collector_number", "condition", "finish", "held_quantity", "id", "image_url", "price_cents", "sellable_quantity", "set_code", "set_name", "variant_type"].sort(),
    );

    // By cart line, and a checkout hold isn't a trade hold.
    await db.query(`insert into public.inventory_reservations (inventory_item_id, customer_id, quantity) values ($1, gen_random_uuid(), 1)`, [free]);
    const lines = await all(`select id, held_quantity from public.trade_held_copies(null, $1::uuid[])`, [[bolt, free]]);
    expect(lines).toEqual([{ id: bolt, held_quantity: 1 }]);
    expect(await all(`select * from public.trade_held_copies(null, null)`)).toEqual([]);
    await cancel(t);
    expect(await all(`select * from public.trade_held_copies($1, null)`, [ORACLE])).toEqual([]);
  });

  it("a watcher is due once the copy is released, and not while it's held", async () => {
    const mox = await inv("Mox Diamond", 1);
    const t = await sentTrade(ann, [[mox, 1]]);
    await watch(mox, "shopper@example.com");
    expect(await due()).toEqual([]);
    await cancel(t);
    const [row] = await due();
    expect(row).toMatchObject({ inventory_item_id: mox, email: "shopper@example.com", card_name: "Mox Diamond", set_name: "Test Set", condition: "NM", state: "released" });
    expect(row.armed_at).toBeTruthy();
    await db.query(`update public.trade_hold_watchers set notified_at = now() where id = $1`, [row.id]);
    expect(await due()).toEqual([]);
  });

  it("a copy a shopper's checkout takes next is still held: the watcher waits", async () => {
    const crypt = await inv("Mana Vault", 1);
    const t = await sentTrade(bob, [[crypt, 1]]);
    await watch(crypt, "waiting@example.com");
    await cancel(t);
    const checkout = (await one(`insert into public.inventory_reservations (inventory_item_id, customer_id, quantity) values ($1, gen_random_uuid(), 1) returning id`, [crypt])).id;
    expect(await due()).toEqual([]);
    await db.query(`update public.inventory_reservations set status = 'released' where id = $1`, [checkout]);
    expect((await due()).map((r) => [r.email, r.state])).toEqual([["waiting@example.com", "released"]]);
    await db.exec(`delete from public.trade_hold_watchers`);
  });

  it("a copy that's gone closes quietly; one held for months expires", async () => {
    const gone = await inv("Gaea's Cradle", 1);
    await watch(gone, "gone@example.com");
    await db.query(`update public.inventory_items set quantity = 0 where id = $1`, [gone]); // traded away, nothing holding it
    const archived = await inv("Mishra's Workshop", 1);
    await watch(archived, "archived@example.com");
    await db.query(`update public.inventory_items set status = 'archived' where id = $1`, [archived]);
    const long = await inv("The Tabernacle", 1);
    await sentTrade(ann, [[long, 1]]);
    await watch(long, "old@example.com", "now() - interval '121 days'");
    await watch(long, "new@example.com");
    const states = Object.fromEntries((await due()).map((r) => [r.email, r.state]));
    expect(states).toEqual({ "gone@example.com": "gone", "archived@example.com": "gone", "old@example.com": "expired" });
  });

  it("one watcher per copy and email; deleting the copy removes them", async () => {
    const x = await inv("Force of Will", 1);
    await watch(x, "same@example.com");
    await expect(watch(x, "same@example.com")).rejects.toThrow(/duplicate key/);
    await expect(
      db.query(`insert into public.trade_hold_watchers (inventory_item_id, card_name, email, closed_reason) values ($1, 'x', 'z@example.com', 'whatever')`, [x]),
    ).rejects.toThrow(/check constraint/);
    await db.query(`delete from public.inventory_items where id = $1`, [x]);
    expect((await one(`select count(*)::int as n from public.trade_hold_watchers where inventory_item_id = $1`, [x])).n).toBe(0);
  });
});
