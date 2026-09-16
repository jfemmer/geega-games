import { describe, expect, it } from "vitest";
import { parseCardListText } from "../src/store/lib/sellCardListParser";

describe("parseCardListText — free-text lines", () => {
  it("parses a simple quantity + name line", () => {
    const [line] = parseCardListText("1 Rhystic Study");
    expect(line.quantity).toBe(1);
    expect(line.cardName).toBe("Rhystic Study");
  });

  it("parses multiple lines independently", () => {
    const lines = parseCardListText(
      "1 Rhystic Study\n2 Smothering Tithe\n4 Lightning Bolt",
    );
    expect(lines).toHaveLength(3);
    expect(lines.map((l) => l.cardName)).toEqual([
      "Rhystic Study",
      "Smothering Tithe",
      "Lightning Bolt",
    ]);
    expect(lines.map((l) => l.quantity)).toEqual([1, 2, 4]);
  });

  it("extracts a set code from brackets or parens", () => {
    const [a] = parseCardListText("Lightning Bolt [MH2]");
    expect(a.setCode).toBe("MH2");
    expect(a.cardName).toBe("Lightning Bolt");

    const [b] = parseCardListText("Lightning Bolt (M10)");
    expect(b.setCode).toBe("M10");
  });

  it("extracts a collector number via #", () => {
    const [line] = parseCardListText("Lightning Bolt #146");
    expect(line.collectorNumber).toBe("146");
    expect(line.cardName).toBe("Lightning Bolt");
  });

  it("extracts a trailing bare collector number only when a set code is present", () => {
    const withSet = parseCardListText("Lightning Bolt (M10) 146")[0];
    expect(withSet.setCode).toBe("M10");
    expect(withSet.collectorNumber).toBe("146");

    // No set code present — a bare trailing number is NOT assumed to be a
    // collector number (too ambiguous; could be part of the name/quantity).
    const withoutSet = parseCardListText("Some Card 146")[0];
    expect(withoutSet.setCode).toBeNull();
  });

  it("extracts condition keywords case-insensitively", () => {
    expect(parseCardListText("Lightning Bolt NM")[0].condition).toBe("NM");
    expect(parseCardListText("Lightning Bolt lightly played")[0].condition).toBe("LP");
    expect(parseCardListText("Lightning Bolt hp")[0].condition).toBe("HP");
  });

  it("extracts finish keywords", () => {
    expect(parseCardListText("Lightning Bolt foil")[0].finish).toBe("foil");
    expect(parseCardListText("Lightning Bolt etched")[0].finish).toBe("etched");
    expect(parseCardListText("Lightning Bolt")[0].finish).toBeNull();
  });

  it("combines quantity, set, condition, and finish on one line", () => {
    const [line] = parseCardListText("4 Lightning Bolt [MH2] foil NM");
    expect(line.quantity).toBe(4);
    expect(line.setCode).toBe("MH2");
    expect(line.condition).toBe("NM");
    expect(line.finish).toBe("foil");
    expect(line.cardName).toBe("Lightning Bolt");
  });

  it("supports a trailing 'x4' quantity style", () => {
    const [line] = parseCardListText("Lightning Bolt x4");
    expect(line.quantity).toBe(4);
    expect(line.cardName).toBe("Lightning Bolt");
  });

  it("never requires a perfect format — an unparseable line keeps its raw text and a best-effort name", () => {
    const [line] = parseCardListText("some totally weird garbled input @@@");
    expect(line.rawInput).toBe("some totally weird garbled input @@@");
    // Nothing threw, and there's still a usable name to submit as free text.
    expect(line.cardName.length).toBeGreaterThan(0);
  });

  it("skips blank lines", () => {
    const lines = parseCardListText("Lightning Bolt\n\n\nCounterspell\n");
    expect(lines).toHaveLength(2);
  });

  it("defaults quantity to 1 when absent", () => {
    expect(parseCardListText("Counterspell")[0].quantity).toBe(1);
  });
});

describe("parseCardListText — CSV with header", () => {
  it("detects a CSV header row and parses accordingly", () => {
    const csv = [
      "Card,Set,Collector #,Condition,Finish,Quantity,Price",
      '"Lightning Bolt","MH2","138","NM","foil","2","1.50"',
    ].join("\n");
    const [line] = parseCardListText(csv);
    expect(line.cardName).toBe("Lightning Bolt");
    expect(line.setCode).toBe("MH2");
    expect(line.collectorNumber).toBe("138");
    expect(line.condition).toBe("NM");
    expect(line.finish).toBe("foil");
    expect(line.quantity).toBe(2);
  });

  it("falls back to free-text parsing when the first line isn't a recognizable header", () => {
    const lines = parseCardListText("1 Rhystic Study\n2 Smothering Tithe");
    expect(lines).toHaveLength(2);
    expect(lines[0].cardName).toBe("Rhystic Study");
  });
});
