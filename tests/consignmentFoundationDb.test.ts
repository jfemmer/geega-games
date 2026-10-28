import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { STANDINS, UPSERT } from "./helpers/tradeDbStandins";
import { parseEstimatorConfig } from "../src/store/lib/consignmentApi";
import {
  DEFAULT_COMMISSION_TIERS,
  applyBps,
  commissionRateBps,
  estimatePayout,
  insurancePremium,
  settle,
} from "../src/store/lib/consignmentMath";

// Consignments, Phase 1 (supabase/migrations/20261028120000_consignment_foundation.sql)
// in PGlite, on top of the Trade Center and Trade Evaluator migrations:
// owners on inventory rows, the owner guards, consigned stock refused by
// every trade path while purchases are unaffected, the effective-dated
// settings and the SQL payout math agreeing with consignmentMath.ts.

const MIGRATIONS = [
  "../supabase/migrations/20261024170000_trades.sql",
  "../supabase/migrations/20261025200000_trade_center.sql",
  "../supabase/migrations/20261026233000_trade_function_search_path.sql",
  "../supabase/migrations/20261027230000_trade_local_pickup.sql",
  "../supabase/migrations/20261028010000_trade_local_terms.sql",
  "../supabase/migrations/20261028030000_trade_meet_spot.sql",
  "../supabase/migrations/20261028120000_consignment_foundation.sql",
].map((path) => readFileSync(new URL(path, import.meta.url), "utf8"));

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

const user = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
let lotId: string;
let ours: string;
let theirs: string;

/** A consigned row, the way the receiving flow (Phase 3) will make one. */
async function consignedRow(qty: number, price: number): Promise<string> {
  await db.query(`select set_config('geega.consignment_write', 'on', false)`);
  try {
    return (
      await one(
        `insert into public.inventory_items (card_name, set_code, collector_number, condition, finish, quantity, price_cents, ownership, consignment_lot_id)
         values ('Sol Ring', 'cmr', '1', 'NM', 'nonfoil', $1, $2, 'consigned', $3) returning id`,
        [qty, price, lotId],
      )
    ).id;
  } finally {
    await db.query(`select set_config('geega.consignment_write', '', false)`);
  }
}

beforeAll(async () => {
  db = new PGlite();
  await db.exec(STANDINS);
  await db.exec(UPSERT);
  for (const sql of MIGRATIONS) await db.exec(sql);
  await db.query(`insert into auth.users (id, email) values ($1, 'lou@x.com')`, [user]);
  await db.exec(`update public.trade_settings set enabled = true`);

  const consignor = await one(`insert into public.consignors (legal_name, email, state_code) values ('Pat Consignor', 'pat@x.com', 'MO') returning id`);
  const consignment = await one(`insert into public.consignments (consignor_id) values ($1) returning id, consignment_number, status`, [consignor.id]);
  expect(Number(consignment.consignment_number)).toBe(1001);
  expect(consignment.status).toBe("draft");
  lotId = (
    await one(
      `insert into public.consignment_lots (consignment_id, card_name, set_code, collector_number, condition, quantity_submitted, quantity_accepted, status)
       values ($1, 'Sol Ring', 'cmr', '1', 'NM', 3, 3, 'accepted') returning id`,
      [consignment.id],
    )
  ).id;

  // Mixed ownership: two of ours and three of a consignor's, same printing and condition.
  ours = (
    await one(
      `insert into public.inventory_items (card_name, set_code, collector_number, condition, finish, quantity, price_cents)
       values ('Sol Ring', 'cmr', '1', 'NM', 'nonfoil', 2, 5000) returning id`,
    )
  ).id;
  theirs = await consignedRow(3, 5000);
});

afterAll(async () => {
  await db?.close();
});

