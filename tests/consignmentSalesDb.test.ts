import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { STANDINS, UPSERT } from "./helpers/tradeDbStandins";

// Consignments, Phase 4 (supabase/migrations/20261029120000_consignment_sales.sql)
// in PGlite: accepted cards are listed only where the consignor approved and
// never below their minimum; consigned cards are never discounted (storewide
// sale, member discount) and sell only online; a paid order records the sale,
// delivery starts the inspection period, settlement computes commission from
// the signed agreement, payouts cover settled sales; a cancelled order puts
// unshipped copies back on sale; the ledger can't be written around.

const MIGRATIONS = [
  "20261024170000_trades",
  "20261025200000_trade_center",
  "20261026233000_trade_function_search_path",
  "20261027230000_trade_local_pickup",
  "20261028010000_trade_local_terms",
  "20261028030000_trade_meet_spot",
  "20261028120000_consignment_foundation",
  "20261028150000_consignment_agreements",
  "20261028180000_consignment_receiving",
].map((f) => readFileSync(new URL(`../supabase/migrations/${f}.sql`, import.meta.url), "utf8"));
const PHASE4 = readFileSync(new URL("../supabase/migrations/20261029120000_consignment_sales.sql", import.meta.url), "utf8");

// What production has that the migration builds on: deal columns, shipping
// fields, storewide sales and the three-argument price functions (production's
// definitions), plus one existing function and view that price inventory, so
// the migration's rewrite of them is exercised.
const PROD = `
alter table public.inventory_items add column deal_source text, add column deal_discount_percent integer,
  add column deal_started_at timestamptz, add column deal_note text;
alter table public.orders add column shipped_at timestamptz, add column postage_cost_cents integer;
create function public.is_us_country(p text) returns boolean language sql immutable as $$ select coalesce(upper(p), 'US') in ('US', 'USA') $$;
create table public.storewide_sales (id uuid primary key default gen_random_uuid(), name text, enabled boolean not null default true,
  discount_percent integer not null, starts_at timestamptz not null, ends_at timestamptz not null);
create function public.storefront_effective_price(p_price_cents integer, p_original_price_cents integer, p_is_deal boolean)
returns integer language plpgsql stable set search_path to '' as $f$
declare v_discount integer; v_regular integer; v_sale_price integer;
begin
  if p_price_cents is null then return null; end if;
  select s.discount_percent into v_discount from public.storewide_sales s
  where s.enabled = true and now() >= s.starts_at and now() < s.ends_at order by s.starts_at desc limit 1;
  if v_discount is null then return p_price_cents; end if;
  v_regular := case when coalesce(p_is_deal, false) and p_original_price_cents is not null then p_original_price_cents else p_price_cents end;
  v_sale_price := greatest(1, round(v_regular * (100 - v_discount) / 100.0)::integer);
  return least(p_price_cents, v_sale_price);
end $f$;
create function public.storefront_effective_original_price(p_price_cents integer, p_original_price_cents integer, p_is_deal boolean)
returns integer language plpgsql stable set search_path to '' as $f$
declare v_effective integer; v_regular integer;
begin
  if p_price_cents is null then return null; end if;
  v_regular := case when coalesce(p_is_deal, false) and p_original_price_cents is not null then p_original_price_cents else p_price_cents end;
  v_effective := public.storefront_effective_price(p_price_cents, p_original_price_cents, p_is_deal);
  if v_effective < v_regular then return v_regular; end if;
  return p_original_price_cents;
end $f$;
create function public.storefront_effective_discount_percent(p_price_cents integer, p_original_price_cents integer, p_is_deal boolean)
returns integer language plpgsql stable set search_path to '' as $f$
declare v_effective integer; v_regular integer;
begin
  v_regular := public.storefront_effective_original_price(p_price_cents, p_original_price_cents, p_is_deal);
  v_effective := public.storefront_effective_price(p_price_cents, p_original_price_cents, p_is_deal);
  if v_regular is null or v_regular <= 0 or v_effective >= v_regular then return null; end if;
  return round((v_regular - v_effective) * 100.0 / v_regular)::integer;
end $f$;
create function public.inventory_live_prices(p_inventory_item_ids uuid[])
returns table(inventory_item_id uuid, price_cents integer) language sql stable set search_path to '' as $f$
  select i.id, public.storefront_effective_price(i.price_cents, i.original_price_cents, i.is_deal)
  from public.inventory_items i where i.id = any(p_inventory_item_ids);
$f$;
create view public.inventory_public with (security_invoker = true) as
  select i.id, public.storefront_effective_price(i.price_cents, i.original_price_cents, i.is_deal) as price_cents,
         public.storefront_effective_original_price(i.price_cents, i.original_price_cents, i.is_deal) as original_price_cents
  from public.inventory_items i where i.status = 'active';
`;

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
const asRole = (role: string) => db.query(`select set_config('test.role', $1, false)`, [role]);
const asUser = (uid: string) => db.query(`select set_config('test.uid', $1, false)`, [uid]);
async function asService<T>(fn: () => Promise<T>): Promise<T> {
  await asRole("service_role");
  try {
    return await fn();
  } finally {
    await asRole("");
  }
}
const sha = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");

