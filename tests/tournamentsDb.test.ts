import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

// supabase/migrations/20261127200000_tournaments.sql in PGlite: entrants match
// the format, nobody plays the same opponent twice, matches can't point at
// another tournament's players, and tournament_pair_round() writes a round
// only when it's the next one, every result before it is in, and everyone
// still in is paired exactly once. Browser roles can't write anything.

const MIGRATION = readFileSync(
  new URL("../supabase/migrations/20261127200000_tournaments.sql", import.meta.url),
  "utf8",
);

const STANDINS = `
create role anon; create role authenticated; create role service_role;
create function public.is_staff() returns boolean language sql stable as $$ select false $$;
`;

// oxlint-disable-next-line typescript/no-explicit-any
type Row = Record<string, any>;
let db: PGlite;
const one = async (q: string, params?: unknown[]): Promise<Row> => (await db.query<Row>(q, params)).rows[0];
async function errorOf(q: string, params?: unknown[]): Promise<{ code: string; message: string } | null> {
  try {
    await db.query(q, params);
    return null;
  } catch (e) {
    const err = e as { code?: string; message?: string };
    return { code: err.code ?? "error", message: err.message ?? "" };
  }
}

async function tournament(format: "1v1" | "2hg", name = "Friday"): Promise<string> {
  return (await one(`insert into public.tournaments (name, format) values ($1, $2) returning id`, [name, format])).id;
}
async function player(t: string, p1: string, p2: string | null = null): Promise<string> {
  return (
    await one(
      `insert into public.tournament_entrants (tournament_id, player_one, player_two) values ($1, $2, $3) returning id`,
      [t, p1, p2],
    )
  ).id;
}
const pair = (t: string, round: number, replace: boolean, pairings: { a: string; b: string | null }[]) =>
  `select public.tournament_pair_round('${t}', ${round}, ${replace}, '${JSON.stringify(pairings)}'::jsonb) as round`;

let t1 = "";
let alex = "";
let blair = "";
let casey = "";

beforeAll(async () => {
  db = new PGlite();
  await db.exec(STANDINS);
  await db.exec(MIGRATION);
  await db.exec(MIGRATION); // safe to run twice
  t1 = await tournament("1v1");
  alex = await player(t1, "Alex");
  blair = await player(t1, "Blair");
  casey = await player(t1, "Casey");
});
afterAll(() => db.close());

describe("tournament tables", () => {
  it("starts a tournament active at round 0", async () => {
    expect(await one(`select status, current_round, finished_at from public.tournaments where id = $1`, [t1])).toEqual({
      status: "active",
      current_round: 0,
      finished_at: null,
    });
  });

  it("keeps finished_at in step with the status", async () => {
    expect((await errorOf(`update public.tournaments set status = 'finished' where id = $1`, [t1]))?.code).toBe("23514");
  });

  it("checks entrants against the format", async () => {
    const hg = await tournament("2hg");
    expect((await errorOf(`insert into public.tournament_entrants (tournament_id, player_one) values ($1, 'Solo')`, [hg]))?.code).toBe(
      "GGT01",
    );
    expect(
      (await errorOf(`insert into public.tournament_entrants (tournament_id, player_one, player_two) values ($1, 'Jo', 'jo')`, [hg]))
        ?.code,
    ).toBe("GGT01");
    expect(
      (await errorOf(`insert into public.tournament_entrants (tournament_id, player_one, player_two) values ($1, 'A', 'B')`, [t1]))?.code,
    ).toBe("GGT01");
    await player(hg, "Jo", "Kim");
  });

  it("won't enter the same player twice, ignoring case", async () => {
    expect((await errorOf(`insert into public.tournament_entrants (tournament_id, player_one) values ($1, 'alex')`, [t1]))?.code).toBe(
      "23505",
    );
  });
});

