import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

// supabase/migrations/20261110230000_cube_checklist_suggestions.sql in
// PGlite: the suggestion list table, the rating columns, the front-face card
// lookup in the local Scryfall data, and the one-statement ratings update.

const read = (f: string) => readFileSync(new URL(`../supabase/migrations/${f}`, import.meta.url), "utf8");

const STANDINS = `
create role anon; create role authenticated; create role service_role;
create function public.is_staff() returns boolean language sql stable as $$ select false $$;
create table public.scryfall_bulk_cards (
  scryfall_id uuid primary key default gen_random_uuid(),
  card_name text not null,
  rarity text,
  released_at date,
  raw jsonb not null
);
`;

// oxlint-disable-next-line typescript/no-explicit-any
type Row = Record<string, any>;
let db: PGlite;
let listId = "";

function printing(name: string, rarity: string, released: string, raw: Record<string, unknown>, games = ["paper", "mtgo"]) {
  return db.query(`insert into public.scryfall_bulk_cards (card_name, rarity, released_at, raw) values ($1, $2, $3, $4)`, [
    name,
    rarity,
    released,
    JSON.stringify({ name, games, ...raw }),
  ]);
}

beforeAll(async () => {
  db = new PGlite();
  await db.exec(STANDINS);
  for (const f of [
    "20261110060000_cube_checklists.sql",
    "20261110200000_cube_checklist_one_of_each.sql",
    "20261110230000_cube_checklist_suggestions.sql",
    "20261110230000_cube_checklist_suggestions.sql", // safe twice
  ]) {
    await db.exec(read(f));
  }
  listId = (
    await db.query<Row>(
      `insert into public.cube_checklists (name, cube_id, share_token) values ('Pauper', 'thepaupercube', repeat('a', 32)) returning id`,
    )
  ).rows[0].id;
  await db.query(
    `insert into public.cube_checklist_cards (checklist_id, position, name) values ($1, 0, 'Kor Skyfisher'), ($1, 1, 'Ardenvale Tactician')`,
    [listId],
  );

  // Chain Lightning: rare first printing, common later -> common, details from the common one.
  await printing("Chain Lightning", "rare", "1997-01-01", { type_line: "Sorcery", colors: ["R"], cmc: 1, mana_cost: "{R}", image_uris: { small: "old.jpg" } });
  await printing("Chain Lightning", "common", "2015-01-01", { type_line: "Sorcery", colors: ["R"], cmc: 1, mana_cost: "{R}", edhrec_rank: 900, image_uris: { small: "s.jpg", normal: "n.jpg" } });
  // Two-part card, details on the faces.
  await printing("Ardenvale Tactician // Dizzying Swoop", "common", "2019-10-04", {
    cmc: 3,
    card_faces: [{ type_line: "Creature — Human Knight", colors: ["W"], mana_cost: "{1}{W}{W}", image_uris: { small: "a.jpg" } }],
  });
  // Uncommon only; and a common only on MTGO.
  await printing("Kitchen Finks", "uncommon", "2008-01-01", { type_line: "Creature — Ouphe", colors: ["W", "G"], cmc: 3 });
  await printing("Chainer's Edict", "common", "2014-01-01", { type_line: "Sorcery", colors: ["B"], cmc: 2 }, ["mtgo"]);
  await printing("Chainer's Edict", "uncommon", "2002-01-01", { type_line: "Sorcery", colors: ["B"], cmc: 2 });
});
afterAll(() => db.close());

