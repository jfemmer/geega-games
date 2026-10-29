import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { STANDINS, UPSERT } from "./helpers/tradeDbStandins";

// Consignments, Phase 3 (supabase/migrations/20261028180000_consignment_receiving.sql)
// in PGlite: cards are received only after signing; each line becomes a lot
// in 'received' with the consignor's own numbers kept apart from what's
// accepted; inspection moves lots through their statuses with a reason for
// every rejection and a full history; lots can't be written any other way;
// the consignor sees their cards without staff notes.

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

const pat = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
let signedId: string;
let unsignedId: string;

const line = (over: Row = {}) => ({
  scryfallId: "11111111-1111-4111-8111-111111111111",
  oracleId: "22222222-2222-4222-8222-222222222222",
  cardName: "Sol Ring",
  setCode: "CMR",
  setName: "Commander Legends",
  collectorNumber: "472",
  rarity: "uncommon",
  imageUrl: "https://cards.example/sol.jpg",
  language: "en",
  finish: "nonfoil",
  declaredCondition: "NM",
  quantity: 4,
  marketPriceCents: 150,
  listPriceCents: 200,
  minPriceCents: 150,
  notes: "In a toploader",
  ...over,
});

const receive = (consignmentId: string, lines: Row[]) =>
  one(`select public.consignment_receive($1, $2::jsonb, 'mail', 'USPS', '9400 1000 0000', 'Box 1 of 1', 'jacob') as id`, [consignmentId, JSON.stringify(lines)]);
const inspect = (lotId: string, action: string, o: Row = {}) =>
  one(`select public.consignment_inspect_lot($1, $2, $3, $4::public.card_condition, $5::public.card_finish, $6, $7, $8, $9, 'jacob') as s`, [
    lotId,
    action,
    o.qty ?? null,
    o.condition ?? null,
    o.finish ?? null,
    o.list ?? null,
    o.min ?? null,
    o.reason ?? null,
    o.allowBelow ?? false,
  ]);

beforeAll(async () => {
  db = new PGlite();
  await db.exec(STANDINS);
  await db.exec(UPSERT);
  await db.exec(`create or replace function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;`);
  for (const sql of MIGRATIONS) await db.exec(sql);
  await db.query(`insert into auth.users (id, email) values ($1, 'pat@x.com')`, [pat]);
  const p = await one(`insert into public.consignors (legal_name, email, user_id) values ('Pat Consignor', 'pat@x.com', $1) returning id`, [pat]);
  unsignedId = (await one(`insert into public.consignments (consignor_id) values ($1) returning id`, [p.id])).id;
  await db.query(`select set_config('geega.consignment_signing', 'on', false)`);
  signedId = (await one(`insert into public.consignments (consignor_id, status, signed_at) values ($1, 'signed', now()) returning id`, [p.id])).id;
  await db.query(`select set_config('geega.consignment_signing', '', false)`);
  await db.query(`update public.consignment_settings set min_card_value_cents = 100`);
});

afterAll(async () => {
  await db?.close();
});

describe("receiving", () => {
  it("refuses cards for an unsigned consignment", async () => {
    await asRole("service_role");
    const err = await errorOf(`select public.consignment_receive($1, $2::jsonb, 'mail', null, null, null, 'jacob')`, [unsignedId, JSON.stringify([line()])]);
    await asRole("");
    expect(err?.code).toBe("GC042");
  });

  it("is only for the service role", async () => {
    const err = await errorOf(`select public.consignment_receive($1, $2::jsonb, 'mail', null, null, null, 'x')`, [signedId, JSON.stringify([line()])]);
    expect(err?.code).toBe("42501");
  });

  it("records a batch of lines as received, keeping the consignor's numbers apart", async () => {
    await asRole("service_role");
    const batch = (await receive(signedId, [line(), line({ cardName: "Arcane Signet", collectorNumber: "297", quantity: 1, finish: "foil", declaredCondition: "LP" })])).id;
    await asRole("");
    const b = await one(`select batch_number, carrier, tracking_number, notes from public.consignment_receiving_batches where id = $1`, [batch]);
    expect(b).toEqual({ batch_number: 1, carrier: "USPS", tracking_number: "9400 1000 0000", notes: "Box 1 of 1" });
    const lots = await all(`select * from public.consignment_lots where batch_id = $1 order by card_name`, [batch]);
    expect(lots).toHaveLength(2);
    expect(lots[1]).toMatchObject({
      card_name: "Sol Ring",
      set_code: "cmr",
      status: "received",
      quantity_submitted: 4,
      quantity_accepted: 0,
      declared_condition: "NM",
      condition: null,
      internal_notes: "In a toploader",
    });
    expect((await one(`select status from public.consignments where id = $1`, [signedId])).status).toBe("inventory_received");
    expect((await one(`select count(*)::int as n from public.consignment_lot_events where event = 'received'`)).n).toBe(2);
  });

  it("numbers a second shipment as batch 2", async () => {
    await asRole("service_role");
    const batch = (await receive(signedId, [line({ cardName: "Command Tower", collectorNumber: "350", quantity: 2 })])).id;
    await asRole("");
    expect((await one(`select batch_number from public.consignment_receiving_batches where id = $1`, [batch])).batch_number).toBe(2);
  });

  it("refuses lines that aren't a specific printing or have no quantity", async () => {
    await asRole("service_role");
    try {
      expect((await errorOf(`select public.consignment_receive($1, $2::jsonb, 'mail', null, null, null, 'x')`, [signedId, JSON.stringify([line({ collectorNumber: "" })])]))?.code).toBe("GC043");
      expect((await errorOf(`select public.consignment_receive($1, $2::jsonb, 'mail', null, null, null, 'x')`, [signedId, JSON.stringify([line({ quantity: 0 })])]))?.code).toBe("GC043");
      expect((await errorOf(`select public.consignment_receive($1, '[]'::jsonb, 'mail', null, null, null, 'x')`, [signedId]))?.code).toBe("GC043");
    } finally {
      await asRole("");
    }
  });

  it("can't be written around the functions", async () => {
    const lot = await one(`select id from public.consignment_lots limit 1`);
    expect((await errorOf(`update public.consignment_lots set quantity_accepted = 99 where id = $1`, [lot.id]))?.code).toBe("GC040");
    expect((await errorOf(`delete from public.consignment_lots where id = $1`, [lot.id]))?.code).toBe("GC040");
  });
});

