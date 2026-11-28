import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeState, createFakeSupabase, fakeId, fakeResponse, type FakeState } from "./helpers/fakeSupabase";

// Free-for-all through /api/admin/tournaments and /api/tournament, with a
// stand-in database whose RPCs follow the SQL's rules
// (supabase/migrations/20261128060000_tournament_ffa.sql): tables dealt here
// and handed over in one call, life and "I'm out" from phones, finishing
// places from the bottom up, staff calling a winner or taking one back, and
// a dropped player going out of the game they're in.

beforeAll(() => {
  process.env.SUPABASE_URL = "https://x.invalid";
  process.env.SUPABASE_SECRET_KEY = "svc";
});

let state: FakeState = createFakeState();
vi.mock("../api/_lib/supabaseAdmin.js", () => ({ getSupabaseAdmin: () => createFakeSupabase(state) }));
vi.mock("../api/_lib/scryfall.js", () => ({ scryfallSearchCards: vi.fn(async () => []) }));

const { default: handler } = await import("../api/admin/tournaments.ts");
const { default: publicHandler } = await import("../api/tournament.ts");

const STAFF = "staff-token";
// oxlint-disable-next-line typescript/no-explicit-any
type Body = Record<string, any>;

async function post(body: Body) {
  const res = fakeResponse();
  await handler(
    { method: "POST", body, headers: { authorization: `Bearer ${STAFF}` }, query: {} } as never,
    res as never,
  );
  return { status: res.statusCode, body: res.body as Body };
}
async function get(id: string) {
  const res = fakeResponse();
  await handler(
    { method: "GET", headers: { authorization: `Bearer ${STAFF}` }, query: { id } } as never,
    res as never,
  );
  return res.body.tournament as Body;
}
async function playerPost(body: Body) {
  const res = fakeResponse();
  await publicHandler({ method: "POST", body, headers: {}, query: {} } as never, res as never);
  return { status: res.statusCode, body: res.body as Body };
}

let deals: Body[] = [];
const err = (code: string, message: string) => ({ data: null, error: { code, message } });
// Always moving forward, like now() in separate transactions (undo goes by who went out last).
let tick = Date.parse("2026-11-27T20:00:00.000Z");
const now = () => new Date((tick += 1000)).toISOString();

