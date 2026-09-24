import type { OcrHint, OcrProvider } from "../ocr/index.js";
import { cropRegion, preprocessVariants, type RegionName } from "./imageRegions.js";

// Multi-pass OCR per field (Part 6.2). Runs OCR against several
// preprocessing variants of the SAME crop and keeps the highest-confidence
// read — a single pass can fail on foil glare, faint ink, or low contrast
// where a different variant succeeds, and averaging blindly would let a bad
// pass drag down a good one. Confidence is never inflated past what the OCR
// provider itself reports for the winning pass.

export interface FieldOcrResult {
  text: string;
  confidence: number;
  /** Which preprocessing pass produced the winning read, for debugging. */
  winningVariant: string;
}

const EMPTY_RESULT: FieldOcrResult = { text: "", confidence: 0, winningVariant: "none" };

// Every field this pipeline OCRs is cropped to a single horizontal text
// line (see imageRegions.ts's REGIONS), so all hint "line" — an engine
// that can act on it (currently only Tesseract; see tesseractProvider.ts)
// gets a real accuracy win from skipping general page-layout analysis it
// doesn't need. Only collectorInfo also gets a character whitelist: its
// format is fully known (digits, a handful of uppercase letters, "/",
// spaces — see parseCollectorLine below), unlike a card name or an artist
// credit (collectorInfoLine2), both free-form text where lowercase letters
// and accents are legitimate.
const REGION_OCR_HINTS: Partial<Record<RegionName, OcrHint>> = {
  title: { shape: "line" },
  collectorInfo: { shape: "line", charWhitelist: "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ/ " },
  collectorInfoLine2: { shape: "line" },
};

/** OCR one region, trying every preprocessing variant, keeping the best read. */
export async function ocrRegion(
  provider: OcrProvider,
  normalizedCard: Buffer,
  width: number,
  height: number,
  region: RegionName,
): Promise<FieldOcrResult> {
  if (!provider.implemented) return EMPTY_RESULT;

  const crop = await cropRegion(normalizedCard, width, height, region);
  const variants = await preprocessVariants(crop);
  const hint = REGION_OCR_HINTS[region];

  const attempts = await Promise.allSettled(
    Object.entries(variants).map(async ([variantName, buf]) => {
      const result = await provider.recognizeText(buf, "image/png", hint);
      return { variantName, ...result };
    }),
  );

  let best: FieldOcrResult = EMPTY_RESULT;
  for (const attempt of attempts) {
    if (attempt.status !== "fulfilled") continue;
    const { variantName, text, confidence } = attempt.value;
    if (!text) continue;
    if (confidence > best.confidence) {
      best = { text, confidence, winningVariant: variantName };
    }
  }
  return best;
}

/**
 * OCR the fields the recognition pipeline actually cares about, in parallel.
 * Deliberately just title + the two collector-line halves — generateCandidates()
 * only ever reads those, so OCR'ing typeLine/footer too (as this used to do)
 * cost a full extra 2 regions x 5 preprocessing variants of billable Vision
 * API calls per card for results nothing consumed. Add a field back here
 * only once something downstream actually reads it.
 */
export async function ocrCardFields(
  provider: OcrProvider,
  normalizedCard: Buffer,
  width: number,
  height: number,
): Promise<{
  title: FieldOcrResult;
  collectorInfo: FieldOcrResult;
  collectorInfoLine2: FieldOcrResult;
}> {
  const [title, collectorInfo, collectorInfoLine2] = await Promise.all([
    ocrRegion(provider, normalizedCard, width, height, "title"),
    ocrRegion(provider, normalizedCard, width, height, "collectorInfo"),
    ocrRegion(provider, normalizedCard, width, height, "collectorInfoLine2"),
  ]);
  return { title, collectorInfo, collectorInfoLine2 };
}

/**
 * Parse the modern (M15+) lower-left collector line — typically something
 * like "138/281 M MH2 EN" (collector number / set size, rarity letter, set
 * code, language) — into its parts. Best-effort and conservative: a field
 * that can't be parsed confidently comes back null rather than a guess.
 * Handles the most common layout; unusual ones fall through to null (the
 * pipeline then relies on candidate generation from OTHER signals).
 */
export function parseCollectorLine(raw: string): {
  collectorNumber: string | null;
  rarity: string | null;
  setCode: string | null;
  language: string | null;
} {
  const cleaned = raw.replace(/\s+/g, " ").trim();
  // Confidence gating already happened on the OCR result before this is
  // called — this is just "is there enough text to even try parsing".
  if (!cleaned || cleaned.length < 2) {
    return { collectorNumber: null, rarity: null, setCode: null, language: null };
  }

  // number(/total)?  — collector number, optionally over a set total.
  const numberMatch = cleaned.match(/(\d{1,4})(?:\s*\/\s*\d{1,4})?/);
  const collectorNumber = numberMatch ? numberMatch[1].replace(/^0+(?=\d)/, "") : null;

  // A standalone single-letter rarity code (C/U/R/M/S), not part of a word.
  const rarityMatch = cleaned.match(/(?:^|\s)([CURMS])(?:\s|$)/);
  const rarityCode = rarityMatch ? rarityMatch[1] : null;
  const rarity =
    rarityCode &&
    ({ C: "common", U: "uncommon", R: "rare", M: "mythic", S: "special" } as const)[
      rarityCode as "C" | "U" | "R" | "M" | "S"
    ];

  // A standalone 2-letter language code, usually the last token on the line.
  const langMatch = cleaned.match(/(?:^|\s)([A-Z]{2})(?:\s|$)/);
  const language = langMatch ? langMatch[1].toLowerCase() : null;

  // The set code: a 3–5 letter/digit uppercase token that ISN'T the rarity
  // letter or language code already matched above.
  const tokens = cleaned.match(/[A-Z0-9]{3,5}/g) ?? [];
  const setCode =
    tokens.find(
      (t) => t !== rarityCode && t.toLowerCase() !== language && !/^\d+$/.test(t),
    ) ?? null;

  return { collectorNumber, rarity: rarity || null, setCode, language };
}
