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
const scry = vi.hoisted(() => ({ searchCards: vi.fn() }));
vi.mock("../api/_lib/supabaseAdmin.js", () => ({ getSupabaseAdmin: () => createFakeSupabase(state) }));
vi.mock("../api/_lib/scryfall.js", () => ({ scryfallSearchCards: scry.searchCards }));

const { default: handler } = await import("../api/admin/tournaments.ts");
const { default: publicHandler } = await import("../api/tournament.ts");

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
    updated_at: new Date().toISOString(),
  });
  scry.searchCards.mockReset();
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
        life_a: null,
        life_b: null,
        ended_at: null,
      });
    });
    t.current_round = args.p_round;
    return { data: args.p_round, error: null };
  };
  // Stand-ins for tournament_sign_up() and tournament_form_teams(), with the SQL's rules.
  state.rpc.tournament_sign_up = (args) => {
    const t = state.tables.tournaments.find((r) => r.id === args.p_tournament_id)!;
    const err = (code: string, message: string) => ({ data: null, error: { code, message } });
    if (t.status !== "active" || (t.current_round as number) > 0) return err("GGT04", "Sign-ups are closed: this tournament has started.");
    if (t.spots == null) return err("GGT04", "This tournament isn't taking sign-ups. Ask the store to add you.");
    const mine = state.tables.tournament_entrants.filter((e) => e.tournament_id === t.id);
    const players = mine.filter((e) => !e.dropped_at).reduce((n, e) => n + (e.player_two ? 2 : 1), 0);
    if (players >= (t.spots as number)) return err("GGT04", "Sorry, every spot is taken.");
    const name = String(args.p_name).toLowerCase();
    if (mine.some((e) => String(e.player_one).toLowerCase() === name || String(e.player_two ?? "").toLowerCase() === name)) {
      return err("GGT05", `Someone named ${args.p_name} has already signed up. Add your last initial.`);
    }
    if (args.p_team_with) {
      const e = mine.find((x) => x.id === args.p_team_with && !x.player_two && !x.dropped_at);
      if (!e) return err("GGT05", "That player already has a teammate.");
      Object.assign(e, { player_two: args.p_name, commander_two: args.p_commander, commander_two_card: args.p_card });
      return { data: { entrant_id: e.id, seat: 1, players: players + 1, spots: t.spots }, error: null };
    }
    const row = {
      id: fakeId(),
      tournament_id: t.id,
      player_one: args.p_name,
      player_two: null,
      commander_one: args.p_commander,
      commander_one_card: args.p_card,
      commander_two: null,
      commander_two_card: null,
      dropped_at: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    state.tables.tournament_entrants.push(row);
    return { data: { entrant_id: row.id, seat: 0, players: players + 1, spots: t.spots }, error: null };
  };
  // Stand-in for tournament_change_life(): adds to a side while the game is pending.
  state.rpc.tournament_change_life = (args) => {
    const t = state.tables.tournaments.find((r) => r.id === args.p_tournament_id)!;
    const m = state.tables.tournament_matches.find((r) => r.id === args.p_match_id && r.tournament_id === t.id);
    if (!m || m.result !== "pending" || !m.entrant_b) return { data: null, error: { code: "GGT02", message: "This game is over." } };
    const start = t.starting_life as number;
    const key = args.p_side === "a" ? "life_a" : "life_b";
    m[key] = ((m[key] as number | null) ?? start) + (args.p_delta as number);
    return { data: { life_a: (m.life_a as number | null) ?? start, life_b: (m.life_b as number | null) ?? start }, error: null };
  };
  state.rpc.tournament_form_teams = (args) => {
    for (const { keep, merge } of args.p_pairs as { keep: string; merge: string }[]) {
      const m = state.tables.tournament_entrants.find((e) => e.id === merge)!;
      const k = state.tables.tournament_entrants.find((e) => e.id === keep)!;
      Object.assign(k, { player_two: m.player_one, commander_two: m.commander_one, commander_two_card: m.commander_one_card });
      state.tables.tournament_entrants = state.tables.tournament_entrants.filter((e) => e.id !== merge);
    }
    return { data: (args.p_pairs as unknown[]).length, error: null };
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
    expect(await bad({ format: "commander" })).toMatch(/1v1, Two-Headed Giant or free-for-all/);
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

// ───────────────────────── player display ─────────────────────────

async function playerPost(body: Body) {
  const res = fakeResponse();
  await publicHandler({ method: "POST", body, headers: {}, query: {} } as never, res as never);
  return { status: res.statusCode, body: res.body as Body };
}

const ATRAXA = "d0d33d52-3d28-4635-b985-51e126289259";

describe("player display link", () => {
  it("staff see the link; players open the tournament with it, without the link or staff details", async () => {
    const t = await create("1v1", [["Alex"], ["Blair"]]);
    expect(t.share).toEqual({ token: expect.stringMatching(/^tok/), enabled: true });
    await post({ action: "pair", id: t.id, round: 1 });
    const res = await playerPost({ token: t.share.token, action: "get" });
    expect(res.status).toBe(200);
    expect(res.body.tournament).toMatchObject({ id: t.id, name: "Friday 1v1", currentRound: 1 });
    expect(res.body.tournament.matches).toHaveLength(1);
    expect(res.body.tournament.share).toBeUndefined();
    const text = JSON.stringify(res.body);
    expect(text).not.toContain(t.share.token);
    expect(text).not.toContain("jordan@geega-games.com");
  });

  it("refuses unknown, malformed and turned-off links alike", async () => {
    const t = await create("1v1", [["Alex"], ["Blair"]]);
    expect((await playerPost({ token: "nope", action: "get" })).status).toBe(404);
    expect((await playerPost({ token: "x".repeat(40), action: "get" })).status).toBe(404);
    const off = await post({ action: "share", id: t.id, enabled: false });
    expect(off.body.tournament.share.enabled).toBe(false);
    expect((await playerPost({ token: t.share.token, action: "get" })).status).toBe(404);
    expect((await playerPost({ token: t.share.token, action: "unknown" })).status).toBe(400);
  });

  it("a new link replaces the old one", async () => {
    const t = await create("1v1", [["Alex"], ["Blair"]]);
    const res = await post({ action: "share", id: t.id, rotate: true });
    const fresh = res.body.tournament.share.token as string;
    expect(fresh).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(fresh).not.toBe(t.share.token);
    expect((await playerPost({ token: t.share.token, action: "get" })).status).toBe(404);
    expect((await playerPost({ token: fresh, action: "get" })).status).toBe(200);
  });
});

describe("commanders", () => {
  it("players set their own commander, with the card they picked", async () => {
    const t = await create("2hg", [["Alex", "Sam"], ["Jo", "Kim"]]);
    const team = t.entrants[0].id;
    const res = await playerPost({
      token: t.share.token,
      action: "commander",
      entrantId: team,
      seat: 1,
      commander: { name: "  Atraxa,   Praetors' Voice ", cardId: ATRAXA.toUpperCase() },
    });
    expect(res.status).toBe(200);
    expect(res.body.tournament.entrants[0].commanders).toEqual([null, { name: "Atraxa, Praetors' Voice", cardId: ATRAXA }]);
    expect(state.tables.tournament_entrants[0]).toMatchObject({ commander_two: "Atraxa, Praetors' Voice", commander_two_card: ATRAXA });

    // A typed name with a junk card id keeps the name only; null clears it.
    await playerPost({ token: t.share.token, action: "commander", entrantId: team, seat: 0, commander: { name: "Thrasios & Tymna", cardId: "javascript:alert(1)" } });
    expect(state.tables.tournament_entrants[0]).toMatchObject({ commander_one: "Thrasios & Tymna", commander_one_card: null });
    await playerPost({ token: t.share.token, action: "commander", entrantId: team, seat: 1, commander: null });
    expect(state.tables.tournament_entrants[0]).toMatchObject({ commander_two: null, commander_two_card: null });
  });

  it("refuses a seat that doesn't exist, someone from another tournament, and a finished tournament", async () => {
    const t = await create("1v1", [["Alex"], ["Blair"]]);
    const other = await create("1v1", [["Sam"], ["Jo"]], "Saturday");
    const alex = t.entrants[0].id;
    const commander = { name: "Krenko, Mob Boss" };
    expect((await playerPost({ token: t.share.token, action: "commander", entrantId: alex, seat: 1, commander })).status).toBe(400);
    expect((await playerPost({ token: t.share.token, action: "commander", entrantId: alex, seat: "0", commander })).status).toBe(400);
    expect(
      (await playerPost({ token: t.share.token, action: "commander", entrantId: other.entrants[0].id, seat: 0, commander })).status,
    ).toBe(404);
    await post({ action: "finish", id: t.id });
    const locked = await playerPost({ token: t.share.token, action: "commander", entrantId: alex, seat: 0, commander });
    expect(locked.status).toBe(409);
    expect(locked.body.message).toMatch(/locked in/);
  });

  it("searches commanders on Scryfall with only the words typed", async () => {
    const t = await create("1v1", [["Alex"], ["Blair"]]);
    scry.searchCards.mockResolvedValue(
      Array.from({ length: 12 }, (_, i) => ({ id: `${ATRAXA.slice(0, -2)}${String(i).padStart(2, "0")}`, name: `Atraxa ${i}` })),
    );
    const res = await playerPost({ token: t.share.token, action: "commander-search", query: 'atraxa" -t:land or (x)' });
    expect(scry.searchCards).toHaveBeenCalledWith("is:commander game:paper atraxa t land x", "edhrec");
    expect(res.body.options).toHaveLength(8);
    expect(res.body.options[0]).toEqual({ name: "Atraxa 0", cardId: `${ATRAXA.slice(0, -2)}00` });

    scry.searchCards.mockClear();
    expect((await playerPost({ token: t.share.token, action: "commander-search", query: "a" })).body.options).toEqual([]);
    expect(scry.searchCards).not.toHaveBeenCalled();
    // Staff search from the admin Edit dialog the same way.
    scry.searchCards.mockResolvedValue([{ id: ATRAXA, name: "Atraxa, Praetors' Voice" }]);
    expect((await post({ action: "commander-search", query: "atraxa" })).body.options).toEqual([
      { name: "Atraxa, Praetors' Voice", cardId: ATRAXA },
    ]);
  });

  it("staff set names and commanders together from the Edit dialog", async () => {
    const t = await create("1v1", [["Alex"], ["Blair"]]);
    const res = await post({
      action: "rename-entrant",
      id: t.id,
      entrantId: t.entrants[0].id,
      players: ["Alexis"],
      commanders: [{ name: "Atraxa, Praetors' Voice", cardId: ATRAXA }],
    });
    expect(res.body.tournament.entrants[0]).toMatchObject({
      players: ["Alexis"],
      commanders: [{ name: "Atraxa, Praetors' Voice", cardId: ATRAXA }],
    });
    // Renaming without commanders leaves them alone.
    await post({ action: "rename-entrant", id: t.id, entrantId: t.entrants[0].id, players: ["Alex"] });
    expect(state.tables.tournament_entrants[0]).toMatchObject({ player_one: "Alex", commander_one: "Atraxa, Praetors' Voice" });
  });
});

// ─────────────────────────────── sign-ups ───────────────────────────────

async function signupTournament(format: "1v1" | "2hg", spots: number) {
  const res = await post({ action: "create", name: "Sign-up night", format, entrants: [], spots });
  expect(res.status).toBe(201);
  return res.body.tournament as Body;
}
const join = (token: string, name: string, extra: Body = {}) => playerPost({ token, action: "sign-up", name, ...extra });

describe("sign-ups", () => {
  it("creates a tournament with player spots and nobody in yet", async () => {
    const t = await signupTournament("1v1", 4);
    expect(t).toMatchObject({ spots: 4, currentRound: 0, entrants: [] });
    expect(state.tables.tournaments[0].spots).toBe(4);
  });

  it("checks the number of spots for the format", async () => {
    const bad = async (format: string, spots: unknown) =>
      (await post({ action: "create", name: "X", format, entrants: [], spots })).body.message;
    expect(await bad("1v1", 1)).toMatch(/between 2 and 64/);
    expect(await bad("1v1", 65)).toMatch(/between 2 and 64/);
    expect(await bad("1v1", "8")).toMatch(/number of player spots/);
    expect(await bad("2hg", 2)).toMatch(/between 4 and 64/);
    expect(await bad("2hg", 7)).toMatch(/even number/);
    expect((await post({ action: "create", name: "X", format: "1v1", entrants: [["A"], ["B"], ["C"]], spots: 2 })).body.message).toMatch(
      /more names than the 2 player spots/,
    );
  });

  it("players take spots from the link, with their commander, and get their seat back", async () => {
    const t = await signupTournament("1v1", 3);
    const res = await join(t.share.token, "  Alex ", { commander: { name: "Atraxa, Praetors' Voice", cardId: ATRAXA } });
    expect(res.status).toBe(200);
    expect(res.body.started).toBe(false);
    expect(res.body.seat).toEqual({ entrantId: state.tables.tournament_entrants[0].id, seat: 0 });
    expect(res.body.tournament.entrants[0]).toMatchObject({
      players: ["Alex"],
      commanders: [{ name: "Atraxa, Praetors' Voice", cardId: ATRAXA }],
    });
    expect(res.body.tournament.share).toBeUndefined();
    expect((await join(t.share.token, "")).body.message).toMatch(/Enter your name/);
    const dup = await join(t.share.token, "ALEX");
    expect(dup.status).toBe(409);
    expect(dup.body.message).toMatch(/already signed up/);
  });

  it("starts round 1 by itself when the last spot fills, and then turns sign-ups away", async () => {
    const t = await signupTournament("1v1", 3);
    await join(t.share.token, "Alex");
    await join(t.share.token, "Blair");
    expect(rpcCalls).toHaveLength(0);
    const last = await join(t.share.token, "Casey");
    expect(last.body.started).toBe(true);
    expect(last.body.tournament.currentRound).toBe(1);
    expect(rpcCalls).toHaveLength(1);
    expect(rpcCalls[0]).toMatchObject({ p_round: 1, p_replace: false });
    const ids = (rpcCalls[0].p_pairings as { a: string; b: string | null }[]).flatMap((p) => [p.a, p.b]).filter(Boolean);
    expect(new Set(ids).size).toBe(3);

    const late = await join(t.share.token, "Drew");
    expect(late.status).toBe(409);
    expect(late.body.message).toMatch(/Sign-ups are closed/);
  });

  it("refuses sign-ups for tournaments where staff enter everyone", async () => {
    const t = await create("1v1", [["Alex"], ["Blair"]]);
    const res = await join(t.share.token, "Casey");
    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/isn't taking sign-ups/);
  });

  it("Two-Headed Giant: friends team up, everyone else gets a random teammate when it fills", async () => {
    const t = await signupTournament("2hg", 6);
    const alex = (await join(t.share.token, "Alex")).body.seat;
    const sam = await join(t.share.token, "Sam", { teamWith: alex.entrantId, commander: { name: "Krenko, Mob Boss" } });
    expect(sam.body.seat).toEqual({ entrantId: alex.entrantId, seat: 1 });
    expect(sam.body.tournament.entrants[0]).toMatchObject({
      players: ["Alex", "Sam"],
      commanders: [null, { name: "Krenko, Mob Boss", cardId: null }],
    });
    await join(t.share.token, "Jo");
    await join(t.share.token, "Kim");
    await join(t.share.token, "Pat");
    const last = await join(t.share.token, "Lee");
    expect(last.body.started).toBe(true);
    const teams = (last.body.tournament.entrants as Body[]).map((e) => e.players.slice().sort().join("+"));
    expect(teams).toHaveLength(3);
    expect(teams).toContain("Alex+Sam");
    expect(teams.flatMap((x) => x.split("+")).sort()).toEqual(["Alex", "Jo", "Kim", "Lee", "Pat", "Sam"]);
    expect(rpcCalls).toHaveLength(1);
  });

  it("staff can start early, but Two-Headed Giant needs an even number of players", async () => {
    const t = await signupTournament("2hg", 8);
    for (const n of ["Alex", "Blair", "Casey", "Drew", "Eli"]) await join(t.share.token, n);
    const odd = await post({ action: "start", id: t.id });
    expect(odd.status).toBe(409);
    expect(odd.body.message).toMatch(/even number of players: 5/);
    await join(t.share.token, "Frankie");
    const started = await post({ action: "start", id: t.id });
    expect(started.status).toBe(200);
    expect(started.body.tournament.currentRound).toBe(1);
    expect(started.body.tournament.entrants).toHaveLength(3);
    expect((started.body.tournament.entrants as Body[]).every((e) => e.players.length === 2)).toBe(true);
  });

  it("staff change the spots (never below who's in), and matching them starts round 1", async () => {
    const t = await signupTournament("1v1", 6);
    for (const n of ["Alex", "Blair", "Casey"]) await join(t.share.token, n);
    const below = await post({ action: "spots", id: t.id, spots: 2 });
    expect(below.status).toBe(409);
    expect(below.body.message).toMatch(/3 players have already signed up/);
    const more = await post({ action: "spots", id: t.id, spots: 8 });
    expect(more.body.tournament).toMatchObject({ spots: 8, currentRound: 0 });
    const match = await post({ action: "spots", id: t.id, spots: 3 });
    expect(match.body.tournament).toMatchObject({ spots: 3, currentRound: 1 });
    expect((await post({ action: "spots", id: t.id, spots: 4 })).status).toBe(409);
  });

  it("staff-added players take spots too: alone in Two-Headed Giant, and the last one starts it", async () => {
    const t = await signupTournament("2hg", 4);
    await join(t.share.token, "Alex");
    const solo = await post({ action: "add-entrant", id: t.id, players: ["Blair", ""] });
    expect(solo.status).toBe(200);
    expect(solo.body.tournament.entrants[1].players).toEqual(["Blair"]);
    const tooMany = await post({ action: "add-entrant", id: t.id, players: ["Casey", "Drew", "Eli"] });
    expect(tooMany.status).toBe(400);
    const team = await post({ action: "add-entrant", id: t.id, players: ["Casey", "Drew"] });
    expect(team.body.tournament.currentRound).toBe(1);
    // Once it has started, late arrivals join as usual: spots no longer apply.
    const late = await post({ action: "add-entrant", id: t.id, players: ["Late", "Comer"] });
    expect(late.status).toBe(200);
    expect(late.body.tournament.entrants).toHaveLength(3);
  });
});

// ───────────────────────────── life and game times ─────────────────────────────

describe("starting life", () => {
  it("defaults to 40 for 1v1 and 60 for Two-Headed Giant, or what staff pick", async () => {
    expect((await create("1v1", [["Alex"], ["Blair"]])).startingLife).toBe(40);
    expect((await create("2hg", [["Alex", "Sam"], ["Jo", "Kim"]], "2HG")).startingLife).toBe(60);
    const custom = await post({ action: "create", name: "Modern", format: "1v1", entrants: [["A"], ["B"]], startingLife: 20 });
    expect(custom.body.tournament.startingLife).toBe(20);
    const bad = await post({ action: "create", name: "X", format: "1v1", entrants: [["A"], ["B"]], startingLife: 0 });
    expect(bad.status).toBe(400);
    expect(bad.body.message).toMatch(/whole number from 1 to 999/);
  });

  it("staff can change it", async () => {
    const t = await create("1v1", [["Alex"], ["Blair"]]);
    expect((await post({ action: "starting-life", id: t.id, life: 30 })).body.tournament.startingLife).toBe(30);
    expect((await post({ action: "starting-life", id: t.id, life: 1000 })).status).toBe(400);
  });

  it("sends the server's clock with every tournament, for game timers", async () => {
    const t = await create("1v1", [["Alex"], ["Blair"]]);
    expect(Date.parse(t.serverTime)).toBeGreaterThan(Date.now() - 60_000);
    expect(Date.parse((await playerPost({ token: t.share.token, action: "get" })).body.tournament.serverTime)).toBeGreaterThan(0);
  });
});

describe("life from players' phones", () => {
  async function liveGame(names: string[][] = [["Alex"], ["Blair"], ["Casey"]]) {
    const t = await create(names[0].length === 2 ? "2hg" : "1v1", names);
    await post({ action: "pair", id: t.id, round: 1 });
    const game = matchRows(1).find((m) => m.entrant_b !== null)!;
    const bye = matchRows(1).find((m) => m.entrant_b === null);
    return { t, game, bye };
  }

  it("adds each change to the right side and sends back both totals", async () => {
    const { t, game } = await liveGame();
    const res = await playerPost({ token: t.share.token, action: "life", matchId: game.id, side: "a", delta: -7 });
    expect(res.status).toBe(200);
    expect(res.body.life).toEqual({ a: 33, b: 40 });
    expect(Date.parse(res.body.serverTime)).toBeGreaterThan(0);
    await playerPost({ token: t.share.token, action: "life", matchId: game.id, side: "b", delta: 3 });
    expect(game).toMatchObject({ life_a: 33, life_b: 43 });
    const view = await playerPost({ token: t.share.token, action: "get" });
    expect(view.body.tournament.matches.find((m: Body) => m.id === game.id)).toMatchObject({ lifeA: 33, lifeB: 43 });
  });

  it("refuses changes that don't make sense, for byes, and after the game", async () => {
    const { t, game, bye } = await liveGame();
    const life = (body: Body) => playerPost({ token: t.share.token, action: "life", matchId: game.id, side: "a", delta: -1, ...body });
    expect((await life({ delta: 0 })).status).toBe(400);
    expect((await life({ delta: 1000 })).status).toBe(400);
    expect((await life({ delta: 1.5 })).status).toBe(400);
    expect((await life({ side: "c" })).status).toBe(400);
    expect((await life({ matchId: bye!.id })).status).toBe(404);
    await post({ action: "report", id: t.id, matchId: game.id, result: "a" });
    const over = await life({});
    expect(over.status).toBe(409);
    expect(over.body.message).toMatch(/game is over/);
  });

  it("'I lost' gives the game to the other side, stops its clock, and only counts once", async () => {
    const { t, game } = await liveGame();
    const res = await playerPost({ token: t.share.token, action: "lost", matchId: game.id, side: "a" });
    expect(res.status).toBe(200);
    expect(game).toMatchObject({ result: "b", reported_by: "player" });
    expect(game.ended_at).toBeTruthy();
    const shown = res.body.tournament.matches.find((m: Body) => m.id === game.id);
    expect(shown).toMatchObject({ result: "b", endedAt: game.ended_at });
    expect(JSON.stringify(res.body)).not.toContain("reported_by");
    const again = await playerPost({ token: t.share.token, action: "lost", matchId: game.id, side: "b" });
    expect(again.status).toBe(409);
    expect(game.result).toBe("b");
  });

  it("Two-Headed Giant teammates change the same team total", async () => {
    const { t, game } = await liveGame([["Alex", "Sam"], ["Jo", "Kim"]]);
    await playerPost({ token: t.share.token, action: "life", matchId: game.id, side: "a", delta: -4 });
    const res = await playerPost({ token: t.share.token, action: "life", matchId: game.id, side: "a", delta: -6 });
    expect(res.body.life).toEqual({ a: 50, b: 60 });
  });
});

describe("game times", () => {
  it("a game ends when it's first decided; changing the winner keeps that time, clearing it resumes the clock", async () => {
    const t = await create("1v1", [["Alex"], ["Blair"]]);
    await post({ action: "pair", id: t.id, round: 1 });
    const game = matchRows(1)[0];
    expect(game.ended_at).toBeNull();
    await post({ action: "report", id: t.id, matchId: game.id, result: "a" });
    const ended = game.ended_at as string;
    expect(ended).toBeTruthy();
    await new Promise((r) => setTimeout(r, 5));
    await post({ action: "report", id: t.id, matchId: game.id, result: "b" });
    expect(game.ended_at).toBe(ended);
    await post({ action: "report", id: t.id, matchId: game.id, result: "pending" });
    expect(game.ended_at).toBeNull();
  });

  it("a game handed over when a player drops ends then", async () => {
    const t = await create("1v1", [["Alex"], ["Blair"]]);
    await post({ action: "pair", id: t.id, round: 1 });
    const game = matchRows(1)[0];
    await post({ action: "remove-entrant", id: t.id, entrantId: game.entrant_a });
    expect(game.ended_at).toBeTruthy();
  });
});
