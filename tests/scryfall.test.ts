import { describe, expect, it } from "vitest";
import {
  extractAvailableFinishes,
  extractCardFaces,
  extractImageUris,
  extractPriceForFinish,
  extractPrintingTreatments,
  isMultiFaced,
  normalizeScryfallCard,
  priceStringToCents,
} from "../src/admin/services/scryfall";
import type { ScryfallCard } from "../src/admin/services/scryfall.types";

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
