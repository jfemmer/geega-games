// Shared types + tiny helpers for the Sell Your Cards / Sell Your Collection flow.
//
// Deliberately independent of src/admin's types — the storefront and admin
// dashboard are separate bundles (the admin bundle is lazy-loaded and never
// downloaded by a storefront visitor), so this file defines its own
// lightweight shapes rather than importing from ../../admin/*.

/** A single exact Scryfall printing, as returned by /api/sell/scryfall-search. */
export interface SellPrinting {
  scryfallId: string;
  cardName: string;
  setName: string;
  setCode: string;
  collectorNumber: string;
  rarity: string;
  imageUrl: string | null;
  availableFinishes: string[];
  treatments: string[];
  scryfallPriceCents: number | null;
  /** ISO date ("YYYY-MM-DD") the printing was released, or null if Scryfall doesn't have one. */
  releasedAt: string | null;
}

export type SellCondition = "NM" | "LP" | "MP" | "HP" | "DMG" | null;

export type SellCardMatchStatus = "matched" | "ambiguous" | "unmatched";

/** One line in the seller's card list — matched to an exact printing, or not. */
export interface SellCardLine {
  /** Client-only id for list management (React key, edit/remove). */
  localId: string;
  scryfallId: string | null;
  cardName: string;
  setCode: string | null;
  setName: string | null;
  collectorNumber: string | null;
  imageUrl: string | null;
  condition: SellCondition;
  finish: string;
  quantity: number;
  scryfallPriceCents: number | null;
  sellerNotes: string;
  matchStatus: SellCardMatchStatus;
  /** The original pasted/typed text, preserved whenever a line isn't a clean match. */
  rawInput: string | null;
  /** ISO date ("YYYY-MM-DD") the printing was released, or null when unknown. */
  releasedAt: string | null;
}

export type SellPhotoStatus = "pending" | "uploading" | "uploaded" | "error";

/** A photo attached client-side. Never persisted to localStorage. */
export interface SellPhoto {
  localId: string;
  file: File;
  previewUrl: string;
  status: SellPhotoStatus;
  errorMessage?: string;
  /** Storage path once the signed upload has completed. */
  uploadedPath?: string;
  originalFilename: string;
  /** Set when attached to a specific card (SellCardLine.localId) rather than the general collection uploader. */
  cardLocalId: string | null;
  /** Which side of the card this is — only meaningful when cardLocalId is set. */
  side: "front" | "back" | null;
}

export interface SellContactInfo {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  preferredContactMethod: "email" | "phone" | "text";
  city: string;
  state: string;
  zip: string;
  transactionPreference: "local" | "ship" | "either" | "not_sure";
}

export interface SellCollectionInfo {
  collectionSize: string; // one of SELL_COLLECTION_SIZE_OPTIONS[].value, or ""
  collectionTypes: string[];
  collectionEras: string[];
  timeline: string; // one of SELL_TIMELINE_OPTIONS[].value, or ""
  valuableCardsNotes: string;
  notes: string;
  referralSource: string;
}

/** Everything that gets persisted to localStorage between steps/refreshes. */
export interface SellDraft {
  draftId: string;
  contact: SellContactInfo;
  collection: SellCollectionInfo;
  cards: SellCardLine[];
  agreedToTerms: boolean;
}

/** A client-only id for React keys / list management — never sent to the server. */
export function newLocalId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function emptyContact(): SellContactInfo {
  return {
    firstName: "",
    lastName: "",
    email: "",
    phone: "",
    preferredContactMethod: "email",
    city: "",
    state: "",
    zip: "",
    transactionPreference: "not_sure",
  };
}

export function emptyCollection(): SellCollectionInfo {
  return {
    collectionSize: "",
    collectionTypes: [],
    collectionEras: [],
    timeline: "",
    valuableCardsNotes: "",
    notes: "",
    referralSource: "",
  };
}

export const SELL_COLLECTION_SIZE_OPTIONS: { value: string; label: string }[] = [
  { value: "under_100", label: "Under 100 cards" },
  { value: "100_to_500", label: "100–500 cards" },
  { value: "500_to_1000", label: "500–1,000 cards" },
  { value: "1000_to_5000", label: "1,000–5,000 cards" },
  { value: "5000_to_10000", label: "5,000–10,000 cards" },
  { value: "10000_plus", label: "10,000+ cards" },
  { value: "not_sure", label: "Not sure" },
];

