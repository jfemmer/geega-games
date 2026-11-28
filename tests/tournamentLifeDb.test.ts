import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

// supabase/migrations/20261128040000_tournament_life.sql on top of the
// earlier tournament migrations, in PGlite: starting life by format, life
// changes add up (and stop when the game is over), and finished games get
// their end time from when they were recorded.

const read = (name: string) => readFileSync(new URL(`../supabase/migrations/${name}`, import.meta.url), "utf8");
const BEFORE = [
  read("20261127200000_tournaments.sql"),
  read("20261127230000_tournament_display.sql"),
  read("20261127235000_tournament_signups.sql"),
];
const LIFE = read("20261128040000_tournament_life.sql");

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

let oldTwoHg = "";
let oldDone = "";
let t = "";
let game = "";

beforeAll(async () => {
  db = new PGlite();
  await db.exec(STANDINS);
  for (const m of BEFORE) await db.exec(m);
  // From before this migration: a Two-Headed Giant tournament, and a 1v1 with a finished game.
  oldTwoHg = (await one(`insert into public.tournaments (name, format) values ('Old 2HG', '2hg') returning id`)).id;
  t = (await one(`insert into public.tournaments (name, format) values ('Friday', '1v1') returning id`)).id;
  const a = (await one(`insert into public.tournament_entrants (tournament_id, player_one) values ($1, 'Alex') returning id`, [t])).id;
  const b = (await one(`insert into public.tournament_entrants (tournament_id, player_one) values ($1, 'Blair') returning id`, [t])).id;
  const c = (await one(`insert into public.tournament_entrants (tournament_id, player_one) values ($1, 'Casey') returning id`, [t])).id;
  const d = (await one(`insert into public.tournament_entrants (tournament_id, player_one) values ($1, 'Drew') returning id`, [t])).id;
  await db.query(`select public.tournament_pair_round($1, 1, false, $2::jsonb)`, [t, JSON.stringify([{ a, b }, { a: c, b: d }])]);
  oldDone = (await one(`select id from public.tournament_matches where tournament_id = $1 and table_number = 1`, [t])).id;
  game = (await one(`select id from public.tournament_matches where tournament_id = $1 and table_number = 2`, [t])).id;
  await db.query(`update public.tournament_matches set result = 'a', reported_at = now() - interval '5 minutes' where id = $1`, [oldDone]);
  await db.exec(LIFE);
  await db.exec(LIFE); // safe to run twice
});
afterAll(() => db.close());

describe("starting life and end times", () => {
  it("starts 1v1 at 40 and Two-Headed Giant teams at 60", async () => {
    expect((await one(`select starting_life from public.tournaments where id = $1`, [t])).starting_life).toBe(40);
    expect((await one(`select starting_life from public.tournaments where id = $1`, [oldTwoHg])).starting_life).toBe(60);
    expect(await errorCode(`update public.tournaments set starting_life = 0 where id = $1`, [t])).toBe("23514");
  });

  it("gives games decided before the migration an end time", async () => {
    const row = await one(`select ended_at = reported_at as same, life_a, life_b from public.tournament_matches where id = $1`, [oldDone]);
    expect(row).toEqual({ same: true, life_a: null, life_b: null });
  });
});

describe("tournament_change_life", () => {
  const change = (side: string, delta: number, match = game, tournament = t) =>
    one(`select public.tournament_change_life($1, $2, $3, $4) as r`, [tournament, match, side, delta]).then((r) => r.r as Row);

  it("counts from the starting life and adds every change", async () => {
    expect(await change("a", -3)).toEqual({ life_a: 37, life_b: 40 });
    expect(await change("a", -5)).toEqual({ life_a: 32, life_b: 40 });
    expect(await change("b", 2)).toEqual({ life_a: 32, life_b: 42 });
    expect(await one(`select life_a, life_b from public.tournament_matches where id = $1`, [game])).toEqual({ life_a: 32, life_b: 42 });
  });

  it("goes below 0 (the player confirms the loss), within limits", async () => {
    expect((await change("a", -40)).life_a).toBe(-8);
    expect((await change("a", -999)).life_a).toBe(-999);
    await db.query(`update public.tournament_matches set life_a = 32 where id = $1`, [game]);
  });

  it("refuses bad input", async () => {
    expect(await errorCode(`select public.tournament_change_life($1, $2, 'c', -1)`, [t, game])).toBe("GGT01");
    expect(await errorCode(`select public.tournament_change_life($1, $2, 'a', 0)`, [t, game])).toBe("GGT01");
    expect(await errorCode(`select public.tournament_change_life($1, $2, 'a', 5000)`, [t, game])).toBe("GGT01");
    expect(await errorCode(`select public.tournament_change_life($1, $2, 'a', -1)`, [oldTwoHg, game])).toBe("GGT02");
  });

  it("stops once the game is over", async () => {
    expect(await errorCode(`select public.tournament_change_life($1, $2, 'a', -1)`, [t, oldDone])).toBe("GGT02");
  });

  it("only the server can change life", async () => {
    const can = await one(
      `select has_function_privilege('anon', 'public.tournament_change_life(uuid, uuid, text, integer)', 'execute') as anon,
              has_function_privilege('service_role', 'public.tournament_change_life(uuid, uuid, text, integer)', 'execute') as svc`,
    );
    expect(can).toEqual({ anon: false, svc: true });
  });
});
