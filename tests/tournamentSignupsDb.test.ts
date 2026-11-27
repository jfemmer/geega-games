import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

// supabase/migrations/20261127235000_tournament_signups.sql on top of the
// earlier tournament migrations, in PGlite: players take spots one at a
// time and never past the limit, names stay unique, Two-Headed Giant players
// can sign up alone and team up, random teams fill the rest before round 1,
// and round 1 can't be paired with anyone still alone.

const read = (name: string) => readFileSync(new URL(`../supabase/migrations/${name}`, import.meta.url), "utf8");
const MIGRATIONS = [
  read("20261127200000_tournaments.sql"),
  read("20261127230000_tournament_display.sql"),
  read("20261127235000_tournament_signups.sql"),
];

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

const signUp = (t: string, name: string, teamWith: string | null = null, commander: string | null = null) =>
  one(`select public.tournament_sign_up($1, $2, $3, null, $4) as r`, [t, name, commander, teamWith]).then((r) => r.r as Row);

async function tournament(format: "1v1" | "2hg", spots: number | null): Promise<string> {
  return (await one(`insert into public.tournaments (name, format, spots) values ('Friday', $1, $2) returning id`, [format, spots])).id;
}

beforeAll(async () => {
  db = new PGlite();
  await db.exec(STANDINS);
  for (const m of MIGRATIONS) await db.exec(m);
  await db.exec(MIGRATIONS[2]); // safe to run twice
});
afterAll(() => db.close());

describe("1v1 sign-ups", () => {
  let t = "";
  beforeAll(async () => {
    t = await tournament("1v1", 3);
  });

  it("takes spots one at a time and reports how many are filled", async () => {
    const first = await signUp(t, "Alex", null, "Atraxa, Praetors' Voice");
    expect(first).toMatchObject({ seat: 0, players: 1, spots: 3 });
    expect((await one(`select commander_one from public.tournament_entrants where id = $1`, [first.entrant_id])).commander_one).toBe(
      "Atraxa, Praetors' Voice",
    );
    expect(await signUp(t, "Blair")).toMatchObject({ players: 2 });
  });

  it("won't take a name that's already in, ignoring case", async () => {
    const err = await errorOf(`select public.tournament_sign_up($1, 'alex', null, null, null)`, [t]);
    expect(err?.code).toBe("GGT05");
    expect(err?.message).toMatch(/already signed up/);
  });

  it("won't go past the last spot", async () => {
    expect(await signUp(t, "Casey")).toMatchObject({ players: 3, spots: 3 });
    const err = await errorOf(`select public.tournament_sign_up($1, 'Drew', null, null, null)`, [t]);
    expect(err?.code).toBe("GGT04");
    expect(err?.message).toMatch(/every spot is taken/);
  });

  it("is closed once round 1 is paired, and for tournaments without spots", async () => {
    const started = await tournament("1v1", 4);
    const a = (await signUp(started, "A")).entrant_id;
    const b = (await signUp(started, "B")).entrant_id;
    await db.query(`select public.tournament_pair_round($1, 1, false, $2::jsonb)`, [started, JSON.stringify([{ a, b }])]);
    expect((await errorOf(`select public.tournament_sign_up($1, 'C', null, null, null)`, [started]))?.code).toBe("GGT04");
    const manual = await tournament("1v1", null);
    expect((await errorOf(`select public.tournament_sign_up($1, 'C', null, null, null)`, [manual]))?.message).toMatch(
      /isn't taking sign-ups/,
    );
  });
});

