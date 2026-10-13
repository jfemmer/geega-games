import { mkdirSync } from "node:fs";
import { readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { entryKey, fetchCatalog } from "./catalog.js";
import type { ImageEmbedder } from "./embedder.js";
import { decodeFit } from "./image.js";
import { BuildParts, libraryRowsByKey, loadLibrary, writeLibrary, LIBRARY_FORMAT, type Library } from "./indexStore.js";
import type { ReferenceProvider } from "./referenceImages.js";
import type { CatalogEntry, RgbImage } from "./types.js";
import { quantize } from "./vectorIndex.js";

// Builds or updates the fingerprint library on this PC.
//
// First run: every paper printing's Scryfall image is downloaded once and
// fingerprinted (roughly 110k images — an overnight job). Later runs only
// touch what changed: new printings, and printings whose Scryfall image was
// replaced (the image URL carries a version stamp). Finished fingerprints are
// saved as they go, so stopping halfway costs nothing.

export type BuildPhase = "reading_card_list" | "fingerprinting" | "saving" | "done";

export interface BuildProgress {
  phase: BuildPhase;
  done: number;
  total: number;
  failed: number;
  startedAt: string;
}

export interface BuildOptions {
  supabase: SupabaseClient;
  libraryDir: string;
  embedder: ImageEmbedder;
  references: ReferenceProvider;
  /** Parallel image downloads. */
  concurrency?: number;
  onProgress?: (p: BuildProgress) => void;
  /** Checked between batches; while true the build waits (e.g. a scan is being processed). */
  shouldPause?: () => boolean;
  signal?: AbortSignal;
  log?: (msg: string) => void;
}

export interface BuildResult {
  library: Library;
  added: number;
  reused: number;
  failed: number;
  durationMs: number;
}

const BATCH = 16;

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

/**
 * One library build at a time per folder — the bridge's background update
 * and `npm run build-index` in another window must never write the same
 * files at once. A lock left by a crashed process is taken over.
 */
async function acquireLock(libraryDir: string): Promise<() => Promise<void>> {
  const lockFile = `${libraryDir}.lock`;
  mkdirSync(path.dirname(lockFile), { recursive: true });
  try {
    await writeFile(lockFile, String(process.pid), { flag: "wx" });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
    const pid = Number((await readFile(lockFile, "utf8").catch(() => "")).trim());
    if (pid && pid !== process.pid && processAlive(pid)) {
      throw new Error(`The card library is already being updated by another bridge process (pid ${pid}).`);
    }
    await writeFile(lockFile, String(process.pid));
  }
  return async () => {
    await rm(lockFile, { force: true });
  };
}

export async function buildLibrary(options: BuildOptions): Promise<BuildResult> {
  const release = await acquireLock(options.libraryDir);
  try {
    return await buildLibraryLocked(options);
  } finally {
    await release();
  }
}

async function buildLibraryLocked(options: BuildOptions): Promise<BuildResult> {
  const started = Date.now();
  const startedAt = new Date(started).toISOString();
  const log = options.log ?? (() => undefined);
  const progress = (p: Omit<BuildProgress, "startedAt">) => options.onProgress?.({ ...p, startedAt });
  const { embedder } = options;

  progress({ phase: "reading_card_list", done: 0, total: 0, failed: 0 });
  const catalog = await fetchCatalog(options.supabase, (rows) =>
    progress({ phase: "reading_card_list", done: rows, total: 0, failed: 0 }),
  );
  log(`Card list: ${catalog.printings} printings, ${catalog.entries.length} paper card faces with images.`);

  const existing = await loadLibrary(options.libraryDir).catch(() => null);
  const existingRows = libraryRowsByKey(existing, embedder.modelId);
  const parts = new BuildParts(`${options.libraryDir}-build`, embedder.modelId, embedder.dims);
  const finished = await parts.load();

  const todo = catalog.entries.filter((e) => {
    const key = entryKey(e);
    return !existingRows.has(key) && !finished.has(key);
  });
  const reused = catalog.entries.length - todo.length;
  log(`${reused} fingerprints already done, ${todo.length} to make.`);

  let done = 0;
  let failed = 0;
  const total = todo.length;
  progress({ phase: "fingerprinting", done, total, failed });

  // Download with bounded concurrency into a small queue; fingerprint in batches.
  const concurrency = Math.max(1, options.concurrency ?? 8);
  let next = 0;
  const ready: { entry: CatalogEntry; image: RgbImage }[] = [];
  let downloadsActive = 0;
  let wake: (() => void) | null = null;
  const notify = () => {
    const w = wake;
    wake = null;
    w?.();
  };

  async function downloader(): Promise<void> {
    while (next < todo.length) {
      if (options.signal?.aborted) return;
      // Keep the queue short so memory stays small.
      while (ready.length > BATCH * 4 && !options.signal?.aborted) await new Promise((r) => setTimeout(r, 50));
      const entry = todo[next++];
      downloadsActive++;
      try {
        const bytes = await options.references.bytes(entry.img, { cache: false });
        if (bytes) {
          ready.push({ entry, image: await decodeFit(bytes, 680) });
        } else {
          failed++;
        }
      } catch {
        failed++;
      } finally {
        downloadsActive--;
        notify();
      }
    }
  }

  const downloaders = Array.from({ length: concurrency }, () => downloader());
  const flushTimerMs = 250;
  while (true) {
    if (options.signal?.aborted) throw new Error("Library build cancelled.");
    while (options.shouldPause?.()) await new Promise((r) => setTimeout(r, 1000));
    const downloadsFinished = next >= todo.length && downloadsActive === 0;
    if (ready.length >= BATCH || (downloadsFinished && ready.length > 0)) {
      const batch = ready.splice(0, BATCH);
      const vecs = await embedder.embed(batch.map((b) => b.image));
      const keys: string[] = [];
      const qv: Int8Array[] = [];
      const scales: number[] = [];
      batch.forEach((b, i) => {
        const { q, scale } = quantize(vecs[i]);
        keys.push(entryKey(b.entry));
        qv.push(q);
        scales.push(scale);
        finished.set(entryKey(b.entry), { vector: q, scale });
      });
      await parts.append(keys, qv, scales);
      done += batch.length;
      progress({ phase: "fingerprinting", done, total, failed });
      continue;
    }
    if (downloadsFinished) break;
    await new Promise<void>((resolve) => {
      wake = resolve;
      setTimeout(resolve, flushTimerMs);
    });
  }
  await Promise.all(downloaders);

  progress({ phase: "saving", done, total, failed });
  const dims = embedder.dims;
  const entries: CatalogEntry[] = [];
  const rows: { vector: Int8Array; scale: number }[] = [];
  for (const e of catalog.entries) {
    const key = entryKey(e);
    const fromParts = finished.get(key);
    if (fromParts) {
      entries.push(e);
      rows.push(fromParts);
      continue;
    }
    const row = existingRows.get(key);
    if (row !== undefined && existing) {
      entries.push(e);
      rows.push({
        vector: existing.index.vectors.slice(row * dims, (row + 1) * dims),
        scale: existing.index.scales[row],
      });
    }
  }
  const vectors = new Int8Array(rows.length * dims);
  const scales = new Float32Array(rows.length);
  rows.forEach((r, i) => {
    vectors.set(r.vector, i * dims);
    scales[i] = r.scale;
  });
  const manifest = {
    format: LIBRARY_FORMAT,
    model: { id: embedder.modelId, dims },
    builtAt: new Date().toISOString(),
    cardListRefreshedAt: catalog.refreshedAt,
    entries: entries.length,
    printings: catalog.printings,
  };
  await writeLibrary(options.libraryDir, manifest, entries, vectors, scales);
  await parts.clear();
  progress({ phase: "done", done, total, failed });
  log(`Card library saved: ${entries.length} card faces (${done} new, ${failed} couldn't be downloaded).`);

  const library = await loadLibrary(options.libraryDir);
  if (!library) throw new Error(`The new card library at ${path.resolve(options.libraryDir)} couldn't be read back.`);
  return { library, added: done, reused, failed, durationMs: Date.now() - started };
}
