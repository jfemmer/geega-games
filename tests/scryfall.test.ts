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
  scryfallCardName,
  scryfallOracleId,
  scryfallTypeLine,
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
    expect(printing.imageUrl).toBe("https://img/large.jpg");
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
  it("prefers large at the top level (crisp storefront/high-DPI display)", () => {
    // Prefer the high-quality `large` JPG over `normal` for the stored/display
    // URL so the storefront card grid stays sharp on high-DPI screens.
    expect(primaryImageUrl(baseCard())).toBe("https://img/large.jpg");
  });

  it("falls back large -> normal -> png -> small as sizes are missing", () => {
    const noLarge = baseCard({
      image_uris: {
        small: "s.jpg",
        normal: "n.jpg",
        png: "p.png",
        // large intentionally omitted
      } as never,
    });
    // normal preferred over png/small when large is missing
    expect(primaryImageUrl(noLarge)).toBe("n.jpg");

    const onlyNormal = baseCard({
      image_uris: { normal: "n.jpg" } as never,
    });
    expect(primaryImageUrl(onlyNormal)).toBe("n.jpg");

    const onlySmall = baseCard({
      image_uris: { small: "s.jpg" } as never,
    });
    // small is the last resort so the UI never shows blank art
    expect(primaryImageUrl(onlySmall)).toBe("s.jpg");

    const onlyPng = baseCard({
      image_uris: { png: "only.png" } as never,
    });
    // png is preferred over small when large/normal are missing
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
    // Front face's high-quality large image is preferred (crisp display).
    expect(p.imageUrl).toBe("fl.jpg");
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

// Scryfall's "reversible_card": one card printed on both sides. Modelled on
// the real object for Steam Vents, Lorwyn Eclipsed #348 — note what is NOT
// there: no top-level oracle_id, type_line or image_uris.
function reversibleCard(overrides: Partial<ScryfallCard> = {}): ScryfallCard {
  const face = (side: "front" | "back") => ({
    name: "Steam Vents",
    oracle_id: "17039058-822d-409f-938c-b727a366ba63",
    type_line: "Land — Island Mountain",
    oracle_text: "({T}: Add {U} or {R}.)",
    image_uris: {
      normal: `https://cards.scryfall.io/normal/${side}/e/b/eb96c335.jpg`,
      large: `https://cards.scryfall.io/large/${side}/e/b/eb96c335.jpg`,
    },
  });
  return {
    object: "card",
    id: "eb96c335-9ed3-4f7d-b07a-185ff4044976",
    name: "Steam Vents // Steam Vents",
    lang: "en",
    released_at: "2026-01-23",
    layout: "reversible_card",
    set: "ecl",
    set_name: "Lorwyn Eclipsed",
    collector_number: "348",
    rarity: "rare",
    border_color: "borderless",
    finishes: ["nonfoil", "foil"],
    card_faces: [face("front"), face("back")],
    prices: { usd: "13.00", usd_foil: "15.00", usd_etched: null, eur: null, tix: null },
    ...overrides,
  } as ScryfallCard;
}

// A real two-named card: Scryfall gives it everything at the top level.
function transformCard(): ScryfallCard {
  return baseCard({
    id: "f150d6e9",
    oracle_id: "70113003-be5e-406a-9aec-cb480468c36d",
    name: "Sephiroth, Fabled SOLDIER // Sephiroth, One-Winged Angel",
    layout: "transform",
    type_line: "Legendary Creature — Human Avatar Soldier // Legendary Creature — Angel Nightmare Avatar",
    image_uris: undefined,
    card_faces: [
      { name: "Sephiroth, Fabled SOLDIER", type_line: "Legendary Creature — Human Avatar Soldier" },
      { name: "Sephiroth, One-Winged Angel", type_line: "Legendary Creature — Angel Nightmare Avatar" },
    ],
  });
}

describe("scryfallOracleId", () => {
  it("is the card's own oracle id", () => {
    expect(scryfallOracleId(baseCard())).toBe("oracle-1");
    expect(scryfallOracleId(transformCard())).toBe("70113003-be5e-406a-9aec-cb480468c36d");
  });

  it("comes from the faces of a reversible card, which has none of its own", () => {
    expect(reversibleCard().oracle_id).toBeUndefined();
    expect(scryfallOracleId(reversibleCard())).toBe("17039058-822d-409f-938c-b727a366ba63");
  });

  it("uses the first face that has one", () => {
    const card = reversibleCard();
    card.card_faces = [{ name: "Steam Vents" }, { name: "Steam Vents", oracle_id: "from-the-back" }];
    expect(scryfallOracleId(card)).toBe("from-the-back");
  });

  it("is null when Scryfall gives none anywhere", () => {
    expect(scryfallOracleId(baseCard({ oracle_id: undefined }))).toBeNull();
    expect(scryfallOracleId(reversibleCard({ card_faces: [] }))).toBeNull();
    expect(scryfallOracleId(reversibleCard({ card_faces: undefined }))).toBeNull();
  });
});

describe("scryfallCardName", () => {
  it("is Scryfall's name for an ordinary card", () => {
    expect(scryfallCardName(baseCard())).toBe("Lightning Bolt");
  });

  it("is the one name of a reversible card, not that name twice", () => {
    expect(scryfallCardName(reversibleCard())).toBe("Steam Vents");
    expect(
      scryfallCardName(
        reversibleCard({
          name: "Ugin, Eye of the Storms // Ugin, Eye of the Storms",
          card_faces: [{ name: "Ugin, Eye of the Storms" }, { name: "Ugin, Eye of the Storms" }],
        }),
      ),
    ).toBe("Ugin, Eye of the Storms");
  });

  it("keeps both names of a card that really has two", () => {
    expect(scryfallCardName(transformCard())).toBe("Sephiroth, Fabled SOLDIER // Sephiroth, One-Winged Angel");
    // Same name on both faces, but not a reversible card: left alone.
    expect(
      scryfallCardName(baseCard({ name: "A // A", layout: "split", card_faces: [{ name: "A" }, { name: "A" }] })),
    ).toBe("A // A");
  });

  it("keeps Scryfall's name for a reversible card whose sides are named differently", () => {
    const card = reversibleCard({
      name: "Zndrsplt, Eye of Wisdom // Okaun, Eye of Chaos",
      card_faces: [{ name: "Zndrsplt, Eye of Wisdom" }, { name: "Okaun, Eye of Chaos" }],
    });
    expect(scryfallCardName(card)).toBe("Zndrsplt, Eye of Wisdom // Okaun, Eye of Chaos");
  });

  it("falls back to Scryfall's name when a reversible card has no faces to read", () => {
    expect(scryfallCardName(reversibleCard({ card_faces: [] }))).toBe("Steam Vents // Steam Vents");
    expect(scryfallCardName(reversibleCard({ card_faces: undefined }))).toBe("Steam Vents // Steam Vents");
  });
});

describe("scryfallTypeLine", () => {
  it("is Scryfall's type line when it gives one", () => {
    expect(scryfallTypeLine(baseCard())).toBe("Instant");
    expect(scryfallTypeLine(transformCard())).toBe(
      "Legendary Creature — Human Avatar Soldier // Legendary Creature — Angel Nightmare Avatar",
    );
  });

  it("is the faces' shared type line for a reversible card, once", () => {
    expect(reversibleCard().type_line).toBeUndefined();
    expect(scryfallTypeLine(reversibleCard())).toBe("Land — Island Mountain");
  });

  it("joins the faces' type lines when they differ", () => {
    const card = reversibleCard({
      card_faces: [
        { name: "A", type_line: "Legendary Creature — Homunculus" },
        { name: "B", type_line: "Legendary Creature — Cyclops Berserker" },
      ],
    });
    expect(scryfallTypeLine(card)).toBe("Legendary Creature — Homunculus // Legendary Creature — Cyclops Berserker");
  });

  it("is null when there is none anywhere", () => {
    expect(scryfallTypeLine(baseCard({ type_line: undefined }))).toBeNull();
    expect(scryfallTypeLine(reversibleCard({ card_faces: [{ name: "Steam Vents" }] }))).toBeNull();
  });
});

describe("normalizeScryfallCard — a reversible card", () => {
  const printing = normalizeScryfallCard(reversibleCard());

  it("gets its oracle id, one name and one type line", () => {
    expect(printing.oracleId).toBe("17039058-822d-409f-938c-b727a366ba63");
    expect(printing.cardName).toBe("Steam Vents");
    expect(printing.cardType).toBe("Land — Island Mountain");
  });

  it("still has both sides, each with its own picture", () => {
    expect(printing.layout).toBe("reversible_card");
    expect(printing.faces).toHaveLength(2);
    expect(printing.faces[0].images.large).toContain("/front/");
    expect(printing.faces[1].images.large).toContain("/back/");
    expect(isMultiFaced(printing)).toBe(true);
    expect(printing.imageUrl).toContain("/large/front/");
    expect(printing.setCode).toBe("ECL");
    expect(printing.collectorNumber).toBe("348");
  });

  it("leaves every other kind of card exactly as before", () => {
    const bolt = normalizeScryfallCard(baseCard());
    expect(bolt).toMatchObject({ cardName: "Lightning Bolt", oracleId: "oracle-1", cardType: "Instant" });
    const sephiroth = normalizeScryfallCard(transformCard());
    expect(sephiroth).toMatchObject({
      cardName: "Sephiroth, Fabled SOLDIER // Sephiroth, One-Winged Angel",
      oracleId: "70113003-be5e-406a-9aec-cb480468c36d",
      cardType: "Legendary Creature — Human Avatar Soldier // Legendary Creature — Angel Nightmare Avatar",
    });
    // No type line at all stays an empty string, as it always has.
    expect(normalizeScryfallCard(baseCard({ type_line: undefined })).cardType).toBe("");
  });
});