describe("tournament_pair_round", () => {
  it("writes round 1 with tables in order and a bye, and moves current_round on", async () => {
    const res = await one(pair(t1, 1, false, [{ a: alex, b: blair }, { a: casey, b: null }]));
    expect(res.round).toBe(1);
    const rows = (
      await db.query<Row>(
        `select table_number, entrant_a, entrant_b, result from public.tournament_matches where tournament_id = $1 order by table_number`,
        [t1],
      )
    ).rows;
    expect(rows).toEqual([
      { table_number: 1, entrant_a: alex, entrant_b: blair, result: "pending" },
      { table_number: 2, entrant_a: casey, entrant_b: null, result: "bye" },
    ]);
    expect((await one(`select current_round from public.tournaments where id = $1`, [t1])).current_round).toBe(1);
  });

  it("won't pair the same round twice (a second device, a double tap)", async () => {
    expect((await errorOf(pair(t1, 1, false, [{ a: alex, b: casey }, { a: blair, b: null }])))?.code).toBe("GGT02");
  });

  it("won't pair the next round while a result is still open", async () => {
    const err = await errorOf(pair(t1, 2, false, [{ a: alex, b: casey }, { a: blair, b: null }]));
    expect(err?.code).toBe("GGT02");
    expect(err?.message).toMatch(/Record every result in round 1/);
  });

  it("re-pairs a round with no results yet, and refuses once a result is in", async () => {
    await one(pair(t1, 1, true, [{ a: alex, b: casey }, { a: blair, b: null }]));
    const rows = (await db.query<Row>(`select entrant_a, entrant_b from public.tournament_matches where tournament_id = $1 and round = 1 order by table_number`, [t1])).rows;
    expect(rows).toEqual([
      { entrant_a: alex, entrant_b: casey },
      { entrant_a: blair, entrant_b: null },
    ]);
    await db.query(
      `update public.tournament_matches set result = 'a', reported_at = now() where tournament_id = $1 and round = 1 and entrant_b is not null`,
      [t1],
    );
    expect((await errorOf(pair(t1, 1, true, [{ a: alex, b: blair }, { a: casey, b: null }])))?.code).toBe("GGT02");
  });

  it("refuses a rematch", async () => {
    const err = await errorOf(pair(t1, 2, false, [{ a: casey, b: alex }, { a: blair, b: null }]));
    expect(err?.code).toBe("23505");
    expect(err?.message).toMatch(/no_rematch/);
    // Nothing was written: still round 1.
    expect((await one(`select current_round from public.tournaments where id = $1`, [t1])).current_round).toBe(1);
  });

  it("needs everyone still in, exactly once", async () => {
    expect((await errorOf(pair(t1, 2, false, [{ a: alex, b: blair }])))?.code).toBe("GGT02");
    expect((await errorOf(pair(t1, 2, false, [{ a: alex, b: blair }, { a: alex, b: null }, { a: casey, b: null }])))?.code).toBe("GGT01");
    expect((await errorOf(pair(t1, 2, false, [])))?.code).toBe("GGT01");
  });

  it("leaves dropped players out, and won't pair someone who has dropped", async () => {
    await db.query(`update public.tournament_entrants set dropped_at = now() where id = $1`, [casey]);
    expect((await errorOf(pair(t1, 2, false, [{ a: alex, b: blair }, { a: casey, b: null }])))?.code).toBe("GGT02");
    await one(pair(t1, 2, false, [{ a: alex, b: blair }]));
    expect((await one(`select current_round from public.tournaments where id = $1`, [t1])).current_round).toBe(2);
  });

  it("won't pair players from another tournament", async () => {
    const t2 = await tournament("1v1", "Saturday");
    const sam = await player(t2, "Sam");
    await player(t2, "Jordan");
    const err = await errorOf(pair(t2, 1, false, [{ a: sam, b: alex }]));
    expect(err).not.toBeNull();
  });

  it("won't pair a finished tournament", async () => {
    const t3 = await tournament("1v1", "Done");
    const a = await player(t3, "A");
    const b = await player(t3, "B");
    await db.query(`update public.tournaments set status = 'finished', finished_at = now() where id = $1`, [t3]);
    expect((await errorOf(pair(t3, 1, false, [{ a, b }])))?.code).toBe("GGT02");
  });

  it("keeps a bye free of a result and a played match's result in step with reported_at", async () => {
    expect(
      (
        await errorOf(
          `insert into public.tournament_matches (tournament_id, round, table_number, entrant_a, entrant_b, result) values ($1, 9, 1, $2, null, 'a')`,
          [t1, alex],
        )
      )?.code,
    ).toBe("23514");
    expect(
      (
        await errorOf(
          `insert into public.tournament_matches (tournament_id, round, table_number, entrant_a, entrant_b, result) values ($1, 9, 1, $2, $3, 'a')`,
          [t1, alex, casey],
        )
      )?.code,
    ).toBe("23514");
  });

  it("deletes everything with the tournament", async () => {
    await db.query(`delete from public.tournaments where id = $1`, [t1]);
    expect((await one(`select count(*)::int as n from public.tournament_entrants where tournament_id = $1`, [t1])).n).toBe(0);
    expect((await one(`select count(*)::int as n from public.tournament_matches where tournament_id = $1`, [t1])).n).toBe(0);
  });
});

describe("access", () => {
  it("lets signed-in staff read but nobody in the browser write", async () => {
    const grants = (
      await db.query<Row>(
        `select table_name, grantee, privilege_type from information_schema.role_table_grants
         where table_schema = 'public' and table_name like 'tournament%' and grantee in ('anon', 'authenticated')
         order by table_name, grantee, privilege_type`,
      )
    ).rows;
    expect(grants).toEqual([
      { table_name: "tournament_entrants", grantee: "authenticated", privilege_type: "SELECT" },
      { table_name: "tournament_matches", grantee: "authenticated", privilege_type: "SELECT" },
      { table_name: "tournaments", grantee: "authenticated", privilege_type: "SELECT" },
    ]);
    const rls = (
      await db.query<Row>(
        `select relname, relrowsecurity from pg_class where relname in ('tournaments', 'tournament_entrants', 'tournament_matches') order by relname`,
      )
    ).rows;
    expect(rls.every((r) => r.relrowsecurity)).toBe(true);
  });

  it("only the server can pair rounds", async () => {
    const can = await one(
      `select has_function_privilege('authenticated', 'public.tournament_pair_round(uuid, integer, boolean, jsonb)', 'execute') as authed,
              has_function_privilege('anon', 'public.tournament_pair_round(uuid, integer, boolean, jsonb)', 'execute') as anon,
              has_function_privilege('service_role', 'public.tournament_pair_round(uuid, integer, boolean, jsonb)', 'execute') as svc`,
    );
    expect(can).toEqual({ authed: false, anon: false, svc: true });
  });
});