const pat = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const buyer = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const RENDERED = "## 1. Parties\n\n" + "Consignment terms. ".repeat(20);
const ACKS = { esign: true, reviewed: true, commission: true, deductions: true, shipping_liability: true, inspection: true, term: true, estimates: true };
const TERMS = { commissionTiers: [{ maxPriceCents: 15000, rateBps: 2000 }, { maxPriceCents: null, rateBps: 1000 }], inspectionDays: 3 };

let consignmentId: string;
let solLot: string; // 3 accepted, min $1.75, list $2.25
let jaceLot: string; // 1 accepted, $200
let businessId: string;

const lotQty = (lot: string) => one(`select * from public.consignment_lot_quantities($1)`, [lot]);
const consignedRow = (lot: string) => one(`select * from public.inventory_items where consignment_lot_id = $1`, [lot]);

async function placeOrder(uid: string | null, items: { id: string; qty: number }[], method = "pwe") {
  return one(
    `select * from public.checkout_place_order_core($1, 'buyer@x.com', $2::jsonb, $3::public.shipping_method, 0, 'Buyer', '1 Main St', null, 'Kansas City', 'MO', '64105', 'US')`,
    [uid, JSON.stringify(items.map((i) => ({ inventory_item_id: i.id, quantity: i.qty }))), method],
  );
}
const pay = (orderId: string) =>
  db.query(`update public.orders set payment_status = 'paid', status = 'paid', paid_at = now(), payment_provider = 'stripe' where id = $1`, [orderId]);

beforeAll(async () => {
  db = new PGlite();
  await db.exec(STANDINS);
  await db.exec(UPSERT);
  await db.exec(`create or replace function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;`);
  await db.exec(PROD);
  for (const sql of MIGRATIONS) await db.exec(sql);
  await db.exec(PHASE4);

  await db.query(`insert into auth.users (id, email) values ($1, 'pat@x.com'), ($2, 'buyer@x.com')`, [pat, buyer]);
  const consignor = await one(`insert into public.consignors (legal_name, email) values ('Pat Consignor', 'pat@x.com') returning id`);
  consignmentId = (await one(`insert into public.consignments (consignor_id) values ($1) returning id`, [consignor.id])).id;
  const versionId = (await one(`insert into public.consignment_agreement_versions (version_number, body_md) values (2, $1) returning id`, [RENDERED])).id;

  await asService(async () => {
    await db.query(`select public.consignment_publish_version($1, 'jacob')`, [versionId]);
    const agreementId = (
      await one(`select public.consignment_create_invitation($1, $2, $3, $4::jsonb, 'pat@x.com', $5, now() + interval '14 days', 'jacob') as id`, [
        consignmentId,
        versionId,
        RENDERED,
        JSON.stringify(TERMS),
        "a".repeat(64),
      ])
    ).id;
    await db.query(
      `select public.consignment_sign_agreement($1, $2, 'pat@x.com', 'Pat Consignor', 'pat consignor', $3::jsonb, $4::jsonb, false, $5, '203.0.113.9', 'Mozilla/5.0')`,
      [agreementId, pat, JSON.stringify(ACKS), JSON.stringify({ website: true, tcgplayer: false, ebay: true }), sha(RENDERED)],
    );
    const line = (cardName: string, cn: string, quantity: number) => ({
      scryfallId: null, oracleId: null, cardName, setCode: "CMR", setName: "Commander Legends", collectorNumber: cn,
      finish: "nonfoil", declaredCondition: "NM", quantity,
    });
    await db.query(`select public.consignment_receive($1, $2::jsonb, 'mail', null, null, null, 'jacob')`, [
      consignmentId,
      JSON.stringify([line("Sol Ring", "472", 3), line("Jace, the Mind Sculptor", "999", 1)]),
    ]);
    solLot = (await one(`select id from public.consignment_lots where card_name = 'Sol Ring'`)).id;
    jaceLot = (await one(`select id from public.consignment_lots where card_name like 'Jace%'`)).id;
    await db.query(`select public.consignment_inspect_lot($1, 'accept', 3, 'NM', null, 225, 175, null, false, 'jacob')`, [solLot]);
    await db.query(`select public.consignment_inspect_lot($1, 'accept', 1, 'NM', null, 20000, 18000, null, false, 'jacob')`, [jaceLot]);
    businessId = (
      await one(`select (public.admin_upsert_inventory(null, null, 'Arcane Signet', 'CMR', 'Commander Legends', '297', 'common', null, null, 'NM', 'nonfoil', 5, 1000)).id as id`)
    ).id;
  });
});

