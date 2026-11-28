import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

// supabase/migrations/20261128090000_tournament_ready.sql on top of the
// earlier tournament migrations, in PGlite: ready-up, how games were lost,
// and poison / commander damage counters (only while a game is played,
// clamped, one row per counter), plus the free-for-all functions taking a
// reason and still answering calls without one.

const read = (name: string) => readFileSync(new URL(`../supabase/migrations/${name}`, import.meta.url), "utf8");
const MIGRATIONS = [
  "20261127200000_tournaments.sql",
  "20261127230000_tournament_display.sql",
  "20261127235000_tournament_signups.sql",
  "20261128040000_tournament_life.sql",
  "20261128060000_tournament_ffa.sql",
  "20261128090000_tournament_ready.sql",
].map(read);

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

let duel = "";
let ffa = "";
let match = "";
const players: string[] = [];
const seats: string[] = [];
const counter = (args: unknown[]) =>
  one(`select public.tournament_change_counter($1, $2, $3, $4, $5, $6, $7) as v`, args).then((r) => r.v as number);

beforeAll(async () => {
  db = new PGlite();
  await db.exec(STANDINS);
  for (const m of MIGRATIONS) await db.exec(m);
  await db.exec(MIGRATIONS[5]); // safe to run twice

  duel = (await one(`insert into public.tournaments (name, format) values ('Duel', '1v1') returning id`)).id;
  const a = (await one(`insert into public.tournament_entrants (tournament_id, player_one) values ($1, 'Alex') returning id`, [duel])).id;
  const b = (await one(`insert into public.tournament_entrants (tournament_id, player_one) values ($1, 'Blair') returning id`, [duel])).id;
  await db.query(`select public.tournament_pair_round($1, 1, false, $2::jsonb)`, [duel, JSON.stringify([{ a, b }])]);
  match = (await one(`select id from public.tournament_matches where tournament_id = $1`, [duel])).id;

  ffa = (await one(`insert into public.tournaments (name, format, table_size) values ('Big', 'ffa', 4) returning id`)).id;
  for (const name of ["Casey", "Drew", "Emery", "Finley"]) {
    players.push((await one(`insert into public.tournament_entrants (tournament_id, player_one) values ($1, $2) returning id`, [ffa, name])).id);
  }
  await db.query(`select public.tournament_deal_pods($1, 1, false, $2::jsonb)`, [ffa, JSON.stringify([players])]);
  for (const p of players) seats.push((await one(`select id from public.tournament_pod_players where entrant_id = $1`, [p])).id);
});
afterAll(() => db.close());

describe("ready-up and how games were lost", () => {
  it("stores the round a player is ready for, and only real ways to lose", async () => {
    await db.query(`update public.tournament_entrants set ready_for = 2 where tournament_id = $1`, [duel]);
    expect((await errorOf(`update public.tournament_entrants set ready_for = 0 where tournament_id = $1`, [duel]))?.code).toBe("23514");
    await db.query(`update public.tournament_matches set loss_reason = 'alt_win' where id = $1`, [match]);
    expect((await errorOf(`update public.tournament_matches set loss_reason = 'bad luck' where id = $1`, [match]))?.code).toBe("23514");
    await db.query(`update public.tournament_matches set loss_reason = null where id = $1`, [match]);
  });
});

