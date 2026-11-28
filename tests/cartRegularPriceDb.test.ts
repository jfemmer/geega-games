import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { STANDINS, UPSERT } from "./helpers/tradeDbStandins";
import { CONSIGNMENT_MIGRATIONS, PROD } from "./helpers/checkoutDbStandins";

// supabase/migrations/20261127233000_cart_regular_price.sql in PGlite: the cart
// reads each card's sale price AND its regular price (for the struck-through
// price), following the storewide sale as it starts and ends, the same rule
// as the catalog. Consigned copies are never discounted.
//
// And 20261128041500_storefront_regular_prices.sql: what each card sells for
// once the sale is over, which the product feed sends Google during a sale.

const read = (f: string) => readFileSync(new URL(`../supabase/migrations/${f}.sql`, import.meta.url), "utf8");
const MIGRATIONS = CONSIGNMENT_MIGRATIONS.map(read);
const CONSIGNMENT_SALES = read("20261029120000_consignment_sales");
const CART_REGULAR_PRICE = read("20261127233000_cart_regular_price");
const STOREFRONT_REGULAR_PRICES = read("20261128041500_storefront_regular_prices");

// oxlint-disable-next-line typescript/no-explicit-any
type Row = Record<string, any>;

let db: PGlite;
const all = async (q: string, params?: unknown[]): Promise<Row[]> => (await db.query<Row>(q, params)).rows;
const ids: Record<string, string> = {};

async function addCard(name: string, price: number, original: number | null, isDeal: boolean, ownership = "business") {
  const row = (
    await db.query<Row>(
      `insert into public.inventory_items (card_name, set_code, collector_number, condition, finish, quantity, price_cents, original_price_cents, is_deal, ownership, consignment_lot_id)
       values ($1, 'TST', '1', 'NM', 'nonfoil', 2, $2, $3, $4, $5, case when $5 = 'consigned' then gen_random_uuid() end) returning id`,
      [name, price, original, isDeal, ownership],
    )
  ).rows[0];
  ids[name] = row.id;
}

/** What the cart sees, by card name: [price charged, struck-through regular price]. */
async function cart(): Promise<Record<string, [number, number | null]>> {
  const rows = await all(
    `select i.card_name, c.price_cents, c.original_price_cents
     from public.cart_item_availability($1::uuid[]) c join public.inventory_items i on i.id = c.id`,
    [Object.values(ids)],
  );
  return Object.fromEntries(rows.map((r) => [r.card_name, [r.price_cents, r.original_price_cents]]));
}

beforeAll(async () => {
  db = new PGlite();
  await db.exec(STANDINS);
  await db.exec(UPSERT);
  await db.exec(`create or replace function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;`);
  await db.exec(PROD);
  for (const sql of MIGRATIONS) await db.exec(sql);
  await db.exec(CONSIGNMENT_SALES);
  await db.exec(CART_REGULAR_PRICE);
  await db.exec(STOREFRONT_REGULAR_PRICES);

  await addCard("Regular", 1000, null, false);
  await addCard("Deal", 677, 846, true); // 20% off already: deeper than a 15% sale
  await addCard("Leftover", 1000, 1500, false); // an old deal's original price left behind
  // A consigned copy is normally only created through Consignments; build one
  // directly, pointing at a lot that isn't there (replica mode skips the
  // foreign key; the "consigned has a lot" check still holds).
  await db.exec(`set session_replication_role = replica`);
  await addCard("Consigned", 225, null, false, "consigned");
  await db.exec(`set session_replication_role = origin`);
}, 60_000);

afterAll(async () => {
  await db.close();
});

describe("cart_item_availability regular price", () => {
  it("shows only real deals when no sale is running", async () => {
    expect(await cart()).toEqual({
      Regular: [1000, null],
      Deal: [677, 846],
      Leftover: [1000, null],
      Consigned: [225, null],
    });
  });

  it("follows a storewide sale the moment it starts: sale price, regular price struck through", async () => {
    await db.query(
      `insert into public.storewide_sales (discount_percent, starts_at, ends_at) values (15, now() - interval '1 minute', now() + interval '1 day')`,
    );
    expect(await cart()).toEqual({
      Regular: [850, 1000],
      Deal: [677, 846], // the lower of the deal and the sale, never both
      Leftover: [850, 1000], // struck through at the real regular price, not the stale one
      Consigned: [225, null],
    });
  });

  it("goes back to regular prices when the sale ends", async () => {
    await db.query(`update public.storewide_sales set ends_at = now() - interval '1 second', starts_at = now() - interval '1 day'`);
    expect(await cart()).toEqual({
      Regular: [1000, null],
      Deal: [677, 846],
      Leftover: [1000, null],
      Consigned: [225, null],
    });
  });

  it("keeps the grants: anyone may call it, nothing else changed", async () => {
    const grants = await all(
      `select grantee from information_schema.routine_privileges
       where routine_schema = 'public' and routine_name = 'cart_item_availability' and privilege_type = 'EXECUTE'
       order by grantee`,
    );
    expect(grants.map((g) => g.grantee)).toEqual(expect.arrayContaining(["anon", "authenticated", "service_role"]));
    expect(grants.map((g) => g.grantee)).not.toContain("PUBLIC");
    const fn = await all(
      `select prosecdef, proconfig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = 'cart_item_availability'`,
    );
    expect(fn).toEqual([{ prosecdef: true, proconfig: ["search_path=public"] }]);
  });
});

describe("storefront_regular_prices (the product feed's after-sale price)", () => {
  async function regular(idsList: string[]): Promise<Record<string, number>> {
    const rows = await all(
      `select i.card_name, r.price_cents from public.storefront_regular_prices($1::uuid[]) r join public.inventory_items i on i.id = r.id`,
      [idsList],
    );
    return Object.fromEntries(rows.map((r) => [r.card_name, r.price_cents]));
  }

  it("is each card's own price during a sale: the deal price for deals, never the sale price", async () => {
    await db.query(`delete from public.storewide_sales`);
    await db.query(
      `insert into public.storewide_sales (discount_percent, starts_at, ends_at) values (25, now() - interval '1 minute', now() + interval '1 day')`,
    );
    expect((await cart()).Regular).toEqual([750, 1000]); // the sale is on...
    expect(await regular(Object.values(ids))).toEqual({ Regular: 1000, Deal: 677, Leftover: 1000, Consigned: 225 });
  });

  it("only answers for cards the shop lists, and only for up to 500 at a time", async () => {
    await db.query(`update public.inventory_items set status = 'archived' where id = $1`, [ids.Leftover]);
    expect(Object.keys(await regular(Object.values(ids))).sort()).toEqual(["Consigned", "Deal", "Regular"]);
    const tooMany = [...Object.values(ids), ...Array.from({ length: 500 }, () => crypto.randomUUID())];
    expect(await regular(tooMany)).toEqual({});
    await db.query(`update public.inventory_items set status = 'active' where id = $1`, [ids.Leftover]);
  });

  it("can be called by anyone (it's the price any visitor sees without a sale), nothing more", async () => {
    const grants = await all(
      `select grantee from information_schema.routine_privileges
       where routine_schema = 'public' and routine_name = 'storefront_regular_prices' and privilege_type = 'EXECUTE'`,
    );
    expect(grants.map((g) => g.grantee)).toEqual(expect.arrayContaining(["anon", "authenticated", "service_role"]));
    expect(grants.map((g) => g.grantee)).not.toContain("PUBLIC");
  });
});
