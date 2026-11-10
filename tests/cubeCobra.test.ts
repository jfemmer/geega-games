import { describe, expect, it } from "vitest";
import { CUBE_ID_RE, parseCubeJson, parseCubeListText } from "../api/_lib/cubeCobra";

describe("CubeCobra parsing", () => {
  it("reads the current cubeJSON shape (cards.mainboard + details)", () => {
    const parsed = parseCubeJson({
      name: "The Pauper Cube",
      cards: {
        mainboard: [
          { cardID: "a", details: { name: "Kor Skyfisher", type: "Creature — Kor Soldier", colorcategory: "White" } },
          { cardID: "b", type_line: "Instant", colorCategory: "Blue", details: { name: "Counterspell", type: "x" } },
          { cardID: "c", details: {} },
        ],
        maybeboard: [{ details: { name: "Should Not Appear" } }],
      },
    });
    expect(parsed.name).toBe("The Pauper Cube");
    expect(parsed.cards).toEqual([
      { name: "Kor Skyfisher", type: "Creature — Kor Soldier", colorCategory: "White" },
      { name: "Counterspell", type: "Instant", colorCategory: "Blue" },
    ]);
  });

  it("reads the older flat cards array", () => {
    const parsed = parseCubeJson({ cards: [{ details: { name: "Lightning Bolt" } }] });
    expect(parsed.cards).toEqual([{ name: "Lightning Bolt", type: null, colorCategory: null }]);
  });

  it("tolerates junk", () => {
    expect(parseCubeJson(null).cards).toEqual([]);
    expect(parseCubeJson({ cards: "nope" }).cards).toEqual([]);
  });

  it("reads the plain-text list, skipping blanks", () => {
    expect(parseCubeListText("Fire // Ice\r\n\n  Ponder  \n").map((c) => c.name)).toEqual([
      "Fire // Ice",
      "Ponder",
    ]);
  });

  it("only accepts safe cube ids", () => {
    expect(CUBE_ID_RE.test("thepaupercube")).toBe(true);
    expect(CUBE_ID_RE.test("../etc")).toBe(false);
    expect(CUBE_ID_RE.test("a?b=c")).toBe(false);
  });
});
