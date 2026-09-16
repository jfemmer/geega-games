import { googleVisionOcrProvider } from "./googleVision.js";
import { tesseractOcrProvider } from "./tesseractProvider.js";
import type { OcrProvider } from "./types.js";

// Single place recognition code resolves its OCR provider.
//
// Default: tesseract (free, local, zero API cost, no account/key needed —
// see tesseractProvider.ts). Opt-in upgrade: Google Cloud Vision, used
// automatically once GOOGLE_CLOUD_VISION_API_KEY is configured, for
// whoever wants to trade a small per-card cost for a commercial API. Either
// way `implemented` is always true now — there's no more "unavailable"
// stub state in production, since a free provider always works.
export const ocrProvider: OcrProvider = googleVisionOcrProvider.implemented
  ? googleVisionOcrProvider
  : tesseractOcrProvider;

export type { OcrProvider, OcrTextResult } from "./types.js";
