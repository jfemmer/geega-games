import { describe, expect, it } from "vitest";
import {
  bestImage,
  extractAvailableFinishes,
  extractCardFaces,
  extractImageUris,
  extractPriceForFinish,
  extractPrintingTreatments,
  imageCandidates,
  isMultiFaced,
  normalizeScryfallCard,
  primaryImageUrl,
  priceStringToCents,
} from "../src/admin/services/scryfall";
import type { ScryfallCard } from "../src/admin/services/scryfall.types";
import type { CardImageUris } from "../src/admin/types";

function baseCard(overrides: Partial<ScryfallCard> = {}): ScryfallCard {
  return {
    object: "card",
    id: "abc-123",
    oracle_id: "oracle-1",
    name: "Lightning Bolt",
    lang: "en",
    released_at: "1993-08-05",
    layout: "normal",
    set: "lea",
    set_name: "Limited Edition Alpha",
    collector_number: "161",
    rarity: "common",
    type_line: "Instant",
    oracle_text: "Deal 3 damage.",
    artist: "Christopher Rush",
    frame: "1993",
    border_color: "black",
    finishes: ["nonfoil"],
    image_uris: {
      small: "https://img/small.jpg",
      normal: "https://img/normal.jpg",
      large: "https://img/large.jpg",
      png: "https://img/png.png",
      art_crop: "https://img/art.jpg",
      border_crop: "https://img/border.jpg",
    },
    prices: {
      usd: "2.50",
      usd_foil: null,
      usd_etched: null,
      eur: null,
      eur_foil: null,
      tix: null,
    },
    ...overrides,
  } as ScryfallCard;
}

describe("priceStringToCents", () => {
  it("converts dollar strings to integer cents", () => {
    expect(priceStringToCents("2.50")).toBe(250);
    expect(priceStringToCents("0.03")).toBe(3);
    expect(priceStringToCents("1000")).toBe(100000);
  });
  it("returns null for null/invalid", () => {
    expect(priceStringToCents(null)).toBeNull();
    expect(priceStringToCents("")).toBeNull();
    expect(priceStringToCents("n/a")).toBeNull();
  });
});

describe("extractImageUris", () => {
  it("maps snake_case Scryfall keys to camelCase domain keys", () => {
    const uris = extractImageUris(baseCard().image_uris ?? null);
    expect(uris.small).toBe("https://img/small.jpg");
    expect(uris.artCrop).toBe("https://img/art.jpg");
  });
  it("returns all-null set when no images", () => {
    const uris = extractImageUris(null);
    expect(uris.small).toBeNull();
    expect(uris.normal).toBeNull();
  });
});

describe("extractCardFaces / isMultiFaced", () => {
  it("returns a single face for a normal card", () => {
    const card = baseCard();
    const faces = extractCardFaces(card);
    expect(faces).toHaveLength(1);
    expect(faces[0].name).toBe("Lightning Bolt");
    expect(isMultiFaced(normalizeScryfallCard(card))).toBe(false);
  });

  it("extracts both faces of a transform card with per-face images", () => {
    const card = baseCard({
      layout: "transform",
      image_uris: undefined,
      card_faces: [
        {
          object: "card_face",
          name: "Front Face",
          mana_cost: "{1}{R}",
          type_line: "Creature",
          oracle_text: "front",
          artist: "A",
          image_uris: {
            small: "f-small.jpg",
            normal: "f-normal.jpg",
            large: "f-large.jpg",
            png: null,
            art_crop: null,
            border_crop: null,
          },
        },
        {
          object: "card_face",
          name: "Back Face",
          mana_cost: "",
          type_line: "Creature",
          oracle_text: "back",
          artist: "A",
          image_uris: {
            small: "b-small.jpg",
            normal: "b-normal.jpg",
            large: "b-large.jpg",
            png: null,
            art_crop: null,
            border_crop: null,
          },
        },
      ],
    });
    const faces = extractCardFaces(card);
    expect(faces).toHaveLength(2);
    expect(faces[0].name).toBe("Front Face");
    expect(faces[1].images.normal).toBe("b-normal.jpg");
    expect(isMultiFaced(normalizeScryfallCard(card))).toBe(true);
  });
});