// The single source of truth for "large collection" across the admin Buying
// Leads filter (buyingLeads.supabase.ts) and the counter-offer eligibility
// rule (api/sell/respond-to-offer.ts, sell_submission_offer_lookup RPC):
// Counter is only ever offered for a large, unsorted (no card list)
// collection. Both consumers import this rather than each keeping their own
// copy of the threshold.
/**
 * Sellers who take store credit instead of PayPal get this much more. One
 * source of truth for the storefront copy and /api/sell/respond-to-offer,
 * which snapshots it onto the submission when the offer is accepted (so a
 * later change never alters what a seller was promised).
 */
export const STORE_CREDIT_BONUS_PERCENT = 20;

export function storeCreditValueCents(payoutCents: number, bonusPercent = STORE_CREDIT_BONUS_PERCENT): number {
  return Math.round((payoutCents * (100 + bonusPercent)) / 100);
}

export const LARGE_SELL_COLLECTION_SIZES: ReadonlySet<string> = new Set([
  "5000_to_10000",
  "10000_plus",
]);

export const SELL_COLLECTION_TYPE_OPTIONS: { value: string; label: string }[] = [
  { value: "individual_singles", label: "Individual singles" },
  { value: "binder_collection", label: "Binder collection" },
  { value: "commander_decks", label: "Commander decks" },
  { value: "other_constructed_decks", label: "Other constructed decks" },
  { value: "bulk_cards", label: "Bulk cards" },
  { value: "foils", label: "Foils" },
  { value: "vintage_cards", label: "Older / vintage cards" },
  { value: "modern_cards", label: "Modern cards" },
  { value: "sealed_product", label: "Sealed product" },
  { value: "mixed_collection", label: "Mixed collection" },
  { value: "not_sure", label: "Not sure" },
];

export const SELL_ERA_OPTIONS: { value: string; label: string }[] = [
  { value: "mostly_recent", label: "Mostly recent" },
  { value: "2010s", label: "2010s" },
  { value: "2000s", label: "2000s" },
  { value: "1990s", label: "1990s" },
  { value: "mixed", label: "Mixed" },
  { value: "not_sure", label: "Not sure" },
];

export const SELL_TIMELINE_OPTIONS: { value: string; label: string }[] = [
  { value: "asap", label: "As soon as possible" },
  { value: "within_week", label: "Within a week" },
  { value: "within_month", label: "Within a month" },
  { value: "no_rush", label: "No rush" },
];

export const SELL_TRANSACTION_PREFERENCE_OPTIONS: { value: string; label: string }[] = [
  { value: "local", label: "Local / in-person" },
  { value: "ship", label: "Ship the collection" },
  { value: "either", label: "Either is fine" },
  { value: "not_sure", label: "Not sure yet" },
];

export const SELL_REFERRAL_OPTIONS: string[] = [
  "Facebook",
  "Google",
  "Friend/referral",
  "Previous customer",
  "Local event",
  "Other",
];

export const SELL_CONDITION_OPTIONS: { value: SellCondition; label: string }[] = [
  { value: "NM", label: "Near Mint" },
  { value: "LP", label: "Lightly Played" },
  { value: "MP", label: "Moderately Played" },
  { value: "HP", label: "Heavily Played" },
  { value: "DMG", label: "Damaged" },
  { value: null, label: "Unsure" },
];

/** The age-based default is always a concrete condition, never "Unsure". */
export type SellDefaultCondition = Exclude<SellCondition, null>;

// Older cards are far more likely to show real wear even when a seller
// remembers them as being in great shape, so a card starts at a condition
// appropriate for its age (owner's rule, updated 2026-09-26):
//   2005 or older          → Heavily Played
//   2006–2015              → Moderately Played
//   2016 – three years ago → Lightly Played
//   the last ~2 years      → Near Mint (brand-new cards)
// The Near Mint cutoff rolls forward each January (NM_RECENT_YEARS), so it
// never goes stale. Every tier is only a starting point: we check each card
// when it arrives, and the offer can go up or down to match.

