import { describe, expect, it } from "vitest";
import { decodeGray } from "./image.js";
import { fakeScan, renderCard, type SyntheticPrinting } from "./testing/syntheticCards.js";
import { findCard } from "./cardFinder.js";
import { compareCards, differingTiles, discriminate, makeViews, TILE_COLS, VERIFY_HEIGHT, VERIFY_WIDTH } from "./verify.js";
import { resizeRgb, toGray } from "./image.js";

// The pixel check: the right printing scores high, other art scores low,
// and two printings of the same art are told apart by the spots where they
// differ (here: the set symbol).

const base: SyntheticPrinting = { id: "a", name: "Grizzly Test", set: "AAA", cn: "1", art: 11, symbol: 0 };
const otherSymbol: SyntheticPrinting = { ...base, id: "b", set: "BBB", symbol: 1 };
const otherArt: SyntheticPrinting = { ...base, id: "c", name: "Ocean Test", art: 33 };

async function refViews(p: SyntheticPrinting) {
  return makeViews(await decodeGray(await renderCard(p), VERIFY_WIDTH, VERIFY_HEIGHT));
}

async function scanViews(p: SyntheticPrinting) {
  const found = await findCard(await fakeScan(p, { angle: 2, blur: 0.5 }), { fallbackDpi: 300 });
  return makeViews(toGray(await resizeRgb(found.image, VERIFY_WIDTH, VERIFY_HEIGHT)));
}

describe("compareCards", () => {
  it("scores the scan of a card high against its own reference and low against other art", async () => {
    const scan = await scanViews(base);
    const same = compareCards(scan, await refViews(base));
    const different = compareCards(scan, await refViews(otherArt));
    expect(same.score).toBeGreaterThan(0.85);
    expect(different.score).toBeLessThan(0.8);
    expect(same.score - different.score).toBeGreaterThan(0.15);
  });

  it("lines up a shifted reference", async () => {
    const ref = await decodeGray(await renderCard(base), VERIFY_WIDTH, VERIFY_HEIGHT);
    const shifted = new Uint8Array(ref.data.length).fill(255);
    for (let y = 0; y < VERIFY_HEIGHT; y++) {
      for (let x = 0; x < VERIFY_WIDTH; x++) {
        const sx = x - 6;
        const sy = y - 4;
        if (sx >= 0 && sy >= 0) shifted[y * VERIFY_WIDTH + x] = ref.data[sy * VERIFY_WIDTH + sx];
      }
    }
    const cmp = compareCards(makeViews(ref), makeViews({ width: VERIFY_WIDTH, height: VERIFY_HEIGHT, data: shifted }));
    expect(cmp.dx).toBe(6);
    expect(cmp.dy).toBe(4);
    expect(cmp.score).toBeGreaterThan(0.95);
  });
});

describe("differingTiles + discriminate", () => {
  it("finds where two printings of the same art differ (the set symbol) and picks the right one", async () => {
    const refA = await refViews(base);
    const refB = await refViews(otherSymbol);
    const tiles = differingTiles(refA, refB);
    expect(tiles.length).toBeGreaterThan(0);
    // They differ only at the set symbol (right end of the type line) and in
    // the set code printed in the bottom-left corner.
    for (const t of tiles) {
      const col = t % TILE_COLS;
      const row = Math.floor(t / TILE_COLS);
      const atSymbol = col >= 15 && row >= 14 && row <= 18;
      const atCorner = col <= 6 && row >= 25;
      expect(atSymbol || atCorner).toBe(true);
    }
    expect(tiles.some((t) => t % TILE_COLS >= 15)).toBe(true);

    const scanB = await scanViews(otherSymbol);
    const a = { views: refA, comparison: compareCards(scanB, refA) };
    const b = { views: refB, comparison: compareCards(scanB, refB) };
    // Overall scores are nearly identical — the whole card is the same art…
    expect(Math.abs(a.comparison.score - b.comparison.score)).toBeLessThan(0.03);
    // …but on the differing tiles the scan clearly agrees with B.
    const d = discriminate(scanB, b, a, tiles);
    expect(d.differingTiles).toBe(tiles.length);
    expect(d.margin).toBeGreaterThan(0.15);
  });

  it("reports identical references as indistinguishable", async () => {
    const refA = await refViews(base);
    expect(differingTiles(refA, await refViews(base))).toEqual([]);
  });
});