describe("card lookup", () => {
  it("matches by front face, ignoring case, and reports paper rarity", async () => {
    const { rows } = await db.query<Row>(
      `select * from public.cube_checklist_lookup_cards(array['chain lightning', 'Ardenvale Tactician', 'Kitchen Finks', 'Chainer''s Edict', 'Not A Card', 'CHAIN LIGHTNING', ''])
       order by requested`,
    );
    const by = Object.fromEntries(rows.map((r) => [r.requested, r]));
    expect(rows).toHaveLength(5); // duplicates and blanks dropped
    expect(by["chain lightning"]).toMatchObject({
      card_name: "Chain Lightning",
      type_line: "Sorcery",
      colors: ["R"],
      mana_cost: "{R}",
      image_small: "s.jpg",
      image_normal: "n.jpg",
      edhrec_rank: 900,
      paper_common: true,
      paper_uncommon: true,
    });
    expect(Number(by["chain lightning"].mana_value)).toBe(1);
    expect(by["Ardenvale Tactician"]).toMatchObject({
      card_name: "Ardenvale Tactician // Dizzying Swoop",
      type_line: "Creature — Human Knight",
      colors: ["W"],
      image_small: "a.jpg",
      paper_common: true,
    });
    expect(by["Kitchen Finks"]).toMatchObject({ paper_common: false, paper_uncommon: true });
    // Common only on MTGO doesn't count for a paper cube.
    expect(by["Chainer's Edict"]).toMatchObject({ paper_common: false, paper_uncommon: true });
    expect(by["Not A Card"]).toMatchObject({ card_name: null, paper_common: false });
  });
});

describe("ratings", () => {
  it("stores ratings by front face in one statement, writing only what changed", async () => {
    const ratings = JSON.stringify([
      { key: "kor skyfisher", elo: 1450, pick_count: 9000, mana_value: 2 },
      { key: "ardenvale tactician", elo: 1180, pick_count: 300, mana_value: 3 },
      { key: "not on the list", elo: 1, pick_count: 1 },
    ]);
    const first = await db.query<Row>(`select public.cube_checklist_set_ratings($1, $2::jsonb) as n`, [listId, ratings]);
    expect(first.rows[0].n).toBe(2);
    const again = await db.query<Row>(`select public.cube_checklist_set_ratings($1, $2::jsonb) as n`, [listId, ratings]);
    expect(again.rows[0].n).toBe(0);

    const cards = await db.query<Row>(`select name, elo, pick_count, mana_value from public.cube_checklist_cards order by position`);
    expect(cards.rows.map((r) => [r.name, r.elo, r.pick_count, Number(r.mana_value)])).toEqual([
      ["Kor Skyfisher", 1450, 9000, 2],
      ["Ardenvale Tactician", 1180, 300, 3],
    ]);
    const list = await db.query<Row>(`select ratings_updated_at from public.cube_checklists where id = $1`, [listId]);
    expect(list.rows[0].ratings_updated_at).toBeTruthy();
  });

  it("keeps suggestions per list, in order, and gives the browser roles no writes", async () => {
    await db.query(`insert into public.cube_checklist_suggestions (checklist_id, position, name) values ($1, 0, 'Chain Lightning')`, [listId]);
    const dup = await db
      .query(`insert into public.cube_checklist_suggestions (checklist_id, position, name) values ($1, 0, 'Ponder')`, [listId])
      .then(() => null, (e: { code?: string }) => e.code);
    expect(dup).toBe("23505");
    const grants = await db.query<Row>(
      `select grantee, privilege_type from information_schema.role_table_grants
       where table_name = 'cube_checklist_suggestions' and grantee in ('anon', 'authenticated')`,
    );
    expect(grants.rows).toEqual([{ grantee: "authenticated", privilege_type: "SELECT" }]);
    const fnGrants = await db.query<Row>(
      `select routine_name, grantee from information_schema.routine_privileges
       where routine_name like 'cube_checklist_%' and grantee in ('anon', 'authenticated', 'PUBLIC')`,
    );
    expect(fnGrants.rows).toEqual([]);
    await db.query(`delete from public.cube_checklists where id = $1`, [listId]);
    expect((await db.query<Row>(`select count(*)::int as n from public.cube_checklist_suggestions`)).rows[0].n).toBe(0);
  });
});
