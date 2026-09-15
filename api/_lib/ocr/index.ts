import { googleVisionOcrProvider } from "./googleVision.js";
import { stubOcrProvider } from "./stub.js";
import type { OcrProvider } from "./types.js";

// Single place recognition code resolves its OCR provider. Real whenever
// GOOGLE_CLOUD_VISION_API_KEY is configured; the honest stub otherwise —
// never a silent fake-success fallback in production.
export const ocrProvider: OcrProvider = googleVisionOcrProvider.implemented
  ? googleVisionOcrProvider
  : stubOcrProvider;

export type { OcrProvider, OcrTextResult } from "./types.js";
