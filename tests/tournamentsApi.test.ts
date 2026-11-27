import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeState, createFakeSupabase, fakeId, fakeResponse, type FakeState } from "./helpers/fakeSupabase";

// /api/admin/tournaments with a stand-in database. These tests are about the
// endpoint's rules: staff only, names checked against the format, pairing
// done here (everyone still in, once, no rematches) and handed to the RPC with
// the round the page meant, results only where they make sense, and a drop
// handing an open match to the opponent.

beforeAll(() => {
  process.env.SUPABASE_URL = "https://x.invalid";
  process.env.SUPABASE_SECRET_KEY = "svc";
});

let state: FakeState = createFakeState();
vi.mock("../api/_lib/supabaseAdmin.js", () => ({ getSupabaseAdmin: () => createFakeSupabase(state) }));

const { default: handler } = await import("../api/admin/tournaments.ts");

const STAFF = "staff-token";
const CUSTOMER = "customer-token";

// oxlint-disable-next-line typescript/no-explicit-any
type Body = Record<string, any>;

async function call(method: "GET" | "POST", body: Body = {}, opts: { auth?: string | null; query?: Body } = {}) {
  const res = fakeResponse();
  const auth = opts.auth === undefined ? STAFF : opts.auth;
  await handler(
    {
      method,
      body: method === "POST" ? body : undefined,
      headers: auth ? { authorization: `Bearer ${auth}` } : {},
      query: opts.query ?? {},
    } as never,
    res as never,
  );
  return { status: res.statusCode, body: res.body as Body };
}
const post = (body: Body, auth?: string | null) => call("POST", body, { auth });

/** What the RPC was asked to write, per call. */
let rpcCalls: Body[] = [];

beforeEach(() => {
  state = createFakeState();
  state.sessions[STAFF] = { id: fakeId(), email: "jordan@geega-games.com", app_metadata: { role: "staff" } };
  state.sessions[CUSTOMER] = { id: fakeId(), email: "shopper@example.com", app_metadata: { role: "customer" } };
  state.tables.tournaments = [];
  state.tables.tournament_entrants = [];
  state.tables.tournament_matches = [];
  state.tables.admin_audit_log = [];
  state.defaults.tournaments = () => ({
    status: "active",
    current_round: 0,
    created_by: null,
    updated_at: new Date().toISOString(),
    finished_at: null,
  });
  state.defaults.tournament_entrants = () => ({ player_two: null, dropped_at: null, updated_at: new Date().toISOString() });
  rpcCalls = [];
  // Stand-in for tournament_pair_round(): writes the round the way the SQL does.
  state.rpc.tournament_pair_round = (args) => {
    rpcCalls.push(args);
    const t = state.tables.tournaments.find((r) => r.id === args.p_tournament_id)!;
    if (args.p_replace) {
      state.tables.tournament_matches = state.tables.tournament_matches.filter(
        (m) => !(m.tournament_id === t.id && m.round === args.p_round),
      );
    }
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
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
    });
    t.current_round = args.p_round;
    return { data: args.p_round, error: null };
  };
});

async function create(format: "1v1" | "2hg", entrants: string[][], name = "Friday 1v1") {
  const res = await post({ action: "create", name, format, entrants });
  expect(res.status).toBe(201);
  return res.body.tournament as Body;
}

function matchRows(round?: number) {
  return state.tables.tournament_matches.filter((m) => round === undefined || m.round === round);
}

describe("access", () => {
  it("needs a staff session", async () => {
    expect((await call("GET", {}, { auth: null })).status).toBe(401);
    expect((await call("GET", {}, { auth: CUSTOMER })).status).toBe(403);
    expect((await post({ action: "create" }, CUSTOMER)).status).toBe(403);
    expect(state.tables.tournaments).toHaveLength(0);
  });
});

