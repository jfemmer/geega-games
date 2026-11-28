import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeState, createFakeSupabase, fakeId, fakeResponse, type FakeState } from "./helpers/fakeSupabase";

// Ready-up, how games were lost, and poison / commander damage through
// /api/tournament (players) and /api/admin/tournaments (staff), with a
// stand-in database whose RPCs follow the SQL's rules
// (supabase/migrations/20261128090000_tournament_ready.sql).

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
  await handler({ method: "POST", body, headers: { authorization: `Bearer ${STAFF}` }, query: {} } as never, res as never);
  return { status: res.statusCode, body: res.body as Body };
}
async function player(body: Body) {
  const res = fakeResponse();
  await publicHandler({ method: "POST", body, headers: {}, query: {} } as never, res as never);
  return { status: res.statusCode, body: res.body as Body };
}

let tick = Date.parse("2026-11-27T20:00:00.000Z");
const now = () => new Date((tick += 1000)).toISOString();
const err = (code: string, message: string) => ({ data: null, error: { code, message } });
let pairings: Body[] = [];
let rpcs: { name: string; args: Body }[] = [];

beforeEach(() => {
  state = createFakeState();
  state.sessions[STAFF] = { id: fakeId(), email: "jordan@geega-games.com", app_metadata: { role: "staff" } };
  for (const table of [
    "tournaments",
    "tournament_entrants",
    "tournament_matches",
    "tournament_pods",
    "tournament_pod_players",
    "tournament_counters",
    "admin_audit_log",
  ]) {
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
    ready_for: null,
    created_at: now(),
    updated_at: now(),
  });
  pairings = [];
  rpcs = [];
  const tournament = (id: unknown) => state.tables.tournaments.find((r) => r.id === id)!;
  const seats = () => state.tables.tournament_pod_players;
  const left = (podId: unknown) => seats().filter((p) => p.pod_id === podId && !p.out_at);

  state.rpc.tournament_pair_round = (args) => {
    const t = tournament(args.p_tournament_id);
    if (t.current_round !== args.p_round - 1) return err("GGT02", `Round ${args.p_round} is already paired.`);
    pairings.push(args);
    (args.p_pairings as { a: string; b: string | null }[]).forEach((p, i) => {
      state.tables.tournament_matches.push({
        id: fakeId(),
        tournament_id: t.id,
        round: args.p_round,
        table_number: i + 1,
        entrant_a: p.a,
        entrant_b: p.b,
        result: p.b ? "pending" : "bye",
        reported_by: null,
        reported_at: null,
        created_at: now(),
        updated_at: now(),
        life_a: null,
        life_b: null,
        ended_at: null,
        loss_reason: null,
      });
    });
    t.current_round = args.p_round;
    return { data: args.p_round, error: null };
  };
  state.rpc.tournament_deal_pods = (args) => {
    const t = tournament(args.p_tournament_id);
    if (t.current_round !== args.p_round - 1) return err("GGT02", `Round ${args.p_round} is already dealt.`);
    pairings.push(args);
    (args.p_pods as string[][]).forEach((table, i) => {
      const pod = { id: fakeId(), tournament_id: t.id, round: args.p_round, table_number: i + 1, created_at: now(), updated_at: now(), ended_at: null };
      state.tables.tournament_pods.push(pod);
      table.forEach((entrantId, s) =>
        seats().push({ id: fakeId(), tournament_id: t.id, pod_id: pod.id, entrant_id: entrantId, seat: s + 1, life: null, out_at: null, place: null, out_reason: null }),
      );
    });
    t.current_round = args.p_round;
    return { data: args.p_round, error: null };
  };
  state.rpc.tournament_pod_knock_out = (args) => {
    rpcs.push({ name: "knock_out", args });
    const seat = seats().find((p) => p.id === args.p_pod_player_id)!;
    const pod = state.tables.tournament_pods.find((p) => p.id === seat.pod_id)!;
    const n = left(pod.id).length;
    Object.assign(seat, { out_at: now(), place: n, out_reason: args.p_reason ?? null });
    if (n - 1 <= 1) {
      for (const p of left(pod.id)) p.place = 1;
      pod.ended_at = now();
    }
    return { data: { place: n, ended: n - 1 <= 1 }, error: null };
  };
  state.rpc.tournament_pod_set_winner = (args) => {
    rpcs.push({ name: "set_winner", args });
    const at = now();
    for (const p of left(args.p_pod_id)) {
      Object.assign(p, p.entrant_id === args.p_entrant_id ? { place: 1 } : { out_at: at, place: 2, out_reason: args.p_reason ?? null });
    }
    state.tables.tournament_pods.find((p) => p.id === args.p_pod_id)!.ended_at = at;
    return { data: null, error: null };
  };
  state.rpc.tournament_change_counter = (args) => {
    rpcs.push({ name: "counter", args });
    const t = tournament(args.p_tournament_id);
    let round: number | null = null;
    if (args.p_match_id) {
      const m = state.tables.tournament_matches.find((r) => r.id === args.p_match_id);
      if (m && m.result === "pending") round = m.round as number;
    } else {
      const seat = seats().find((p) => p.id === args.p_pod_player_id);
      if (seat && !seat.out_at) round = t.current_round as number;
    }
    if (round == null) return err("GGT02", "This game is over for you.");
    const key = [args.p_match_id, args.p_side, args.p_pod_player_id, args.p_kind, args.p_source].join("|");
    let row = state.tables.tournament_counters.find((r) => r.key === key);
    if (!row) {
      row = { key, tournament_id: t.id, round, match_id: args.p_match_id, side: args.p_side, pod_player_id: args.p_pod_player_id, kind: args.p_kind, source: args.p_source, value: 0 };
      state.tables.tournament_counters.push(row);
    }
    row.value = Math.max(0, Math.min(999, (row.value as number) + (args.p_delta as number)));
    return { data: row.value, error: null };
  };
});

