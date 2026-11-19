import { describe, expect, it } from "vitest";
import { draftRanks, pairUpgrades, roleLabel, type ChecklistCard, type SuggestionInfo } from "../src/store/lib/cubeChecklist";
import {
  colorsOnList,
  facetCounts,
  matchesFilters,
  ordinal,
  sortCards,
  typesOnList,
  type ChecklistFilters,
} from "../src/admin/components/cube/checklistFilters";

// Choosing swaps on the cube checklist: where each card ranks by draft
// rating, which cards are swap candidates (the same ones Suggested upgrades
// works from), and sorting / filtering the list.

function c(id: string, position: number, name: string, extra: Partial<ChecklistCard> = {}): ChecklistCard {
  return {
    id,
    position,
    name,
    typeLine: "Instant",
    colorCategory: "Blue",
    originalName: null,
    swappedBy: null,
    swappedAt: null,
    foundBy: null,
    foundAt: null,
    elo: null,
    pickCount: null,
    priceCents: null,
    edhrecRank: null,
    updatedAt: "2026-11-10T00:00:00.000Z",
    ...extra,
  };
}

const CARDS = [
  c("sky", 0, "Kor Skyfisher", { colorCategory: "White", typeLine: "Creature — Kor Soldier", elo: 1500, pickCount: 900, priceCents: 25, edhrecRank: 3000 }),
  c("cs", 1, "Counterspell", { elo: 1400, pickCount: 900, priceCents: 150, edhrecRank: 120 }),
  c("pon", 2, "Ponder", { typeLine: "Sorcery", elo: 1100, pickCount: 900, priceCents: 10, edhrecRank: 50, foundBy: "Sam", foundAt: "2026-11-10T00:01:00.000Z" }),
  c("bolt", 3, "Lightning Bolt", { colorCategory: "Red", elo: 1600, pickCount: 900, edhrecRank: 5 }),
  // Swapped in: the slot still holds Exclude's rating, which isn't Mana Leak's.
  c("leak", 4, "Mana Leak", { originalName: "Exclude", swappedAt: "2026-11-10T00:02:00.000Z", elo: 1700, pickCount: 900, priceCents: 40 }),
  // Too few picks to judge.
  c("new", 5, "Brand New Common", { elo: 1200, pickCount: 3 }),
  c("land", 6, "Evolving Wilds", { colorCategory: "Lands", typeLine: "Land" }),
];

const NONE: ChecklistFilters = { view: "all", search: "", color: null, type: null, weakOnly: false };
const names = (cards: ChecklistCard[]) => cards.map((x) => x.name);

describe("draft ranks", () => {
  const ranks = draftRanks(CARDS);

  it("ranks only the cube's own cards with enough picks, #1 the highest rated", () => {
    expect([...ranks.keys()].sort()).toEqual(["bolt", "cs", "pon", "sky"]);
    expect(ranks.get("bolt")).toMatchObject({ rank: 1, of: 4 });
    expect(ranks.get("pon")).toMatchObject({ rank: 4, of: 4 });
  });

  it("calls the lowest-rated quarter swap candidates", () => {
    expect([...ranks.entries()].filter(([, r]) => r.weak).map(([id]) => id)).toEqual(["pon"]);
  });

  it("ranks each card within its role (same color, same kind of card)", () => {
    expect(ranks.get("pon")).toMatchObject({ role: "Blue|Spell", roleWeakest: 1, roleOf: 2 });
    expect(ranks.get("cs")).toMatchObject({ role: "Blue|Spell", roleWeakest: 2, roleOf: 2 });
    expect(ranks.get("sky")).toMatchObject({ role: "White|Creature", roleWeakest: 1, roleOf: 1 });
    expect(roleLabel("Blue|Spell")).toBe("Blue instants and sorceries");
    expect(roleLabel("Lands|Land")).toBe("lands");
    expect(roleLabel("Colorless|Artifact")).toBe("Colorless artifacts");
  });

  it("agrees with Suggested upgrades on who's weakest", () => {
    const pool: SuggestionInfo[] = [
      { position: 0, name: "Preordain", cardName: "Preordain", typeLine: "Sorcery", colors: ["U"], manaValue: 1, manaCost: "{U}", imageSmall: null, imageNormal: null, edhrecRank: 30, paperCommon: true, paperUncommon: true },
    ];
    expect(pairUpgrades(CARDS, pool).map((p) => p.cut.id)).toEqual(["pon"]);
  });
});

