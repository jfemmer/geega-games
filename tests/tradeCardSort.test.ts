// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { colorGroupOf, loadWantedSort, saveWantedSort, sortWanted } from "../src/admin/pages/trades/tradeCardSort";
import { wantedItem } from "./helpers/tradeFixtures";

// Sorting the cards a customer wants from our inventory: by name, or by color
// in the usual Magic order (W, U, B, R, G, multicolor, colorless, lands), the
// trade's own order otherwise. Remembered on this device.

const card = (id: string, cardName: string, colors: string[] | null, typeLine: string | null = "Creature") =>
  wantedItem({ id, cardName, colors, typeLine });

const CARDS = [
  card("1", "Sol Ring", [], "Artifact"),
  card("2", "Lightning Bolt", ["R"], "Instant"),
  card("3", "Command Tower", [], "Land"),
  card("4", "Swords to Plowshares", ["W"], "Instant"),
  card("5", "Lost card", null, null),
  card("6", "Counterspell", ["U"], "Instant"),
  card("7", "Assassin's Trophy", ["G", "B"], "Instant"),
  card("8", "Atraxa, Grand Unifier", ["W", "U", "B", "G"]),
  card("9", "Abrupt Decay", ["B", "G"], "Instant"),
  card("10", "Thoughtseize", ["B"], "Sorcery"),
  card("11", "Llanowar Elves", ["G"]),
  card("12", "Electrolyze", ["U", "R"], "Instant"),
];

describe("sorting our cards on a trade", () => {
  it("keeps the trade's own order by default, without touching the list it was given", () => {
    const before = CARDS.map((c) => c.id);
    expect(sortWanted(CARDS, "added").map((c) => c.id)).toEqual(before);
    sortWanted(CARDS, "name");
    sortWanted(CARDS, "color");
    expect(CARDS.map((c) => c.id)).toEqual(before);
  });

  it("sorts by name, ignoring case and punctuation, then by printing", () => {
    const names = sortWanted(
      [card("a", "sol ring", []), card("b", "Abrupt Decay", ["B", "G"]), card("c", "Sol Ring", []), card("d", "Assassin's Trophy", ["B", "G"])].map(
        (c, i) => ({ ...c, setCode: ["C21", "RTR", "CMM", "GRN"][i] }),
      ),
      "name",
    );
    expect(names.map((c) => `${c.cardName} ${c.setCode}`)).toEqual(["Abrupt Decay RTR", "Assassin's Trophy GRN", "sol ring C21", "Sol Ring CMM"]);
  });

  it("sorts by color: WUBRG, then multicolor, colorless, lands, and cards whose colors aren't known", () => {
    expect(sortWanted(CARDS, "color").map((c) => c.cardName)).toEqual([
      "Swords to Plowshares",
      "Counterspell",
      "Thoughtseize",
      "Lightning Bolt",
      "Llanowar Elves",
      // Two colors before four; pairs in WUBRG order (blue-red before black-green), then by name.
      "Electrolyze",
      "Abrupt Decay",
      "Assassin's Trophy",
      "Atraxa, Grand Unifier",
      "Sol Ring",
      "Command Tower",
      "Lost card",
    ]);
  });

  it("names each color group", () => {
    expect(colorGroupOf({ colors: ["W"], typeLine: null }).label).toBe("White");
    expect(colorGroupOf({ colors: ["u"], typeLine: null }).label).toBe("Blue");
    expect(colorGroupOf({ colors: ["R", "G"], typeLine: null }).label).toBe("Multicolor");
    expect(colorGroupOf({ colors: [], typeLine: "Artifact — Equipment" }).label).toBe("Colorless");
    expect(colorGroupOf({ colors: [], typeLine: "Legendary Land" }).label).toBe("Land");
    // "Island" isn't the word "Land".
    expect(colorGroupOf({ colors: [], typeLine: "Artifact Creature — Islandwalker" }).label).toBe("Colorless");
    expect(colorGroupOf({ colors: null, typeLine: null }).label).toBe("Unknown color");
    expect(colorGroupOf({}).label).toBe("Unknown color");
  });
});

describe("remembering the sort", () => {
  afterEach(() => window.localStorage.clear());

  it("remembers the last sort on this device, and ignores anything it doesn't know", () => {
    expect(loadWantedSort()).toBe("added");
    saveWantedSort("color");
    expect(loadWantedSort()).toBe("color");
    window.localStorage.setItem("gg-trade-wanted-sort", "price");
    expect(loadWantedSort()).toBe("added");
  });
});