describe("extractAvailableFinishes", () => {
  it("keeps only known finishes", () => {
    const card = baseCard({ finishes: ["nonfoil", "foil", "etched", "bogus"] as never });
    expect(extractAvailableFinishes(card)).toEqual(["nonfoil", "foil", "etched"]);
  });
  it("defaults to nonfoil when empty", () => {
    const card = baseCard({ finishes: [] });
    expect(extractAvailableFinishes(card)).toEqual(["nonfoil"]);
  });
});

describe("extractPriceForFinish", () => {
  it("selects finish-specific price with fallback to usd", () => {
    const card = baseCard({
      prices: {
        usd: "2.00",
        usd_foil: "5.00",
        usd_etched: "8.00",
        eur: null,
        eur_foil: null,
        tix: null,
      },
    });
    expect(extractPriceForFinish(card, "nonfoil")).toBe(200);
    expect(extractPriceForFinish(card, "foil")).toBe(500);
    expect(extractPriceForFinish(card, "etched")).toBe(800);
  });
  it("falls back to usd when finish price missing", () => {
    const card = baseCard({
      prices: { usd: "2.00", usd_foil: null, usd_etched: null, eur: null, eur_foil: null, tix: null },
    });
    expect(extractPriceForFinish(card, "foil")).toBe(200);
  });
});

describe("extractPrintingTreatments", () => {
  it("detects retro frame from frame year", () => {
    const card = baseCard({ frame: "1997" });
    expect(extractPrintingTreatments(card)).toContain("retro_frame");
  });
  it("detects borderless from border color", () => {
    const card = baseCard({ border_color: "borderless" });
    expect(extractPrintingTreatments(card)).toContain("borderless");
  });
  it("detects showcase/extended from frame effects", () => {
    const card = baseCard({ frame_effects: ["showcase"] });
    expect(extractPrintingTreatments(card)).toContain("showcase");
    const ext = baseCard({ frame_effects: ["extendedart"] });
    expect(extractPrintingTreatments(ext)).toContain("extended_art");
  });
  it("detects promo", () => {
    const card = baseCard({ promo: true });
    expect(extractPrintingTreatments(card)).toContain("promo");
  });
});

describe("normalizeScryfallCard", () => {
  it("produces a complete CardPrinting keyed by scryfall id", () => {
    const printing = normalizeScryfallCard(baseCard());
    expect(printing.scryfallId).toBe("abc-123");
    expect(printing.cardName).toBe("Lightning Bolt");
    expect(printing.setCode).toBe("LEA");
    expect(printing.collectorNumber).toBe("161");
    expect(printing.rarity).toBe("common");
    expect(printing.availableFinishes).toContain("nonfoil");
    expect(printing.imageUrl).toBe("https://img/normal.jpg");
    expect(printing.scryfallPriceCents).toBe(250);
    expect(printing.faces).toHaveLength(1);
  });

  it("normalizes rarity variants safely", () => {
    const mythic = normalizeScryfallCard(baseCard({ rarity: "mythic" }));
    expect(mythic.rarity).toBe("mythic");
    const special = normalizeScryfallCard(baseCard({ rarity: "special" as never }));
    // Unknown rarities degrade without throwing.
    expect(typeof special.rarity).toBe("string");
  });
});

describe("primaryImageUrl — resolution & fallbacks", () => {
  it("prefers normal at the top level", () => {
    expect(primaryImageUrl(baseCard())).toBe("https://img/normal.jpg");
  });

  it("falls back to large, then small, then png when earlier sizes are missing", () => {
    const noNormal = baseCard({
      image_uris: {
        small: "s.jpg",
        large: "l.jpg",
        png: "p.png",
        // normal intentionally omitted
      } as never,
    });
    // large preferred over small when normal is missing
    expect(primaryImageUrl(noNormal)).toBe("l.jpg");

    const onlySmall = baseCard({
      image_uris: { small: "s.jpg" } as never,
    });
    expect(primaryImageUrl(onlySmall)).toBe("s.jpg");

    const onlyPng = baseCard({
      image_uris: { png: "only.png" } as never,
    });
    // png is a valid last-resort so the UI never shows blank art
    expect(primaryImageUrl(onlyPng)).toBe("only.png");
  });

  it("uses face-level images for a DFC with no top-level image_uris", () => {
    const dfc = baseCard({
      layout: "transform",
      image_uris: undefined,
      card_faces: [
        {
          object: "card_face",
          name: "Front",
          image_uris: { normal: "front-normal.jpg" },
        },
        {
          object: "card_face",
          name: "Back",
          image_uris: { normal: "back-normal.jpg" },
        },
      ] as never,
    });
    expect(primaryImageUrl(dfc)).toBe("front-normal.jpg");
  });

  it("returns the front face image even when the front only has png", () => {
    const dfc = baseCard({
      layout: "transform",
      image_uris: undefined,
      card_faces: [
        { object: "card_face", name: "Front", image_uris: { png: "front.png" } },
        { object: "card_face", name: "Back", image_uris: { normal: "back.jpg" } },
      ] as never,
    });
    expect(primaryImageUrl(dfc)).toBe("front.png");
  });

  it("returns empty string only when the card truly has no images anywhere", () => {
    const none = baseCard({ image_uris: undefined, card_faces: undefined });
    expect(primaryImageUrl(none)).toBe("");
  });
});

