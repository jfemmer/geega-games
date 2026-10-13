import { describe, expect, it } from "vitest";
import { decide, DEFAULT_THRESHOLDS, type Contender, type PairJudge } from "./decide.js";
import type { CatalogEntry } from "./types.js";

// Precision over recall: "sure" only when one printing clearly wins and
// every look-alike was ruled out; anything doubtful is "check" (the reviewer
// picks), and no real match is "none".

function entry(id: string, set: string, cn: string, name = "Grizzly Test"): CatalogEntry {
  return { id, face: 0, name, set, cn, lang: "en", ill: "ill", img: `https://img/${id}`, finishes: ["nonfoil"], layout: "normal" };
}

function contender(id: string, visual: number, set = "AAA", cn = id, name?: string): Contender {
  return { key: id, entry: entry(id, set, cn, name), similarity: 0.9, visual };
}

const noLookAlikes: PairJudge = () => ({ differingTiles: 0, margin: 0 });

describe("decide", () => {
  it("is sure about a clear winner, keeping every other candidate at least 0.15 lower", () => {
    const r = decide([contender("1", 0.93), contender("2", 0.41, "BBB"), contender("3", 0.38, "CCC")], noLookAlikes);
    expect(r.decision).toBe("sure");
    expect(r.ranked[0].contender.key).toBe("1");
    expect(r.ranked[0].confidence).toBeGreaterThanOrEqual(0.9);
    for (const other of r.ranked.slice(1)) {
      expect(other.confidence).toBeLessThanOrEqual(r.ranked[0].confidence - 0.15 + 1e-9);
    }
    expect(r.reason).toMatch(/Matched Grizzly Test \(AAA #1\)/);
  });

  it("tells same-art printings apart by the spots where they differ", () => {
    const judge: PairJudge = (a) => (a.key === "B" ? { differingTiles: 3, margin: 0.3 } : { differingTiles: 3, margin: -0.3 });
    const r = decide([contender("A", 0.95, "AAA"), contender("B", 0.94, "BBB")], judge);
    expect(r.decision).toBe("sure");
    expect(r.ranked[0].contender.key).toBe("B");
    expect(r.reason).toMatch(/told apart from the same art in AAA #A/);
  });

  it("says check — and asks for the collector number — when two printings look identical", () => {
    const r = decide([contender("1", 0.95, "AAA", "1"), contender("3", 0.95, "AAA", "3")], noLookAlikes);
    expect(r.decision).toBe("check");
    expect(r.needsOcr).toBe(true);
    expect(r.ambiguousWith.map((c) => c.key)).toEqual(["3"]);
    expect(r.ranked[0].confidence).toBeLessThan(0.9);
    expect(r.reason).toMatch(/Close call/);
  });

  it("lets the collector number settle look-alikes", () => {
    const cs = [contender("1", 0.95, "AAA", "1"), contender("3", 0.95, "AAA", "3")];
    cs[0].ocr = { setMatch: true, numberMatch: false };
    cs[1].ocr = { setMatch: true, numberMatch: true };
    const r = decide(cs, noLookAlikes);
    expect(r.decision).toBe("sure");
    expect(r.ranked[0].contender.key).toBe("3");
    expect(r.ranked[0].reason).toMatch(/collector number read/);
  });

  it("never asks for the collector number when the look-alikes share it", () => {
    const r = decide([contender("x", 0.95, "AAA", "7"), { ...contender("y", 0.95, "AAA", "7") }], noLookAlikes);
    expect(r.decision).toBe("check");
    expect(r.needsOcr).toBe(false);
  });

  it("is only 'check' for a weak picture match, and 'none' for no real match", () => {
    expect(decide([contender("1", 0.48)], noLookAlikes).decision).toBe("check");
    const none = decide([contender("1", 0.2)], noLookAlikes);
    expect(none.decision).toBe("none");
    expect(none.ranked[0].confidence).toBeLessThan(0.5);
    expect(decide([], noLookAlikes)).toMatchObject({ decision: "none", ranked: [] });
  });

  it("won't be sure when the scan itself has a problem", () => {
    const r = decide([contender("1", 0.95)], noLookAlikes, DEFAULT_THRESHOLDS, {
      blockSure: "This scan looks bigger than one card — two cards may have gone through together.",
    });
    expect(r.decision).toBe("check");
    expect(r.reason).toMatch(/two cards/);
  });

  it("compares each pair of look-alikes once, reading the result both ways round", () => {
    const calls: string[] = [];
    const judge: PairJudge = (a, b) => {
      calls.push(`${a.key}>${b.key}`);
      return { differingTiles: 2, margin: -0.2 };
    };
    const r = decide([contender("1", 0.9), contender("2", 0.9, "BBB")], judge);
    // "2 beats 1" — so with 2 as the answer, 1 is ruled out without asking again.
    expect(r.decision).toBe("sure");
    expect(r.ranked[0].contender.key).toBe("2");
    expect(calls).toEqual(["1>2"]);
  });
});
