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

export const SELL_FINISH_OPTIONS: { value: string; label: string }[] = [
  { value: "nonfoil", label: "Nonfoil" },
  { value: "foil", label: "Foil" },
  { value: "etched", label: "Etched" },
];
