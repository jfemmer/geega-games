// Shared types for the on-PC card recognizer.
//
// The recognizer identifies a scanned Magic card by its PICTURE rather than by
// reading its text: every paper printing in the shop's Scryfall card list gets
// a visual fingerprint (built once on this PC, see indexBuilder.ts), a scan is
// fingerprinted the same way, and the closest printings are then checked
// pixel-by-pixel (verify.ts) to pick the exact printing among reprints. Text
// (collectorOcr.ts) is read only to settle printings that still look
// identical and to double-check a sure match against the set code printed on
// modern cards.

/** 8-bit RGB pixels, row-major, 3 bytes per pixel. */
export interface RgbImage {
  width: number;
  height: number;
  data: Uint8Array;
}

/** 8-bit grayscale pixels, row-major. */
export interface GrayImage {
  width: number;
  height: number;
  data: Uint8Array;
}

export interface Point {
  x: number;
  y: number;
}

/**
 * A rectangle rotated by `angle` radians around its center. `width` runs
 * along the rectangle's own x-axis (cos angle, sin angle) and `height` along
 * its y-axis (-sin angle, cos angle) — image coordinates, y pointing down.
 */
export interface RotatedRect {
  cx: number;
  cy: number;
  width: number;
  height: number;
  angle: number;
}

/** What the person picked for a whole batch next to "Scan now". */
export type BatchFinish = "nonfoil" | "foil";

/** One face of one paper printing in the fingerprint library. */
export interface CatalogEntry {
  /** Scryfall printing id. */
  id: string;
  /** 0 for a single-faced card or the front face; 1 for the back face. */
  face: number;
  name: string;
  /** Upper-case set code, as stored in scryfall_bulk_cards. */
  set: string;
  /** Collector number exactly as Scryfall has it ("138", "138a", "★7"). */
  cn: string;
  lang: string;
  /** Scryfall illustration id of this face — same art across reprints. */
  ill: string | null;
  /** Scryfall "normal" (488×680) image of this face. */
  img: string;
  finishes: string[];
  layout: string;
}

export type Decision = "sure" | "check" | "none";

export interface LocalCandidate {
  scryfallId: string;
  /** 0–1. "sure" results keep every other candidate at least 0.15 below the top. */
  confidence: number;
  reason: string;
  /** Pixel-level agreement with the scan after alignment, 0–1. */
  visual: number | null;
  /** Fingerprint (embedding) cosine similarity, roughly -1–1. */
  similarity: number | null;
  /** Which face of the printing matched the scan. */
  face: number;
}

/**
 * Sent to POST /api/admin/scans/:id/recognize as `{ local: ... }`. The server
 * validates every field (api/_lib/recognition/localResult.ts) and re-loads
 * each printing from its own Scryfall index — nothing here is trusted as-is.
 */
export interface LocalRecognitionResult {
  engine: "scanner_pc";
  engineVersion: string;
  decision: Decision;
  candidates: LocalCandidate[];
  decisionReason: string;
  warnings: string[];
  visualSimilarity: number | null;
  /** The batch's foil / non-foil setting when this card was scanned. */
  finish: BatchFinish | null;
  /** 180 when the card went through the feeder upside down. */
  orientation: 0 | 180;
  /** True when the scanner's second side turned out to be the card's face. */
  sidesSwapped: boolean;
  /** Which uploaded sides are already cropped and straightened by this PC. */
  straightened: { front: boolean; back: boolean };
  ocrText: string | null;
  timingsMs: Record<string, number>;
  library: { builtAt: string | null; entries: number; model: string };
}
