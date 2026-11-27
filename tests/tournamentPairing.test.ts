import { describe, expect, it } from "vitest";
import {
  canRepairRound,
  computeStandings,
  duplicateName,
  entrantProblem,
  hasNewOpponents,
  nextRoundBlocker,
  pairRound,
  parsePlayerList,
  parseTeamList,
  randomTeams,
  type TournamentDetail,
  type TournamentEntrant,
  type TournamentMatch,
} from "../src/admin/utils/tournament";

// The rules behind admin → Tournaments: random pairings that never repeat a
// matchup, fair byes, a clean stop when everyone has played everyone, and
// standings (3 for a win, byes count as wins, opponents' match-win % breaks
// ties). Pure functions; a seeded random keeps runs repeatable.

function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const ids = (n: number) => Array.from({ length: n }, (_, i) => `p${i + 1}`);
const key = (a: string, b: string) => [a, b].sort().join("|");

/** Plays rounds until no pairing is left, returning every round's pairing. */
function playOut(players: string[], seed: number, maxRounds = 100) {
  const random = seeded(seed);
  const history: { a: string; b: string | null }[] = [];
  const rounds = [];
  for (let r = 0; r < maxRounds; r += 1) {
    const pairing = pairRound(players, history, random);
    if (!pairing) break;
    rounds.push(pairing);
    for (const [a, b] of pairing.pairs) history.push({ a, b });
    for (const a of pairing.byes) history.push({ a, b: null });
  }
  return { rounds, history };
}

describe("pairRound", () => {
  it("pairs everyone once per round with nobody left out", () => {
    const pairing = pairRound(ids(8), [], seeded(1))!;
    expect(pairing.pairs).toHaveLength(4);
    expect(pairing.byes).toEqual([]);
    expect(pairing.pairs.flat().sort()).toEqual(ids(8).sort());
  });

  it("never repeats a matchup, and runs a full round robin before stopping (even count)", () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const { rounds, history } = playOut(ids(8), seed);
      const seen = new Set<string>();
      for (const m of history) {
        if (!m.b) continue;
        const k = key(m.a, m.b);
        expect(seen.has(k)).toBe(false);
        seen.add(k);
      }
      // Every pair of 8 players (28 matches) gets played, 4 per round, in 7 rounds.
      expect(seen.size).toBe(28);
      expect(rounds).toHaveLength(7);
    }
  });

  it("gives an odd field one bye per round, never twice to the same player before everyone has had one", () => {
    const { rounds } = playOut(ids(5), 7);
    // 5 players: 10 matches, 2 per round, one bye each round → 5 rounds.
    expect(rounds).toHaveLength(5);
    for (const r of rounds) {
      expect(r.pairs).toHaveLength(2);
      expect(r.byes).toHaveLength(1);
    }
    expect(new Set(rounds.map((r) => r.byes[0])).size).toBe(5);
  });

  it("returns null once everyone still in has played each other", () => {
    const players = ids(4);
    const history = [
      { a: "p1", b: "p2" },
      { a: "p3", b: "p4" },
      { a: "p1", b: "p3" },
      { a: "p2", b: "p4" },
      { a: "p1", b: "p4" },
      { a: "p2", b: "p3" },
    ];
    expect(pairRound(players, history, seeded(1))).toBeNull();
  });

  it("knows when there's a next round without pairing it", () => {
    expect(hasNewOpponents(["p1", "p2", "p3"], [{ a: "p1", b: "p2" }, { a: "p3", b: null }])).toBe(true);
    expect(
      hasNewOpponents(
        ["p1", "p2", "p3"],
        [
          { a: "p1", b: "p2" },
          { a: "p1", b: "p3" },
          { a: "p3", b: "p2" },
        ],
      ),
    ).toBe(false);
  });

  it("keeps a full round robin on track for small fields (no dead ends that force extra byes)", () => {
    for (const n of [5, 6, 7, 8, 9, 10]) {
      for (const seed of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]) {
        const { rounds } = playOut(ids(n), seed * 31 + n);
        expect(rounds).toHaveLength(n % 2 ? n : n - 1);
        expect(rounds.every((r) => r.byes.length === n % 2)).toBe(true);
      }
    }
  });

  it("returns null with fewer than two players", () => {
    expect(pairRound(["p1"], [])).toBeNull();
    expect(pairRound([], [])).toBeNull();
  });

  it("pairs as many as it can, with extra byes, when no full rematch-free pairing exists", () => {
    // Two triangles left unplayed: {p1,p2,p3} and {p4,p5,p6}. Every cross pair
    // has played, so a full pairing is impossible; two matches + two byes is the best.
    const history = [];
    for (const a of ["p1", "p2", "p3"]) for (const b of ["p4", "p5", "p6"]) history.push({ a, b });
    const pairing = pairRound(ids(6), history, seeded(3))!;
    expect(pairing.pairs).toHaveLength(2);
    expect(pairing.byes).toHaveLength(2);
    for (const [a, b] of pairing.pairs) {
      expect(history.some((m) => key(m.a, m.b) === key(a, b))).toBe(false);
    }
  });

  it("ignores history for players who aren't in the round (dropped)", () => {
    const history = [
      { a: "p1", b: "gone" },
      { a: "gone", b: null },
    ];
    const pairing = pairRound(["p1", "p2"], history, seeded(1))!;
    expect(pairing.pairs).toEqual([expect.arrayContaining(["p1", "p2"])]);
  });

  it("is random: different seeds give different first rounds", () => {
    const firsts = new Set(
      [1, 2, 3, 4, 5, 6, 7, 8].map((seed) =>
        pairRound(ids(8), [], seeded(seed))!
          .pairs.map(([a, b]) => key(a, b))
          .sort()
          .join(","),
      ),
    );
    expect(firsts.size).toBeGreaterThan(1);
  });

  it("stays fast for a big field late in the event", () => {
    const players = ids(64);
    const started = Date.now();
    const { rounds } = playOut(players, 11, 12);
    expect(rounds).toHaveLength(12);
    expect(Date.now() - started).toBeLessThan(3000);
  });
});