describe("create", () => {
  it("creates a 1v1 tournament with its players and logs it", async () => {
    const t = await create("1v1", [["  Alex "], ["Blair"], ["Casey"]]);
    expect(t).toMatchObject({ name: "Friday 1v1", format: "1v1", status: "active", currentRound: 0 });
    expect(t.entrants.map((e: Body) => e.players)).toEqual([["Alex"], ["Blair"], ["Casey"]]);
    expect(state.tables.tournaments[0].created_by).toBe("jordan@geega-games.com");
    expect(state.tables.admin_audit_log[0]).toMatchObject({ action: "tournament.create", resource_type: "tournament" });
  });

  it("creates Two-Headed Giant teams of two", async () => {
    const t = await create("2hg", [["Alex", "Sam"], ["Jo", "Kim"]], "2HG night");
    expect(t.entrants.map((e: Body) => e.players)).toEqual([
      ["Alex", "Sam"],
      ["Jo", "Kim"],
    ]);
    expect(state.tables.tournament_entrants[0]).toMatchObject({ player_one: "Alex", player_two: "Sam" });
  });

  it("refuses bad input with a message the page can show", async () => {
    const bad = async (body: Body) => (await post({ action: "create", name: "X", format: "1v1", ...body })).body.message;
    expect(await bad({ format: "commander" })).toMatch(/1v1 or Two-Headed Giant/);
    expect(await bad({ name: "   " })).toMatch(/name/);
    expect(await bad({ entrants: [["Alex"]] })).toMatch(/at least two players/);
    expect(await bad({ entrants: [["Alex"], ["alex"]] })).toMatch(/more than once/);
    expect(await bad({ format: "2hg", entrants: [["Alex"], ["Jo", "Kim"]] })).toMatch(/two player names/);
    expect(await bad({ format: "2hg", entrants: [["Alex", "Jo"], ["jo", "Kim"]] })).toMatch(/more than once/);
    expect(await bad({ entrants: Array.from({ length: 65 }, (_, i) => [`P${i}`]) })).toMatch(/up to 64/);
    expect(state.tables.tournaments).toHaveLength(0);
  });
});

describe("reading", () => {
  it("lists tournaments newest first with entrant counts, and loads one", async () => {
    const t = await create("1v1", [["Alex"], ["Blair"]]);
    const list = await call("GET");
    expect(list.body.tournaments).toEqual([expect.objectContaining({ id: t.id, entrantCount: 2, format: "1v1" })]);
    const one = await call("GET", {}, { query: { id: t.id } });
    expect(one.body.tournament.entrants).toHaveLength(2);
    expect((await call("GET", {}, { query: { id: "nope" } })).status).toBe(400);
    expect((await call("GET", {}, { query: { id: fakeId() } })).status).toBe(404);
  });
});