describe("inventory owners", () => {
  it("makes every existing and new row ours unless it says otherwise", async () => {
    expect((await one(`select ownership, consignment_lot_id from public.inventory_items where id = $1`, [ours]))).toEqual({
      ownership: "business",
      consignment_lot_id: null,
    });
  });

  it("refuses a consigned row made outside receiving, or one without its lot", async () => {
    const outside = await errorOf(
      `insert into public.inventory_items (card_name, set_code, collector_number, condition, finish, quantity, ownership, consignment_lot_id)
       values ('Sol Ring', 'cmr', '1', 'NM', 'nonfoil', 1, 'consigned', $1)`,
      [lotId],
    );
    expect(outside?.code).toBe("GC001");

    await db.query(`select set_config('geega.consignment_write', 'on', false)`);
    const noLot = await errorOf(
      `insert into public.inventory_items (card_name, set_code, collector_number, condition, finish, quantity, ownership)
       values ('Sol Ring', 'cmr', '1', 'NM', 'nonfoil', 1, 'consigned')`,
    );
    await db.query(`select set_config('geega.consignment_write', '', false)`);
    expect(noLot?.code).toBe("23514");
  });

  it("never changes a row's owner in place, in either direction", async () => {
    expect((await errorOf(`update public.inventory_items set ownership = 'business', consignment_lot_id = null where id = $1`, [theirs]))?.code).toBe("GC002");
    expect((await errorOf(`update public.inventory_items set ownership = 'consigned', consignment_lot_id = $2 where id = $1`, [ours, lotId]))?.code).toBe("GC002");
    // Ordinary edits (price, quantity on a sale) still work on both.
    await db.query(`update public.inventory_items set price_cents = 225 where id = $1`, [theirs]);
    await db.query(`update public.inventory_items set price_cents = 5000 where id = $1`, [theirs]);
  });

  it("won't delete a consignor's cards", async () => {
    expect((await errorOf(`delete from public.inventory_items where id = $1`, [theirs]))?.code).toBe("GC001");
  });

  it("tops up only our row when the same card is added again, never the consignor's", async () => {
    await asRole("service_role");
    try {
      const row = await one(
        `select * from public.admin_upsert_inventory(null, null, 'Sol Ring', 'cmr', 'Commander Legends', '1', 'uncommon', null, null,
                 'NM', 'nonfoil', 1, 200)`,
      );
      expect(row.id).toBe(ours);
      expect(row.quantity).toBe(3);
      expect((await one(`select quantity from public.inventory_items where id = $1`, [theirs])).quantity).toBe(3);
      await db.query(`update public.inventory_items set quantity = 2 where id = $1`, [ours]);
    } finally {
      await asRole("");
    }
  });
});

describe("consigned cards are never traded", () => {
  it("counts only our copies as free for a trade", async () => {
    expect((await one(`select public.trade_available($1, null) as n`, [ours])).n).toBe(2);
    expect((await one(`select public.trade_available($1, null) as n`, [theirs])).n).toBe(0);
  });

  it("won't start a trade for a consigned copy, and will for ours", async () => {
    await asRole("service_role");
    try {
      const refused = await errorOf(`select public.trade_start($1, $2::jsonb, 'Lou', 'lou@x.com')`, [
        user,
        JSON.stringify([{ inventory_item_id: theirs, quantity: 2 }]),
      ]);
      expect(refused?.code).toBe("GT004");
      const started = await one(`select public.trade_start($1, $2::jsonb, 'Lou', 'lou@x.com') as id`, [
        user,
        JSON.stringify([{ inventory_item_id: ours, quantity: 2 }]),
      ]);
      expect(started.id).toBeTruthy();
      // Our two are all a trade can have, even though five are on the shelf.
      const tooMany = await errorOf(`select public.trade_put_line($1, 1, $2, 3, false)`, [started.id, ours]);
      expect(tooMany?.code).toBe("GT004");
    } finally {
      await asRole("");
    }
  });

  it("refuses a consigned row on a trade line or a trade hold, however it's written", async () => {
    const trade = await one(`select id from public.trade_requests limit 1`);
    const line = await errorOf(
      `insert into public.trade_request_items (trade_request_id, inventory_item_id, quantity, unit_price_cents, status, card_name, set_code, collector_number, condition, finish)
       values ($1, $2, 1, 200, 'requested', 'Sol Ring', 'cmr', '1', 'NM', 'nonfoil')`,
      [trade.id, theirs],
    );
    expect(line?.code).toBe("GT004");
    expect(line?.message).toMatch(/consigned card/);

    const hold = await errorOf(
      `insert into public.inventory_reservations (inventory_item_id, trade_request_id, quantity, reserved_by) values ($1, $2, 1, 'trade')`,
      [theirs, trade.id],
    );
    expect(hold?.code).toBe("GT004");
  });

  it("still lets a consigned card be held for a sale", async () => {
    const hold = await one(
      `insert into public.inventory_reservations (inventory_item_id, customer_id, quantity, reserved_by) values ($1, $2, 1, 'staff') returning id`,
      [theirs, user],
    );
    await db.query(`update public.inventory_reservations set status = 'released' where id = $1`, [hold.id]);
  });

  it("refuses a Trade Evaluator trade that includes a consigned copy", async () => {
    const insert = (id: string) =>
      errorOf(
        `insert into public.trades (share_token, customer_name, credit_percent, your_cards, their_tcg_low_cents, credit_cents, your_cards_cents, balance_cents)
         values (repeat('a', 31) || substr(md5(random()::text), 1, 8), 'Lou', 70, $1::jsonb, 1000, 700, 200, 500)`,
        [JSON.stringify([{ inventoryItemId: id, cardName: "Sol Ring", quantity: 1, priceCents: 200 }])],
      );
    expect((await insert(theirs))?.code).toBe("GT004");
    expect(await insert(ours)).toBeNull();
  });
});

describe("consignments", () => {
  it("can't be activated without a signature, or marked signed outside signing", async () => {
    const c = await one(`select id from public.consignments limit 1`);
    expect((await errorOf(`update public.consignments set status = 'active' where id = $1`, [c.id]))?.code).toBe("23514");
    expect((await errorOf(`update public.consignments set signed_at = now() where id = $1`, [c.id]))?.code).toBe("GC003");
  });
});

