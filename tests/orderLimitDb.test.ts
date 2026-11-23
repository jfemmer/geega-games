import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { STANDINS, UPSERT } from "./helpers/tradeDbStandins";
import { CONSIGNMENT_MIGRATIONS, PROD } from "./helpers/checkoutDbStandins";

// supabase/migrations/20261123210000_max_order_lines_setting.sql in PGlite:
// the most different cards one order may have is a store setting that
// checkout enforces (and names in its error), the storefront can read, and
// the admin settings page can compare carts against.

const read = (f: string) => readFileSync(new URL(`../supabase/migrations/${f}.sql`, import.meta.url), "utf8");

// What production has that these functions read: the store settings row,
// yard sales, and signed-in customers' carts.
const STORE = `
create table public.store_settings (
  id boolean primary key default true check (id),
  orders_paused boolean not null default false,
  orders_paused_message text not null default 'Away',
  orders_paused_until timestamptz,
  updated_at timestamptz not null default now(),
  updated_by uuid
);
insert into public.store_settings default values;
create table public.yard_sales (id uuid primary key default gen_random_uuid(), started_at timestamptz not null default now(),
  ends_at timestamptz not null, ended_at timestamptz);
create table public.cart_items (id uuid primary key default gen_random_uuid(), cart_id uuid not null,
  inventory_item_id uuid not null, quantity integer not null, created_at timestamptz not null default now(), updated_at timestamptz not null default now());
`;

// oxlint-disable-next-line typescript/no-explicit-any
type Row = Record<string, any>;
let db: PGlite;
const one = async (q: string, params?: unknown[]): Promise<Row> => (await db.query<Row>(q, params)).rows[0];
async function errorOf(statement: string, params?: unknown[]): Promise<{ code?: string; message?: string } | null> {
  try {
    await db.query(statement, params);
    return null;
  } catch (e) {
    return e as { code?: string; message?: string };
  }
}
const asRole = (role: string) => db.query(`select set_config('test.role', $1, false)`, [role]);

const ids: string[] = [];
function placeOrder(items: { id: string; qty: number }[]) {
  return one(
    `select * from public.checkout_place_order_core(null, 'buyer@x.com', $1::jsonb, 'tracked', 0, 'Buyer', '1 Main St', null, 'Kansas City', 'MO', '64105', 'US')`,
    [JSON.stringify(items.map((i) => ({ inventory_item_id: i.id, quantity: i.qty })))],
  );
}
const setLimit = (n: number) => db.query(`update public.store_settings set max_order_lines = $1`, [n]);

beforeAll(async () => {
  db = new PGlite();
  await db.exec(STANDINS);
  await db.exec(UPSERT);
  await db.exec(PROD);
  for (const f of CONSIGNMENT_MIGRATIONS) await db.exec(read(f));
  await db.exec(read("20261029120000_consignment_sales"));
  await db.exec(read("20261117120000_member_discount_cash_orders_only"));
  await db.exec(STORE);
  for (let i = 0; i < 2; i++) await db.exec(read("20261123210000_max_order_lines_setting")); // safe twice

  await asRole("service_role");
  for (const [name, cn] of [["Sol Ring", "1"], ["Arcane Signet", "2"], ["Command Tower", "3"]]) {
    ids.push(
      (
        await one(
          `select (public.admin_upsert_inventory(null, null, $1, 'CMR', 'Commander Legends', $2, 'common', null, null, 'NM', 'nonfoil', 10, 100)).id as id`,
          [name, cn],
        )
      ).id,
    );
  }
  await asRole("");
});
afterAll(() => db?.close());

describe("max different cards per order", () => {
  it("starts at 500 and stays between 1 and 1000", async () => {
    expect((await one(`select max_order_lines from public.store_settings`)).max_order_lines).toBe(500);
    expect((await errorOf(`update public.store_settings set max_order_lines = 0`))?.code).toBe("23514");
    expect((await errorOf(`update public.store_settings set max_order_lines = 1001`))?.code).toBe("23514");
  });

  it("refuses an order over the limit, naming both numbers, and creates nothing", async () => {
    await setLimit(2);
    const before = (await one(`select count(*)::int as n from public.orders`)).n;
    const err = await errorOf(
      `select * from public.checkout_place_order_core(null, 'buyer@x.com', $1::jsonb, 'tracked', 0, 'Buyer', '1 Main St', null, 'Kansas City', 'MO', '64105', 'US')`,
      [JSON.stringify(ids.map((id) => ({ inventory_item_id: id, quantity: 1 })))],
    );
    expect(err?.code).toBe("P0006");
    expect(err?.message).toBe("too many items: 3 different cards, limit 2");
    expect((await one(`select count(*)::int as n from public.orders`)).n).toBe(before);
  });

  it("counts different cards, not copies", async () => {
    await setLimit(2);
    const order = await placeOrder([
      { id: ids[0], qty: 4 },
      { id: ids[1], qty: 1 },
      { id: ids[0], qty: 1 },
    ]);
    expect(order.subtotal_cents).toBe(600);
  });

  it("takes a bigger order once the limit goes up", async () => {
    await setLimit(500);
    const order = await placeOrder(ids.map((id) => ({ id, qty: 1 })));
    expect(order.order_id).toBeTruthy();
  });

  it("tells the storefront the limit, alongside whether orders are paused", async () => {
    await setLimit(250);
    await asRole("anon");
    try {
      expect(await one(`select * from public.store_ordering_status()`)).toMatchObject({ paused: false, max_order_lines: 250 });
    } finally {
      await asRole("");
    }
    await db.query(`update public.store_settings set orders_paused = true`);
    expect(await one(`select paused, message, max_order_lines from public.store_ordering_status()`)).toEqual({
      paused: true,
      message: "Away",
      max_order_lines: 250,
    });
    await db.query(`update public.store_settings set orders_paused = false`);
  });

  it("sizes up signed-in carts for the settings page", async () => {
    const [a, b] = ["11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222"];
    await db.query(
      `insert into public.cart_items (cart_id, inventory_item_id, quantity) values ($1, $3, 2), ($1, $4, 1), ($1, $5, 1), ($2, $3, 1)`,
      [a, b, ...ids],
    );
    expect(await one(`select * from public.admin_cart_size_summary(2)`)).toEqual({ largest_lines: 3, carts_over_limit: 1 });
    expect(await one(`select * from public.admin_cart_size_summary(3)`)).toEqual({ largest_lines: 3, carts_over_limit: 0 });
  });

  it("keeps the cart summary and the order function away from the browser roles", async () => {
    const grants = await db.query<Row>(
      `select routine_name, grantee from information_schema.routine_privileges
       where routine_name in ('admin_cart_size_summary', 'checkout_place_order_core') and grantee in ('anon', 'authenticated', 'PUBLIC')`,
    );
    expect(grants.rows).toEqual([]);
  });
});