const NAMES = ["Alex", "Blair", "Casey", "Drew", "Emery"];

async function start(format: "1v1" | "ffa", count: number, extra: Body = {}) {
  const res = await post({ action: "create", name: "Night", format, entrants: NAMES.slice(0, count).map((n) => [n]), ...extra });
  expect(res.status).toBe(201);
  const t = (await post({ action: "pair", id: res.body.id, round: 1 })).body.tournament as Body;
  return t;
}
const idOf = (t: Body, name: string) => t.entrants.find((e: Body) => e.players[0] === name).id as string;
const matchOf = (t: Body, name: string) => {
  const id = idOf(t, name);
  const m = t.matches.find((x: Body) => x.round === t.currentRound && (x.a === id || x.b === id));
  return { match: m, side: m.a === id ? "a" : "b", opponent: m.a === id ? m.b : m.a } as { match: Body; side: "a" | "b"; opponent: string | null };
};
const sourceOf = (entrantId: string) => `${entrantId}:0:0`;

describe("losing, and how", () => {
  it("records how the game was lost, and staff results clear it", async () => {
    const t = await start("1v1", 4);
    const { match, side } = matchOf(t, "Alex");
    expect((await player({ token: t.share.token, action: "lost", matchId: match.id, side, reason: "bad luck" })).status).toBe(400);
    const res = await player({ token: t.share.token, action: "lost", matchId: match.id, side, reason: "commander" });
    expect(res.status).toBe(200);
    expect(res.body.tournament.matches.find((m: Body) => m.id === match.id)).toMatchObject({ lossReason: "commander", result: side === "a" ? "b" : "a" });
    await post({ action: "report", id: t.id, matchId: match.id, result: side });
    expect(state.tables.tournament_matches.find((m) => m.id === match.id)?.loss_reason).toBeNull();
  });

  it("still takes a loss without a reason", async () => {
    const t = await start("1v1", 2);
    const { match, side } = matchOf(t, "Alex");
    expect((await player({ token: t.share.token, action: "lost", matchId: match.id, side })).status).toBe(200);
    expect(state.tables.tournament_matches[0].loss_reason).toBeNull();
  });
});

