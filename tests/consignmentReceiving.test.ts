import { describe, expect, it } from "vitest";
import {
  RECEIVE_CSV_TEMPLATE,
  dollarsToCents,
  normalizeCondition,
  normalizeFinish,
  parseCsvRows,
  parseReceiveCsv,
} from "../src/store/lib/consignmentReceiving";

// Reading what arrived: CSV files from spreadsheets and other stores, with
// loosely named headers, quoted fields, tabs or semicolons, and the usual
// ways people write finishes, conditions and prices.

describe("normalizing", () => {
  it("reads finishes", () => {
    expect(normalizeFinish("")).toBe("nonfoil");
    expect(normalizeFinish("Normal")).toBe("nonfoil");
    expect(normalizeFinish("yes")).toBe("foil");
    expect(normalizeFinish("Foil")).toBe("foil");
    expect(normalizeFinish("Etched Foil")).toBe("etched");
    expect(normalizeFinish("galaxy")).toBe("galaxy");
    expect(normalizeFinish("shiny")).toBeNull();
  });

  it("reads conditions", () => {
    expect(normalizeCondition("Near Mint")).toBe("NM");
    expect(normalizeCondition("Lightly Played Foil")).toBe("LP");
    expect(normalizeCondition("heavily-played")).toBe("HP");
    expect(normalizeCondition("Damaged")).toBe("DMG");
    expect(normalizeCondition("")).toBeNull();
    expect(normalizeCondition("pristine")).toBeUndefined();
  });

  it("reads dollars", () => {
    expect(dollarsToCents("$1,234.5")).toBe(123450);
    expect(dollarsToCents("3")).toBe(300);
    expect(dollarsToCents(" ")).toBeNull();
    expect(dollarsToCents("1.234")).toBeUndefined();
    expect(dollarsToCents("-2")).toBeUndefined();
  });
});

describe("parseCsvRows", () => {
  it("handles quotes, doubled quotes, line endings and blank rows", () => {
    expect(parseCsvRows('a,b\r\n"Fire // Ice","say ""hi"", ok"\n\n')).toEqual([
      ["a", "b"],
      ["Fire // Ice", 'say "hi", ok'],
    ]);
  });

  it("detects tab and semicolon files", () => {
    expect(parseCsvRows("a\tb\n1\t2")).toEqual([["a", "b"], ["1", "2"]]);
    expect(parseCsvRows("a;b\n1;2,5")).toEqual([["a", "b"], ["1", "2,5"]]);
  });
});

describe("parseReceiveCsv", () => {
  it("reads the template", () => {
    const r = parseReceiveCsv(RECEIVE_CSV_TEMPLATE);
    expect(r.problems).toEqual([]);
    expect(r.lines).toEqual([
      { scryfallId: null, name: "Sol Ring", setCode: "CMR", collectorNumber: "472", language: null, finish: "nonfoil", condition: "NM", quantity: 2, listPriceCents: 350, minPriceCents: null, notes: null, sourceRow: 2 },
      { scryfallId: null, name: "Arcane Signet", setCode: "CMR", collectorNumber: "297", language: null, finish: "foil", condition: "LP", quantity: 1, listPriceCents: 400, minPriceCents: 300, notes: "Slight edge wear", sourceRow: 3 },
    ]);
  });

  it("matches headers loosely and defaults quantity to 1", () => {
    const r = parseReceiveCsv("Card Name;Edition;Collector #;Foil;Cond\nLightning Bolt;2X2;117;no;Lightly Played");
    expect(r.lines[0]).toMatchObject({ name: "Lightning Bolt", setCode: "2X2", collectorNumber: "117", finish: "nonfoil", condition: "LP", quantity: 1 });
  });

  it("skips unreadable rows and says why, keeping the rest", () => {
    const r = parseReceiveCsv("Name,Qty,Price,Condition\nA,two,1,NM\nB,1,1.999,NM\nC,1,1,mint-ish\nD,3,2,NM");
    expect(r.lines.map((l) => l.name)).toEqual(["D"]);
    expect(r.problems.map((p) => p.row)).toEqual([2, 3, 4]);
    expect(r.problems[0].message).toMatch(/quantity "two"/);
  });

  it("needs a header row that identifies cards", () => {
    const r = parseReceiveCsv("Sol Ring,CMR,472\n");
    expect(r.lines).toEqual([]);
    expect(r.problems[0].message).toMatch(/first row must be headers/);
    expect(parseReceiveCsv("").problems[0].message).toMatch(/empty/);
  });
});
