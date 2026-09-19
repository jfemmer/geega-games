import { describe, expect, it } from "vitest";
import { isCommanderCandidate, pickDefaultCommander, type ResolvedCard } from "../src/store/pages/MyDecksPage";

function resolved(overrides: Partial<ResolvedCard>): ResolvedCard {
  return {
    input_name: "",
    card_name: null,
    oracle_id: null,
    scryfall_id: null,
    type_line: null,
    image_url: null,
    commander_legal: null,
    ...overrides,
  };
}

describe("isCommanderCandidate", () => {
  it("accepts a legendary creature", () => {
    expect(
      isCommanderCandidate(
        resolved({ oracle_id: "1", card_name: "Muldrotha, the Gravetide", type_line: "Legendary Creature — Elf Druid" }),
      ),
    ).toBe(true);
  });

  it("accepts a legendary planeswalker that can be a commander", () => {
    expect(
      isCommanderCandidate(
        resolved({ oracle_id: "2", card_name: "Commander-eligible Planeswalker", type_line: "Legendary Planeswalker — Test" }),
      ),
    ).toBe(true);
  });

  it("rejects a card that is commander_legal but not a legendary creature/planeswalker", () => {
    expect(
      isCommanderCandidate(
        resolved({ oracle_id: "3", card_name: "Sol Ring", type_line: "Artifact", commander_legal: true }),
      ),
    ).toBe(false);
  });

  it("rejects a non-legendary creature", () => {
    expect(
      isCommanderCandidate(resolved({ oracle_id: "4", card_name: "Grizzly Bears", type_line: "Creature — Bear" })),
    ).toBe(false);
  });

  it("rejects an unresolved name (no oracle_id)", () => {
    expect(
      isCommanderCandidate(resolved({ oracle_id: null, card_name: null, type_line: "Legendary Creature — Elf" })),
    ).toBe(false);
  });
});

describe("pickDefaultCommander", () => {
  const muldrotha = resolved({
    oracle_id: "m-1",
    card_name: "Muldrotha, the Gravetide",
    type_line: "Legendary Creature — Elf Druid",
    scryfall_id: "sf-1",
  });
  const vhati = resolved({
    oracle_id: "v-1",
    card_name: "Vhati il-Dal",
    type_line: "Legendary Creature — Human Warrior",
    scryfall_id: "sf-2",
  });

  it("prefers the card explicitly placed in the Commander section", () => {
    const parsed = [
      { name: "Vhati il-Dal", quantity: 1, section: "mainboard" },
      { name: "Muldrotha, the Gravetide", quantity: 1, section: "commander" },
    ];
    expect(pickDefaultCommander(parsed, [vhati, muldrotha])).toEqual({
      card_name: "Muldrotha, the Gravetide",
      oracle_id: "m-1",
      scryfall_id: "sf-1",
    });
  });

  it("falls back to the first legendary candidate when there is no Commander section", () => {
    const parsed = [
      { name: "Vhati il-Dal", quantity: 1, section: "mainboard" },
      { name: "Muldrotha, the Gravetide", quantity: 1, section: "mainboard" },
    ];
    // A deck can easily run several legendary creatures in the 99 without
    // any of them being the actual commander — this is the known-imprecise
    // guess a user is expected to correct via the picker, not a promise
    // that the "first" legendary is always right.
    expect(pickDefaultCommander(parsed, [vhati, muldrotha])).toEqual({
      card_name: "Vhati il-Dal",
      oracle_id: "v-1",
      scryfall_id: "sf-2",
    });
  });

  it("returns null when no candidates were found", () => {
    expect(pickDefaultCommander([{ name: "Sol Ring", quantity: 1, section: "mainboard" }], [])).toBeNull();
  });

  it("falls back to the first candidate if the Commander-section card itself didn't resolve as a legendary", () => {
    const parsed = [
      { name: "Some Typo'd Name", quantity: 1, section: "commander" },
      { name: "Vhati il-Dal", quantity: 1, section: "mainboard" },
    ];
    expect(pickDefaultCommander(parsed, [vhati])).toEqual({
      card_name: "Vhati il-Dal",
      oracle_id: "v-1",
      scryfall_id: "sf-2",
    });
  });
});
