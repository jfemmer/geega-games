import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

// supabase/migrations/20261127230000_tournament_display.sql on top of the
// tournaments migration, in PGlite: every tournament (old and new) gets its
// own share link, links are unique, commanders line up with players, and the
// browser roles still can't write.

const read = (name: string) => readFileSync(new URL(`../supabase/migrations/${name}`, import.meta.url), "utf8");
const TOURNAMENTS = read("20261127200000_tournaments.sql");
const DISPLAY = read("20261127230000_tournament_display.sql");

const STANDINS = `
create role anon; create role authenticated; create role service_role;
create function public.is_staff() returns boolean language sql stable as $$ select false $$;
`;

// oxlint-disable-next-line typescript/no-explicit-any
type Row = Record<string, any>;
let db: PGlite;
const one = async (q: string, params?: unknown[]): Promise<Row> => (await db.query<Row>(q, params)).rows[0];
async function errorCode(q: string, params?: unknown[]): Promise<string | null> {
  try {
    await db.query(q, params);
    return null;
  } catch (e) {
    return (e as { code?: string }).code ?? "error";
  }
}

let before1 = "";
let before2 = "";

beforeAll(async () => {
  db = new PGlite();
  await db.exec(STANDINS);
  await db.exec(TOURNAMENTS);
  // Tournaments made before this migration…
  before1 = (await one(`insert into public.tournaments (name, format) values ('Old one', '1v1') returning id`)).id;
  before2 = (await one(`insert into public.tournaments (name, format) values ('Old two', '2hg') returning id`)).id;
  await db.exec(DISPLAY);
  await db.exec(DISPLAY); // safe to run twice
});
afterAll(() => db.close());

describe("share links", () => {
  it("gives tournaments made before the migration their own link, switched on", async () => {
    const rows = (await db.query<Row>(`select share_token, share_enabled from public.tournaments where id in ($1, $2)`, [before1, before2])).rows;
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => /^[0-9a-f]{64}$/.test(r.share_token) && r.share_enabled)).toBe(true);
    expect(rows[0].share_token).not.toBe(rows[1].share_token);
  });

  it("gives new tournaments a link too, and keeps links unique", async () => {
    const row = await one(`insert into public.tournaments (name, format) values ('New', '1v1') returning share_token`);
    expect(row.share_token).toMatch(/^[0-9a-f]{64}$/);
    const taken = (await one(`select share_token from public.tournaments where id = $1`, [before1])).share_token;
    expect(await errorCode(`update public.tournaments set share_token = $1 where name = 'New'`, [taken])).toBe("23505");
    expect(await errorCode(`update public.tournaments set share_token = 'short' where name = 'New'`)).toBe("23514");
  });
});

describe("commanders", () => {
  it("stores a commander per player, with or without a card", async () => {
    const team = await one(
      `insert into public.tournament_entrants (tournament_id, player_one, player_two, commander_one, commander_one_card, commander_two)
       values ($1, 'Jo', 'Kim', 'Atraxa, Praetors'' Voice', 'd0d33d52-3d28-4635-b985-51e126289259', 'Thrasios & Tymna')
       returning commander_one, commander_one_card, commander_two, commander_two_card`,
      [before2],
    );
    expect(team).toEqual({
      commander_one: "Atraxa, Praetors' Voice",
      commander_one_card: "d0d33d52-3d28-4635-b985-51e126289259",
      commander_two: "Thrasios & Tymna",
      commander_two_card: null,
    });
  });

  it("refuses a card with no name, and a second commander for a 1v1 player", async () => {
    expect(
      await errorCode(
        `insert into public.tournament_entrants (tournament_id, player_one, commander_one_card) values ($1, 'Alex', 'd0d33d52-3d28-4635-b985-51e126289259')`,
        [before1],
      ),
    ).toBe("23514");
    expect(
      await errorCode(
        `insert into public.tournament_entrants (tournament_id, player_one, commander_two) values ($1, 'Blair', 'Krenko, Mob Boss')`,
        [before1],
      ),
    ).toBe("23514");
    expect(
      await errorCode(
        `insert into public.tournament_entrants (tournament_id, player_one, commander_one) values ($1, 'Casey', $2)`,
        [before1, "x".repeat(121)],
      ),
    ).toBe("23514");
  });

  it("still lets nobody in the browser write", async () => {
    const writes = (
      await db.query<Row>(
        `select table_name, privilege_type from information_schema.role_table_grants
         where table_schema = 'public' and table_name like 'tournament%' and grantee in ('anon', 'authenticated')
           and privilege_type <> 'SELECT'`,
      )
    ).rows;
    expect(writes).toEqual([]);
  });
});