describe("poison and commander damage", () => {
  it("track per side, only from the commanders across the table", async () => {
    const t = await start("1v1", 4);
    const token = t.share.token;
    const { match, side, opponent } = matchOf(t, "Alex");
    const poison = await player({ token, action: "counter", matchId: match.id, side, kind: "poison", delta: 3 });
    expect(poison.body).toMatchObject({ ok: true, value: 3, serverTime: expect.any(String) });
    const cmd = await player({ token, action: "counter", matchId: match.id, side, kind: "commander", source: sourceOf(opponent!), delta: 7 });
    expect(cmd.body.value).toBe(7);
    // A typed partner pair has a second commander.
    expect((await player({ token, action: "counter", matchId: match.id, side, kind: "commander", source: `${opponent}:0:1`, delta: 2 })).body.value).toBe(2);
    // Not from yourself, someone at another table, a seat that isn't there, or no commander at all.
    for (const source of [sourceOf(idOf(t, "Alex")), sourceOf(matchOf(t, "Alex").match.id), `${opponent}:1:0`, ""]) {
      expect((await player({ token, action: "counter", matchId: match.id, side, kind: "commander", source, delta: 1 })).status).toBe(400);
    }
    const other = matchOf(t, NAMES.find((n) => idOf(t, n) !== opponent && n !== "Alex")!);
    expect((await player({ token, action: "counter", matchId: match.id, side, kind: "commander", source: sourceOf(other.match.a), delta: 1 })).status).toBe(400);
    expect((await player({ token, action: "counter", matchId: match.id, side, kind: "energy", delta: 1 })).status).toBe(400);
    expect((await player({ token, action: "counter", matchId: match.id, side, kind: "poison", delta: 0 })).status).toBe(400);

    const view = (await player({ token, action: "get" })).body.tournament;
    expect(view.matches.find((m: Body) => m.id === match.id)[side === "a" ? "countersA" : "countersB"]).toEqual({
      poison: 3,
      commander: { [sourceOf(opponent!)]: 7, [`${opponent}:0:1`]: 2 },
    });
  });

  it("work at a free-for-all table, and stop once you're out", async () => {
    const t = await start("ffa", 4, { tableSize: 4 });
    const token = t.share.token;
    const [me, them] = t.pods[0].players as Body[];
    const res = await player({ token, action: "counter", podPlayerId: me.id, kind: "commander", source: sourceOf(them.entrantId), delta: 21 });
    expect(res.body.value).toBe(21);
    expect((await player({ token, action: "counter", podPlayerId: me.id, kind: "commander", source: sourceOf(me.entrantId), delta: 1 })).status).toBe(400);
    await player({ token, action: "pod-out", podPlayerId: me.id, reason: "commander" });
    expect(state.tables.tournament_pod_players.find((p) => p.id === me.id)?.out_reason).toBe("commander");
    expect((await player({ token, action: "counter", podPlayerId: me.id, kind: "poison", delta: 1 })).status).toBe(409);
  });
});

describe("alternate wins in free-for-all", () => {
  it("end the game: the winner is 1st and everyone else still in shares 2nd", async () => {
    const t = await start("ffa", 4, { tableSize: 4 });
    const [me, , , winner] = t.pods[0].players as Body[];
    const token = t.share.token;
    expect((await player({ token, action: "pod-out", podPlayerId: me.id, reason: "alt_win" })).status).toBe(400);
    expect((await player({ token, action: "pod-out", podPlayerId: me.id, reason: "alt_win", winnerEntrantId: me.entrantId })).status).toBe(400);
    const res = await player({ token, action: "pod-out", podPlayerId: me.id, reason: "alt_win", winnerEntrantId: winner.entrantId });
    expect(res.body.place).toBe(2);
    expect(rpcs.at(-1)).toMatchObject({ name: "set_winner", args: { p_entrant_id: winner.entrantId, p_reason: "alt_win" } });
    const places = res.body.tournament.pods[0].players.map((p: Body) => [p.place, p.outReason]);
    expect(places).toEqual([
      [2, "alt_win"],
      [2, "alt_win"],
      [2, "alt_win"],
      [1, null],
    ]);
  });

  it("with two left, it's just a loss", async () => {
    const t = await start("ffa", 3, { tableSize: 3 });
    const [a, b] = t.pods[0].players as Body[];
    await player({ token: t.share.token, action: "pod-out", podPlayerId: a.id, reason: "decked" });
    const res = await player({ token: t.share.token, action: "pod-out", podPlayerId: b.id, reason: "alt_win" });
    expect(res.body.place).toBe(2);
    expect(rpcs.at(-1)).toMatchObject({ name: "knock_out", args: { p_reason: "alt_win" } });
  });
});