afterAll(async () => {
  await db?.close();
});

describe("listing", () => {
  it("is only for the service role", async () => {
    expect((await errorOf(`select public.consignment_list_lot($1, 1, null, 'x')`, [solLot]))?.code).toBe("42501");
  });

  it("refuses a price below the consignor's minimum, or more copies than accepted", async () => {
    await asService(async () => {
      expect((await errorOf(`select public.consignment_list_lot($1, 1, 150, 'x')`, [solLot]))?.code).toBe("GC051");
      expect((await errorOf(`select public.consignment_list_lot($1, 4, null, 'x')`, [solLot]))?.code).toBe("GC061");
    });
  });

  it("puts accepted copies on the website as a consigned, sale-only row and starts the term", async () => {
    await asService(() => db.query(`select public.consignment_list_lot($1, 2, null, 'jacob')`, [solLot]));
    const row = await consignedRow(solLot);
    expect(row).toMatchObject({ ownership: "consigned", quantity: 2, price_cents: 225, status: "active", is_deal: false, card_name: "Sol Ring" });
    expect(await lotQty(solLot)).toEqual({ accepted: 3, on_sale: 2, pending: 0, sold: 0, unlisted: 1 });
    expect((await one(`select status from public.consignment_lots where id = $1`, [solLot])).status).toBe("listed");
    const c = await one(`select status, term_started_at from public.consignments where id = $1`, [consignmentId]);
    expect(c.status).toBe("active");
    expect(c.term_started_at).not.toBeNull();
  });

  it("adds more copies to the same row and reprices it, never below the minimum", async () => {
    await asService(async () => {
      await db.query(`select public.consignment_list_lot($1, 1, 250, 'jacob')`, [solLot]);
      expect((await errorOf(`select public.consignment_set_lot_price($1, 100, 'x')`, [solLot]))?.code).toBe("GC051");
      await db.query(`select public.consignment_set_lot_price($1, 225, 'jacob')`, [solLot]);
      await db.query(`select public.consignment_list_lot($1, 1, null, 'jacob')`, [jaceLot]);
    });
    expect(await consignedRow(solLot)).toMatchObject({ quantity: 3, price_cents: 225 });
    expect((await all(`select id from public.inventory_items where consignment_lot_id = $1`, [solLot])).length).toBe(1);
    const every = await all(`select * from public.consignment_lot_quantities_all($1) order by accepted`, [consignmentId]);
    expect(every.map((r) => [r.accepted, r.on_sale, r.unlisted])).toEqual([[1, 1, 0], [3, 3, 0]]);
  });

  it("can't be changed, discounted or held for pickup outside Consignments", async () => {
    const row = await consignedRow(solLot);
    expect((await errorOf(`update public.inventory_items set price_cents = 300 where id = $1`, [row.id]))?.code).toBe("GC052");
    expect((await errorOf(`update public.inventory_items set quantity = quantity + 5 where id = $1`, [row.id]))?.code).toBe("GC052");
    expect((await errorOf(`update public.inventory_items set is_deal = true, original_price_cents = 300 where id = $1`, [row.id]))?.code).toBe("GC050");
    expect(
      (await errorOf(`insert into public.inventory_reservations (inventory_item_id, pickup_request_id, quantity) values ($1, gen_random_uuid(), 1)`, [row.id]))?.code,
    ).toBe("GC053");
    // Harmless edits are fine.
    await db.query(`update public.inventory_items set storage_location = 'Binder 3' where id = $1`, [row.id]);
  });
});

