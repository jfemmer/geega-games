// OCR provider abstraction — lets the recognition pipeline compare/replace
// OCR engines without rewriting anything upstream. Two real implementations
// (tesseractProvider.ts, the free default; googleVision.ts, opt-in paid),
// selected in index.ts.

export interface OcrTextResult {
  /** Best-effort extracted text, "" when nothing was confidently read. */
  text: string;
  /** 0–1. Never fabricated — 0 when the provider gives no real signal. */
  confidence: number;
}

/**
 * Optional, best-effort guidance about the field being read — a provider is
 * free to ignore any/all of it (Google Vision's DOCUMENT_TEXT_DETECTION
 * already handles both shapes well without hinting); only tesseractProvider
 * currently acts on it, since Tesseract's default page-segmentation mode is
 * tuned for a whole page/photo rather than a thin single-line crop.
 */
export interface OcrHint {
  /** The field's expected text shape. */
  shape?: "line" | "block";
  /**
   * Restrict recognition to exactly these characters, when the field's
   * format is fully known (e.g. a collector line is always digits, a
   * handful of letters, "/", and spaces) — removes lookalike-glyph
   * ambiguity (0/O, 1/I, B/8) entirely rather than hoping context
   * disambiguates it. Omit for free-form text like a card name.
   */
  charWhitelist?: string;
}

export interface OcrProvider {
  /** Human-readable id, e.g. "google-vision" or "stub". */
  readonly name: string;
  /** Whether this provider can actually run (has credentials configured). */
  readonly implemented: boolean;
  /**
   * Run OCR on ONE already-cropped region (title crop, collector-line crop,
   * etc.) and return its text + confidence. Never throws for "no text found"
   * — that's a valid (empty, 0-confidence) result; throws only for a real
   * provider/network failure so callers can distinguish "read nothing" from
   * "couldn't even try".
   */
  recognizeText(image: Buffer, mimeType: string, hint?: OcrHint): Promise<OcrTextResult>;
}