describe("pairing", () => {
  it("pairs everyone still in exactly once, with a bye for an odd count", async () => {
    const t = await create("1v1", [["Alex"], ["Blair"], ["Casey"], ["Drew"], ["Eli"]]);
    const res = await post({ action: "pair", id: t.id, round: 1 });
    expect(res.status).toBe(200);
    expect(rpcCalls).toHaveLength(1);
    expect(rpcCalls[0]).toMatchObject({ p_tournament_id: t.id, p_round: 1, p_replace: false });
    const pairings = rpcCalls[0].p_pairings as { a: string; b: string | null }[];
    const ids = pairings.flatMap((p) => [p.a, p.b]).filter(Boolean);
    expect(new Set(ids).size).toBe(5);
    expect(pairings.filter((p) => p.b === null)).toHaveLength(1);
    expect(res.body.tournament.currentRound).toBe(1);
    expect(res.body.tournament.matches).toHaveLength(3);
  });

  it("refuses a round the page didn't mean (a double tap or another device)", async () => {
    const t = await create("1v1", [["Alex"], ["Blair"]]);
    expect((await post({ action: "pair", id: t.id, round: 2 })).status).toBe(409);
    await post({ action: "pair", id: t.id, round: 1 });
    const again = await post({ action: "pair", id: t.id, round: 1 });
    expect(again.status).toBe(409);
    expect(rpcCalls).toHaveLength(1);
  });

  it("waits for every result, then never repeats a matchup", async () => {
    const t = await create("1v1", [["Alex"], ["Blair"], ["Casey"], ["Drew"]]);
    await post({ action: "pair", id: t.id, round: 1 });
    const blocked = await post({ action: "pair", id: t.id, round: 2 });
    expect(blocked.status).toBe(409);
    expect(blocked.body.message).toMatch(/Record the 2 results still open in round 1/);

    for (let round = 1; round <= 3; round += 1) {
      for (const m of matchRows(round)) {
        expect((await post({ action: "report", id: t.id, matchId: m.id, result: "a" })).status).toBe(200);
      }
      if (round < 3) expect((await post({ action: "pair", id: t.id, round: round + 1 })).status).toBe(200);
    }
    const keys = matchRows().map((m) => [m.entrant_a, m.entrant_b].sort().join("|"));
    expect(new Set(keys).size).toBe(6); // all 6 matchups of 4 players, none twice

    // Everyone has played everyone: nothing left to pair.
    const done = await post({ action: "pair", id: t.id, round: 4 });
    expect(done.status).toBe(409);
    expect(done.body.message).toMatch(/no new pairings left/);
  });

  it("re-pairs a round only before any result is in", async () => {
    const t = await create("1v1", [["Alex"], ["Blair"], ["Casey"], ["Drew"]]);
    await post({ action: "pair", id: t.id, round: 1 });
    const repaired = await post({ action: "pair", id: t.id, round: 1, replace: true });
    expect(repaired.status).toBe(200);
    expect(rpcCalls[1]).toMatchObject({ p_round: 1, p_replace: true });
    expect(matchRows(1)).toHaveLength(2);

    await post({ action: "report", id: t.id, matchId: matchRows(1)[0].id, result: "b" });
    expect((await post({ action: "pair", id: t.id, round: 1, replace: true })).status).toBe(409);
  });

  it("passes database refusals through as messages", async () => {
    const t = await create("1v1", [["Alex"], ["Blair"]]);
    state.rpc.tournament_pair_round = () => ({
      data: null,
      error: { code: "GGT02", message: "The player list changed while you were working. Refresh and try again." },
    });
    const res = await post({ action: "pair", id: t.id, round: 1 });
    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/player list changed/);
  });
});

describe("results", () => {
  it("records who won, credited to the staff member, and can clear this round's result", async () => {
    const t = await create("1v1", [["Alex"], ["Blair"]]);
    await post({ action: "pair", id: t.id, round: 1 });
    const m = matchRows(1)[0];
    const res = await post({ action: "report", id: t.id, matchId: m.id, result: "b" });
    expect(res.status).toBe(200);
    expect(m).toMatchObject({ result: "b", reported_by: "jordan@geega-games.com" });
    expect(m.reported_at).toBeTruthy();

    await post({ action: "report", id: t.id, matchId: m.id, result: "pending" });
    expect(m).toMatchObject({ result: "pending", reported_at: null, reported_by: null });
  });

  it("refuses results that don't make sense", async () => {
    const t = await create("1v1", [["Alex"], ["Blair"], ["Casey"]]);
    await post({ action: "pair", id: t.id, round: 1 });
    const bye = matchRows(1).find((m) => m.entrant_b === null)!;
    const played = matchRows(1).find((m) => m.entrant_b !== null)!;
    expect((await post({ action: "report", id: t.id, matchId: bye.id, result: "a" })).status).toBe(400);
    expect((await post({ action: "report", id: t.id, matchId: played.id, result: "c" })).status).toBe(400);
    expect((await post({ action: "report", id: t.id, matchId: fakeId(), result: "a" })).status).toBe(404);

    // A past round's result can be changed but not cleared.
    await post({ action: "report", id: t.id, matchId: played.id, result: "a" });
    await post({ action: "pair", id: t.id, round: 2 });
    expect((await post({ action: "report", id: t.id, matchId: played.id, result: "pending" })).status).toBe(400);
    expect((await post({ action: "report", id: t.id, matchId: played.id, result: "draw" })).status).toBe(200);
  });

  it("locks results once the tournament is finished, until it's reopened", async () => {
    const t = await create("1v1", [["Alex"], ["Blair"]]);
    await post({ action: "pair", id: t.id, round: 1 });
    const finished = await post({ action: "finish", id: t.id });
    expect(finished.body.tournament).toMatchObject({ status: "finished" });
    expect(finished.body.tournament.finishedAt).toBeTruthy();
    const m = matchRows(1)[0];
    expect((await post({ action: "report", id: t.id, matchId: m.id, result: "a" })).status).toBe(409);
    expect((await post({ action: "pair", id: t.id, round: 2 })).status).toBe(409);
    const reopened = await post({ action: "reopen", id: t.id });
    expect(reopened.body.tournament).toMatchObject({ status: "active", finishedAt: null });
    expect((await post({ action: "report", id: t.id, matchId: m.id, result: "a" })).status).toBe(200);
  });
});

