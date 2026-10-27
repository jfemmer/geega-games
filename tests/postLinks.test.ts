import { describe, expect, it } from "vitest";
import { MAX_PICKS, PICKS_PATH, facebookPostLink, readPickSlugs } from "../src/store/lib/postLinks";
import { slugifyCardName } from "../src/store/lib/cardSlug";

describe("readPickSlugs", () => {
  it("reads the card slugs from a picks link, cleaned and without repeats", () => {
    expect(readPickSlugs(null)).toEqual([]);
    expect(readPickSlugs("")).toEqual([]);
    expect(readPickSlugs("lightning-bolt,sheoldred-the-apocalypse")).toEqual(["lightning-bolt", "sheoldred-the-apocalypse"]);
    expect(readPickSlugs(" Lightning-Bolt , lightning-bolt,,")).toEqual(["lightning-bolt"]);
  });

  it("ignores anything that isn't a card slug", () => {
    expect(readPickSlugs("../admin,lightning bolt,bolt_1,-bolt,bolt-,ok-1")).toEqual(["ok-1"]);
    expect(readPickSlugs(`${"a".repeat(151)},b`)).toEqual(["b"]);
  });

  it(`shows at most ${MAX_PICKS} cards`, () => {
    const many = Array.from({ length: 40 }, (_, i) => `card-${i}`).join(",");
    const slugs = readPickSlugs(many);
    expect(slugs).toHaveLength(MAX_PICKS);
    expect(slugs[0]).toBe("card-0");
    expect(slugs[MAX_PICKS - 1]).toBe(`card-${MAX_PICKS - 1}`);
  });
});

describe("facebookPostLink", () => {
  const now = new Date("2026-10-27T03:30:00Z"); // 10:30 PM on Oct 26 in St. Louis

  it("links one card to its own page, tagged with the card", () => {
    expect(facebookPostLink(["Lightning Bolt"], now)).toBe(
      "https://geega-games.com/shop/card/lightning-bolt?utm_source=facebook&utm_medium=social&utm_campaign=lightning-bolt",
    );
    // The same card twice (two printings) is still one card.
    expect(facebookPostLink(["Lightning Bolt", "Lightning Bolt"], now)).toContain("/shop/card/lightning-bolt?");
  });

  it("links several cards to the picks page, tagged with the St. Louis date", () => {
    const link = facebookPostLink(["Lightning Bolt", "Sheoldred, the Apocalypse", "Lightning Bolt"], now);
    expect(link).toBe(
      `https://geega-games.com${PICKS_PATH}?c=lightning-bolt,sheoldred-the-apocalypse&utm_source=facebook&utm_medium=social&utm_campaign=picks-2026-10-26`,
    );
    // The picks page reads back exactly those cards.
    const url = new URL(link!);
    expect(url.pathname).toBe(PICKS_PATH);
    expect(readPickSlugs(url.searchParams.get("c"))).toEqual(["lightning-bolt", "sheoldred-the-apocalypse"]);
  });

  it("uses the same slugs as the card pages, for names with punctuation and accents", () => {
    const names = ["Jace, the Mind Sculptor", "Lim-Dûl's Vault", "Borrowing 100,000 Arrows"];
    const url = new URL(facebookPostLink(names, now)!);
    expect(readPickSlugs(url.searchParams.get("c"))).toEqual(names.map(slugifyCardName));
  });

  it(`keeps a long selection to the first ${MAX_PICKS} different cards, and is null for none`, () => {
    const names = Array.from({ length: 30 }, (_, i) => `Card ${i}`);
    const url = new URL(facebookPostLink(names, now)!);
    expect(readPickSlugs(url.searchParams.get("c"))).toHaveLength(MAX_PICKS);
    expect(facebookPostLink([], now)).toBeNull();
    expect(facebookPostLink(["!!!"], now)).toBeNull();
  });
});
