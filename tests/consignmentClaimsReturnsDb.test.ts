import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { STANDINS, UPSERT } from "./helpers/tradeDbStandins";
import { PROD } from "./helpers/consignmentDbStandins";

// Consignments, Phase 5 (supabase/migrations/20261029160000_consignment_claims_returns.sql)
// in PGlite: proceeds fall due by the agreement's inspection rule (6.1, 6.2);
// a hold stops only that card (6.4); adjustments are paid or recovered
// through payouts; a package's shipment record follows the consignors'
// insurance elections (5.2, 5.3); shipping claims reverse or keep sales by
// their outcome (5.4, 5.5); unsold cards go back through a tracked return
// (7.4) and a consignment closes only when nothing is left.

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
  "20261029120000_consignment_sales",
  "20261029160000_consignment_claims_returns",
].map((f) => readFileSync(new URL(`../supabase/migrations/${f}.sql`, import.meta.url), "utf8"));

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
async function svc<T>(fn: () => Promise<T>): Promise<T> {
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
const lots: Record<string, string> = {};

const row = (lot: string) => one(`select * from public.inventory_items where consignment_lot_id = $1`, [lot]);
const qty = (lot: string) => one(`select * from public.consignment_lot_quantities($1)`, [lot]);

async function buy(items: { lot: string; qty: number }[]) {
  const ids = await Promise.all(items.map(async (i) => ({ inventory_item_id: (await row(i.lot)).id, quantity: i.qty })));
  const o = await one(
    `select * from public.checkout_place_order_core($1, 'buyer@x.com', $2::jsonb, 'tracked', 0, 'Buyer', '1 Main St', null, 'Kansas City', 'MO', '64105', 'US')`,
    [buyer, JSON.stringify(ids)],
  );
  await db.query(`update public.orders set payment_status = 'paid', status = 'paid', paid_at = now() where id = $1`, [o.order_id]);
  return o.order_id as string;
}
const ship = (orderId: string, at = "now()") =>
  db.query(`update public.orders set status = 'shipped', shipped_at = ${at}, tracking_carrier = 'USPS', tracking_number = '9400 1', shipping_service = 'GroundAdvantage' where id = $1`, [orderId]);
const deliver = (orderId: string, at: string) => db.query(`update public.orders set status = 'delivered', delivered_at = $2::timestamptz where id = $1`, [orderId, at]);
const saleOf = (orderId: string, lot: string) => one(`select * from public.consignment_sales where order_id = $1 and lot_id = $2`, [orderId, lot]);

beforeAll(async () => {
  db = new PGlite();
  await db.exec(STANDINS);
  await db.exec(UPSERT);
  await db.exec(`create or replace function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;`);
  await db.exec(PROD);
  for (const sql of MIGRATIONS) await db.exec(sql);

  await db.query(`insert into auth.users (id, email) values ($1, 'pat@x.com'), ($2, 'buyer@x.com')`, [pat, buyer]);
  const consignor = await one(`insert into public.consignors (legal_name, email) values ('Pat Consignor', 'pat@x.com') returning id`);
  consignmentId = (await one(`insert into public.consignments (consignor_id) values ($1) returning id`, [consignor.id])).id;
  const versionId = (await one(`insert into public.consignment_agreement_versions (version_number, body_md) values (2, $1) returning id`, [RENDERED])).id;
  await svc(async () => {
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
    // Website and eBay approved; additional insurance approved (Option A).
    await db.query(
      `select public.consignment_sign_agreement($1, $2, 'pat@x.com', 'Pat Consignor', 'pat consignor', $3::jsonb, $4::jsonb, true, $5, '203.0.113.9', 'Mozilla/5.0')`,
      [agreementId, pat, JSON.stringify(ACKS), JSON.stringify({ website: true, tcgplayer: false, ebay: true }), sha(RENDERED)],
    );
    const line = (cardName: string, cn: string, quantity: number) => ({
      scryfallId: null, oracleId: null, cardName, setCode: "CMR", setName: "Commander Legends", collectorNumber: cn, finish: "nonfoil", declaredCondition: "NM", quantity,
    });
    await db.query(`select public.consignment_receive($1, $2::jsonb, 'mail', null, null, null, 'jacob')`, [
      consignmentId,
      JSON.stringify([line("Jace", "1", 1), line("Sol Ring", "2", 4), line("Mana Crypt", "3", 1), line("Arcane Signet", "4", 3)]),
    ]);
    for (const l of await all(`select id, card_name from public.consignment_lots`)) lots[l.card_name] = l.id;
    await db.query(`select public.consignment_inspect_lot($1, 'accept', 1, 'NM', null, 20000, 18000, null, false, 'j')`, [lots.Jace]);
    await db.query(`select public.consignment_inspect_lot($1, 'accept', 3, 'NM', null, 300, null, 'One proxy', false, 'j')`, [lots["Sol Ring"]]);
    await db.query(`select public.consignment_inspect_lot($1, 'accept', 1, 'NM', null, 15000, null, null, false, 'j')`, [lots["Mana Crypt"]]);
    await db.query(`select public.consignment_inspect_lot($1, 'accept', 3, 'NM', null, 400, null, null, false, 'j')`, [lots["Arcane Signet"]]);
    await db.query(`select public.consignment_list_lot($1, 1, null, 'j')`, [lots.Jace]);
    await db.query(`select public.consignment_list_lot($1, 3, null, 'j')`, [lots["Sol Ring"]]);
    await db.query(`select public.consignment_list_lot($1, 1, null, 'j')`, [lots["Mana Crypt"]]);
    await db.query(`select public.consignment_list_lot($1, 2, null, 'j')`, [lots["Arcane Signet"]]);
  });
});

afterAll(async () => {
  await db?.close();
});

describe("payout timing (6.1, 6.2)", () => {
  it("starts the inspection period the day after delivery and ends it at 11:59 p.m. Central", async () => {
    // Delivered Monday afternoon: Tue, Wed, Thu; due Friday.
    const mon = await one(`select public.consignment_payable_at('2026-10-26 15:00-05', 3) as p, public.consignment_payout_due_on(public.consignment_payable_at('2026-10-26 15:00-05', 3)) as d`);
    expect(new Date(mon.p).toISOString()).toBe("2026-10-30T05:00:00.000Z"); // Fri 00:00 CDT
    expect(mon.d.toISOString().slice(0, 10)).toBe("2026-10-30");
    // Delivered late Monday Central (already Tuesday in UTC) still counts as Monday.
    const late = await one(`select public.consignment_payable_at('2026-10-27 04:30+00', 3) as p`);
    expect(new Date(late.p).toISOString()).toBe("2026-10-30T05:00:00.000Z");
    // Due on a Sunday: paid Monday.
    const wed = await one(`select public.consignment_payout_due_on(public.consignment_payable_at('2026-10-28 10:00-05', 3)) as d`);
    expect(wed.d.toISOString().slice(0, 10)).toBe("2026-11-02");
  });
});

describe("shipments, holds and adjustments", () => {
  let order: string;
  let jace: Row;

  it("records the package, and that it needs insurance the consignor approved", async () => {
    order = await buy([{ lot: lots.Jace, qty: 1 }]);
    const sh = await one(`select * from public.consignment_shipments where order_id = $1`, [order]);
    expect(sh).toMatchObject({ declared_value_cents: 20000, insurance_needed: true, over_limit: false });
    jace = await saleOf(order, lots.Jace);
    expect(jace.insurance_elected).toBe(true);
    await svc(() => db.query(`select public.consignment_record_insurance($1, 20000, 455, 'USPS counter', null, 'jacob')`, [order]));
    expect((await one(`select insurance_premium_cents from public.consignment_shipments where order_id = $1`, [order])).insurance_premium_cents).toBe(455);
  });

  it("holds only the affected sale, and blocks settling it until resolved", async () => {
    await ship(order);
    await deliver(order, new Date(Date.now() - 6 * 86_400_000).toISOString());
    jace = await saleOf(order, lots.Jace);
    expect(jace.payout_due_on).not.toBeNull();
    await svc(async () => {
      const hold = (await one(`select public.consignment_open_hold($1, 'buyer_report', 'Buyer says the corner is bent', 'jacob') as id`, [jace.id])).id;
      expect((await errorOf(`select public.consignment_settle_sale($1, 0, 610, 0, 455, 0, null, '{}', 'j')`, [jace.id]))?.code).toBe("GC082");
      await db.query(`select public.consignment_release_hold($1, 'Photos match our grading; no refund', 'jacob')`, [hold]);
      await db.query(`select public.consignment_settle_sale($1, 0, 610, 0, 455, 0, null, '{}', 'j')`, [jace.id]);
    });
    // $200 − $6.10 − $4.55 = $189.35 net; 10% = $18.94 (half up); payout $170.41.
    expect((await saleOf(order, lots.Jace)).payout_cents).toBe(17041);
  });

  it("pays sales and adjustments together, and won't pay out less than $0", async () => {
    await svc(async () => {
      const charge = (await one(`select public.consignment_add_adjustment($1, null, 'refund_costs', -2000, 'Return costs for a misdescribed card (6.5(3))', 'jacob') as id`, [consignmentId])).id;
      const big = (await one(`select public.consignment_add_adjustment($1, null, 'chargeback', -50000, 'Chargeback after payout (6.6)', 'jacob') as id`, [consignmentId])).id;
      expect(
        (await errorOf(`select public.consignment_record_payout($1, $2::uuid[], $3::uuid[], 'paypal', null, now(), null, 'j')`, [consignmentId, [jace.id], [charge, big]]))?.code,
      ).toBe("GC085");
      await db.query(`select public.consignment_void_adjustment($1, 'Entered by mistake', 'jacob')`, [big]);
      const id = (await one(`select public.consignment_record_payout($1, $2::uuid[], $3::uuid[], 'paypal', 'PP-1', now(), null, 'j') as id`, [consignmentId, [jace.id], [charge]])).id;
      const p = await one(`select amount_cents, sale_count, adjustment_count from public.consignment_payouts where id = $1`, [id]);
      expect(p).toEqual({ amount_cents: (await saleOf(order, lots.Jace)).payout_cents - 2000, sale_count: 1, adjustment_count: 1 });
      expect((await errorOf(`select public.consignment_void_adjustment($1, 'x', 'j')`, [charge]))?.code).toBe("GC084");
    });
  });

  it("refuses an insurance charge the consignor never approved", async () => {
    // Pat approved insurance; flip the snapshot on a second sale to model a declined election.
    const o = await buy([{ lot: lots["Sol Ring"], qty: 1 }]);
    const s = await saleOf(o, lots["Sol Ring"]);
    await db.query(`select set_config('geega.consignment_write', 'on', false)`);
    await db.query(`update public.consignment_sales set insurance_elected = false where id = $1`, [s.id]);
    await db.query(`select set_config('geega.consignment_write', '', false)`);
    await ship(o);
    await deliver(o, new Date(Date.now() - 6 * 86_400_000).toISOString());
    await svc(async () => {
      expect((await errorOf(`select public.consignment_settle_sale($1, 0, 39, 0, 10, 0, null, '{}', 'j')`, [s.id]))?.message).toMatch(/declined additional insurance/);
    });
  });
});

describe("shipping claims (5.4, 5.5)", () => {
  it("carrier loss: reverses the sale (no Commission), keeps the copy gone, and settles the claim payment as the sale", async () => {
    const o = await buy([{ lot: lots["Mana Crypt"], qty: 1 }, { lot: lots["Arcane Signet"], qty: 1 }]);
    await ship(o);
    await svc(async () => {
      expect((await errorOf(`select public.consignment_open_claim($1, 'stolen', null, 'j')`, [o]))?.code).toBe("GC045");
      const claim = (await one(`select public.consignment_open_claim($1, 'lost', 'No scans for 10 days', 'jacob') as id`, [o])).id;
      expect((await errorOf(`select public.consignment_open_claim($1, 'lost', null, 'j')`, [o]))?.code).toBe("GC086");
      const holds = await all(`select source from public.consignment_sale_holds where claim_id = $1 and resolved_at is null`, [claim]);
      expect(holds).toHaveLength(2);
      // Refunding the buyer doesn't cancel sales under a claim.
      await db.query(`update public.orders set status = 'refunded' where id = $1`, [o]);
      expect((await saleOf(o, lots["Mana Crypt"])).status).toBe("open");

      await db.query(`select public.consignment_update_claim($1, 'paid', 'CLM-9', now(), 'refunded', 10000, now(), null, 'jacob')`, [claim]);
      const crypt = await saleOf(o, lots["Mana Crypt"]);
      const signet = await saleOf(o, lots["Arcane Signet"]);
      const alloc = [
        { saleId: crypt.id, claimPaymentCents: 10000 },
        { saleId: signet.id, claimPaymentCents: 0, returnedDamaged: true },
      ];
      expect((await errorOf(`select public.consignment_close_claim($1, 'carrier_loss', $2::jsonb, 'Paid in part', 'j')`, [claim, JSON.stringify([{ saleId: crypt.id, claimPaymentCents: 20000 }, alloc[1]])]))?.code).toBe("GC045");
      await db.query(`select public.consignment_close_claim($1, 'carrier_loss', $2::jsonb, 'USPS paid $100 of $150 declared', 'jacob')`, [claim, JSON.stringify(alloc)]);
    });
    const crypt = await saleOf(o, lots["Mana Crypt"]);
    expect(crypt).toMatchObject({ status: "cancelled", lost: true });
    // The lost copy stays counted as gone, not back in stock.
    expect(await qty(lots["Mana Crypt"])).toMatchObject({ sold: 1, unlisted: 0 });
    // The damaged copy that came back is the consignor's again, unlisted.
    expect((await qty(lots["Arcane Signet"])).unlisted).toBe(2);
    // $100 claim payment, 20% (sold for $150 or less): $80 to the consignor.
    const adj = await one(`select kind, amount_cents from public.consignment_adjustments where sale_id = $1`, [crypt.id]);
    expect(adj).toEqual({ kind: "claim_payment", amount_cents: 8000 });
  });

  it("our responsibility: the sale stands and can be settled now", async () => {
    const o = await buy([{ lot: lots["Sol Ring"], qty: 1 }]);
    await ship(o);
    await svc(async () => {
      const claim = (await one(`select public.consignment_open_claim($1, 'lost', null, 'jacob') as id`, [o])).id;
      await db.query(`select public.consignment_close_claim($1, 'our_responsibility', null, 'We addressed it wrong', 'jacob')`, [claim]);
      const s = await saleOf(o, lots["Sol Ring"]);
      expect(s.status).toBe("open");
      await db.query(`select public.consignment_settle_sale($1, 0, 39, 0, 0, 0, null, '{}', 'j')`, [s.id]);
    });
  });
});

describe("returns (7.4) and closing", () => {
  it("won't return copies committed to a sale", async () => {
    // One Sol Ring in an unpaid checkout.
    const sol = await row(lots["Sol Ring"]);
    await one(
      `select * from public.checkout_place_order_core($1, 'buyer@x.com', $2::jsonb, 'tracked', 0, 'Buyer', '1 Main St', null, 'Kansas City', 'MO', '64105', 'US')`,
      [buyer, JSON.stringify([{ inventory_item_id: sol.id, quantity: 1 }])],
    );
    await svc(async () => {
      const err = await errorOf(`select public.consignment_request_return($1, $2::jsonb, false, 'consignor', null, 'pat')`, [
        consignmentId,
        JSON.stringify([{ lotId: lots["Sol Ring"], pool: "accepted", quantity: 1 }]),
      ]);
      expect(err?.code).toBe("GC089");
    });
  });

  it("returns everything unsold, and the declined copy, through to delivery", async () => {
    await svc(async () => {
      const id = (await one(`select public.consignment_request_return($1, null, true, 'consignor', 'Moving away', 'pat') as id`, [consignmentId])).id;
      const lines = await all(`select l.card_name, rl.pool, rl.quantity from public.consignment_return_lines rl join public.consignment_lots l on l.id = rl.lot_id where return_id = $1 order by 1, 2`, [id]);
      expect(lines).toEqual([
        { card_name: "Arcane Signet", pool: "accepted", quantity: 3 },
        { card_name: "Sol Ring", pool: "rejected", quantity: 1 },
      ]);
      expect((await errorOf(`select public.consignment_request_return($1, null, false, 'consignor', null, 'pat')`, [consignmentId]))?.code).toBe("GC088");

      await db.query(`select public.consignment_approve_return($1, 'jacob')`, [id]);
      expect((await row(lots["Arcane Signet"])).quantity).toBe(0);
      expect((await one(`select status from public.consignments where id = $1`, [consignmentId])).status).toBe("terminated");
      expect((await one(`select status from public.consignment_lots where id = $1`, [lots["Arcane Signet"]])).status).toBe("returned");

      expect((await errorOf(`select public.consignment_advance_return($1, 'ship', null, null, 'USPS', '9400 2', null, null, 'j')`, [id]))?.code).toBe("GC088");
      expect((await one(`select public.consignment_advance_return($1, 'quote', 595, false, null, null, null, null, 'j') as s`, [id])).s).toBe("awaiting_shipping_payment");
      expect((await one(`select public.consignment_advance_return($1, 'paid', null, null, null, null, null, now(), 'j') as s`, [id])).s).toBe("ready_to_ship");
      expect((await errorOf(`select public.consignment_advance_return($1, 'ship', null, null, 'USPS', ' ', null, null, 'j')`, [id]))?.code).toBe("GC045");
      expect((await one(`select public.consignment_advance_return($1, 'ship', null, null, 'USPS', '9400 2', 1200, now(), 'j') as s`, [id])).s).toBe("shipped");
      expect((await errorOf(`select public.consignment_cancel_return($1, 'x', 'j')`, [id]))?.code).toBe("GC088");

      // Not closable yet: a Sol Ring is still in a checkout and sales are unpaid.
      expect((await errorOf(`select public.consignment_close($1, 'j')`, [consignmentId]))?.code).toBe("GC090");
      expect((await one(`select public.consignment_advance_return($1, 'delivered', null, null, null, null, null, now(), 'j') as s`, [id])).s).toBe("delivered");
    });
  });

  it("shows the consignor their holds, adjustments, returns and term", async () => {
    await asUser(pat);
    const c = (await one(`select public.my_consignments() as x`)).x[0];
    await asUser("");
    expect(c.termEndsAt).not.toBeNull();
    expect(c.returns[0]).toMatchObject({ status: "delivered", endsConsignment: true, cards: 4, trackingNumber: "9400 2" });
    const jace = c.sales.find((s: Row) => s.cardName === "Jace");
    expect(jace.holds[0]).toMatchObject({ reason: "Buyer says the corner is bent", resolution: "Photos match our grading; no refund" });
    expect(jace.shipment).toMatchObject({ carrier: "USPS", declaredValueCents: 20000, insurancePremiumCents: 455 });
    expect(jace.shipment).not.toHaveProperty("trackingNumber");
    expect(c.adjustments.map((a: Row) => a.kind).sort()).toEqual(["claim_payment", "refund_costs"]);
  });

  it("can't be written around the functions", async () => {
    expect((await errorOf(`update public.consignment_returns set status = 'delivered'`))?.code).toBe("GC057");
    expect((await errorOf(`insert into public.consignment_adjustments (consignment_id, kind, amount_cents, reason) values ($1, 'goodwill', 100, 'gift')`, [consignmentId]))?.code).toBe("GC057");
  });
});
