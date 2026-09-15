import type { OcrProvider } from "./types.js";

// Honest "unavailable" OCR provider — same posture as
// src/admin/repositories/recognition.stub.ts: never fabricates text or a
// confidence value. Selected automatically whenever no real OCR provider is
// configured (see ./index.ts), so recognition degrades to manual review
// instead of a silent wrong guess.

export const stubOcrProvider: OcrProvider = {
  name: "stub",
  implemented: false,

  async recognizeText() {
    return { text: "", confidence: 0 };
  },
};
