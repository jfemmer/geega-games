import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { collectorEvidence, collectorLines, createPaddleTextReader, ctcDecode, printedSetCodes, printedSetMatches } from "./collectorOcr.js";
import { ocrModelPaths } from "./modelFiles.js";
import { cardSvg } from "./testing/syntheticCards.js";

describe("ctcDecode", () => {
  it("collapses repeats, drops blanks and averages confidence", () => {
    // classes: 0 blank, 1 "1", 2 "2"
    const probs = Float32Array.from([
      0.1, 0.8, 0.1, // 1
      0.1, 0.8, 0.1, // 1 (repeat, collapsed)
      0.9, 0.05, 0.05, // blank
      0.1, 0.7, 0.2, // 1 again (new char after blank)
      0.1, 0.1, 0.8, // 2
    ]);
    const out = ctcDecode(probs, 5, 3, ["1", "2"]);
    expect(out.text).toBe("112");
    expect(out.confidence).toBeCloseTo((0.8 + 0.7 + 0.8) / 3, 5);
  });
});

describe("collectorEvidence", () => {
  const line = (text: string, confidence = 0.95) => ({ text, confidence });

  it("reads the modern two-line corner", () => {
    expect(collectorEvidence([line("0123 R"), line("DMU · EN")], "DMU", "123")).toEqual({ setMatch: true, numberMatch: true });
    expect(collectorEvidence([line("0123 R"), line("DMU · EN")], "DMU", "124")).toEqual({ setMatch: true, numberMatch: false });
  });

  it("handles the rarity letter glued on, the set size after a slash, and common misreads", () => {
    expect(collectorEvidence([line("0001R"), line("AAA·EN")], "AAA", "1").numberMatch).toBe(true);
    // 280 is the set size, not a collector number.
    expect(collectorEvidence([line("138/280 M")], "MH2", "280").numberMatch).toBe(false);
    expect(collectorEvidence([line("138/280 M")], "MH2", "138").numberMatch).toBe(true);
    expect(collectorEvidence([line("M2I • EN")], "M21", "1").setMatch).toBe(true);
    expect(collectorEvidence([line("0O45 U")], "XXX", "45").numberMatch).toBe(true);
  });

  it("ignores low-confidence noise", () => {
    expect(collectorEvidence([line("0123 R", 0.1), line("DMU EN", 0.1)], "DMU", "123")).toEqual({ setMatch: false, numberMatch: false });
  });
});

describe("printedSetCodes / printedSetMatches", () => {
  const line = (text: string, confidence = 0.95) => ({ text, confidence });

  it("reads the set code that sits before the language on modern cards, however the dot came out", () => {
    expect(printedSetCodes([line("0123 R"), line("DSK • EN")]).map((c) => c.raw)).toEqual(["DSK"]);
    expect(printedSetCodes([line("DSK*EN Seb McKinnon")]).map((c) => c.raw)).toEqual(["DSK"]);
    expect(printedSetCodes([line("123/280 R"), line("DOM - EN")]).map((c) => c.raw)).toEqual(["DOM"]);
    expect(printedSetCodes([line("M2I · JA")])[0]).toEqual({ raw: "M2I", folded: "M21" });
  });

  it("ignores artist names, copyright lines, numbers and unsure reads", () => {
    expect(printedSetCodes([line("Illus. Eve Ventrue"), line("© 1995 Wizards of the Coast")])).toEqual([]);
    expect(printedSetCodes([line("0123 EN")])).toEqual([]);
    expect(printedSetCodes([line("DSK • EN", 0.3)])).toEqual([]);
  });

  it("matches promos, tokens and The List to the set code they print", () => {
    const [dsk] = printedSetCodes([line("DSK • EN")]);
    expect(printedSetMatches(dsk, "DSK", "12")).toBe(true);
    expect(printedSetMatches(dsk, "PDSK", "12p")).toBe(true);
    expect(printedSetMatches(dsk, "TDSK", "3")).toBe(true);
    expect(printedSetMatches(dsk, "MKM", "12")).toBe(false);
    const [dom] = printedSetCodes([line("DOM • EN")]);
    expect(printedSetMatches(dom, "PLST", "DOM-123")).toBe(true);
    const [misread] = printedSetCodes([line("M2I • EN")]);
    expect(printedSetMatches(misread, "M21", "1")).toBe(true);
  });
});

describe("collectorLines + the PaddleOCR reader", () => {
  it("cuts the corner into its two lines and reads them", async () => {
    const paths = ocrModelPaths();
    expect(paths).not.toBeNull();
    const reader = await createPaddleTextReader(paths!.recognitionPath, paths!.dictionaryPath, 1);
    const { data, info } = await sharp(Buffer.from(cardSvg({ id: "x", name: "Test", set: "QQZ", cn: "245", art: 3, symbol: 1, rarity: "U" })))
      .resize(744, 1039, { fit: "fill" })
      .flatten({ background: "#fff" })
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const lines = collectorLines({ width: info.width, height: info.height, data: new Uint8Array(data) });
    expect(lines.length).toBeGreaterThanOrEqual(2);
    const read = await reader.readLines(lines);
    const text = read.map((l) => l.text).join(" ");
    expect(text).toMatch(/0245/);
    expect(text).toMatch(/QQZ/);
    expect(collectorEvidence(read, "QQZ", "245")).toEqual({ setMatch: true, numberMatch: true });
  }, 30_000);
});
