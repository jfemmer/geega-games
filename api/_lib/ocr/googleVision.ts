import { HttpError } from "../http.js";
import { ServerEnv } from "../env.js";
import type { OcrHint, OcrProvider, OcrTextResult } from "./types.js";

// Google Cloud Vision REST adapter — DOCUMENT_TEXT_DETECTION, chosen over
// plain TEXT_DETECTION because its response includes a real per-page
// confidence value (verified against Google's own text_annotation.proto:
// Page/Block/Paragraph/Word/Symbol all carry a float confidence in [0, 1]),
// which the recognition pipeline needs for field-level confidence — never
// selecting a printing on a weak OCR guess.
//
// Auth via a simple API key in the query string (the documented, simplest
// Vision API auth mode) rather than a full service-account/OAuth flow — the
// key is a server-only env var, never sent to the browser.

const ENDPOINT = "https://vision.googleapis.com/v1/images:annotate";
const REQUEST_TIMEOUT_MS = 10_000;

interface VisionPage {
  confidence?: number;
}

interface VisionAnnotateResponse {
  responses: {
    fullTextAnnotation?: {
      text?: string;
      pages?: VisionPage[];
    };
    error?: { message?: string };
  }[];
}

function apiKey(): string | null {
  const key = ServerEnv.googleCloudVisionApiKey();
  return key || null;
}

// mimeType isn't sent — Vision auto-detects image format from the bytes —
// so it's only a parameter on the public recognizeText() below, to satisfy
// the shared OcrProvider interface other adapters may need it for.
async function callVision(
  image: Buffer,
): Promise<VisionAnnotateResponse["responses"][number]> {
  const key = apiKey();
  if (!key) {
    throw new HttpError(503, "Google Cloud Vision is not configured.");
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(`${ENDPOINT}?key=${encodeURIComponent(key)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        requests: [
          {
            image: { content: image.toString("base64") },
            features: [{ type: "DOCUMENT_TEXT_DETECTION", maxResults: 1 }],
          },
        ],
      }),
    });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new HttpError(504, "Google Cloud Vision took too long to respond.");
    }
    throw new HttpError(502, "Could not reach Google Cloud Vision.");
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    throw new HttpError(502, `Google Cloud Vision request failed (${res.status}).`);
  }
  const body = (await res.json()) as VisionAnnotateResponse;
  const first = body.responses?.[0];
  if (!first) throw new HttpError(502, "Google Cloud Vision returned no result.");
  if (first.error) {
    throw new HttpError(502, `Google Cloud Vision error: ${first.error.message}`);
  }
  return first;
}

export const googleVisionOcrProvider: OcrProvider = {
  name: "google-vision",
  get implemented() {
    return apiKey() !== null;
  },

  // _hint is unused: DOCUMENT_TEXT_DETECTION already handles both a single
  // line and a denser block well without a page-segmentation hint, and
  // Vision has no equivalent of a character whitelist in this API mode.
  async recognizeText(image: Buffer, _mimeType: string, _hint?: OcrHint): Promise<OcrTextResult> {
    const result = await callVision(image);
    const text = result.fullTextAnnotation?.text?.trim() ?? "";
    if (!text) return { text: "", confidence: 0 };

    // Average the per-page confidence Google reports (usually one page for
    // a single-region crop). Falls back to a conservative fixed estimate
    // only if Google omits confidence entirely for this response — never
    // fabricates a HIGH confidence when the field is simply absent.
    const pages = result.fullTextAnnotation?.pages ?? [];
    const withConfidence = pages.filter(
      (p): p is Required<VisionPage> => typeof p.confidence === "number",
    );
    const confidence =
      withConfidence.length > 0
        ? withConfidence.reduce((sum, p) => sum + p.confidence, 0) /
          withConfidence.length
        : 0.5;

    return { text, confidence };
  },
};