beforeEach(() => {
  state = createFakeState();
  state.sessions[STAFF] = { id: fakeId(), email: "jordan@geega-games.com", app_metadata: { role: "staff" } };
  for (const table of ["tournaments", "tournament_entrants", "tournament_matches", "tournament_pods", "tournament_pod_players", "admin_audit_log"]) {
    state.tables[table] = [];
  }
  state.defaults.tournaments = () => ({
    status: "active",
    current_round: 0,
    created_by: null,
    created_at: now(),
    updated_at: now(),
    finished_at: null,
    share_token: `tok${fakeId().replace(/-/g, "")}`,
    share_enabled: true,
    spots: null,
  });
  state.defaults.tournament_entrants = () => ({
    player_two: null,
    dropped_at: null,
    commander_one: null,
    commander_one_card: null,
    commander_two: null,
    commander_two_card: null,
    created_at: now(),
    updated_at: now(),
  });
  deals = [];

  const pods = () => state.tables.tournament_pods;
  const seats = () => state.tables.tournament_pod_players;
  const left = (podId: unknown) => seats().filter((p) => p.pod_id === podId && !p.out_at);

  state.rpc.tournament_deal_pods = (args) => {
    deals.push(args);
    const t = state.tables.tournaments.find((r) => r.id === args.p_tournament_id)!;
    if (t.format !== "ffa") return err("GGT01", "Tables are for free-for-all tournaments.");
    if (args.p_replace) {
      const gone = new Set(pods().filter((p) => p.tournament_id === t.id && p.round === args.p_round).map((p) => p.id));
      state.tables.tournament_pods = pods().filter((p) => !gone.has(p.id));
      state.tables.tournament_pod_players = seats().filter((p) => !gone.has(p.pod_id));
    } else if (pods().some((p) => p.tournament_id === t.id && p.round === t.current_round && !p.ended_at)) {
      return err("GGT02", `Finish every game in round ${t.current_round} before dealing the next one.`);
    }
    (args.p_pods as string[][]).forEach((table, i) => {
      const pod = { id: fakeId(), tournament_id: t.id, round: args.p_round, table_number: i + 1, created_at: now(), updated_at: now(), ended_at: null };
      pods().push(pod);
      table.forEach((entrantId, s) =>
        seats().push({ id: fakeId(), tournament_id: t.id, pod_id: pod.id, entrant_id: entrantId, seat: s + 1, life: null, out_at: null, place: null }),
      );
    });
    t.current_round = args.p_round;
    return { data: args.p_round, error: null };
  };
  state.rpc.tournament_pod_change_life = (args) => {
    const t = state.tables.tournaments.find((r) => r.id === args.p_tournament_id)!;
    const seat = seats().find((p) => p.id === args.p_pod_player_id);
    const pod = pods().find((p) => p.id === seat?.pod_id);
    if (!seat || !pod || pod.ended_at || seat.out_at) return err("GGT02", "This game is over for you.");
    seat.life = ((seat.life as number | null) ?? (t.starting_life as number)) + (args.p_delta as number);
    return { data: seat.life, error: null };
  };
  state.rpc.tournament_pod_knock_out = (args) => {
    const seat = seats().find((p) => p.id === args.p_pod_player_id)!;
    const pod = pods().find((p) => p.id === seat.pod_id)!;
    if (pod.ended_at) return err("GGT02", "This game is over.");
    if (seat.out_at) return err("GGT02", "That player is already out.");
    const n = left(pod.id).length;
    Object.assign(seat, { out_at: now(), place: n });
    if (n - 1 <= 1) {
      for (const p of left(pod.id)) p.place = 1;
      pod.ended_at = now();
    }
    return { data: { place: n, ended: n - 1 <= 1 }, error: null };
  };
  state.rpc.tournament_pod_set_winner = (args) => {
    const pod = pods().find((p) => p.id === args.p_pod_id)!;
    // One transaction: everyone who goes out goes out at the same moment.
    const at = now();
    for (const p of left(pod.id)) Object.assign(p, p.entrant_id === args.p_entrant_id ? { place: 1 } : { out_at: at, place: 2 });
    pod.ended_at = at;
    return { data: null, error: null };
  };
  state.rpc.tournament_pod_undo = (args) => {
    const at = seats().filter((p) => p.pod_id === args.p_pod_id);
    const last = at.map((p) => p.out_at as string | null).filter(Boolean).sort().at(-1);
    for (const p of at) {
      if (p.out_at === last) Object.assign(p, { out_at: null, place: null });
      if (!p.out_at) p.place = null;
    }
    pods().find((p) => p.id === args.p_pod_id)!.ended_at = null;
    return { data: null, error: null };
  };
  state.rpc.tournament_sign_up = (args) => {
    const t = state.tables.tournaments.find((r) => r.id === args.p_tournament_id)!;
    const row = { id: fakeId(), tournament_id: t.id, player_one: args.p_name, player_two: null, dropped_at: null, created_at: now(), updated_at: now() };
    state.tables.tournament_entrants.push(row);
    return { data: { entrant_id: row.id, seat: 0, players: state.tables.tournament_entrants.length, spots: t.spots }, error: null };
  };
});

const NAMES = ["Alex", "Blair", "Casey", "Drew", "Emery", "Finley", "Gray", "Harper", "Indy"];

async function create(count: number, extra: Body = {}) {
  const res = await post({ action: "create", name: "Big game", format: "ffa", entrants: NAMES.slice(0, count).map((n) => [n]), ...extra });
  expect(res.status).toBe(201);
  return res.body.tournament as Body;
}
async function deal(t: Body, round: number, replace = false) {
  const res = await post({ action: "pair", id: t.id, round, replace });
  expect(res.status).toBe(200);
  return res.body.tournament as Body;
}
const nameOf = (t: Body, entrantId: string) => t.entrants.find((e: Body) => e.id === entrantId).players[0] as string;
/** The seat id at a table for each player name. */
const seatsOf = (t: Body, round: number) =>
  Object.fromEntries(
    (t.pods as Body[]).filter((p) => p.round === round).flatMap((p) => p.players.map((pp: Body) => [nameOf(t, pp.entrantId), { pod: p, seat: pp }])),
  ) as Record<string, { pod: Body; seat: Body }>;

describe("creating a free-for-all", () => {
  it("stores the players per table (4 unless set), needs at least 3 players, and checks the size", async () => {
    const t = await create(5);
    expect(t).toMatchObject({ format: "ffa", tableSize: 4, startingLife: 40, pods: [] });
    expect((await create(8, { tableSize: 8 })).tableSize).toBe(8);
    expect((await post({ action: "create", name: "X", format: "ffa", entrants: [["A"], ["B"]] })).body.message).toBe("Add at least 3 players.");
    expect((await post({ action: "create", name: "X", format: "ffa", entrants: [["A"], ["B"], ["C"]], tableSize: 2 })).status).toBe(400);
    expect((await post({ action: "create", name: "X", format: "ffa", entrants: [["A", "B"], ["C"], ["D"]] })).status).toBe(400);
    expect(state.tables.admin_audit_log.at(-1)?.after).toMatchObject({ format: "ffa", tableSize: 8 });
  });

  it("other formats don't get a table size", async () => {
    const res = await post({ action: "create", name: "X", format: "1v1", entrants: [["A"], ["B"]], tableSize: 6 });
    expect(res.body.tournament.tableSize).toBeNull();
    expect(state.tables.tournaments[0].table_size).toBeNull();
    expect((await post({ action: "table-size", id: res.body.id, tableSize: 4 })).status).toBe(400);
  });
});