function entrant(id: string, players: string[], extra: Partial<TournamentEntrant> = {}): TournamentEntrant {
  return { id, players, droppedAt: null, createdAt: "2026-11-27T20:00:00.000Z", ...extra };
}
let matchSeq = 0;
function match(round: number, a: string, b: string | null, result: TournamentMatch["result"]): TournamentMatch {
  matchSeq += 1;
  return { id: `m${matchSeq}`, round, table: matchSeq, a, b, result, reportedAt: null };
}

describe("computeStandings", () => {
  const people = [entrant("a", ["Alex"]), entrant("b", ["Blair"]), entrant("c", ["Casey"]), entrant("d", ["Drew"])];

  it("scores 3 for a win and 1 for a draw, counts a bye as a win, and ignores pending matches", () => {
    const rows = computeStandings(people, [
      match(1, "a", "b", "a"),
      match(1, "c", "d", "draw"),
      match(2, "a", "c", "pending"),
      match(2, "b", null, "bye"),
    ]);
    const by = Object.fromEntries(rows.map((r) => [r.entrant.id, r]));
    expect(by.a).toMatchObject({ wins: 1, losses: 0, draws: 0, points: 3 });
    expect(by.b).toMatchObject({ wins: 1, losses: 1, byes: 1, points: 3 });
    expect(by.c).toMatchObject({ wins: 0, draws: 1, points: 1 });
    // Pending opponents still show as played (they're paired), byes don't.
    expect(by.a.opponents).toEqual(["b", "c"]);
    expect(by.b.opponents).toEqual(["a"]);
  });

  it("breaks ties on opponents' match-win %, and shares a rank only when both are level", () => {
    // a beat b, c beat d, then a beat c and d beat b: a 2-0, c 1-1, d 1-1, b 0-2.
    const rows = computeStandings(people, [
      match(1, "a", "b", "a"),
      match(1, "c", "d", "a"),
      match(2, "a", "c", "a"),
      match(2, "d", "b", "a"),
    ]);
    expect(rows.map((r) => r.entrant.id)).toEqual(["a", "c", "d", "b"]);
    // c played a (100%) and d (50%) = 75%; d played c (50%) and b (floored to 33%) ≈ 42%.
    expect(rows[1].opponentWinPct).toBeCloseTo(0.75);
    expect(rows[2].opponentWinPct).toBeCloseTo((0.5 + 1 / 3) / 2);
    expect(rows.map((r) => r.rank)).toEqual([1, 2, 3, 4]);

    const level = computeStandings(people, []);
    expect(level.map((r) => r.rank)).toEqual([1, 1, 1, 1]);
  });

  it("keeps dropped entrants in the standings", () => {
    const rows = computeStandings(
      [entrant("a", ["Alex"]), entrant("b", ["Blair"], { droppedAt: "2026-11-27T21:00:00.000Z" })],
      [match(1, "a", "b", "b")],
    );
    expect(rows[0].entrant.id).toBe("b");
    expect(rows[0].entrant.droppedAt).not.toBeNull();
  });
});

