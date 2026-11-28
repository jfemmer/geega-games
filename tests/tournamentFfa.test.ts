import { describe, expect, it } from "vitest";
import {
  canRepairRound,
  computeFfaStandings,
  dealTables,
  nextRoundBlocker,
  ordinal,
  placePoints,
  spotsProblem,
  startBlocker,
  tableSizes,
  type TournamentDetail,
  type TournamentEntrant,
  type TournamentPod,
} from "../src/admin/utils/tournament";

// Free-for-all rules in src/admin/utils/tournament.ts: how many sit at each
// table, dealing that mixes up tablemates, points by finishing place, and
// when the next round can be dealt.

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
const T = "2026-11-27T20:00:00.000Z";
const entrant = (id: string): TournamentEntrant => ({ id, players: [id.toUpperCase()], commanders: [null], droppedAt: null, createdAt: T });
function pod(round: number, table: number, places: Record<string, number | null>, ended = true): TournamentPod {
  return {
    id: `r${round}t${table}`,
    round,
    table,
    startedAt: T,
    endedAt: ended ? T : null,
    players: Object.entries(places).map(([entrantId, place], i) => ({
      id: `${entrantId}-r${round}`,
      entrantId,
      seat: i + 1,
      life: null,
      outAt: place != null && place > 1 ? T : null,
      place,
    })),
  };
}

describe("table sizes", () => {
  it("are as even as possible with none over the size", () => {
    expect(tableSizes(8, 8)).toEqual([8]);
    expect(tableSizes(8, 4)).toEqual([4, 4]);
    expect(tableSizes(10, 8)).toEqual([5, 5]);
    expect(tableSizes(9, 4)).toEqual([3, 3, 3]);
    expect(tableSizes(10, 4)).toEqual([4, 3, 3]);
    expect(tableSizes(3, 8)).toEqual([3]);
    expect(tableSizes(1, 4)).toEqual([]);
  });

  it("never leave anyone alone at a table", () => {
    for (let n = 2; n <= 64; n += 1) {
      for (let size = 3; size <= 12; size += 1) {
        const sizes = tableSizes(n, size);
        expect(sizes.reduce((a, b) => a + b, 0)).toBe(n);
        expect(Math.min(...sizes)).toBeGreaterThanOrEqual(2);
        expect(Math.max(...sizes)).toBeLessThanOrEqual(size);
      }
    }
  });
});

describe("dealing", () => {
  it("seats everyone exactly once at tables of the right sizes", () => {
    const tables = dealTables(ids(10), 4, [], seeded(1))!;
    expect(tables.map((t) => t.length).sort()).toEqual([3, 3, 4]);
    expect(tables.flat().sort()).toEqual(ids(10).sort());
    expect(dealTables(["p1"], 4, [])).toBeNull();
  });

  it("is random", () => {
    const deals = new Set(Array.from({ length: 10 }, (_, i) => JSON.stringify(dealTables(ids(8), 4, [], seeded(i)))));
    expect(deals.size).toBeGreaterThan(5);
  });

  it("keeps new tablemates together as long as it can", () => {
    // 16 players at tables of 4 can play 3 rounds without anyone sitting with the same person twice.
    for (let seed = 0; seed < 10; seed += 1) {
      const random = seeded(seed);
      const history: TournamentPod[] = [];
      const met = new Set<string>();
      for (let round = 1; round <= 3; round += 1) {
        const tables = dealTables(ids(16), 4, history, random)!;
        tables.forEach((table, i) => {
          for (let x = 0; x < table.length; x += 1) {
            for (let y = x + 1; y < table.length; y += 1) {
              const key = [table[x], table[y]].sort().join("|");
              expect(met.has(key)).toBe(false);
              met.add(key);
            }
          }
          history.push(pod(round, i + 1, Object.fromEntries(table.map((id) => [id, 1]))));
        });
      }
    }
  });

  it("splits two tables of four evenly in the next round", () => {
    const history = [pod(1, 1, { p1: 1, p2: 2, p3: 3, p4: 4 }), pod(1, 2, { p5: 1, p6: 2, p7: 3, p8: 4 })];
    for (let seed = 0; seed < 10; seed += 1) {
      for (const table of dealTables(ids(8), 4, history, seeded(seed))!) {
        expect(table.filter((id) => ["p1", "p2", "p3", "p4"].includes(id))).toHaveLength(2);
      }
    }
  });
});

