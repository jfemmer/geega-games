import { readFile, readFileSync, writeFileSync } from "node:fs";
import { promisify } from "node:util";
import path from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ApiClient } from "./apiClient.js";
import type { BridgeConfig } from "./config.js";
import type { PairedCard } from "./pairing.js";
import type { CardRecognizer, PairRecognition } from "./recognizer/recognizer.js";
import type { BatchFinish } from "./recognizer/types.js";

const readFileAsync = promisify(readFile);

// Mirrors the browser's ingestBatch (src/admin/repositories/scan.supabase.ts)
// step for step: mint signed upload URLs, PUT bytes directly to Storage,
// finalize into card_scans rows, then trigger recognition automatically per
// card (Part 15 — no manual "recognize" click). Concurrency-limited with
// retries throughout so one bad file or one flaky recognition call never
// stalls or fails the rest of a hundred-card batch (Part 12/15).
//
// With the on-PC recognizer ready (src/recognizer), each card is identified
// HERE before upload: what goes to Storage is the cropped, straightened card
// (a few hundred KB of JPEG instead of a multi-megabyte raw scan), and the
// recognize call carries this PC's answer for the server to check and save.
// Cards go through in small chunks so the first ones show up in Scan Review
// while the rest are still being worked on. Without the recognizer (library
// still building, or RECOGNIZER=off), or if it fails on a card, that card
// takes the original path: raw files up, cloud recognition.

const SCAN_BUCKET = "card-scans";
const CARD_CHUNK = 12;
const UPLOAD_URL_CHUNK = 40;
const UPLOAD_CONCURRENCY = 4;
const UPLOAD_MAX_RETRIES = 2;
const INGEST_CHUNK = 200;
const LOCAL_RECOGNITION_CONCURRENCY = 2;
const RECOGNITION_CONCURRENCY = 3;
const RECOGNITION_MAX_RETRIES = 2;
const RETRY_BASE_DELAY_MS = 500;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

interface UploadTarget {
  fileName: string;
  side: "front" | "back";
  sequenceHint: number;
  path?: string;
  token?: string;
  error?: string;
}

export interface FileOutcome {
  localPath: string;
  ok: boolean;
  reason?: string;
}

export interface BatchResult {
  cardsCreated: number;
  cardsRecognized: number;
  cardsFailedRecognition: number;
  /** Of cardsRecognized, how many were identified on this PC. */
  cardsRecognizedOnPc: number;
  fileOutcomes: FileOutcome[];
  /**
   * Raw files of cards that never reached the server because the connection
   * failed partway through the batch — retried later. Cards before that
   * point are already in the session, so retrying only these never creates
   * duplicate review rows.
   */
  retryLater: string[];
  /** Why retryLater isn't empty. */
  retryReason: string | null;
}

export interface UploadOptions {
  /** The on-PC recognizer, when its card library is ready. */
  recognizer?: CardRecognizer | null;
  /** The foil / non-foil batch setting that applied when this card was scanned. */
  finishFor?: (pair: PairedCard) => BatchFinish | null;
  log?: (message: string) => void;
}

/** Reuses a persisted session across restarts (Part 12: resumable, never
 * fragments one physical batch run into a pile of orphaned sessions). */
export async function ensureSession(
  config: BridgeConfig,
  api: ApiClient,
  supabase: SupabaseClient,
): Promise<string> {
  try {
    const saved = readFileSync(config.sessionStateFile, "utf8").trim();
    if (saved) {
      // Confirm it still exists before trusting it — a direct RLS-gated
      // read, same as the browser's ScanRepository.getSession(); there is
      // no GET-by-id admin endpoint (scan-sessions/[id] only handles PATCH).
      const { data, error } = await supabase
        .from("scan_sessions")
        .select("id")
        .eq("id", saved)
        .maybeSingle();
      if (error) throw error;
      if (data) return saved;
    }
  } catch {
    /* no saved session yet, or it's gone — fall through and create one */
  }

  const session = await api.call<{ id: string }>("/api/admin/scan-sessions", {
    method: "POST",
    body: { scannerName: config.scannerName, sourceType: "scanner_bridge", scanMode: config.scanMode },
  });
  writeFileSync(config.sessionStateFile, session.id, "utf8");
  return session.id;
}

/** One file to put in Storage: a raw scan, or this PC's straightened copy of one. */
interface PlannedFile {
  side: "front" | "back";
  sequenceHint: number;
  fileName: string;
  /** The raw scan this upload stands for (moved to _processed / _failed afterwards). */
  localPath: string;
  bytes: Buffer | null;
  contentType: string;
}

interface PreparedCard {
  pair: PairedCard;
  local: PairRecognition | null;
  files: PlannedFile[];
}

