import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

// supabase/migrations/20261128060000_tournament_ffa.sql on top of the
// earlier tournament migrations, in PGlite: free-for-all tables are dealt
// with everyone once, players go out in finishing order and the last one
// left wins, staff can pick a winner or undo, life stops when you're out,
// and the next round waits for every game.

const read = (name: string) => readFileSync(new URL(`../supabase/migrations/${name}`, import.meta.url), "utf8");
const MIGRATIONS = [
  read("20261127200000_tournaments.sql"),
  read("20261127230000_tournament_display.sql"),
  read("20261127235000_tournament_signups.sql"),
  read("20261128040000_tournament_life.sql"),
  read("20261128060000_tournament_ffa.sql"),
];

const STANDINS = `
create role anon; create role authenticated; create role service_role;
create function public.is_staff() returns boolean language sql stable as $$ select false $$;
`;

// oxlint-disable-next-line typescript/no-explicit-any
type Row = Record<string, any>;
let db: PGlite;
const one = async (q: string, params?: unknown[]): Promise<Row> => (await db.query<Row>(q, params)).rows[0];
const all = async (q: string, params?: unknown[]): Promise<Row[]> => (await db.query<Row>(q, params)).rows;
async function errorOf(q: string, params?: unknown[]): Promise<{ code: string; message: string } | null> {
  try {
    await db.query(q, params);
    return null;
  } catch (e) {
    const err = e as { code?: string; message?: string };
    return { code: err.code ?? "error", message: err.message ?? "" };
  }
}

let t = "";
const ids: string[] = [];
const deal = (round: number, pods: string[][], replace = false) =>
  db.query(`select public.tournament_deal_pods($1, $2, $3, $4::jsonb)`, [t, round, replace, JSON.stringify(pods)]);
const podPlayer = async (entrant: string, round = 1) =>
  (
    await one(
      `select pp.id from public.tournament_pod_players pp join public.tournament_pods p on p.id = pp.pod_id
       where pp.entrant_id = $1 and p.round = $2`,
      [entrant, round],
    )
  ).id as string;
const out = async (entrant: string, round = 1) =>
  (await one(`select public.tournament_pod_knock_out($1, $2) as r`, [t, await podPlayer(entrant, round)])).r as Row;

beforeAll(async () => {
  db = new PGlite();
  await db.exec(STANDINS);
  for (const m of MIGRATIONS) await db.exec(m);
  await db.exec(MIGRATIONS[4]); // safe to run twice
  t = (await one(`insert into public.tournaments (name, format, table_size) values ('Big game', 'ffa', 4) returning id`)).id;
  for (const name of ["A", "B", "C", "D", "E", "F", "G"]) {
    ids.push((await one(`insert into public.tournament_entrants (tournament_id, player_one) values ($1, $2) returning id`, [t, name])).id);
  }
});
afterAll(() => db.close());

describe("free-for-all tournaments", () => {
  it("need a table size, and only free-for-all has one", async () => {
    expect((await errorOf(`insert into public.tournaments (name, format) values ('X', 'ffa')`))?.code).toBe("23514");
    expect((await errorOf(`insert into public.tournaments (name, format, table_size) values ('X', '1v1', 4)`))?.code).toBe("23514");
    expect((await errorOf(`insert into public.tournaments (name, format, table_size) values ('X', 'ffa', 2)`))?.code).toBe("23514");
    expect((await errorOf(`insert into public.tournaments (name, format) values ('X', 'chaos')`))?.code).toBe("23514");
  });

  it("are one player per entrant", async () => {
    expect(
      (await errorOf(`insert into public.tournament_entrants (tournament_id, player_one, player_two) values ($1, 'X', 'Y')`, [t]))?.code,
    ).toBe("GGT01");
  });
});

describe("dealing tables", () => {
  it("seats everyone once, in table and seat order", async () => {
    await deal(1, [ids.slice(0, 4), ids.slice(4)]);
    const seats = await all(
      `select p.table_number, pp.seat, pp.entrant_id from public.tournament_pod_players pp
       join public.tournament_pods p on p.id = pp.pod_id where p.tournament_id = $1 order by 1, 2`,
      [t],
    );
    expect(seats.map((r) => [r.table_number, r.seat])).toEqual([
      [1, 1],
      [1, 2],
      [1, 3],
      [1, 4],
      [2, 1],
      [2, 2],
      [2, 3],
    ]);
    expect((await one(`select current_round from public.tournaments where id = $1`, [t])).current_round).toBe(1);
  });

  it("refuses someone twice, someone missing, a table of one, or the next round too early", async () => {
    expect((await errorOf(`select public.tournament_deal_pods($1, 1, true, $2::jsonb)`, [t, JSON.stringify([ids.slice(0, 4), [ids[0], ...ids.slice(4)]])]))?.code).toBe("GGT01");
    expect((await errorOf(`select public.tournament_deal_pods($1, 1, true, $2::jsonb)`, [t, JSON.stringify([ids.slice(0, 4), ids.slice(4, 6)])]))?.code).toBe("GGT02");
    expect((await errorOf(`select public.tournament_deal_pods($1, 1, true, $2::jsonb)`, [t, JSON.stringify([ids.slice(0, 6), [ids[6]]])]))?.code).toBe("GGT01");
    const early = await errorOf(`select public.tournament_deal_pods($1, 2, false, $2::jsonb)`, [t, JSON.stringify([ids])]);
    expect(early?.code).toBe("GGT02");
    expect(early?.message).toMatch(/Finish every game in round 1/);
  });

  it("re-deals the round while nobody is out", async () => {
    await deal(1, [ids.slice(3), ids.slice(0, 3)], true);
    expect((await one(`select count(*)::int as n from public.tournament_pods where tournament_id = $1`, [t])).n).toBe(2);
    expect((await one(`select p.table_number from public.tournament_pods p join public.tournament_pod_players pp on pp.pod_id = p.id where pp.entrant_id = $1`, [ids[0]])).table_number).toBe(2);
  });
});

