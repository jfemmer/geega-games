import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

// supabase/migrations/20261119010000_cube_checklist_card_stats.sql in PGlite:
// each card's price (cheapest paper printing) and EDHREC rank from the local
// Scryfall data, filled in when a slot's card changes and refreshed for a
// whole list in one statement.

const read = (f: string) => readFileSync(new URL(`../supabase/migrations/${f}`, import.meta.url), "utf8");

const STANDINS = `
create role anon; create role authenticated; create role service_role;
create function public.is_staff() returns boolean language sql stable as $$ select false $$;
create table public.scryfall_bulk_cards (
  scryfall_id uuid primary key default gen_random_uuid(),
  card_name text not null,
  rarity text,
  released_at date,
  raw jsonb not null,
  bulk_updated_at timestamptz not null default '2026-09-16T03:22:29Z'
);
`;

// oxlint-disable-next-line typescript/no-explicit-any
type Row = Record<string, any>;
let db: PGlite;
let listId = "";

function printing(name: string, raw: Record<string, unknown>, games = ["paper"]) {
  return db.query(`insert into public.scryfall_bulk_cards (card_name, rarity, released_at, raw) values ($1, 'common', '2020-01-01', $2)`, [
    name,
    JSON.stringify({ name, games, layout: "normal", ...raw }),
  ]);
}

async function cards(): Promise<Row[]> {
  return (
    await db.query<Row>(
      `select name, price_cents, edhrec_rank, mana_value, updated_at from public.cube_checklist_cards where checklist_id = $1 order by position`,
      [listId],
    )
  ).rows;
}

beforeAll(async () => {
  db = new PGlite();
  await db.exec(STANDINS);
  // A list made before this migration: the migration fills it in.
  for (const f of [
    "20261110060000_cube_checklists.sql",
    "20261110200000_cube_checklist_one_of_each.sql",
    "20261110230000_cube_checklist_suggestions.sql",
  ]) {
    await db.exec(read(f));
  }
  listId = (
    await db.query<Row>(
      `insert into public.cube_checklists (name, cube_id, share_token) values ('Pauper', 'thepaupercube', repeat('a', 32)) returning id`,
    )
  ).rows[0].id;
  await db.query(
    `insert into public.cube_checklist_cards (checklist_id, position, name, elo, pick_count, mana_value)
     values ($1, 0, 'Lightning Bolt', 1500, 9000, 1), ($1, 1, 'Ardenvale Tactician', 1200, 400, 3), ($1, 2, 'Mystery Card', null, null, null)`,
    [listId],
  );

  // Lightning Bolt: the cheapest non-foil wins, even over a cheaper foil;
  // an MTGO-only printing, an art-series card and a pricier printing don't.
  await printing("Lightning Bolt", { prices: { usd: "1.25", usd_foil: "0.50" }, edhrec_rank: 12, cmc: 1 });
  await printing("Lightning Bolt", { prices: { usd: "0.99" }, edhrec_rank: 12, cmc: 1 });
  await printing("Lightning Bolt", { prices: { usd: "0.10" }, edhrec_rank: 12, cmc: 1 }, ["mtgo"]);
  await printing("Lightning Bolt // Lightning Bolt", { layout: "art_series", prices: { usd: "0.05" } });
  // A two-part card printed only in foil: the foil price is the price.
  await printing("Ardenvale Tactician // Dizzying Swoop", { prices: { usd: null, usd_foil: "2.00", usd_etched: "1.50" }, cmc: 3, edhrec_rank: 4000 });
  // Swap-in candidates.
  await printing("Chain Lightning", { prices: { usd: "3.40" }, edhrec_rank: 900, cmc: 1 });
  await printing("Gleemax", { prices: { usd: "8.00" }, cmc: 1000000 });

  for (let i = 0; i < 2; i++) await db.exec(read("20261119010000_cube_checklist_card_stats.sql")); // safe twice
});
afterAll(() => db.close());