describe("ready-up", () => {
  it("waits for each game to end, then pairs the next round when the last player is ready", async () => {
    const t = await start("1v1", 4);
    const token = t.share.token;
    const alex = idOf(t, "Alex");
    const early = await player({ token, action: "ready", entrantId: alex });
    expect(early.status).toBe(409);
    expect(early.body.message).toBe("Finish your game first.");

    for (const m of t.matches as Body[]) await player({ token, action: "lost", matchId: m.id, side: "b", reason: "life" });
    const ids = (t.entrants as Body[]).map((e) => e.id as string);
    for (const id of ids.slice(0, 3)) {
      const res = await player({ token, action: "ready", entrantId: id });
      expect(res.body.started).toBe(false);
      expect(res.body.tournament.entrants.find((e: Body) => e.id === id).readyFor).toBe(2);
    }
    expect(pairings).toHaveLength(1);
    // Changed their mind, then ready again.
    await player({ token, action: "ready", entrantId: ids[0], ready: false });
    expect(state.tables.tournament_entrants.find((e) => e.id === ids[0])?.ready_for).toBeNull();
    await player({ token, action: "ready", entrantId: ids[0] });

    const last = await player({ token, action: "ready", entrantId: ids[3] });
    expect(last.body.started).toBe(true);
    expect(pairings).toHaveLength(2);
    expect(pairings[1]).toMatchObject({ p_round: 2, p_replace: false });
    expect(last.body.tournament.currentRound).toBe(2);
  });

  it("lets a player with a bye ready up straight away", async () => {
    const t = await start("1v1", 3);
    const bye = (t.matches as Body[]).find((m) => m.b == null)!;
    expect((await player({ token: t.share.token, action: "ready", entrantId: bye.a })).body.ok).toBe(true);
  });

  it("deals the next free-for-all round once everyone's out of their games and ready", async () => {
    const t = await start("ffa", 3, { tableSize: 3 });
    const token = t.share.token;
    const [a, b, c] = t.pods[0].players as Body[];
    await player({ token, action: "pod-out", podPlayerId: a.id, reason: "poison" });
    // Out of the game: ready while the others play on.
    expect((await player({ token, action: "ready", entrantId: a.entrantId })).body.started).toBe(false);
    expect((await player({ token, action: "ready", entrantId: c.entrantId })).status).toBe(409);
    await player({ token, action: "pod-out", podPlayerId: b.id, reason: "life" });
    await player({ token, action: "ready", entrantId: b.entrantId });
    const res = await player({ token, action: "ready", entrantId: c.entrantId });
    expect(res.body.started).toBe(true);
    expect(pairings.at(-1)).toMatchObject({ p_round: 2 });
  });

  it("starts the round when staff drop the one everyone was waiting on", async () => {
    const t = await start("1v1", 4);
    const token = t.share.token;
    for (const m of t.matches as Body[]) await player({ token, action: "lost", matchId: m.id, side: "a", reason: "concede" });
    const ids = (t.entrants as Body[]).map((e) => e.id as string);
    for (const id of ids.slice(0, 3)) await player({ token, action: "ready", entrantId: id });
    await post({ action: "remove-entrant", id: t.id, entrantId: ids[3] });
    expect(pairings).toHaveLength(2);
  });

  it("doesn't pair once everyone has played everyone", async () => {
    const t = await start("1v1", 2);
    const token = t.share.token;
    await player({ token, action: "lost", matchId: t.matches[0].id, side: "a", reason: "life" });
    for (const e of t.entrants as Body[]) expect((await player({ token, action: "ready", entrantId: e.id })).body.started).toBe(false);
    expect(pairings).toHaveLength(1);
  });
});
