import { describe, expect, it } from "vitest";
import { findCard } from "./cardFinder.js";
import { CardRecognizer } from "./recognizer.js";
import { largeImageUrl, pickSamples, runSelfTest, synthesizeScan } from "./selfTest.js";
import { renderCard, type SyntheticPrinting } from "./testing/syntheticCards.js";
import { buildSyntheticLibrary, tinyEmbedder } from "./testing/syntheticLibrary.js";
import type { CatalogEntry } from "./types.js";

function entry(id: string, ill: string | null, face = 0, layout = "normal"): CatalogEntry {
  return { id, face, name: id, set: "S", cn: "1", lang: "en", ill, img: `https://cards.scryfall.io/normal/front/a/b/${id}.jpg?1`, finishes: [], layout };
}

describe("pickSamples", () => {
  it("draws half the sample from art printed more than once, never back faces, tokens or art cards", () => {
    const entries = [
      ...Array.from({ length: 50 }, (_, i) => entry(`solo-${i}`, `solo-ill-${i}`)),
      ...Array.from({ length: 20 }, (_, i) => entry(`shared-${i}`, `shared-ill-${i % 5}`)),
      entry("back", "x", 1),
      entry("token", "y", 0, "token"),
      entry("art", "z", 0, "art_series"),
    ];
    let seed = 1;
    const random = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const sample = pickSamples(entries, 20, random);
    expect(sample).toHaveLength(20);
    expect(sample.filter((e) => e.id.startsWith("shared")).length).toBeGreaterThanOrEqual(10);
    expect(sample.some((e) => ["back", "token", "art"].includes(e.id))).toBe(false);
  });
});

describe("largeImageUrl", () => {
  it("swaps Scryfall's size segment", () => {
    expect(largeImageUrl("https://cards.scryfall.io/normal/front/a/b/x.jpg?1")).toBe("https://cards.scryfall.io/large/front/a/b/x.jpg?1");
  });
});

describe("synthesizeScan", () => {
  it("makes a crooked 300 dpi scan the card finder can find", async () => {
    let seed = 3;
    const random = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const p: SyntheticPrinting = { id: "x", name: "X", set: "AAA", cn: "1", art: 4, symbol: 0 };
    const scan = await synthesizeScan(await renderCard(p, 672, 936), random);
    const found = await findCard(scan, { fallbackDpi: null });
    expect(found.found).toBe(true);
    expect(found.dpi).toBe(300);
    expect(found.rect!.height).toBeCloseTo(1039, 0);
  });
});

describe("runSelfTest", () => {
  it("scores the recognizer on fake scans of its own library", async () => {
    const embedder = await tinyEmbedder();
    const printings: SyntheticPrinting[] = [
      { id: "c1", name: "One", set: "AAA", cn: "1", art: 1, symbol: 0 },
      { id: "c2", name: "One", set: "BBB", cn: "2", art: 1, symbol: 1 },
      { id: "c3", name: "Three", set: "CCC", cn: "3", art: 3, symbol: 2 },
      { id: "c4", name: "Four", set: "DDD", cn: "4", art: 4, symbol: 3 },
    ];
    const lib = await buildSyntheticLibrary(printings, embedder);
    const recognizer = new CardRecognizer({ embedder, library: lib.library, references: lib.references, reader: null, fallbackDpi: 300 });
    const progress: number[] = [];
    const report = await runSelfTest({ recognizer, references: lib.references, samples: 4, onProgress: (d) => progress.push(d) });
    expect(report.samples).toBe(4);
    expect(progress.at(-1)).toBe(4);
    expect(report.exactPrinting).toBeGreaterThanOrEqual(0.75);
    expect(report.sureCorrect).toBe(report.sure);
    expect(report.sure + report.check + report.none).toBe(4);
    expect(report.meanMs).toBeGreaterThan(0);
    // How much room correct matches have above the "sure" cut-off.
    expect(report.visualCorrectMedian).toBeGreaterThan(0.55);
    expect(report.visualCorrectP10).toBeLessThanOrEqual(report.visualCorrectMedian!);
  }, 60_000);
});