describe("no discounts", () => {
  it("prices consigned cards at their list price during a storewide sale; our cards still get the sale", async () => {
    await db.query(`insert into public.storewide_sales (discount_percent, starts_at, ends_at) values (20, now() - interval '1 hour', now() + interval '1 day')`);
    const sol = await consignedRow(solLot);
    const prices = await all(`select * from public.inventory_live_prices($1::uuid[]) order by price_cents`, [[sol.id, businessId]]);
    expect(prices.map((p) => p.price_cents).sort((a, b) => a - b)).toEqual([225, 800]);
    const view = await one(`select price_cents, original_price_cents from public.inventory_public where id = $1`, [sol.id]);
    expect(view).toEqual({ price_cents: 225, original_price_cents: null });
    expect((await one(`select reloptions from pg_class where relname = 'inventory_public'`)).reloptions).toEqual(["security_invoker=true"]);
    const cart = await one(`select price_cents, sale_only from public.cart_item_availability($1::uuid[])`, [[sol.id]]);
    expect(cart).toEqual({ price_cents: 225, sale_only: true });
  });

  it("takes the member discount off our cards only, and ships tracked", async () => {
    const sol = await consignedRow(solLot);
    const order = await placeOrder(buyer, [
      { id: sol.id, qty: 1 },
      { id: businessId, qty: 1 },
    ]);
    // $2.25 consigned + $8.00 business (storewide 20%) = $10.25; 5% of $8.00 = $0.40; tracked $5.50.
    expect(order).toMatchObject({ subtotal_cents: 1025, shipping_cents: 550, total_cents: 1025 - 40 + 550 });
    const o = await one(`select discount_cents, shipping_method from public.orders where id = $1`, [order.order_id]);
    expect(o).toEqual({ discount_cents: 40, shipping_method: "tracked" });
    expect(await lotQty(solLot)).toMatchObject({ on_sale: 2, pending: 1, unlisted: 0 });
    await db.query(`update public.storewide_sales set enabled = false`);
    // Leave it unpaid; the next test pays it.
    await db.query(`select set_config('test.order', $1, false)`, [order.order_id]);
  });

  it("sells consigned cards online only", async () => {
    const sol = await consignedRow(solLot);
    const pos = await one(`insert into public.orders (channel, subtotal_cents, total_cents, amount_due_cents) values ('pos', 0, 0, 0) returning id`);
    const err = await errorOf(
      `insert into public.order_items (order_id, inventory_item_id, card_name, condition, finish, quantity, unit_price_cents, line_total_cents) values ($1, $2, 'Sol Ring', 'NM', 'nonfoil', 1, 225, 225)`,
      [pos.id, sol.id],
    );
    expect(err?.code).toBe("GC054");
  });
});

