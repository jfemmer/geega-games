import path from "node:path";
import { fileURLToPath } from "node:url";
import { createWorker, PSM, type Worker, type WorkerParams } from "tesseract.js";
import type { OcrHint, OcrProvider, OcrTextResult } from "./types.js";

// Free, local, zero-cost OCR — the default provider (see index.ts): no API
// key, no account, no per-call billing, ever. Trained-language data is
// bundled in ./data/eng.traineddata.gz rather than fetched from a CDN at
// runtime, so recognition needs no external network call and has no
// per-invocation download latency on a cold start.
//
// TWO separate sets of files here are loaded via a dynamic path deep inside
// tesseract.js/tesseract.js-core, not a static JS import — Vercel's file
// tracer can't see either one, so BOTH must be listed in vercel.json's
// `includeFiles` for this function or the deployed bundle silently omits
// them: this file's own ./data/*.traineddata.gz, AND tesseract.js-core's
// own .wasm engine binaries (node_modules/tesseract.js-core/**). Missing
// the second one doesn't fail fast — every real OCR call hangs until
// Vercel's platform-level function timeout kills it (confirmed against
// production logs: "ENOENT ... tesseract-core-relaxedsimd.wasm", ending in
// "Task timed out after 300 seconds", not a fast, catchable error), so if
// OCR ever seems to hang rather than error, check this first.
//
// Verified during development against realistic simulated crops (a card
// title and a dense collector-line string) with 90%+ Tesseract-reported
// confidence and fully correct reads, and against 5 concurrent recognize()
// calls on one worker (exactly what ocrRegion's multi-variant pass does) —
// each call gets its own correct, uncorrupted result.
//
// Accuracy is genuinely good on clean printed text but isn't guaranteed to
// match a commercial API on every foil-glare/low-contrast case — that's
// exactly why OCR is only ONE signal here, never the final word: visual
// verification against the real Scryfall reference image (verification.ts)
// is what actually confirms an exact printing. A weaker OCR read just means
// more scans land in manual review — never a wrong auto-match.

const DATA_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "data");

// One worker PER DISTINCT TUNING — created lazily on first use and reused
// for the process's lifetime (a Vercel function instance handles many
// invocations while warm), same as the original single-worker design.
// Concurrent recognize() calls on any ONE worker are safe — verified
// directly — but that guarantee depends on a worker's parameters never
// changing after creation, so region-specific tuning (page-segmentation
// mode, character whitelist — see OcrHint) needs its OWN worker rather than
// mutating a shared one mid-flight: tesseract.js has no per-call parameter
// override, only setParameters(), which is worker-scoped (see
// WorkerParams/recognize()'s RecognizeOptions, which carries no PSM/
// whitelist field of its own). Still no need for tesseract.js's multi-worker
// Scheduler — this is a small fixed set of purpose-built workers, not a
// pool for throughput.
const workerCache = new Map<string, Promise<Worker>>();

function workerCacheKey(hint?: OcrHint): string {
  return `${hint?.shape ?? "auto"}|${hint?.charWhitelist ?? ""}`;
}

function getWorker(hint?: OcrHint): Promise<Worker> {
  const key = workerCacheKey(hint);
  let worker = workerCache.get(key);
  if (!worker) {
    worker = (async () => {
      const w = await createWorker("eng", undefined, {
        langPath: DATA_DIR,
        gzip: true,
        // The deployed bundle directory is read-only; /tmp is the one
        // writable path Vercel functions get.
        cachePath: "/tmp",
      });

      const params: Partial<WorkerParams> = {};
      // Both fields this pipeline ever OCRs (title, collector line — see
      // ocrFields.ts) are cropped to a single horizontal text line (see
      // imageRegions.ts's REGIONS rectangles). Tesseract's default
      // page-segmentation mode does fully-automatic multi-block layout
      // analysis, built for a whole page/photo — effort a thin single-line
      // crop doesn't need and that only adds mis-segmentation risk. Forcing
      // SINGLE_LINE is a well-established accuracy win on exactly this
      // shape of input.
      if (hint?.shape === "line") {
        params.tessedit_pageseg_mode = PSM.SINGLE_LINE;
      }
      // The collector line's character set is fully known ahead of time
      // (digits, a handful of uppercase letters, "/", spaces — see
      // parseCollectorLine in ocrFields.ts) — a whitelist removes
      // Tesseract's most common failure mode on this exact field (0/O,
      // 1/I, B/8 glyph confusion) by making the confused character simply
      // illegal, rather than hoping context disambiguates it. Never applied
      // to the title: a card name is free-form text where almost any
      // character (accents, punctuation, apostrophes) is legitimate.
      if (hint?.charWhitelist) {
        params.tessedit_char_whitelist = hint.charWhitelist;
      }
      if (Object.keys(params).length > 0) {
        await w.setParameters(params);
      }
      return w;
    })();
    workerCache.set(key, worker);
  }
  return worker;
}

export const tesseractOcrProvider: OcrProvider = {
  name: "tesseract",
  implemented: true,

  async recognizeText(image: Buffer, _mimeType: string, hint?: OcrHint): Promise<OcrTextResult> {
    const worker = await getWorker(hint);
    const { data } = await worker.recognize(image);
    const text = data.text.trim();
    if (!text) return { text: "", confidence: 0 };
    // Tesseract reports confidence 0-100; never fabricate a nonzero
    // confidence for an empty read.
    return { text, confidence: Math.max(0, Math.min(1, data.confidence / 100)) };
  },
};