/** Cards released this year or in the previous NM_RECENT_YEARS years start at Near Mint. */
export const NM_RECENT_YEARS = 2;

export interface AgeConditionTier {
  condition: SellDefaultCondition;
  /** Plain-English year range, e.g. "2005 or earlier". */
  years: string;
}

/** The first release year that starts at Near Mint, as of `now`. */
export function nearMintFromYear(now: Date = new Date()): number {
  return now.getFullYear() - NM_RECENT_YEARS;
}

/** The tiers in display order (oldest first), for explaining them on the site. */
export function ageConditionTiers(now: Date = new Date()): AgeConditionTier[] {
  const nmFrom = nearMintFromYear(now);
  return [
    { condition: "HP", years: "2005 or earlier" },
    { condition: "MP", years: "2006–2015" },
    { condition: "LP", years: `2016–${nmFrom - 1}` },
    { condition: "NM", years: `${nmFrom} and newer` },
  ];
}

export function defaultConditionForReleaseDate(
  releasedAt: string | null,
  now: Date = new Date(),
): SellDefaultCondition {
  const year = releasedAt ? Number.parseInt(releasedAt.slice(0, 4), 10) : NaN;
  if (!Number.isFinite(year)) return "LP";
  if (year <= 2005) return "HP";
  if (year <= 2015) return "MP";
  if (year < nearMintFromYear(now)) return "LP";
  return "NM";
}

const OFFER_CAN_MOVE =
  "We check every card when it arrives — if its condition turns out better or worse than listed, the offer goes up or down to match.";

export function conditionDefaultExplanation(
  defaultCondition: SellDefaultCondition,
  now: Date = new Date(),
): string | null {
  if (defaultCondition === "HP") {
    return `Cards printed in 2005 or earlier almost always show real wear after 20+ years, even when well cared for, so we start these at Heavily Played. If yours is actually in better shape, just add a front and back photo below so we can confirm it. ${OFFER_CAN_MOVE}`;
  }
  if (defaultCondition === "MP") {
    return `Cards from 2006–2015 typically show some age-related wear, so we start these at Moderately Played. If yours is in better shape, just add a front and back photo below so we can confirm it. ${OFFER_CAN_MOVE}`;
  }
  if (defaultCondition === "LP") {
    return `Cards from 2016–${nearMintFromYear(now) - 1} often have light wear from play, so we start these at Lightly Played. If yours is Near Mint, add a front and back photo below so we can confirm it. ${OFFER_CAN_MOVE}`;
  }
  return null;
}

const CONDITION_RANK: Record<SellDefaultCondition, number> = {
  NM: 0,
  LP: 1,
  MP: 2,
  HP: 3,
  DMG: 4,
};

/**
 * Whether a manually-entered card's chosen condition needs photo proof:
 * true whenever the seller claims a condition better than the age-based
 * default. Near Mint always needs photos EXCEPT on brand-new cards, where
 * Near Mint is itself the default (we still check every card on arrival).
 */
export function conditionNeedsPhotos(
  condition: SellCondition,
  defaultCondition: SellDefaultCondition,
): boolean {
  if (condition == null) return false;
  if (condition === "NM") return defaultCondition !== "NM";
  return CONDITION_RANK[condition] < CONDITION_RANK[defaultCondition];
}

/**
 * A single photo of "the card" doesn't prove a condition claim — both sides
 * need to be visible. Satisfied only once a front AND a back photo for this
 * card have both actually finished uploading (not just selected/in-flight).
 */
export function cardPhotoRequirementMet(photos: SellPhoto[], cardLocalId: string): boolean {
  const forCard = photos.filter((p) => p.cardLocalId === cardLocalId && p.status === "uploaded");
  return forCard.some((p) => p.side === "front") && forCard.some((p) => p.side === "back");
}

export const SELL_FINISH_OPTIONS: { value: string; label: string }[] = [
  { value: "nonfoil", label: "Nonfoil" },
  { value: "foil", label: "Foil" },
  { value: "etched", label: "Etched" },
];
