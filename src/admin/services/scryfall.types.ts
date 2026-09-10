// Raw Scryfall API response shapes.
//
// These mirror the subset of the Scryfall REST API that Geega consumes. They
// are intentionally kept SEPARATE from the Geega domain model (../types). Raw
// responses never leak into React components — everything passes through
// normalizeScryfallCard() first (see ./scryfall.ts).
//
// Reference: https://scryfall.com/docs/api/cards

/** Scryfall image_uris object. All keys optional per layout. */
export interface ScryfallImageUris {
  small?: string;
  normal?: string;
  large?: string;
  png?: string;
  art_crop?: string;
  border_crop?: string;
}

/** One face of a multi-faced Scryfall card. */
export interface ScryfallCardFace {
  name: string;
  mana_cost?: string;
  type_line?: string;
  oracle_text?: string;
  artist?: string;
  illustration_id?: string;
  image_uris?: ScryfallImageUris;
}

export interface ScryfallPrices {
  usd?: string | null;
  usd_foil?: string | null;
  usd_etched?: string | null;
  eur?: string | null;
  tix?: string | null;
}

/** A single Scryfall card object (one printing). */
export interface ScryfallCard {
  object: "card";
  id: string;
  oracle_id?: string;
  name: string;
  printed_name?: string;
  lang: string;
  released_at?: string;
  layout: string;
  mana_cost?: string;
  type_line?: string;
  oracle_text?: string;
  rarity: string;
  set: string;
  set_name: string;
  set_id?: string;
  collector_number: string;
  artist?: string;
  illustration_id?: string;
  image_uris?: ScryfallImageUris;
  card_faces?: ScryfallCardFace[];
  finishes?: string[];
  foil?: boolean;
  nonfoil?: boolean;
  frame?: string;
  frame_effects?: string[];
  border_color?: string;
  full_art?: boolean;
  textless?: boolean;
  promo?: boolean;
  promo_types?: string[];
  variation?: boolean;
  variation_of?: string;
  prices?: ScryfallPrices;
}

/** Scryfall list response envelope (e.g. /cards/search). */
export interface ScryfallList {
  object: "list";
  total_cards?: number;
  has_more: boolean;
  next_page?: string;
  data: ScryfallCard[];
  warnings?: string[];
}

/** Scryfall error envelope. */
export interface ScryfallError {
  object: "error";
  code: string;
  status: number;
  details: string;
  warnings?: string[];
}