describe("counters", () => {
  const ALEX_CMDR = "00000000-0000-4000-8000-00000000000a:0:0";

  it("add up per side and per commander, from 0, and never go below 0", async () => {
    expect(await counter([duel, match, "a", null, "poison", "", 3])).toBe(3);
    expect(await counter([duel, match, "a", null, "poison", null, 2])).toBe(5);
    expect(await counter([duel, match, "a", null, "poison", "", -9])).toBe(0);
    expect(await counter([duel, match, "b", null, "commander", ALEX_CMDR, 7])).toBe(7);
    expect(await counter([duel, match, "b", null, "commander", ALEX_CMDR, 14])).toBe(21);
    expect(await counter([duel, match, "b", null, "commander", `${ALEX_CMDR.slice(0, -1)}1`, 4])).toBe(4);
    const rows = (await db.query<Row>(`select side, kind, source, value, round from public.tournament_counters where match_id = $1 order by side, source`, [match])).rows;
    expect(rows.map((r) => [r.side, r.kind, r.value, r.round])).toEqual([
      ["a", "poison", 0, 1],
      ["b", "commander", 21, 1],
      ["b", "commander", 4, 1],
    ]);
  });

  it("work for a free-for-all seat", async () => {
    expect(await counter([ffa, null, null, seats[0], "commander", "x:0:0", 6])).toBe(6);
    expect(await counter([ffa, null, null, seats[0], "poison", "", 10])).toBe(10);
  });

  it("refuse bad input", async () => {
    expect((await errorOf(`select public.tournament_change_counter($1, $2, 'a', null, 'poison', 'x', 1)`, [duel, match]))?.code).toBe("GGT01");
    expect((await errorOf(`select public.tournament_change_counter($1, $2, 'a', null, 'commander', '', 1)`, [duel, match]))?.code).toBe("GGT01");
    expect((await errorOf(`select public.tournament_change_counter($1, $2, 'a', null, 'energy', '', 1)`, [duel, match]))?.code).toBe("GGT01");
    expect((await errorOf(`select public.tournament_change_counter($1, $2, 'c', null, 'poison', '', 1)`, [duel, match]))?.code).toBe("GGT01");
    expect((await errorOf(`select public.tournament_change_counter($1, null, null, null, 'poison', '', 1)`, [duel]))?.code).toBe("GGT01");
    expect((await errorOf(`select public.tournament_change_counter($1, $2, 'a', null, 'poison', '', 0)`, [duel, match]))?.code).toBe("GGT01");
  });

  it("stop once the game is over (or the player is out)", async () => {
    await db.query(`update public.tournament_matches set result = 'b', reported_at = now() where id = $1`, [match]);
    expect((await errorOf(`select public.tournament_change_counter($1, $2, 'a', null, 'poison', '', 1)`, [duel, match]))?.code).toBe("GGT02");
    await db.query(`select public.tournament_pod_knock_out($1, $2, 'poison')`, [ffa, seats[0]]);
    expect((await errorOf(`select public.tournament_change_counter($1, null, null, $2, 'poison', '', 1)`, [ffa, seats[0]]))?.code).toBe("GGT02");
  });
});

describe("free-for-all reasons", () => {
  it("records how a player went out, and calls without a reason still work", async () => {
    expect((await one(`select out_reason, place from public.tournament_pod_players where id = $1`, [seats[0]]))).toEqual({ out_reason: "poison", place: 4 });
    await db.query(`select public.tournament_pod_knock_out($1, $2)`, [ffa, seats[1]]);
    expect((await one(`select out_reason, place from public.tournament_pod_players where id = $1`, [seats[1]]))).toEqual({ out_reason: null, place: 3 });
    expect((await errorOf(`select public.tournament_pod_knock_out($1, $2, 'boredom')`, [ffa, seats[2]]))?.code).toBe("GGT01");
  });

  it("an alternate win ends the game: the winner is 1st, everyone else still in shares 2nd", async () => {
    const pod = (await one(`select pod_id from public.tournament_pod_players where id = $1`, [seats[2]])).pod_id;
    await db.query(`select public.tournament_pod_set_winner($1, $2, $3, 'alt_win')`, [ffa, pod, players[3]]);
    expect((await one(`select out_reason, place from public.tournament_pod_players where id = $1`, [seats[2]]))).toEqual({ out_reason: "alt_win", place: 2 });
    expect((await one(`select out_reason, place from public.tournament_pod_players where id = $1`, [seats[3]]))).toEqual({ out_reason: null, place: 1 });
  });

  it("undo clears the reason", async () => {
    const pod = (await one(`select pod_id from public.tournament_pod_players where id = $1`, [seats[2]])).pod_id;
    await db.query(`select public.tournament_pod_undo($1, $2)`, [ffa, pod]);
    expect((await one(`select out_reason, place, out_at from public.tournament_pod_players where id = $1`, [seats[2]]))).toEqual({ out_reason: null, place: null, out_at: null });
  });
});

describe("access", () => {
  it("staff read the counters, the browser can't write, and only the server changes them", async () => {
    const writes = await db.query<Row>(
      `select privilege_type from information_schema.role_table_grants
       where table_schema = 'public' and table_name = 'tournament_counters' and grantee in ('anon', 'authenticated') and privilege_type <> 'SELECT'`,
    );
    expect(writes.rows).toEqual([]);
    expect(
      await one(
        `select has_function_privilege('anon', 'public.tournament_change_counter(uuid, uuid, text, uuid, text, text, integer)', 'execute') as anon,
                has_function_privilege('authenticated', 'public.tournament_pod_knock_out(uuid, uuid, text)', 'execute') as authed,
                has_function_privilege('service_role', 'public.tournament_pod_set_winner(uuid, uuid, uuid, text)', 'execute') as svc,
                (select count(*)::int from pg_proc where proname = 'tournament_pod_knock_out') as knockouts`,
      ),
    ).toEqual({ anon: false, authed: false, svc: true, knockouts: 1 });
  });
});