describe("players", () => {
  it("adds late arrivals, but not a name that's already in", async () => {
    const t = await create("1v1", [["Alex"], ["Blair"]]);
    await post({ action: "pair", id: t.id, round: 1 });
    const added = await post({ action: "add-entrant", id: t.id, players: ["Casey"] });
    expect(added.status).toBe(200);
    expect(added.body.tournament.entrants).toHaveLength(3);
    const dup = await post({ action: "add-entrant", id: t.id, players: ["ALEX"] });
    expect(dup.status).toBe(409);
    expect(dup.body.message).toMatch(/ALEX is already in this tournament/);
    expect((await post({ action: "add-entrant", id: t.id, players: ["A", "B"] })).status).toBe(400);
  });

  it("removes someone outright before they've played", async () => {
    const t = await create("1v1", [["Alex"], ["Blair"], ["Casey"]]);
    const casey = t.entrants[2].id;
    const res = await post({ action: "remove-entrant", id: t.id, entrantId: casey });
    expect(res.body.tournament.entrants.map((e: Body) => e.players[0])).toEqual(["Alex", "Blair"]);
  });

  it("drops someone mid-event: results stay, their open match goes to the opponent, and they can come back", async () => {
    const t = await create("1v1", [["Alex"], ["Blair"]]);
    await post({ action: "pair", id: t.id, round: 1 });
    const m = matchRows(1)[0];
    const leaving = m.entrant_a;
    const res = await post({ action: "remove-entrant", id: t.id, entrantId: leaving });
    expect(res.status).toBe(200);
    expect(m).toMatchObject({ result: "b", reported_by: "jordan@geega-games.com" });
    const dropped = res.body.tournament.entrants.find((e: Body) => e.id === leaving);
    expect(dropped.droppedAt).toBeTruthy();

    const back = await post({ action: "restore-entrant", id: t.id, entrantId: leaving });
    expect(back.body.tournament.entrants.find((e: Body) => e.id === leaving).droppedAt).toBeNull();
  });

  it("renames a player or team, keeping names unique", async () => {
    const t = await create("2hg", [["Alex", "Sam"], ["Jo", "Kim"]]);
    const team = t.entrants[0].id;
    expect((await post({ action: "rename-entrant", id: t.id, entrantId: team, players: ["Alex", "Kim"] })).status).toBe(409);
    const ok = await post({ action: "rename-entrant", id: t.id, entrantId: team, players: ["Alex", "Samantha"] });
    expect(ok.body.tournament.entrants[0].players).toEqual(["Alex", "Samantha"]);
  });
});

describe("tournament", () => {
  it("renames, and deletes with an audit entry", async () => {
    const t = await create("1v1", [["Alex"], ["Blair"]]);
    expect((await post({ action: "rename", id: t.id, name: "  Store Champs " })).body.tournament.name).toBe("Store Champs");
    expect((await post({ action: "rename", id: t.id, name: "" })).status).toBe(400);
    expect((await post({ action: "delete", id: t.id })).status).toBe(200);
    expect(state.tables.tournaments).toHaveLength(0);
    expect(state.tables.admin_audit_log.map((r) => r.action)).toEqual(["tournament.create", "tournament.delete"]);
  });

  it("refuses unknown actions", async () => {
    const t = await create("1v1", [["Alex"], ["Blair"]]);
    expect((await post({ action: "explode", id: t.id })).status).toBe(400);
  });
});