describe("inspection", () => {
  const lotByName = async (name: string) => (await one(`select id from public.consignment_lots where card_name = $1`, [name])).id as string;

  it("accepts part of a line, grading it and counting the rest as rejected", async () => {
    await asRole("service_role");
    try {
      const sol = await lotByName("Sol Ring");
      expect((await inspect(sol, "start")).s).toBe("under_inspection");
      expect((await inspect(sol, "accept", { qty: 3, condition: "LP", list: 225, min: 175, reason: "One copy was a proxy" })).s).toBe("accepted");
      const l = await one(`select * from public.consignment_lots where id = $1`, [sol]);
      expect(l).toMatchObject({ status: "accepted", quantity_accepted: 3, quantity_rejected: 1, condition: "LP", declared_condition: "NM", list_price_cents: 225, min_price_cents: 175, rejection_reason: "One copy was a proxy", decided_by: "jacob" });
    } finally {
      await asRole("");
    }
  });

  it("insists on a grade, a price, a sensible minimum and a reason to reject", async () => {
    await asRole("service_role");
    try {
      const signet = await lotByName("Arcane Signet");
      expect((await errorOf(`select public.consignment_inspect_lot($1, 'accept', 1, null, null, 300, null, null, false, 'x')`, [signet]))?.code).toBe("GC045");
      expect((await errorOf(`select public.consignment_inspect_lot($1, 'accept', 1, 'NM', null, null, null, null, false, 'x')`, [signet]))?.code).toBe("GC045");
      expect((await errorOf(`select public.consignment_inspect_lot($1, 'accept', 1, 'NM', null, 300, 400, null, false, 'x')`, [signet]))?.code).toBe("GC045");
      expect((await errorOf(`select public.consignment_inspect_lot($1, 'accept', 0, 'NM', null, 300, null, null, false, 'x')`, [signet]))?.code).toBe("GC045");
      expect((await errorOf(`select public.consignment_inspect_lot($1, 'reject', null, null, null, null, null, '  ', false, 'x')`, [signet]))?.code).toBe("GC045");
    } finally {
      await asRole("");
    }
  });

  it("holds cards below the minimum accepted value unless staff choose to take them", async () => {
    await asRole("service_role");
    try {
      const tower = await lotByName("Command Tower");
      expect((await errorOf(`select public.consignment_inspect_lot($1, 'accept', 2, 'NM', null, 50, null, null, false, 'x')`, [tower]))?.code).toBe("GC046");
      expect((await inspect(tower, "accept", { qty: 2, condition: "NM", list: 50, allowBelow: true })).s).toBe("accepted");
      const ev = await one(`select details from public.consignment_lot_events where lot_id = $1 and event = 'accepted'`, [tower]);
      expect(ev.details.belowMinimum).toBe(true);
    } finally {
      await asRole("");
    }
  });

  it("rejects with a reason, reopens for corrections, and keeps the whole history", async () => {
    await asRole("service_role");
    try {
      const signet = await lotByName("Arcane Signet");
      expect((await inspect(signet, "reject", { reason: "Counterfeit: wrong font and back" })).s).toBe("rejected");
      expect((await one(`select quantity_rejected, quantity_accepted from public.consignment_lots where id = $1`, [signet]))).toEqual({ quantity_rejected: 1, quantity_accepted: 0 });
      expect((await errorOf(`select public.consignment_inspect_lot($1, 'accept', 1, 'NM', null, 300, null, null, false, 'x')`, [signet]))?.code).toBe("GC044");
      expect((await inspect(signet, "reopen")).s).toBe("under_inspection");
      const events = await all(`select event, from_status, to_status from public.consignment_lot_events where lot_id = $1 order by created_at, event`, [signet]);
      expect(events.map((e) => e.event)).toEqual(["received", "rejected", "reopened"]);
      expect((await errorOf(`update public.consignment_lot_events set actor = 'x'`))?.code).toBe("GC029");
    } finally {
      await asRole("");
    }
  });
});

describe("the consignor's view", () => {
  it("shows Pat their cards, prices only once accepted, and no staff notes", async () => {
    await db.query(`select set_config('test.uid', $1, false)`, [pat]);
    const mine = (await one(`select public.my_consignments() as m`)).m as Row[];
    await db.query(`select set_config('test.uid', '', false)`);
    const c = mine.find((x) => x.id === signedId)!;
    expect(c.cards).toHaveLength(3);
    const sol = c.cards.find((x: Row) => x.cardName === "Sol Ring");
    expect(sol).toMatchObject({ status: "accepted", quantityAccepted: 3, quantityRejected: 1, condition: "LP", declaredCondition: "NM", listPriceCents: 225, minPriceCents: 175 });
    const signet = c.cards.find((x: Row) => x.cardName === "Arcane Signet");
    expect(signet.listPriceCents).toBeNull();
    expect(JSON.stringify(mine)).not.toContain("toploader");
  });
});