describe("dealing tables", () => {
  it("seats everyone once, as evenly as the table size allows", async () => {
    const t = await deal(await create(9), 1);
    expect(deals[0]).toMatchObject({ p_round: 1, p_replace: false });
    const tables = deals[0].p_pods as string[][];
    expect(tables.map((x) => x.length)).toEqual([3, 3, 3]);
    expect(new Set(tables.flat()).size).toBe(9);
    expect(t.currentRound).toBe(1);
    expect(t.pods).toHaveLength(3);
    expect(t.pods[0].players.map((p: Body) => p.seat)).toEqual([1, 2, 3]);
  });

  it("puts everyone at one table when the table size covers them", async () => {
    await deal(await create(8, { tableSize: 8 }), 1);
    expect((deals[0].p_pods as string[][]).map((x) => x.length)).toEqual([8]);
  });

  it("waits for every game before the next round, then mixes up the tables", async () => {
    const t = await deal(await create(8), 1);
    const blocked = await post({ action: "pair", id: t.id, round: 2 });
    expect(blocked.status).toBe(409);
    expect(blocked.body.message).toMatch(/Finish the 2 games still being played in round 1/);
    for (const pod of t.pods as Body[]) {
      await post({ action: "pod-winner", id: t.id, podId: pod.id, entrantId: pod.players[0].entrantId });
    }
    await deal(t, 2);
    // Two tables of four from two tables of four: two from each, so nobody keeps the same table.
    const before = (deals[0].p_pods as string[][]).map((x) => new Set(x));
    for (const table of deals[1].p_pods as string[][]) {
      for (const old of before) expect(table.filter((id) => old.has(id)).length).toBe(2);
    }
  });

  it("re-deals the round while nobody is out, and not after", async () => {
    const t = await deal(await create(6), 1);
    await deal(t, 1, true);
    expect(deals[1]).toMatchObject({ p_round: 1, p_replace: true });
    const someone = (await get(t.id)).pods[0].players[0];
    await post({ action: "knock-out", id: t.id, podPlayerId: someone.id });
    const res = await post({ action: "pair", id: t.id, round: 1, replace: true });
    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/already out in round 1/);
  });

  it("deals round 1 on its own when the last sign-up spot fills", async () => {
    const res = await post({ action: "create", name: "Open game", format: "ffa", entrants: [], spots: 3, tableSize: 8 });
    expect(res.status).toBe(201);
    expect((await post({ action: "create", name: "X", format: "ffa", entrants: [], spots: 2 })).status).toBe(400);
    const token = res.body.tournament.share.token;
    for (const name of ["Alex", "Blair"]) await playerPost({ token, action: "sign-up", name });
    expect(deals).toHaveLength(0);
    const last = await playerPost({ token, action: "sign-up", name: "Casey" });
    expect(last.body.started).toBe(true);
    expect((deals[0].p_pods as string[][]).map((x) => x.length)).toEqual([3]);
  });
});

describe("playing a table from phones", () => {
  it("tracks life, gives places from the bottom, and the last one standing wins", async () => {
    const t = await deal(await create(4, { tableSize: 4 }), 1);
    const token = t.share.token;
    const at = seatsOf(t, 1);

    const life = await playerPost({ token, action: "pod-life", podPlayerId: at.Alex.seat.id, delta: -12 });
    expect(life.status).toBe(200);
    expect(life.body).toMatchObject({ life: 28, serverTime: expect.any(String) });

    const out1 = await playerPost({ token, action: "pod-out", podPlayerId: at.Alex.seat.id });
    expect(out1.body.place).toBe(4);
    expect(out1.body.tournament.share).toBeUndefined();
    expect((await playerPost({ token, action: "pod-life", podPlayerId: at.Alex.seat.id, delta: -1 })).status).toBe(409);
    expect((await playerPost({ token, action: "pod-out", podPlayerId: at.Alex.seat.id })).status).toBe(409);

    expect((await playerPost({ token, action: "pod-out", podPlayerId: at.Casey.seat.id })).body.place).toBe(3);
    const done = await playerPost({ token, action: "pod-out", podPlayerId: at.Blair.seat.id });
    expect(done.body.place).toBe(2);
    const pod = done.body.tournament.pods[0];
    expect(pod.endedAt).toEqual(expect.any(String));
    const places = Object.fromEntries(pod.players.map((p: Body) => [nameOf(t, p.entrantId), p.place]));
    expect(places).toEqual({ Alex: 4, Blair: 2, Casey: 3, Drew: 1 });
    expect((await playerPost({ token, action: "pod-out", podPlayerId: at.Drew.seat.id })).status).toBe(409);
  });

  it("checks the seat and the change", async () => {
    const t = await deal(await create(3), 1);
    const token = t.share.token;
    expect((await playerPost({ token, action: "pod-life", podPlayerId: "nope", delta: -1 })).status).toBe(400);
    expect((await playerPost({ token, action: "pod-life", podPlayerId: fakeId(), delta: -1 })).status).toBe(404);
    expect((await playerPost({ token, action: "pod-life", podPlayerId: t.pods[0].players[0].id, delta: 0 })).status).toBe(400);
    expect((await playerPost({ token, action: "pod-life", podPlayerId: t.pods[0].players[0].id, delta: 5000 })).status).toBe(400);
  });
});