describe("bestImage / imageCandidates — ordered fallback", () => {
  const full: CardImageUris = {
    small: "s.jpg",
    normal: "n.jpg",
    large: "l.jpg",
    png: "p.png",
    artCrop: "a.jpg",
  };

  it("bestImage degrades by preference and always finds something", () => {
    expect(bestImage(full, "small")).toBe("s.jpg");
    expect(bestImage(full, "normal")).toBe("n.jpg");
    expect(bestImage(full, "large")).toBe("l.jpg");

    const onlyPng: CardImageUris = {
      small: null,
      normal: null,
      large: null,
      png: "p.png",
      artCrop: null,
    };
    // When only png exists, every preference still resolves to it.
    expect(bestImage(onlyPng, "small")).toBe("p.png");
    expect(bestImage(onlyPng, "normal")).toBe("p.png");
    expect(bestImage(onlyPng, "large")).toBe("p.png");
  });

  it("imageCandidates returns an ordered, de-duplicated list per preference", () => {
    expect(imageCandidates(full, "small")).toEqual([
      "s.jpg",
      "n.jpg",
      "l.jpg",
      "p.png",
    ]);
    expect(imageCandidates(full, "normal")).toEqual([
      "n.jpg",
      "l.jpg",
      "s.jpg",
      "p.png",
    ]);
    expect(imageCandidates(full, "large")).toEqual([
      "l.jpg",
      "n.jpg",
      "s.jpg",
      "p.png",
    ]);
  });

  it("imageCandidates de-duplicates when sizes share a url and skips nulls", () => {
    const dupes: CardImageUris = {
      small: "same.jpg",
      normal: "same.jpg",
      large: null,
      png: "p.png",
      artCrop: null,
    };
    expect(imageCandidates(dupes, "small")).toEqual(["same.jpg", "p.png"]);
    expect(imageCandidates(null, "normal")).toEqual([]);
  });
});

describe("normalizeScryfallCard — image resilience", () => {
  it("keeps a usable imageUrl for a face-only DFC", () => {
    const dfc = baseCard({
      layout: "modal_dfc",
      image_uris: undefined,
      card_faces: [
        {
          object: "card_face",
          name: "Front",
          image_uris: { small: "fs.jpg", normal: "fn.jpg", large: "fl.jpg" },
        },
        {
          object: "card_face",
          name: "Back",
          image_uris: { small: "bs.jpg", normal: "bn.jpg", large: "bl.jpg" },
        },
      ] as never,
    });
    const p = normalizeScryfallCard(dfc);
    expect(p.imageUrl).toBe("fn.jpg");
    expect(p.faces).toHaveLength(2);
    expect(p.faces[1].images.normal).toBe("bn.jpg");
    expect(isMultiFaced(p)).toBe(true);
  });

  it("produces an all-null image set but does not throw for an imageless printing", () => {
    const none = baseCard({ image_uris: undefined, card_faces: undefined });
    const p = normalizeScryfallCard(none);
    expect(p.imageUrl).toBe("");
    expect(p.images.normal).toBeNull();
    // A blank printing still yields empty candidate lists (UI shows placeholder).
    expect(imageCandidates(p.images, "small")).toEqual([]);
  });

  it("handles an unusual rarity/treatment printing (showcase borderless promo)", () => {
    const fancy = baseCard({
      rarity: "mythic",
      border_color: "borderless",
      frame_effects: ["showcase", "extendedart"],
      promo: true,
      full_art: true,
    });
    const p = normalizeScryfallCard(fancy);
    expect(p.rarity).toBe("mythic");
    expect(p.treatments).toEqual(
      expect.arrayContaining([
        "borderless",
        "showcase",
        "extended_art",
        "promo",
        "full_art",
      ]),
    );
  });
});