describe("rounds", () => {
  const base: TournamentDetail = {
    id: "t",
    name: "Friday",
    format: "1v1",
    status: "active",
    currentRound: 1,
    createdAt: "2026-11-27T20:00:00.000Z",
    finishedAt: null,
    entrants: [entrant("a", ["Alex"]), entrant("b", ["Blair"]), entrant("c", ["Casey"])],
    matches: [],
  };

  it("blocks the next round until every result is in, and allows re-pairing only before results", () => {
    const open = { ...base, matches: [match(1, "a", "b", "pending"), match(1, "c", null, "bye")] };
    expect(nextRoundBlocker(open)).toMatch(/Record the last result in round 1/);
    expect(canRepairRound(open)).toBe(true);

    const done = { ...base, matches: [match(1, "a", "b", "b"), match(1, "c", null, "bye")] };
    expect(nextRoundBlocker(done)).toBeNull();
    expect(canRepairRound(done)).toBe(false);
  });

  it("needs two entrants still in, and an active tournament", () => {
    expect(nextRoundBlocker({ ...base, currentRound: 0, entrants: [entrant("a", ["Alex"])] })).toMatch(/at least two players/);
    expect(nextRoundBlocker({ ...base, status: "finished" })).toMatch(/finished/);
  });
});

describe("names", () => {
  it("reads one player per line (or comma), trimming and skipping blanks", () => {
    expect(parsePlayerList("  Alex \n\nBlair, Casey ;Drew\n")).toEqual(["Alex", "Blair", "Casey", "Drew"]);
  });

  it("reads teams as pairs and reports lines that aren't two names", () => {
    const { teams, problems } = parseTeamList("Alex & Sam\nJo + Kim\nPat and Lee\nSolo\nA, B, C");
    expect(teams).toEqual([
      ["Alex", "Sam"],
      ["Jo", "Kim"],
      ["Pat", "Lee"],
    ]);
    expect(problems).toEqual(["Solo", "A, B, C"]);
  });

  it("doesn't split a name that only contains 'and'", () => {
    expect(parseTeamList("Andy & Brandon").teams).toEqual([["Andy", "Brandon"]]);
  });

  it("makes random teams of two from everyone", () => {
    const teams = randomTeams(["A", "B", "C", "D"], seeded(2));
    expect(teams).toHaveLength(2);
    expect(teams.flat().sort()).toEqual(["A", "B", "C", "D"]);
  });

  it("spots duplicate names ignoring case, and checks entrants against the format", () => {
    expect(duplicateName([["Alex"], ["alex"]])).toBe("alex");
    expect(duplicateName([["Alex", "Sam"], ["Jo", "Kim"]])).toBeNull();
    expect(entrantProblem("1v1", ["Alex"])).toBeNull();
    expect(entrantProblem("1v1", [""])).toMatch(/name/);
    expect(entrantProblem("2hg", ["Alex"])).toMatch(/two player names/);
    expect(entrantProblem("2hg", ["Alex", "ALEX"])).toMatch(/two different players/);
  });
});
