import { createHash } from "node:crypto";
import { createReadStream, createWriteStream, existsSync, mkdirSync } from "node:fs";
import { readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createRequire } from "node:module";

// The two AI models the recognizer runs, both free and open-source:
//
// * DINOv2-small (Meta, Apache-2.0) — the visual fingerprint. 88 MB, too big
//   for npm, so it's downloaded once from Hugging Face at a pinned commit and
//   checked against its published SHA-256 before it's ever loaded.
// * PaddleOCR PP-OCRv4 text-line recogniser (Apache-2.0) — reads the
//   collector number when needed. Ships inside the @gutenye/ocr-models npm
//   package, pinned (with an integrity hash) in package-lock.json.

export interface ModelSpec {
  id: string;
  url: string;
  sha256: string;
  fileName: string;
  inputSize: number;
}

export const FINGERPRINT_MODEL: ModelSpec = {
  id: "dinov2-small@8b1f705",
  url: "https://huggingface.co/onnx-community/dinov2-small/resolve/8b1f705a3a7f6f062f6bdd21986c1583d3ef105d/onnx/model.onnx",
  sha256: "f22797eabf810a75e41de68d378541ebea372122b25c4ce3ef25ff618250c20a",
  fileName: "dinov2-small.onnx",
  inputSize: 224,
};

/** The most specific reason a network or file operation failed: "ENOTFOUND", "ECONNRESET", … */
export function failureReason(err: unknown): string {
  const e = err as { code?: unknown; message?: unknown; cause?: { code?: unknown; message?: unknown } } | null;
  const code = e?.cause?.code ?? e?.code;
  if (typeof code === "string" && code) return code;
  const message = e?.cause?.message ?? e?.message;
  return typeof message === "string" && message ? message : String(err);
}

async function sha256File(file: string): Promise<string> {
  const hash = createHash("sha256");
  await pipeline(createReadStream(file), hash);
  return hash.digest("hex");
}

export interface DownloadProgress {
  receivedBytes: number;
  totalBytes: number | null;
}

/**
 * Path to the model file, downloading and verifying it first if needed.
 * A file whose hash doesn't match is deleted and never used.
 */
export async function ensureModel(
  modelsDir: string,
  spec: ModelSpec,
  options: { fetchImpl?: typeof fetch; onProgress?: (p: DownloadProgress) => void } = {},
): Promise<string> {
  mkdirSync(modelsDir, { recursive: true });
  const target = path.join(modelsDir, spec.fileName);
  const verifiedMarker = `${target}.verified`;
  if (existsSync(target)) {
    const s = await stat(target);
    const marker = await readFile(verifiedMarker, "utf8").catch(() => "");
    if (marker === `${spec.sha256}:${s.size}:${Math.round(s.mtimeMs)}`) return target;
    if ((await sha256File(target)) === spec.sha256) {
      await writeFile(verifiedMarker, `${spec.sha256}:${s.size}:${Math.round(s.mtimeMs)}`);
      return target;
    }
    await rm(target, { force: true });
  }

  const fetchImpl = options.fetchImpl ?? fetch;
  const host = new URL(spec.url).host;
  let res: Response;
  try {
    res = await fetchImpl(spec.url, { headers: { "User-Agent": "GeegaScannerBridge/1.0" } });
  } catch (err) {
    throw new Error(
      `Couldn't reach ${host} to download the card-recognition model (${failureReason(err)}). Check this PC's internet connection.`,
    );
  }
  if (!res.ok || !res.body) throw new Error(`Couldn't download the card-recognition model from ${host} (HTTP ${res.status}).`);
  const total = Number(res.headers.get("content-length")) || null;
  const tmp = `${target}.download`;
  let received = 0;
  const hash = createHash("sha256");
  const body = Readable.fromWeb(res.body as unknown as import("node:stream/web").ReadableStream<Uint8Array>);
  body.on("data", (chunk: Buffer) => {
    received += chunk.length;
    hash.update(chunk);
    options.onProgress?.({ receivedBytes: received, totalBytes: total });
  });
  try {
    await pipeline(body, createWriteStream(tmp));
  } catch (err) {
    await rm(tmp, { force: true }).catch(() => undefined);
    const reason = failureReason(err);
    throw new Error(
      reason === "ENOSPC"
        ? `There isn't enough free disk space for the card-recognition model (88 MB) in ${modelsDir}.`
        : `The card-recognition model download from ${host} was interrupted (${reason}).`,
    );
  }
  const digest = hash.digest("hex");
  if (digest !== spec.sha256) {
    await rm(tmp, { force: true });
    throw new Error(`The downloaded ${spec.id} model failed its integrity check — not using it.`);
  }
  await rename(tmp, target);
  const s = await stat(target);
  await writeFile(verifiedMarker, `${spec.sha256}:${s.size}:${Math.round(s.mtimeMs)}`);
  return target;
}

export interface OcrModelPaths {
  recognitionPath: string;
  dictionaryPath: string;
}

/** The collector-number reader's model files, or null if the package isn't installed. */
export function ocrModelPaths(): OcrModelPaths | null {
  try {
    const require = createRequire(import.meta.url);
    // The package only exports "./node"; its folder holds the model files.
    const pkgDir = path.dirname(require.resolve("@gutenye/ocr-models/node"));
    const recognitionPath = path.join(pkgDir, "assets", "ch_PP-OCRv4_rec_infer.onnx");
    const dictionaryPath = path.join(pkgDir, "assets", "ppocr_keys_v1.txt");
    if (!existsSync(recognitionPath) || !existsSync(dictionaryPath)) return null;
    return { recognitionPath, dictionaryPath };
  } catch {
    return null;
  }
}
