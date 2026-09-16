// Row <-> domain mapping for the LIVE scan pipeline (public.scan_sessions /
// public.card_scans, plus the joined public.card_printings for a scan's
// selected match). Kept pure and shared so scan.supabase.ts and its tests
// map rows identically — mirrors inventory.mapper.ts's pattern.

import type {
  CardCondition,
  CardFace,
  CardFinish,
  CardImageUris,
  CardPrinting,
  CardRecognitionResult,
  CardScan,
  ConditionFindings,
  PrintingTreatment,
  RecognitionStatus,
  ScanRecognitionMode,
  ScanReviewStatus,
  ScanSession,
  ScanSessionStatus,
  ScanSourceType,
} from "../types";
import { normalizeRarity } from "./inventory.mapper";

export interface ScanSessionRowLike {
  id: string;
  label: string;
  created_by: string | null;
  scanner_name: string | null;
  source_type: ScanSourceType;
  scan_mode: ScanRecognitionMode;
  status: ScanSessionStatus;
  total_files: number;
  total_cards: number;
  reviewed_cards: number;
  matched_cards: number;
  ready_cards: number;
  added_cards: number;
  rejected_cards: number;
  failed_cards: number;
  note: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

export function mapScanSessionRow(row: ScanSessionRowLike): ScanSession {
  return {
    id: row.id,
    label: row.label,
    createdBy: row.created_by ?? "",
    scannerName: row.scanner_name,
    sourceType: row.source_type,
    scanMode: row.scan_mode,
    status: row.status,
    totalFiles: row.total_files,
    totalCards: row.total_cards,
    reviewedCards: row.reviewed_cards,
    matchedCards: row.matched_cards,
    readyCards: row.ready_cards,
    addedCards: row.added_cards,
    rejectedCards: row.rejected_cards,
    failedCards: row.failed_cards,
    note: row.note,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at,
  };
}

/** Superset of public.card_printings' columns (as stored by cachePrinting). */
export interface CardPrintingRowLike {
  scryfall_id: string;
  oracle_id: string | null;
  card_name: string;
  set_code: string;
  set_name: string | null;
  collector_number: string;
  rarity: string | null;
  card_type: string | null;
  layout: string | null;
  artist: string | null;
  released_at: string | null;
  language: string | null;
  frame: string | null;
  frame_effects: string[];
  border_color: string | null;
  full_art: boolean;
  textless: boolean;
  promo: boolean;
  promo_types: string[];
  treatments: string[];
  available_finishes: string[];
  images: unknown;
  faces: unknown;
  price_usd_cents: number | null;
  price_usd_foil_cents: number | null;
  price_usd_etched_cents: number | null;
}

const EMPTY_IMAGES: CardImageUris = {
  small: null,
  normal: null,
  large: null,
  png: null,
  artCrop: null,
};

/** Map a stored card_printings row back to the domain CardPrinting shape. */
export function mapCardPrintingRow(row: CardPrintingRowLike): CardPrinting {
  const images = (row.images as CardImageUris | null) ?? EMPTY_IMAGES;
  const faces = (row.faces as CardFace[] | null) ?? [];
  const imageUrl =
    images.normal ?? images.large ?? images.small ?? images.png ?? "";
  return {
    id: row.scryfall_id,
    cardName: row.card_name,
    setName: row.set_name ?? "",
    setCode: row.set_code,
    collectorNumber: row.collector_number,
    rarity: normalizeRarity(row.rarity) ?? "common",
    cardType: row.card_type ?? "",
    imageUrl,
    availableFinishes: row.available_finishes as CardFinish[],
    scryfallPriceCents: row.price_usd_cents,
    scryfallId: row.scryfall_id,
    oracleId: row.oracle_id,
    images,
    faces,
    layout: row.layout ?? "",
    artist: row.artist,
    releasedAt: row.released_at,
    language: row.language ?? "en",
    frame: row.frame,
    frameEffects: row.frame_effects,
    borderColor: row.border_color,
    fullArt: row.full_art,
    textless: row.textless,
    promo: row.promo,
    promoTypes: row.promo_types,
    treatments: row.treatments as PrintingTreatment[],
    prices: {
      usd: row.price_usd_cents,
      usdFoil: row.price_usd_foil_cents,
      usdEtched: row.price_usd_etched_cents,
    },
  };
}

export interface CardScanRowLike {
  id: string;
  scan_session_id: string;
  sequence_number: number;
  front_image_path: string | null;
  back_image_path: string | null;
  selected_scryfall_id: string | null;
  recognition_status: RecognitionStatus;
  recognition_confidence: number | null;
  recognition_data: unknown;
  suggested_condition: CardCondition | null;
  suggested_condition_confidence: number | null;
  condition_findings: unknown;
  confirmed_condition: CardCondition | null;
  selected_finish: CardFinish | null;
  quantity: number;
  price_cents: number | null;
  cost_cents: number | null;
  storage_location: string | null;
  notes: string | null;
  review_status: ScanReviewStatus;
  reviewed_by: string | null;
  reviewed_at: string | null;
  inventory_item_id: string | null;
  created_at: string;
  updated_at: string;
  /** Embedded via `card_printings!selected_scryfall_id(*)`; null until matched. */
  card_printings?: CardPrintingRowLike | CardPrintingRowLike[] | null;
}

/**
 * Map a card_scans row (with an optionally-embedded card_printings join) to
 * the domain CardScan. Signed front/back URLs are resolved separately in
 * bulk (see scan.supabase.ts) and passed in here since minting them is async
 * and best done for a whole page of rows in one Storage call.
 */
export function mapCardScanRow(
  row: CardScanRowLike,
  images: { frontImageUrl: string | null; backImageUrl: string | null },
): CardScan {
  const printingRow = Array.isArray(row.card_printings)
    ? (row.card_printings[0] ?? null)
    : (row.card_printings ?? null);

  return {
    id: row.id,
    scanSessionId: row.scan_session_id,
    sequenceNumber: row.sequence_number,
    frontImagePath: row.front_image_path,
    backImagePath: row.back_image_path,
    frontImageUrl: images.frontImageUrl,
    backImageUrl: images.backImageUrl,
    selectedScryfallId: row.selected_scryfall_id,
    selectedPrinting: printingRow ? mapCardPrintingRow(printingRow) : null,
    recognitionStatus: row.recognition_status,
    recognitionConfidence: row.recognition_confidence,
    recognitionData: row.recognition_data as CardRecognitionResult | null,
    suggestedCondition: row.suggested_condition,
    suggestedConditionConfidence: row.suggested_condition_confidence,
    conditionFindings: (row.condition_findings as ConditionFindings | null) ?? null,
    confirmedCondition: row.confirmed_condition,
    selectedFinish: row.selected_finish,
    quantity: row.quantity,
    priceCents: row.price_cents,
    costCents: row.cost_cents,
    storageLocation: row.storage_location,
    notes: row.notes,
    reviewStatus: row.review_status,
    reviewedBy: row.reviewed_by,
    reviewedAt: row.reviewed_at,
    inventoryItemId: row.inventory_item_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