describe("points and standings", () => {
  it("give a table of N players N points for 1st down to 1 for last", () => {
    expect([1, 2, 3, 4, 5, 6, 7, 8].map((p) => placePoints(p, 8))).toEqual([8, 7, 6, 5, 4, 3, 2, 1]);
    expect(placePoints(1, 3)).toBe(3);
    expect(["1st", "2nd", "3rd", "4th", "11th", "12th", "13th", "21st", "22nd"]).toEqual(
      [1, 2, 3, 4, 11, 12, 13, 21, 22].map(ordinal),
    );
  });

  it("add up across rounds, break ties by games won, and share a rank when level", () => {
    const entrants = ["p1", "p2", "p3", "p4"].map(entrant);
    const rows = computeFfaStandings(entrants, [
      pod(1, 1, { p1: 1, p2: 2, p3: 3, p4: 4 }),
      pod(2, 1, { p1: 3, p2: 4, p3: 1, p4: 2 }),
      pod(3, 1, { p1: null, p2: null, p3: null, p4: null }, false),
    ]);
    // p1: 4 + 2, p3: 2 + 4 (one win each); p2: 3 + 1, p4: 1 + 3 (none).
    expect(rows.map((r) => [r.entrant.id, r.rank, r.points, r.wins, r.games])).toEqual([
      ["p1", 1, 6, 1, 2],
      ["p3", 1, 6, 1, 2],
      ["p2", 3, 4, 0, 2],
      ["p4", 3, 4, 0, 2],
    ]);
    const more = computeFfaStandings(["p1", "p2"].map(entrant), [pod(1, 1, { p1: 2, p2: 1 }), pod(2, 1, { p1: 1, p2: 2 }), pod(3, 1, { p1: 1, p2: 2 })]);
    expect(more.map((r) => [r.entrant.id, r.rank, r.points, r.wins])).toEqual([
      ["p1", 1, 5, 2],
      ["p2", 2, 4, 1],
    ]);
    expect(rows[0].places).toEqual([
      { round: 1, place: 1, of: 4 },
      { round: 2, place: 3, of: 4 },
      { round: 3, place: null, of: 4 },
    ]);
  });

  it("score shared places alike (staff called the game)", () => {
    const rows = computeFfaStandings(["p1", "p2", "p3"].map(entrant), [pod(1, 1, { p1: 1, p2: 2, p3: 2 })]);
    expect(rows.map((r) => [r.entrant.id, r.rank, r.points])).toEqual([
      ["p1", 1, 3],
      ["p2", 2, 2],
      ["p3", 2, 2],
    ]);
  });
});

describe("rounds", () => {
  function detail(extra: Partial<TournamentDetail>): TournamentDetail {
    return {
      id: "t",
      name: "Big game",
      format: "ffa",
      status: "active",
      currentRound: 1,
      createdAt: T,
      finishedAt: null,
      entrants: ["p1", "p2", "p3", "p4"].map(entrant),
      matches: [],
      spots: null,
      startingLife: 40,
      tableSize: 4,
      pods: [],
      ...extra,
    };
  }

  it("start with at least 3 players, and sign-ups need at least 3 spots", () => {
    expect(startBlocker(detail({ currentRound: 0, entrants: ["p1", "p2"].map(entrant) }))).toMatch(/at least 3 players/);
    expect(startBlocker(detail({ currentRound: 0 }))).toBeNull();
    expect(spotsProblem("ffa", 2)).toMatch(/between 3 and/);
    expect(spotsProblem("ffa", 9)).toBeNull();
  });

  it("deal the next round once every table's game is decided", () => {
    const open = detail({ pods: [pod(1, 1, { p1: 1, p2: 2 }), pod(1, 2, { p3: null, p4: 2 }, false)] });
    expect(nextRoundBlocker(open)).toBe("Finish the last game in round 1 first.");
    expect(nextRoundBlocker(detail({ pods: [pod(1, 1, { p1: 1, p2: 2 }), pod(1, 2, { p3: 1, p4: 2 })] }))).toBeNull();
  });

  it("can be re-dealt only while nobody is out", () => {
    expect(canRepairRound(detail({ pods: [pod(1, 1, { p1: null, p2: null }, false)] }))).toBe(true);
    expect(canRepairRound(detail({ pods: [pod(1, 1, { p1: null, p2: 3, p3: null }, false)] }))).toBe(false);
  });
});