describe("Two-Headed Giant sign-ups", () => {
  let t = "";
  let alex = "";
  beforeAll(async () => {
    t = await tournament("2hg", 6);
  });

  it("lets a player sign up alone, and a friend team up with them", async () => {
    alex = (await signUp(t, "Alex")).entrant_id;
    const sam = await signUp(t, "Sam", alex, "Thrasios & Tymna");
    expect(sam).toMatchObject({ entrant_id: alex, seat: 1, players: 2 });
    expect(await one(`select player_one, player_two, commander_two from public.tournament_entrants where id = $1`, [alex])).toEqual({
      player_one: "Alex",
      player_two: "Sam",
      commander_two: "Thrasios & Tymna",
    });
  });

  it("won't add a third player to a team, or teammates in 1v1", async () => {
    expect((await errorOf(`select public.tournament_sign_up($1, 'Pat', null, null, $2)`, [t, alex]))?.code).toBe("GGT05");
    const v = await tournament("1v1", 4);
    const a = (await signUp(v, "A")).entrant_id;
    expect((await errorOf(`select public.tournament_sign_up($1, 'B', null, null, $2)`, [v, a]))?.code).toBe("GGT01");
  });

  it("won't pair round 1 with anyone still alone", async () => {
    const jo = (await signUp(t, "Jo")).entrant_id;
    const kim = (await signUp(t, "Kim")).entrant_id;
    const err = await errorOf(`select public.tournament_pair_round($1, 1, false, $2::jsonb)`, [
      t,
      JSON.stringify([{ a: alex, b: jo }, { a: kim, b: null }]),
    ]);
    expect(err?.code).toBe("GGT02");
    expect(err?.message).toMatch(/needs two players/);
    // Random teams: Kim joins Jo.
    expect((await one(`select public.tournament_form_teams($1, $2::jsonb) as n`, [t, JSON.stringify([{ keep: jo, merge: kim }])])).n).toBe(1);
    expect(await one(`select player_one, player_two from public.tournament_entrants where id = $1`, [jo])).toEqual({
      player_one: "Jo",
      player_two: "Kim",
    });
    expect((await one(`select count(*)::int as n from public.tournament_entrants where id = $1`, [kim])).n).toBe(0);
    await db.query(`select public.tournament_pair_round($1, 1, false, $2::jsonb)`, [t, JSON.stringify([{ a: alex, b: jo }])]);
    expect((await one(`select current_round from public.tournaments where id = $1`, [t])).current_round).toBe(1);
  });

  it("won't leave anyone alone when forming teams, or form them after round 1", async () => {
    const u = await tournament("2hg", 6);
    const a = (await signUp(u, "A")).entrant_id;
    const b = (await signUp(u, "B")).entrant_id;
    await signUp(u, "C");
    const err = await errorOf(`select public.tournament_form_teams($1, $2::jsonb)`, [u, JSON.stringify([{ keep: a, merge: b }])]);
    expect(err?.code).toBe("GGT02");
    // Nothing changed: the whole call rolled back.
    expect((await one(`select count(*)::int as n from public.tournament_entrants where tournament_id = $1`, [u])).n).toBe(3);
    expect((await errorOf(`select public.tournament_form_teams($1, '[]'::jsonb)`, [t]))?.code).toBe("GGT02");
  });

  it("refuses someone alone once the tournament has started", async () => {
    expect(
      (await errorOf(`insert into public.tournament_entrants (tournament_id, player_one) values ($1, 'Late')`, [t]))?.code,
    ).toBe("GGT01");
  });
});

describe("access", () => {
  it("only the server can sign people up or form teams", async () => {
    const can = await one(
      `select has_function_privilege('anon', 'public.tournament_sign_up(uuid, text, text, uuid, uuid)', 'execute') as anon_signup,
              has_function_privilege('authenticated', 'public.tournament_form_teams(uuid, jsonb)', 'execute') as authed_teams,
              has_function_privilege('service_role', 'public.tournament_sign_up(uuid, text, text, uuid, uuid)', 'execute') as svc`,
    );
    expect(can).toEqual({ anon_signup: false, authed_teams: false, svc: true });
  });

  it("keeps spots in a sensible range", async () => {
    expect((await errorOf(`insert into public.tournaments (name, format, spots) values ('X', '1v1', 1)`))?.code).toBe("23514");
    expect((await errorOf(`insert into public.tournaments (name, format, spots) values ('X', '1v1', 500)`))?.code).toBe("23514");
  });
});
