// OCR provider abstraction — lets the recognition pipeline compare/replace
// OCR engines without rewriting anything upstream. One real implementation
// (googleVision.ts) plus an honest stub (stub.ts), selected in index.ts.

export interface OcrTextResult {
  /** Best-effort extracted text, "" when nothing was confidently read. */
  text: string;
  /** 0–1. Never fabricated — 0 when the provider gives no real signal. */
  confidence: number;
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
  recognizeText(image: Buffer, mimeType: string): Promise<OcrTextResult>;
}