describe("card stats", () => {
  it("fills in existing lists: cheapest paper non-foil price, foil when that's all there is, EDHREC rank", async () => {
    expect((await cards()).map((r) => [r.name, r.price_cents, r.edhrec_rank])).toEqual([
      ["Lightning Bolt", 99, 12],
      ["Ardenvale Tactician", 150, 4000],
      ["Mystery Card", null, null],
    ]);
    const list = (await db.query<Row>(`select stats_updated_at, prices_as_of from public.cube_checklists where id = $1`, [listId])).rows[0];
    expect(list.stats_updated_at).toBeTruthy();
    expect(new Date(list.prices_as_of).toISOString()).toBe("2026-09-16T03:22:29.000Z");
  });

  it("writes only cards whose stats changed", async () => {
    const before = await cards();
    const again = await db.query<Row>(`select public.cube_checklist_refresh_card_stats($1) as n`, [listId]);
    expect(again.rows[0].n).toBe(0);
    await db.query(`update public.scryfall_bulk_cards set raw = jsonb_set(raw, '{prices,usd}', '"0.75"') where card_name = 'Lightning Bolt' and raw->'prices'->>'usd' = '0.99'`);
    const changed = await db.query<Row>(`select public.cube_checklist_refresh_card_stats($1) as n`, [listId]);
    expect(changed.rows[0].n).toBe(1);
    const after = await cards();
    expect(after[0].price_cents).toBe(75);
    expect(after[1].updated_at).toEqual(before[1].updated_at);
  });

  it("gives a slot the new card's stats on a swap, and the old card's back on undo", async () => {
    await db.query(`update public.cube_checklist_cards set name = 'Chain Lightning', original_name = 'Lightning Bolt', swapped_at = now() where checklist_id = $1 and position = 0`, [listId]);
    let row = (await cards())[0];
    expect([row.price_cents, row.edhrec_rank, Number(row.mana_value)]).toEqual([340, 900, 1]);

    await db.query(`update public.cube_checklist_cards set name = 'Lightning Bolt', original_name = null, swapped_at = null where checklist_id = $1 and position = 0`, [listId]);
    row = (await cards())[0];
    expect([row.price_cents, row.edhrec_rank]).toEqual([75, 12]);

    // A card with an absurd mana value still swaps in (the column can't hold it).
    await db.query(`update public.cube_checklist_cards set name = 'Gleemax', original_name = 'Mystery Card', swapped_at = now() where checklist_id = $1 and position = 2`, [listId]);
    row = (await cards())[2];
    expect([row.price_cents, row.mana_value]).toEqual([800, null]);
  });

  it("leaves stats alone when something other than the card changes", async () => {
    await db.query(`update public.cube_checklist_cards set price_cents = 1 where checklist_id = $1 and position = 1`, [listId]);
    await db.query(`update public.cube_checklist_cards set found_by = 'Sam', found_at = now() where checklist_id = $1 and position = 1`, [listId]);
    expect((await cards())[1].price_cents).toBe(1);
    await db.query(`select public.cube_checklist_refresh_card_stats($1)`, [listId]);
  });

  it("prices swap options by name, front face, at most 50", async () => {
    const { rows } = await db.query<Row>(
      `select * from public.cube_checklist_prices(array['chain lightning', 'Ardenvale Tactician', 'Not A Card', '', 'chain lightning']) order by requested`,
    );
    expect(rows).toEqual([
      { requested: "Ardenvale Tactician", price_cents: 150, edhrec_rank: 4000 },
      { requested: "Not A Card", price_cents: null, edhrec_rank: null },
      { requested: "chain lightning", price_cents: 340, edhrec_rank: 900 },
    ]);
    const many = await db.query<Row>(
      `select count(*)::int as n from public.cube_checklist_prices(array(select 'Card ' || g from generate_series(1, 80) g))`,
    );
    expect(many.rows[0].n).toBe(50);
  });

  it("gives the browser roles nothing", async () => {
    const fnGrants = await db.query<Row>(
      `select routine_name, grantee from information_schema.routine_privileges
       where routine_name like 'cube_checklist_%' and grantee in ('anon', 'authenticated', 'PUBLIC')`,
    );
    expect(fnGrants.rows).toEqual([]);
  });
});