describe("sales, settlement and payouts", () => {
  let orderId: string;
  let saleId: string;

  it("records a sale when the order is paid, with the signed agreement's tiers and inspection period", async () => {
    orderId = (await one(`select current_setting('test.order') as id`)).id;
    await pay(orderId);
    const sales = await all(`select * from public.consignment_sales where order_id = $1`, [orderId]);
    expect(sales).toHaveLength(1);
    saleId = sales[0].id;
    expect(sales[0]).toMatchObject({ channel: "website", quantity: 1, unit_price_cents: 225, gross_cents: 225, status: "open", inspection_days: 3 });
    expect(sales[0].commission_tiers).toEqual(TERMS.commissionTiers);
    expect(await lotQty(solLot)).toEqual({ accepted: 3, on_sale: 2, pending: 0, sold: 1, unlisted: 0 });
  });

  it("can't be settled before delivery and the inspection period", async () => {
    await asService(async () => {
      expect((await errorOf(`select public.consignment_settle_sale($1, 0, 37, 50, 0, 0, null, '{}', 'jacob')`, [saleId]))?.code).toBe("GC064");
    });
    await db.query(`update public.orders set status = 'shipped', shipped_at = now() - interval '5 days' where id = $1`, [orderId]);
    await db.query(`update public.orders set status = 'delivered', delivered_at = now() - interval '1 day' where id = $1`, [orderId]);
    const s = await one(`select delivered_at, payable_at, shipped_at from public.consignment_sales where id = $1`, [saleId]);
    expect(new Date(s.payable_at).getTime() - new Date(s.delivered_at).getTime()).toBe(3 * 86_400_000);
    await asService(async () => {
      expect((await errorOf(`select public.consignment_settle_sale($1, 0, 37, 50, 0, 0, null, '{}', 'jacob')`, [saleId]))?.message).toMatch(/inspection period ends/);
    });
    await db.query(`update public.orders set delivered_at = now() - interval '4 days' where id = $1`, [orderId]);
  });

  it("settles with the actual expenses: net, commission by the card's price tier, payout", async () => {
    const payout = await asService(async () => {
      expect((await errorOf(`select public.consignment_settle_sale($1, 0, 37, 50, 0, 25, '  ', '{}', 'jacob')`, [saleId]))?.code).toBe("GC045");
      return (await one(`select public.consignment_settle_sale($1, 0, 37, 50, 0, 0, null, '{"basis":"test"}', 'jacob') as p`, [saleId])).p;
    });
    // $2.25 - $0.37 - $0.50 = $1.38 net; 20% (sold for $150 or less) = $0.28 (half up); payout $1.10.
    expect(payout).toBe(110);
    expect(await one(`select status, net_sale_cents, commission_rate_bps, commission_cents, payout_cents from public.consignment_sales where id = $1`, [saleId])).toEqual({
      status: "settled",
      net_sale_cents: 138,
      commission_rate_bps: 2000,
      commission_cents: 28,
      payout_cents: 110,
    });
  });

  it("pays settled sales, and a void payout puts them back to settled", async () => {
    await asService(async () => {
      expect((await errorOf(`select public.consignment_record_payout($1, $2::uuid[], 'bitcoin', null, now(), null, 'jacob')`, [consignmentId, [saleId]]))?.code).toBe("GC045");
      const id = (await one(`select public.consignment_record_payout($1, $2::uuid[], 'paypal', 'PP-123', now(), null, 'jacob') as id`, [consignmentId, [saleId]])).id;
      expect(await one(`select amount_cents, sale_count from public.consignment_payouts where id = $1`, [id])).toEqual({ amount_cents: 110, sale_count: 1 });
      expect((await one(`select status from public.consignment_sales where id = $1`, [saleId])).status).toBe("paid");
      expect((await errorOf(`select public.consignment_record_payout($1, $2::uuid[], 'paypal', null, now(), null, 'jacob')`, [consignmentId, [saleId]]))?.code).toBe("GC065");
      await db.query(`select public.consignment_void_payout($1, 'Sent to the wrong account', 'jacob')`, [id]);
      expect((await one(`select status, payout_id from public.consignment_sales where id = $1`, [saleId]))).toEqual({ status: "settled", payout_id: null });
      await db.query(`select public.consignment_record_payout($1, $2::uuid[], 'paypal', 'PP-124', now(), null, 'jacob')`, [consignmentId, [saleId]]);
    });
  });

  it("can't be written around the functions", async () => {
    expect((await errorOf(`update public.consignment_sales set payout_cents = 999 where id = $1`, [saleId]))?.code).toBe("GC057");
    expect((await errorOf(`delete from public.consignment_payouts`))?.code).toBe("GC057");
  });

  it("flags a paid-out sale whose order is later refunded", async () => {
    await db.query(`update public.orders set status = 'refunded' where id = $1`, [orderId]);
    const s = await one(`select status, flag from public.consignment_sales where id = $1`, [saleId]);
    expect(s.status).toBe("paid");
    expect(s.flag).toMatch(/refunded after this sale was paid out/);
  });

  it("cancels the sale and puts the copy back on sale when a paid order is cancelled before shipping", async () => {
    const sol = await consignedRow(solLot);
    const order = await placeOrder(buyer, [{ id: sol.id, qty: 2 }], "tracked");
    await pay(order.order_id);
    expect((await consignedRow(solLot)).quantity).toBe(0);
    expect((await one(`select status from public.consignment_lots where id = $1`, [solLot])).status).toBe("sold");
    await db.query(`update public.orders set status = 'cancelled' where id = $1`, [order.order_id]);
    const s = await one(`select status, restocked, cancel_reason from public.consignment_sales where order_id = $1`, [order.order_id]);
    expect(s).toEqual({ status: "cancelled", restocked: true, cancel_reason: "Order cancelled" });
    expect((await consignedRow(solLot)).quantity).toBe(2);
    expect((await one(`select status from public.consignment_lots where id = $1`, [solLot])).status).toBe("listed");
  });

  it("records marketplace sales only on approved channels, taking unlisted copies first", async () => {
    await asService(async () => {
      const args = (channel: string, qty: number, price: number) => [jaceLot, channel, qty, price];
      const sql = `select public.consignment_record_external_sale($1, $2, $3, $4, now() - interval '6 days', 'EB-1', 2650, 0, 600, null, 'jacob') as id`;
      expect((await errorOf(sql, args("tcgplayer", 1, 20000)))?.code).toBe("GC060");
      expect((await errorOf(sql, args("ebay", 1, 17000)))?.code).toBe("GC051");
      expect((await errorOf(sql, args("ebay", 2, 20000)))?.code).toBe("GC061");
      const id = (await one(sql, args("ebay", 1, 20000))).id;
      // The only copy was on the website, so it comes off.
      expect((await consignedRow(jaceLot)).quantity).toBe(0);
      expect(await one(`select channel, external_order_ref, marketplace_fee_cents, postage_cents, status from public.consignment_sales where id = $1`, [id])).toEqual({
        channel: "ebay",
        external_order_ref: "EB-1",
        marketplace_fee_cents: 2650,
        postage_cents: 600,
        status: "open",
      });
      await db.query(`select public.consignment_mark_sale_delivered($1, now() - interval '4 days', 'jacob')`, [id]);
      // $200 - $26.50 - $6.00 = $167.50; sold above $150, so 10% = $16.75 (half up to $16.75); payout $150.75.
      expect((await one(`select public.consignment_settle_sale($1, 2650, 0, 600, 0, 0, null, '{}', 'jacob') as p`, [id])).p).toBe(15075);
      await db.query(`select public.consignment_unsettle_sale($1, 'jacob')`, [id]);
      await db.query(`select public.consignment_cancel_sale($1, 'Buyer never paid', 'jacob')`, [id]);
      expect(await lotQty(jaceLot)).toMatchObject({ sold: 0, unlisted: 1 });
    });
  });
});

describe("the consignor's view", () => {
  it("shows their sales with the settlement, and payouts, without order details", async () => {
    await asUser(pat);
    const mine = (await one(`select public.my_consignments() as x`)).x;
    await asUser("");
    const c = mine[0];
    const settled = c.sales.find((s: Row) => s.status === "paid");
    expect(settled).toMatchObject({ cardName: "Sol Ring", channel: "website", unitPriceCents: 225 });
    expect(settled.settlement).toMatchObject({ netSaleCents: 138, commissionCents: 28, payoutCents: 110 });
    expect(settled).not.toHaveProperty("orderId");
    expect(c.payouts.filter((p: Row) => !p.voided)).toEqual([expect.objectContaining({ amountCents: 110, method: "paypal" })]);
  });
});
