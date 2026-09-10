// Scryfall normalization service.
//
// Turns raw Scryfall card objects into Geega's domain `CardPrinting`. These
// functions are PURE and have no network dependency, so they are unit-testable
// in isolation (see tests/scryfall.test.ts). Direct HTTP access lives in the
// ScryfallRepository implementation, never here and never in components.

import type {
  CardFace,
  CardFinish,
  CardImageUris,
  CardPrices,
  CardPrinting,
  CardRarity,
  PrintingTreatment,
} from "../types/index.js";
import type {
  ScryfallCard,
  ScryfallCardFace,
  ScryfallImageUris,
} from "./scryfall.types.js";

/** Finishes Geega understands today. Unknown Scryfall finishes are dropped. */
const KNOWN_FINISHES: readonly CardFinish[] = [
  "nonfoil",
  "foil",
  "etched",
  "glossy",
];

/** Scryfall rarities map 1:1, with an "special"/"bonus" catch-all. */
function normalizeRarity(rarity: string): CardRarity {
  switch (rarity) {
    case "common":
    case "uncommon":
    case "rare":
    case "mythic":
      return rarity;
    default:
      // bonus, special, etc.
      return "special";
  }
}

/** Convert a Scryfall usd string ("12.34") to integer cents, or null. */
export function priceStringToCents(value: string | null | undefined): number | null {
  if (value == null) return null;
  const n = Number.parseFloat(value);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100);
}

/** Map a Scryfall image_uris object to Geega's CardImageUris (all nullable). */
export function extractImageUris(
  uris: ScryfallImageUris | undefined,
): CardImageUris {
  return {
    small: uris?.small ?? null,
    normal: uris?.normal ?? null,
    large: uris?.large ?? null,
    png: uris?.png ?? null,
    artCrop: uris?.art_crop ?? null,
  };
}

/** Whether a card has any usable image at the top level. */
function hasTopLevelImage(card: ScryfallCard): boolean {
  return Boolean(
    card.image_uris?.small ||
      card.image_uris?.normal ||
      card.image_uris?.large,
  );
}

function faceFromScryfall(
  face: ScryfallCardFace,
  fallbackArtist: string | null,
): CardFace {
  return {
    name: face.name,
    manaCost: face.mana_cost ?? null,
    typeLine: face.type_line ?? null,
    oracleText: face.oracle_text ?? null,
    artist: face.artist ?? fallbackArtist,
    illustrationId: face.illustration_id ?? null,
    images: extractImageUris(face.image_uris),
  };
}

/**
 * Extract per-face data. Handles the layouts where the image structure differs
 * from a normal single-faced card:
 *   - transform / modal_dfc / double_faced_token: card_faces each own image_uris
 *   - split / flip / adventure / class: card_faces exist but SHARE one top-level
 *     image (the whole card is printed on one side)
 * Single-faced cards return exactly one synthetic face built from the top-level.
 */
export function extractCardFaces(card: ScryfallCard): CardFace[] {
  const fallbackArtist = card.artist ?? null;
  const topLevel = extractImageUris(card.image_uris);

  if (card.card_faces && card.card_faces.length > 0) {
    const facesHaveOwnImages = card.card_faces.some((f) => f.image_uris);
    if (facesHaveOwnImages) {
      return card.card_faces.map((f) => {
        const face = faceFromScryfall(f, fallbackArtist);
        // Some faces omit images even when siblings have them; fall back to
        // the top-level image so a face always renders SOMETHING.
        if (!f.image_uris && hasTopLevelImage(card)) {
          face.images = topLevel;
        }
        return face;
      });
    }
    // Shared-image layout (split/flip/adventure): present faces for metadata
    // but every face points at the single shared image.
    return card.card_faces.map((f) => {
      const face = faceFromScryfall(f, fallbackArtist);
      face.images = topLevel;
      return face;
    });
  }

  // Single-faced card: one synthetic face from the top-level fields.
  return [
    {
      name: card.name,
      manaCost: card.mana_cost ?? null,
      typeLine: card.type_line ?? null,
      oracleText: card.oracle_text ?? null,
      artist: fallbackArtist,
      illustrationId: card.illustration_id ?? null,
      images: topLevel,
    },
  ];
}

/**
 * The primary display image for a printing — the front face's normal image,
 * falling back through sizes and to the top-level image for shared-image
 * layouts. Always returns a usable string when any image exists, else "".
 */
export function primaryImageUrl(card: ScryfallCard): string {
  const faces = extractCardFaces(card);
  const front = faces[0]?.images;
  return (
    front?.normal ||
    front?.large ||
    front?.small ||
    card.image_uris?.normal ||
    card.image_uris?.large ||
    card.image_uris?.small ||
    ""
  );
}

/**
 * Available finishes for THIS printing, filtered to finishes Geega supports and
 * preserving Scryfall's order (nonfoil, foil, etched). Falls back to the
 * foil/nonfoil booleans for older objects that omit `finishes`.
 */
