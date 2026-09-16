import { readFile, readFileSync, writeFileSync } from "node:fs";
import { promisify } from "node:util";
import path from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ApiClient } from "./apiClient.js";
import type { BridgeConfig } from "./config.js";
import type { PairedCard } from "./pairing.js";

const readFileAsync = promisify(readFile);

// Mirrors the browser's ingestBatch (src/admin/repositories/scan.supabase.ts)
// step for step: mint signed upload URLs, PUT bytes directly to Storage,
// finalize into card_scans rows, then trigger recognition automatically per
// card (Part 15 — no manual "recognize" click). Concurrency-limited with
// retries throughout so one bad file or one flaky recognition call never
// stalls or fails the rest of a hundred-card batch (Part 12/15).

const SCAN_BUCKET = "card-scans";
const UPLOAD_URL_CHUNK = 40;
const UPLOAD_CONCURRENCY = 4;
const UPLOAD_MAX_RETRIES = 2;
const INGEST_CHUNK = 200;
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
  fileOutcomes: FileOutcome[];
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

/** One file's bytes uploaded to a freshly-minted signed URL, with retries. */
async function uploadOneFile(
  supabase: SupabaseClient,
  target: UploadTarget,
  localPath: string,
): Promise<boolean> {
  if (target.error || !target.path || !target.token) return false;
  const bytes = await readFileAsync(localPath);
  for (let attempt = 0; attempt <= UPLOAD_MAX_RETRIES; attempt++) {
    const { error } = await supabase.storage
      .from(SCAN_BUCKET)
      .uploadToSignedUrl(target.path, target.token, bytes);
    if (!error) return true;
    if (attempt < UPLOAD_MAX_RETRIES) {
      await sleep(RETRY_BASE_DELAY_MS * 2 ** attempt);
    }
  }
  return false;
}

async function recognizeWithRetry(api: ApiClient, scanId: string): Promise<boolean> {
  for (let attempt = 0; attempt <= RECOGNITION_MAX_RETRIES; attempt++) {
    try {
      await api.call(`/api/admin/scans/${scanId}/recognize`, { method: "POST" });
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
): Promise<BatchResult> {
  // Flatten pairs into individual files, remembering each file's local disk
  // path by the same (sequenceHint, side) key the server pairs on.
  const localByKey = new Map<string, string>();
  const requestFiles: { fileName: string; side: "front" | "back"; sequenceHint: number }[] = [];
  for (const pair of pairs) {
    if (pair.front) {
      localByKey.set(`${pair.sequenceHint}:front`, pair.front);
      requestFiles.push({ fileName: path.basename(pair.front), side: "front", sequenceHint: pair.sequenceHint });
    }
    if (pair.back) {
      localByKey.set(`${pair.sequenceHint}:back`, pair.back);
      requestFiles.push({ fileName: path.basename(pair.back), side: "back", sequenceHint: pair.sequenceHint });
    }
  }

  const targets: UploadTarget[] = [];
  for (const group of chunk(requestFiles, UPLOAD_URL_CHUNK)) {
    const res = await api.call<{ uploads: UploadTarget[] }>(
      `/api/admin/scan-sessions/${sessionId}/uploads`,
      { method: "POST", body: { files: group } },
    );
    targets.push(...res.uploads);
  }

  const fileOutcomes: FileOutcome[] = [];
  const uploaded: { fileName: string; side: "front" | "back"; sequenceHint: number; path: string }[] = [];

  await mapWithConcurrency(targets, UPLOAD_CONCURRENCY, async (target) => {
    const localPath = localByKey.get(`${target.sequenceHint}:${target.side}`);
    if (!localPath) return;
    if (target.error || !target.path) {
      fileOutcomes.push({ localPath, ok: false, reason: target.error ?? "No upload URL returned." });
      return;
    }
    const ok = await uploadOneFile(supabase, target, localPath);
    if (ok) {
      uploaded.push({ fileName: target.fileName, side: target.side, sequenceHint: target.sequenceHint, path: target.path });
      fileOutcomes.push({ localPath, ok: true });
    } else {
      fileOutcomes.push({ localPath, ok: false, reason: "Upload to Storage failed after retries." });
    }
  });

  let cardsCreated = 0;
  const createdIds: string[] = [];
  for (const group of chunk(uploaded, INGEST_CHUNK)) {
    if (group.length === 0) continue;
    const res = await api.call<{ created: { id: string }[]; failed: number }>(
      `/api/admin/scan-sessions/${sessionId}/ingest`,
      { method: "POST", body: { uploads: group } },
    );
    cardsCreated += res.created.length;
    createdIds.push(...res.created.map((c) => c.id));
  }

  // Recognition runs automatically per card — the whole point of "no manual
  // recognize click" (Part 15) applies just as much to bridge-ingested scans
  // as to browser-uploaded ones.
  let cardsRecognized = 0;
  let cardsFailedRecognition = 0;
  await mapWithConcurrency(createdIds, RECOGNITION_CONCURRENCY, async (id) => {
    const ok = await recognizeWithRetry(api, id);
    if (ok) cardsRecognized += 1;
    else cardsFailedRecognition += 1;
  });

  return { cardsCreated, cardsRecognized, cardsFailedRecognition, fileOutcomes };
}