function contentTypeFor(file: string): string {
  const ext = path.extname(file).toLowerCase();
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".png") return "image/png";
  if (ext === ".tif" || ext === ".tiff") return "image/tiff";
  return "application/octet-stream";
}

function rawFile(side: "front" | "back", sequenceHint: number, localPath: string): PlannedFile {
  return { side, sequenceHint, fileName: path.basename(localPath), localPath, bytes: null, contentType: contentTypeFor(localPath) };
}

function straightenedFile(side: "front" | "back", sequenceHint: number, localPath: string, bytes: Buffer): PlannedFile {
  const base = path.basename(localPath, path.extname(localPath));
  return { side, sequenceHint, fileName: `${base}.jpg`, localPath, bytes, contentType: "image/jpeg" };
}

async function prepareCard(pair: PairedCard, options: UploadOptions): Promise<PreparedCard> {
  const raw = (): PlannedFile[] => {
    const files: PlannedFile[] = [];
    if (pair.front) files.push(rawFile("front", pair.sequenceHint, pair.front));
    if (pair.back) files.push(rawFile("back", pair.sequenceHint, pair.back));
    return files;
  };
  if (!options.recognizer || (!pair.front && !pair.back)) return { pair, local: null, files: raw() };
  try {
    const local = await options.recognizer.recognizePair({
      front: pair.front,
      back: pair.back,
      finish: options.finishFor?.(pair) ?? null,
    });
    // The face goes up as the scan's front, whichever side of the feeder it was on.
    const faceRaw = local.faceSource === "back" ? pair.back : pair.front;
    const otherRaw = local.faceSource === "back" ? pair.front : pair.back;
    const files: PlannedFile[] = [];
    if (faceRaw) {
      files.push(
        local.frontJpeg
          ? straightenedFile("front", pair.sequenceHint, faceRaw, local.frontJpeg)
          : rawFile("front", pair.sequenceHint, faceRaw),
      );
    }
    if (otherRaw) {
      files.push(
        local.backJpeg
          ? straightenedFile("back", pair.sequenceHint, otherRaw, local.backJpeg)
          : rawFile("back", pair.sequenceHint, otherRaw),
      );
    }
    return { pair, local, files };
  } catch (err) {
    options.log?.(
      `Couldn't recognize card ${pair.sequenceHint} on this PC (${err instanceof Error ? err.message : err}) — sending it to cloud recognition.`,
    );
    return { pair, local: null, files: raw() };
  }
}

/** One file's bytes uploaded to a freshly-minted signed URL, with retries. */
async function uploadOneFile(supabase: SupabaseClient, target: UploadTarget, file: PlannedFile): Promise<boolean> {
  if (target.error || !target.path || !target.token) return false;
  const bytes = file.bytes ?? (await readFileAsync(file.localPath));
  for (let attempt = 0; attempt <= UPLOAD_MAX_RETRIES; attempt++) {
    const { error } = await supabase.storage
      .from(SCAN_BUCKET)
      .uploadToSignedUrl(target.path, target.token, bytes, { contentType: file.contentType });
    if (!error) return true;
    if (attempt < UPLOAD_MAX_RETRIES) {
      await sleep(RETRY_BASE_DELAY_MS * 2 ** attempt);
    }
  }
  return false;
}

async function recognizeWithRetry(api: ApiClient, scanId: string, body?: unknown): Promise<boolean> {
  for (let attempt = 0; attempt <= RECOGNITION_MAX_RETRIES; attempt++) {
    try {
      await api.call(`/api/admin/scans/${scanId}/recognize`, { method: "POST", body });
      return true;
    } catch {
      if (attempt < RECOGNITION_MAX_RETRIES) {
        await sleep(RETRY_BASE_DELAY_MS * 2 ** attempt);
      }
    }
  }
  return false;
}

export async function uploadBatch(
  api: ApiClient,
  supabase: SupabaseClient,
  sessionId: string,
  pairs: PairedCard[],
  options: UploadOptions = {},
): Promise<BatchResult> {
  const result: BatchResult = {
    cardsCreated: 0,
    cardsRecognized: 0,
    cardsFailedRecognition: 0,
    cardsRecognizedOnPc: 0,
    fileOutcomes: [],
    retryLater: [],
    retryReason: null,
  };

  const chunks = chunk(pairs, CARD_CHUNK);
  for (let c = 0; c < chunks.length; c++) {
    try {
      await uploadChunk(api, supabase, sessionId, chunks[c], options, result);
    } catch (err) {
      // The server couldn't be reached (or refused) mid-batch. Everything
      // before this chunk is safely in the session; this chunk and the rest
      // wait for the retry instead of being uploaded twice.
      const rawFiles = (cards: PairedCard[]) =>
        cards.flatMap((p) => [p.front, p.back]).filter((f): f is string => !!f);
      const done = new Set(result.fileOutcomes.map((o) => o.localPath));
      result.retryLater = chunks
        .slice(c)
        .flatMap(rawFiles)
        .filter((f) => !done.has(f));
      result.retryReason = err instanceof Error ? err.message : String(err);
      break;
    }
  }
  return result;
}