describe("settings schedules", () => {
  it("locks a schedule once it's in effect", async () => {
    const f = await one(`select id from public.consignment_fee_schedules where channel = 'ebay'`);
    expect((await errorOf(`update public.consignment_fee_schedules set marketplace_bps = 1 where id = $1`, [f.id]))?.code).toBe("GC010");
    expect((await errorOf(`delete from public.consignment_fee_schedules where id = $1`, [f.id]))?.code).toBe("GC010");
  });

  it("takes a new schedule from now on, never backdated, and lets a future one be edited", async () => {
    const past = await errorOf(
      `insert into public.consignment_commission_schedules (effective_from, tiers) values (now() - interval '1 day', '[{"maxPriceCents":null,"rateBps":1500}]')`,
    );
    expect(past?.code).toBe("GC011");
    const future = await one(
      `insert into public.consignment_commission_schedules (effective_from, tiers) values (now() + interval '7 days', '[{"maxPriceCents":null,"rateBps":1500}]') returning id`,
    );
    await db.query(`update public.consignment_commission_schedules set tiers = '[{"maxPriceCents":null,"rateBps":1200}]' where id = $1`, [future.id]);
    await db.query(`delete from public.consignment_commission_schedules where id = $1`, [future.id]);
  });

  it("rejects malformed tiers and brackets", async () => {
    const twoOpen = await errorOf(
      `insert into public.consignment_commission_schedules (effective_from, tiers) values (now() + interval '1 day', '[{"maxPriceCents":null,"rateBps":1500},{"maxPriceCents":null,"rateBps":1000}]')`,
    );
    expect(twoOpen?.code).toBe("23514");
  });
});

describe("payout math agrees with consignmentMath.ts", () => {
  it("picks the commission tier by the card's price: 20% at $150.00, 10% at $150.01", async () => {
    const tiers = JSON.stringify(DEFAULT_COMMISSION_TIERS);
    for (const price of [1, 14999, 15000, 15001, 100000]) {
      const sql = await one(`select public.consignment_commission_rate_bps($1, $2::jsonb) as r`, [price, tiers]);
      expect(sql.r).toBe(commissionRateBps(price, DEFAULT_COMMISSION_TIERS));
    }
    expect(commissionRateBps(15000, DEFAULT_COMMISSION_TIERS)).toBe(2000);
    expect(commissionRateBps(15001, DEFAULT_COMMISSION_TIERS)).toBe(1000);
  });

  it("rounds the commission the same way, halves up", async () => {
    const tiers = JSON.stringify(DEFAULT_COMMISSION_TIERS);
    for (const [price, net] of [
      [20000, 18450],
      [15000, 13333],
      [999, 1],
      [5000, 0],
      [5000, 25],
      [15001, 12345],
    ]) {
      const sql = await one(`select public.consignment_commission_cents($1, $2, $3::jsonb) as c`, [price, net, tiers]);
      const ts = net > 0 ? applyBps(net, commissionRateBps(price, DEFAULT_COMMISSION_TIERS)) : 0;
      expect(sql.c).toBe(ts);
    }
  });

  it("prices insurance per package the same way, and flags packages above the limit", async () => {
    const config = parseEstimatorConfig((await one(`select public.consignment_estimator_settings() as s`)).s);
    expect(config).not.toBeNull();
    const schedule = await one(`select id from public.consignment_insurance_schedules limit 1`);
    for (const value of [0, 9999, 10000, 10001, 20000, 20001, 60000, 60001, 70000, 70001, 500000, 500001, 900000]) {
      const sql = (await one(`select public.consignment_insurance_premium($1, $2) as q`, [value, schedule.id])).q;
      const ts = insurancePremium(value, config!.insurance);
      expect({ value, premium: sql.premiumCents, review: sql.needsManualReview }).toEqual({
        value,
        premium: ts.premiumCents,
        review: ts.needsManualReview,
      });
    }
    expect(insurancePremium(10000, config!.insurance).premiumCents).toBe(0);
    expect(insurancePremium(10001, config!.insurance).premiumCents).toBe(450);
    expect(insurancePremium(60001, config!.insurance).premiumCents).toBe(1055);
    expect(insurancePremium(500001, config!.insurance).needsManualReview).toBe(true);
  });

  it("serves rates the estimator can use, and the spec's worked example settles to $166.05", async () => {
    const config = parseEstimatorConfig((await one(`select public.consignment_estimator_settings() as s`)).s)!;
    expect(Object.keys(config.channels).sort()).toEqual(["ebay", "tcgplayer", "website"]);
    const est = estimatePayout({ priceCents: 20000, channel: "website", additionalInsurance: true }, config);
    expect(est?.commissionRateBps).toBe(1000);
    // The spec's example uses round figures for processing and postage.
    const example = settle({
      finalPriceCents: 20000,
      marketplaceFeeCents: 0,
      processingFeeCents: 600,
      postageCents: 500,
      buyerShippingCents: 0,
      insuranceCents: 450,
      otherExpenseCents: 0,
    });
    expect(example.netSaleCents).toBe(18450);
    expect(example.commissionCents).toBe(1845);
    expect(example.payoutCents).toBe(16605);
  });
});