describe("playing a table", () => {
  it("tracks life from the starting life, until a player is out", async () => {
    const pp = await podPlayer(ids[3]);
    expect((await one(`select public.tournament_pod_change_life($1, $2, -7) as l`, [t, pp])).l).toBe(33);
    expect((await one(`select public.tournament_pod_change_life($1, $2, 2) as l`, [t, pp])).l).toBe(35);
    expect((await errorOf(`select public.tournament_pod_change_life($1, $2, 0)`, [t, pp]))?.code).toBe("GGT01");
  });

  it("gives finishing places from the bottom, and the last one left wins", async () => {
    // Table 1: D, E, F, G (4 players).
    expect(await out(ids[4])).toEqual({ place: 4, ended: false });
    expect((await errorOf(`select public.tournament_pod_change_life($1, $2, -1)`, [t, await podPlayer(ids[4])]))?.code).toBe("GGT02");
    expect((await errorOf(`select public.tournament_pod_knock_out($1, $2)`, [t, await podPlayer(ids[4])]))?.code).toBe("GGT02");
    expect(await out(ids[6])).toEqual({ place: 3, ended: false });
    expect(await out(ids[3])).toEqual({ place: 2, ended: true });
    const places = await all(
      `select pp.entrant_id, pp.place, pp.out_at is not null as is_out, p.ended_at is not null as ended
       from public.tournament_pod_players pp join public.tournament_pods p on p.id = pp.pod_id
       where p.table_number = 1 and p.tournament_id = $1 order by pp.place`,
      [t],
    );
    expect(places.map((r) => [r.entrant_id, r.place, r.is_out])).toEqual([
      [ids[5], 1, false],
      [ids[3], 2, true],
      [ids[6], 3, true],
      [ids[4], 4, true],
    ]);
    expect(places.every((r) => r.ended)).toBe(true);
  });

  it("undo brings back whoever went out last and reopens the game", async () => {
    const pod = (await one(`select id from public.tournament_pods where tournament_id = $1 and table_number = 1`, [t])).id;
    await db.query(`select public.tournament_pod_undo($1, $2)`, [t, pod]);
    const rows = await all(`select entrant_id, place from public.tournament_pod_players where pod_id = $1 order by seat`, [pod]);
    expect(Object.fromEntries(rows.map((r) => [r.entrant_id, r.place]))).toMatchObject({
      [ids[3]]: null,
      [ids[5]]: null,
      [ids[6]]: 3,
      [ids[4]]: 4,
    });
    expect((await one(`select ended_at from public.tournament_pods where id = $1`, [pod])).ended_at).toBeNull();
  });

  it("staff can pick the winner: everyone else still in shares 2nd", async () => {
    // Table 2: A, B, C.
    const pod = (await one(`select id from public.tournament_pods where tournament_id = $1 and table_number = 2`, [t])).id;
    expect((await errorOf(`select public.tournament_pod_set_winner($1, $2, $3)`, [t, pod, ids[5]]))?.code).toBe("GGT01");
    await db.query(`select public.tournament_pod_set_winner($1, $2, $3)`, [t, pod, ids[1]]);
    const rows = await all(`select entrant_id, place from public.tournament_pod_players where pod_id = $1`, [pod]);
    expect(Object.fromEntries(rows.map((r) => [r.entrant_id, r.place]))).toEqual({ [ids[0]]: 2, [ids[1]]: 1, [ids[2]]: 2 });
    // Undo takes back the whole call.
    await db.query(`select public.tournament_pod_undo($1, $2)`, [t, pod]);
    expect((await all(`select place from public.tournament_pod_players where pod_id = $1 and place is not null`, [pod]))).toEqual([]);
    await db.query(`select public.tournament_pod_set_winner($1, $2, $3)`, [t, pod, ids[2]]);
  });

  it("deals the next round once every game is decided, and can't re-deal one that's started", async () => {
    expect((await errorOf(`select public.tournament_deal_pods($1, 1, true, $2::jsonb)`, [t, JSON.stringify([ids])]))?.code).toBe("GGT02");
    await out(ids[3]);
    await deal(2, [ids]);
    expect((await one(`select current_round from public.tournaments where id = $1`, [t])).current_round).toBe(2);
  });
});

describe("access", () => {
  it("staff read, the browser can't write, and only the server runs the games", async () => {
    const writes = await all(
      `select table_name, privilege_type from information_schema.role_table_grants
       where table_schema = 'public' and table_name like 'tournament_pod%' and grantee in ('anon', 'authenticated') and privilege_type <> 'SELECT'`,
    );
    expect(writes).toEqual([]);
    const can = await one(
      `select has_function_privilege('anon', 'public.tournament_pod_knock_out(uuid, uuid)', 'execute') as anon_out,
              has_function_privilege('authenticated', 'public.tournament_deal_pods(uuid, integer, boolean, jsonb)', 'execute') as authed_deal,
              has_function_privilege('service_role', 'public.tournament_pod_change_life(uuid, uuid, integer)', 'execute') as svc`,
    );
    expect(can).toEqual({ anon_out: false, authed_deal: false, svc: true });
  });
});