describe("sorting", () => {
  const ranks = draftRanks(CARDS);

  it("sorts by price either way, cards without a price last", () => {
    expect(names(sortCards(CARDS, "priceHigh", ranks))).toEqual([
      "Counterspell", "Mana Leak", "Kor Skyfisher", "Ponder", "Brand New Common", "Evolving Wilds", "Lightning Bolt",
    ]);
    expect(names(sortCards(CARDS, "priceLow", ranks)).slice(0, 4)).toEqual(["Ponder", "Kor Skyfisher", "Mana Leak", "Counterspell"]);
  });

  it("sorts by draft rating, unrated and swapped-in cards last", () => {
    expect(names(sortCards(CARDS, "weakest", ranks))).toEqual([
      "Ponder", "Counterspell", "Kor Skyfisher", "Lightning Bolt", "Mana Leak", "Brand New Common", "Evolving Wilds",
    ]);
    expect(names(sortCards(CARDS, "strongest", ranks)).slice(0, 4)).toEqual(["Lightning Bolt", "Kor Skyfisher", "Counterspell", "Ponder"]);
  });

  it("sorts by how widely a card is played", () => {
    expect(names(sortCards(CARDS, "played", ranks)).slice(0, 4)).toEqual(["Lightning Bolt", "Ponder", "Counterspell", "Kor Skyfisher"]);
  });

  it("keeps the Found tab newest first, whatever the sort", () => {
    const found = [c("x", 0, "A", { foundAt: "2026-11-10T00:01:00Z" }), c("y", 1, "B", { foundAt: "2026-11-10T00:05:00Z" })];
    expect(names(sortCards(found, "priceHigh", ranks, true))).toEqual(["B", "A"]);
  });
});

describe("filters", () => {
  const ranks = draftRanks(CARDS);

  it("filters by color, type, swap candidates and tab together", () => {
    const pick = (f: Partial<ChecklistFilters>) => names(CARDS.filter((x) => matchesFilters(x, { ...NONE, ...f }, ranks)));
    expect(pick({ color: "Blue" })).toEqual(["Counterspell", "Ponder", "Mana Leak", "Brand New Common"]);
    expect(pick({ color: "Blue", type: "Sorcery" })).toEqual(["Ponder"]);
    expect(pick({ type: "Creature" })).toEqual(["Kor Skyfisher"]);
    expect(pick({ weakOnly: true })).toEqual(["Ponder"]);
    expect(pick({ weakOnly: true, view: "remaining" })).toEqual([]);
    expect(pick({ color: "Blue", search: "leak" })).toEqual(["Mana Leak"]);
  });

  it("counts each filter's options with the other filters applied", () => {
    const f = facetCounts(CARDS, { ...NONE, color: "Blue", type: "Instant" }, ranks);
    expect(f.views).toEqual({ remaining: 3, all: 3, found: 0, swapped: 1 });
    // Colors ignore the color filter, types ignore the type filter.
    expect(Object.fromEntries(f.colors)).toEqual({ Blue: 3, Red: 1 });
    expect(Object.fromEntries(f.types)).toEqual({ Instant: 3, Sorcery: 1 });
    expect(f.weak).toBe(0);
    expect(facetCounts(CARDS, NONE, ranks).weak).toBe(1);
  });

  it("lists the colors in CubeCobra's order and the types in a fixed order", () => {
    expect(colorsOnList(CARDS)).toEqual(["White", "Blue", "Red", "Lands"]);
    expect(typesOnList(CARDS)).toEqual(["Creature", "Instant", "Sorcery", "Land"]);
  });

  it("writes ordinals", () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 101].map(ordinal)).toEqual([
      "1st", "2nd", "3rd", "4th", "11th", "12th", "13th", "21st", "22nd", "101st",
    ]);
  });
});