export function extractAvailableFinishes(card: ScryfallCard): CardFinish[] {
  if (Array.isArray(card.finishes) && card.finishes.length > 0) {
    return card.finishes.filter((f): f is CardFinish =>
      (KNOWN_FINISHES as readonly string[]).includes(f),
    );
  }
  const out: CardFinish[] = [];
  if (card.nonfoil !== false) out.push("nonfoil");
  if (card.foil) out.push("foil");
  return out.length > 0 ? out : ["nonfoil"];
}

export function extractPrices(card: ScryfallCard): CardPrices {
  return {
    usd: priceStringToCents(card.prices?.usd),
    usdFoil: priceStringToCents(card.prices?.usd_foil),
    usdEtched: priceStringToCents(card.prices?.usd_etched),
  };
}

/**
 * The reference price in cents for a specific finish. Foil → usd_foil, etched →
 * usd_etched, everything else → usd. Falls back to plain usd when a
 * finish-specific price is missing.
 */
export function extractPriceForFinish(
  card: ScryfallCard,
  finish: CardFinish,
): number | null {
  const prices = extractPrices(card);
  switch (finish) {
    case "foil":
      return prices.usdFoil ?? prices.usd;
    case "etched":
      return prices.usdEtched ?? prices.usd;
    default:
      return prices.usd;
  }
}

/**
 * Printing treatments derived from frame, frame_effects, promo and full/textless
 * flags. Treatment is DISTINCT from finish: foil/etched are finishes; showcase,
 * borderless, extended-art, retro-frame are treatments. (Etched is surfaced as
 * a treatment badge too, because it changes the product's appearance.)
 */
export function extractPrintingTreatments(card: ScryfallCard): PrintingTreatment[] {
  const out = new Set<PrintingTreatment>();
  const effects = card.frame_effects ?? [];

  if (effects.includes("showcase")) out.add("showcase");
  if (effects.includes("extendedart")) out.add("extended_art");
  if (card.border_color === "borderless") out.add("borderless");
  // Retro frame: Scryfall marks the classic frame as "1997".
  if (card.frame === "1997") out.add("retro_frame");
  if (card.full_art) out.add("full_art");
  if (card.textless) out.add("textless");
  if (card.promo) out.add("promo");
  if (card.variation) out.add("variation");
  if ((card.finishes ?? []).includes("etched")) out.add("etched");

  return Array.from(out);
}

/** Normalize a single raw Scryfall card into a Geega CardPrinting. */
export function normalizeScryfallCard(card: ScryfallCard): CardPrinting {
  const faces = extractCardFaces(card);
  const finishes = extractAvailableFinishes(card);
  const prices = extractPrices(card);
  const images = faces[0]?.images ?? extractImageUris(card.image_uris);
  const typeLine =
    card.type_line ?? faces.map((f) => f.typeLine).filter(Boolean).join(" // ");

  return {
    // Existing lightweight fields (unchanged shape for back-compat).
    id: card.id,
    cardName: card.name,
    setName: card.set_name,
    setCode: card.set.toUpperCase(),
    collectorNumber: card.collector_number,
    rarity: normalizeRarity(card.rarity),
    cardType: typeLine || "",
    imageUrl: primaryImageUrl(card),
    availableFinishes: finishes,
    scryfallPriceCents: prices.usd,

    // Exact-printing metadata.
    scryfallId: card.id,
    oracleId: card.oracle_id ?? null,
    images,
    faces,
    layout: card.layout,
    artist: card.artist ?? null,
    releasedAt: card.released_at ?? null,
    language: card.lang,
    frame: card.frame ?? null,
    frameEffects: card.frame_effects ?? [],
    borderColor: card.border_color ?? null,
    fullArt: card.full_art ?? false,
    textless: card.textless ?? false,
    promo: card.promo ?? false,
    promoTypes: card.promo_types ?? [],
    treatments: extractPrintingTreatments(card),
    prices,
  };
}

/** Normalize a list of raw cards, skipping any malformed entries defensively. */
export function normalizeScryfallCards(cards: ScryfallCard[]): CardPrinting[] {
  const out: CardPrinting[] = [];
  for (const c of cards) {
    if (c && c.object === "card" && c.id) {
      out.push(normalizeScryfallCard(c));
    }
  }
  return out;
}

/** True when a printing has more than one distinct face image (DFC etc.). */
export function isMultiFaced(printing: CardPrinting): boolean {
  if (printing.faces.length < 2) return false;
  const first = printing.faces[0]?.images.normal;
  return printing.faces.some((f) => f.images.normal && f.images.normal !== first);
}

/** Choose the best image at a requested size, gracefully degrading. */
export function bestImage(
  images: CardImageUris,
  prefer: "small" | "normal" | "large",
): string | null {
  if (prefer === "small") return images.small ?? images.normal ?? images.large;
  if (prefer === "large") return images.large ?? images.normal ?? images.small;
  return images.normal ?? images.large ?? images.small;
}