describe("staff at a table", () => {
  it("mark players out, call a winner (the rest share 2nd) and take it back", async () => {
    const t = await deal(await create(5, { tableSize: 5 }), 1);
    const at = seatsOf(t, 1);
    await post({ action: "knock-out", id: t.id, podPlayerId: at.Emery.seat.id });
    expect((await post({ action: "pod-winner", id: t.id, podId: at.Alex.pod.id, entrantId: at.Emery.seat.entrantId })).status).toBe(400);
    const won = (await post({ action: "pod-winner", id: t.id, podId: at.Alex.pod.id, entrantId: at.Blair.seat.entrantId })).body.tournament;
    const places = Object.fromEntries(won.pods[0].players.map((p: Body) => [nameOf(t, p.entrantId), p.place]));
    expect(places).toEqual({ Alex: 2, Blair: 1, Casey: 2, Drew: 2, Emery: 5 });
    expect((await post({ action: "pod-winner", id: t.id, podId: at.Alex.pod.id, entrantId: at.Blair.seat.entrantId })).status).toBe(409);

    const undone = (await post({ action: "pod-undo", id: t.id, podId: at.Alex.pod.id })).body.tournament;
    expect(undone.pods[0].endedAt).toBeNull();
    expect(undone.pods[0].players.filter((p: Body) => p.place != null).map((p: Body) => nameOf(t, p.entrantId))).toEqual(["Emery"]);
  });

  it("only change this round's games", async () => {
    const t = await deal(await create(3), 1);
    await post({ action: "pod-winner", id: t.id, podId: t.pods[0].id, entrantId: t.pods[0].players[0].entrantId });
    await deal(t, 2);
    const res = await post({ action: "pod-undo", id: t.id, podId: t.pods[0].id });
    expect(res.status).toBe(409);
    expect(res.body.message).toBe("Only this round's games can be changed.");
  });

  it("change the table size for the next deal", async () => {
    const t = await create(6);
    expect((await post({ action: "table-size", id: t.id, tableSize: 6 })).body.tournament.tableSize).toBe(6);
    expect((await post({ action: "table-size", id: t.id, tableSize: 99 })).status).toBe(400);
    await deal(t, 1);
    expect((deals[0].p_pods as string[][]).map((x) => x.length)).toEqual([6]);
  });

  it("dropping a player mid-game puts them out of it, and they aren't dealt again", async () => {
    const t = await deal(await create(4, { tableSize: 4 }), 1);
    const at = seatsOf(t, 1);
    const res = await post({ action: "remove-entrant", id: t.id, entrantId: at.Casey.seat.entrantId });
    expect(res.status).toBe(200);
    const seat = res.body.tournament.pods[0].players.find((p: Body) => p.entrantId === at.Casey.seat.entrantId);
    expect(seat).toMatchObject({ place: 4, outAt: expect.any(String) });
    expect(res.body.tournament.entrants.find((e: Body) => e.id === at.Casey.seat.entrantId).droppedAt).toEqual(expect.any(String));
    await post({ action: "pod-winner", id: t.id, podId: at.Alex.pod.id, entrantId: at.Alex.seat.entrantId });
    await deal(t, 2);
    expect((deals[1].p_pods as string[][]).flat()).not.toContain(at.Casey.seat.entrantId);
  });

  it("deletes someone who was never dealt in", async () => {
    const t = await create(4);
    const res = await post({ action: "remove-entrant", id: t.id, entrantId: t.entrants[0].id });
    expect(res.body.tournament.entrants).toHaveLength(3);
  });
});
