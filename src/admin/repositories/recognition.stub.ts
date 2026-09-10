// Stub CardRecognitionProvider.
//
// Real OCR / visual matching is intentionally NOT implemented in this phase.
// This stub fulfils the CardRecognitionProvider contract so the scan pipeline,
// database columns, and review UI can already carry recognition data. A future
// provider (e.g. a Vercel Function calling a vision model, then matching
// candidates to Scryfall ids) can replace this with NO interface changes.
//
// `queueRecognition` is the seam for a future async/batch job pipeline: today it
// is a no-op, but the boundary means a job-based implementation (500 pending
// scans, retryable failures, per-card + session progress) slots in cleanly.

import type { CardRecognitionResult, CardScan } from "../types";
import type { CardRecognitionProvider } from "./types";

/** An empty, explicitly-unrecognized result. Never fabricates a match. */
export function emptyRecognition(): CardRecognitionResult {
  return {
    detectedName: null,
    detectedSetCode: null,
    detectedCollectorNumber: null,
    detectedLanguage: null,
    finishGuess: null,
    candidatePrintings: [],
    confidence: 0,
    fieldConfidence: {},
    warnings: ["Automated recognition is not implemented yet (stub provider)."],
  };
}

export const stubRecognitionProvider: CardRecognitionProvider = {
  name: "stub",
  implemented: false,

  async recognize(_scan: CardScan): Promise<CardRecognitionResult> {
    // Intentionally returns a low-confidence empty result. Manual matching in
    // the review UI is the identification path in this phase.
    return emptyRecognition();
  },

  async queueRecognition(_scanId: string): Promise<void> {
    // No-op. The future job pipeline attaches here.
    return;
  },
};