async function uploadChunk(
  api: ApiClient,
  supabase: SupabaseClient,
  sessionId: string,
  cards: PairedCard[],
  options: UploadOptions,
  result: BatchResult,
): Promise<void> {
  const prepared = await mapWithConcurrency(cards, LOCAL_RECOGNITION_CONCURRENCY, (pair) => prepareCard(pair, options));
  const planned = prepared.flatMap((p) => p.files);
  const byKey = new Map(planned.map((f) => [`${f.sequenceHint}:${f.side}`, f]));
  const cardByHint = new Map(prepared.map((p) => [p.pair.sequenceHint, p]));

  const targets: UploadTarget[] = [];
  for (const group of chunk(planned, UPLOAD_URL_CHUNK)) {
    const res = await api.call<{ uploads: UploadTarget[] }>(
      `/api/admin/scan-sessions/${sessionId}/uploads`,
      {
        method: "POST",
        body: { files: group.map((f) => ({ fileName: f.fileName, side: f.side, sequenceHint: f.sequenceHint })) },
      },
    );
    targets.push(...res.uploads);
  }

  // Outcomes only count once this chunk's cards exist on the server (after
  // ingest) — if anything below throws, the whole chunk is retried and
  // none of its files are moved out of the watch folder.
  const outcomes: FileOutcome[] = [];
  const uploaded: { fileName: string; side: "front" | "back"; sequenceHint: number; path: string }[] = [];
  await mapWithConcurrency(targets, UPLOAD_CONCURRENCY, async (target) => {
    const file = byKey.get(`${target.sequenceHint}:${target.side}`);
    if (!file) return;
    if (target.error || !target.path) {
      outcomes.push({ localPath: file.localPath, ok: false, reason: target.error ?? "No upload URL returned." });
      return;
    }
    const ok = await uploadOneFile(supabase, target, file);
    if (ok) {
      uploaded.push({ fileName: target.fileName, side: target.side, sequenceHint: target.sequenceHint, path: target.path });
      outcomes.push({ localPath: file.localPath, ok: true });
    } else {
      outcomes.push({ localPath: file.localPath, ok: false, reason: "Upload to Storage failed after retries." });
    }
  });

  const created: { id: string; front_image_path: string | null; back_image_path: string | null }[] = [];
  for (const group of chunk(uploaded, INGEST_CHUNK)) {
    if (group.length === 0) continue;
    const res = await api.call<{
      created: { id: string; front_image_path?: string | null; back_image_path?: string | null }[];
      failed: number;
    }>(`/api/admin/scan-sessions/${sessionId}/ingest`, { method: "POST", body: { uploads: group } });
    result.cardsCreated += res.created.length;
    created.push(
      ...res.created.map((c) => ({ id: c.id, front_image_path: c.front_image_path ?? null, back_image_path: c.back_image_path ?? null })),
    );
  }
  result.fileOutcomes.push(...outcomes);

  // Which card each new row is, by the Storage path it was given.
  const hintByPath = new Map(uploaded.map((u) => [u.path, u.sequenceHint]));
  const straightenedPaths = new Set(
    uploaded.filter((u) => byKey.get(`${u.sequenceHint}:${u.side}`)?.bytes).map((u) => u.path),
  );

  // Recognition runs automatically per card — the whole point of "no manual
  // recognize click" (Part 15) applies just as much to bridge-ingested scans
  // as to browser-uploaded ones.
  await mapWithConcurrency(created, RECOGNITION_CONCURRENCY, async (row) => {
    const hint =
      (row.front_image_path ? hintByPath.get(row.front_image_path) : undefined) ??
      (row.back_image_path ? hintByPath.get(row.back_image_path) : undefined);
    const card = hint !== undefined ? cardByHint.get(hint) : undefined;
    let body: unknown;
    if (card?.local) {
      body = {
        local: {
          ...card.local.result,
          // What actually reached Storage — a straightened copy only when its upload succeeded.
          straightened: {
            front: !!row.front_image_path && straightenedPaths.has(row.front_image_path),
            back: !!row.back_image_path && straightenedPaths.has(row.back_image_path),
          },
        },
      };
    }
    const ok = await recognizeWithRetry(api, row.id, body);
    if (ok) {
      result.cardsRecognized += 1;
      if (body) result.cardsRecognizedOnPc += 1;
    } else {
      result.cardsFailedRecognition += 1;
    }
  });
}
