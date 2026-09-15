// LIVE CardRecognitionProvider — calls the real recognition pipeline
// (api/_lib/recognition/) via the staff-gated /api/admin/scans/:id/recognize
// endpoint. `implemented` mirrors whether a real OCR provider is actually
// configured server-side; when it isn't, recognize() still calls the
// endpoint (which will mark the scan recognition_status='failed' with a
// clear warning) rather than lying about being unavailable — the SERVER is
// the authority on whether OCR is configured, not a guess made client-side.

import { adminFetch } from "./apiClient";
import type { CardScan, CardRecognitionResult } from "../types";
import type { CardRecognitionProvider } from "./types";

export const supabaseRecognitionProvider: CardRecognitionProvider = {
  name: "geega-recognition-pipeline",
  implemented: true,

  async recognize(scan: CardScan): Promise<CardRecognitionResult> {
    const updated = await adminFetch<{ recognition_data: CardRecognitionResult | null }>(
      `/api/admin/scans/${scan.id}/recognize`,
      { method: "POST" },
    );
    return (
      updated.recognition_data ?? {
        detectedName: null,
        detectedSetCode: null,
        detectedCollectorNumber: null,
        detectedLanguage: null,
        finishGuess: null,
        candidatePrintings: [],
        confidence: 0,
        fieldConfidence: {},
        warnings: ["No recognition data returned."],
      }
    );
  },

  async queueRecognition(scanId: string): Promise<void> {
    await adminFetch(`/api/admin/scans/${scanId}/recognize`, { method: "POST" });
  },
};
