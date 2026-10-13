import { rename } from "node:fs/promises";
import path from "node:path";
import chokidar from "chokidar";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ApiClient } from "./apiClient.js";
import type { BridgeConfig } from "./config.js";
import { pairScannedFiles, sortScannedFileNames } from "./pairing.js";
import { ensureSession, uploadBatch } from "./uploader.js";
import type { BridgeStatus } from "./statusServer.js";
import type { CardRecognizer } from "./recognizer/recognizer.js";
import type { BatchFinish } from "./recognizer/types.js";

const IMAGE_EXTENSIONS = new Set([".tif", ".tiff", ".jpg", ".jpeg", ".png"]);
const BATCH_RETRY_DELAY_MS = 30_000;

function isScannedImage(filePath: string): boolean {
  return IMAGE_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

export interface WatcherControl {
  /**
   * Call right before starting a WIA-driven scan (scan/start in
   * statusServer.ts). PaperStream writes a whole ADF run's pages in a fast
   * burst, which is what the quiet-period heuristic below is tuned for —
   * WIA's real per-page timing on the fi-8170 hasn't been verified here,
   * so rather than trust that heuristic for this path too, suppress it
   * entirely: files chokidar sees while suppressed still accumulate in
   * `pending` exactly as normal (so status.pendingFiles stays live), only
   * the auto-trigger is held back. Without this, a single slower-than-
   * usual gap between two pages could let the quiet timer fire mid-run and
   * split one physical batch's front/back pairs across two separate
   * processBatch() calls — silently mispairing cards, not just a timing
   * inconvenience.
   */
  suppressAutoProcess(): void;
  /** Call once the direct-scan process has fully finished, success or
   * failure — resumes normal auto-processing and arms the same quiet-period
   * timer a PaperStream-driven batch uses, rather than processing
   * immediately. This is NOT redundant with the quiet period: chokidar's
   * awaitWriteFinish only fires "add" for a file once it's been stable for
   * stabilityThreshold (1s) — a page NAPS2 finished writing just before its
   * process exited may not have crossed that threshold yet, so processing
   * synchronously here could grab every file EXCEPT that still-stabilizing
   * tail and silently strand it. batchQuietMs (5s default) is comfortably
   * longer than the 1s stability window, so this costs a few seconds of
   * extra latency per scan run, never a lost or mispaired card. */
  resumeAndProcessNow(): void;
}

/**
 * Watches WATCH_FOLDER for new files PaperStream IP drops there, waits for a
 * quiet period (a whole ADF feed run writes its pages in a burst, not one at
 * a time — processing on the very first file would split one physical batch
 * into many tiny sessions' worth of mis-paired front/back scans), then hands
 * the accumulated batch to the uploader.
 */
export function startWatcher(
  config: BridgeConfig,
  api: ApiClient,
  supabase: SupabaseClient,
  status: BridgeStatus,
  /** The on-PC recognizer once its card library is ready (null until then, or when turned off). */
  getRecognizer: () => CardRecognizer | null = () => null,
): WatcherControl {
  const pending = new Set<string>();
  // The foil / non-foil setting in force when each file arrived — so
  // flipping the switch for the NEXT batch never relabels one still uploading.
  const finishByFile = new Map<string, BatchFinish>();
  let quietTimer: NodeJS.Timeout | null = null;
  let retryTimer: NodeJS.Timeout | null = null;
  let processing = false;
  let suppressed = false;

  const watcher = chokidar.watch(config.watchFolder, {
    ignored: (p: string) => {
      const resolved = path.resolve(p);
      return (
        resolved.startsWith(config.processedFolder) ||
        resolved.startsWith(config.failedFolder) ||
        path.basename(p) === path.basename(config.sessionStateFile)
      );
    },
    depth: 0,
    awaitWriteFinish: { stabilityThreshold: 1000, pollInterval: 200 },
    ignoreInitial: false,
  });

  function scheduleProcessing() {
    if (suppressed) return;
    if (quietTimer) clearTimeout(quietTimer);
    quietTimer = setTimeout(() => {
      void processBatch();
    }, config.batchQuietMs);
  }

  async function processBatch() {
    if (processing) {
      // A batch is already uploading — these files (often the tail end of
      // a run whose last page(s) were still inside chokidar's
      // awaitWriteFinish stability window when this timer was armed) must
      // not be silently dropped: re-arm so they're picked up once the
      // in-flight batch finishes, instead of sitting in `pending` until
      // some unrelated future scan happens to trigger processing again.
      if (pending.size > 0) scheduleProcessing();
      return;
    }
    if (pending.size === 0) return;
    processing = true;
    const files = Array.from(pending);
    pending.clear();
    status.state = "uploading";

    try {
      const byName = new Map(files.map((f) => [path.basename(f), f]));
      const sortedNames = sortScannedFileNames(Array.from(byName.keys()));
      const sortedPaths = sortedNames.map((n) => byName.get(n)!);
      const pairs = pairScannedFiles(sortedPaths, config.duplex);
      // Cards, not files — with both sides scanned that's half the files.
      status.lastBatchSize = pairs.length;

      console.log(
        `[geega-scanner-bridge] Processing ${files.length} file(s) as ${pairs.length} card(s)…`,
      );

      const sessionId = await ensureSession(config, api, supabase);
      status.currentSessionId = sessionId;
      const recognizer = getRecognizer();
      const result = await uploadBatch(api, supabase, sessionId, pairs, {
        recognizer,
        finishFor: (pair) => {
          const file = pair.front ?? pair.back;
          return file ? (finishByFile.get(file) ?? status.batchFinish) : status.batchFinish;
        },
        log: (message) => console.log(`[geega-scanner-bridge] ${message}`),
      });
      const retry = new Set(result.retryLater);
      for (const f of files) if (!retry.has(f)) finishByFile.delete(f);

      for (const outcome of result.fileOutcomes) {
        const dest = outcome.ok ? config.processedFolder : config.failedFolder;
        try {
          await rename(outcome.localPath, path.join(dest, path.basename(outcome.localPath)));
        } catch (err) {
          console.error(`[geega-scanner-bridge] Could not move ${outcome.localPath}:`, err);
        }
        if (!outcome.ok) {
          console.error(
            `[geega-scanner-bridge] ${path.basename(outcome.localPath)} failed: ${outcome.reason}. Moved to ${dest} for manual attention.`,
          );
        }
      }

      if (result.retryLater.length > 0) {
        // Part of the batch never reached the server (connection dropped
        // mid-way). The cards before that point are in the session; only
        // these files are retried, so nothing is uploaded twice.
        for (const f of result.retryLater) pending.add(f);
        status.lastError = `${result.retryLater.length} file(s) will be retried: ${result.retryReason ?? "upload interrupted"}`;
        console.error(
          `[geega-scanner-bridge] Batch interrupted (${result.retryReason}); retrying ${result.retryLater.length} file(s) in ${BATCH_RETRY_DELAY_MS / 1000}s.`,
        );
        if (retryTimer) clearTimeout(retryTimer);
        retryTimer = setTimeout(() => {
          void processBatch();
        }, BATCH_RETRY_DELAY_MS);
      }

      status.totalCardsCreated += result.cardsCreated;
      status.totalCardsRecognized += result.cardsRecognized;
      status.totalCardsRecognizedOnPc += result.cardsRecognizedOnPc;
      status.totalRecognitionFailures += result.cardsFailedRecognition;
      if (result.retryLater.length === 0) status.lastError = null;
      status.lastBatchAt = new Date().toISOString();
      console.log(
        `[geega-scanner-bridge] Batch done: ${result.cardsCreated} card(s) created, ` +
          `${result.cardsRecognized} recognized (${result.cardsRecognizedOnPc} on this PC), ` +
          `${result.cardsFailedRecognition} recognition failures.`,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      status.lastError = message;
      console.error(
        `[geega-scanner-bridge] Batch failed, will retry in ${BATCH_RETRY_DELAY_MS / 1000}s: ${message}`,
      );
      // Files stay in WATCH_FOLDER (never moved on a batch-level failure).
      // No new filesystem "add" event will ever fire for files already on
      // disk, so retrying requires explicitly re-arming the timer here —
      // just re-adding to `pending` is not enough on its own.
      for (const f of files) pending.add(f);
      if (retryTimer) clearTimeout(retryTimer);
      retryTimer = setTimeout(() => {
        void processBatch();
      }, BATCH_RETRY_DELAY_MS);
    } finally {
      status.state = "watching";
      processing = false;
    }
  }

  watcher.on("add", (filePath) => {
    if (!isScannedImage(filePath)) return;
    if (!finishByFile.has(filePath)) finishByFile.set(filePath, status.batchFinish);
    pending.add(filePath);
    status.pendingFiles = pending.size;
    scheduleProcessing();
  });

  watcher.on("error", (err) => {
    status.lastError = err instanceof Error ? err.message : String(err);
    console.error("[geega-scanner-bridge] Watcher error:", err);
  });

  status.state = "watching";
  console.log(`[geega-scanner-bridge] Watching ${config.watchFolder} for new scans…`);

  return {
    suppressAutoProcess() {
      suppressed = true;
      if (quietTimer) {
        clearTimeout(quietTimer);
        quietTimer = null;
      }
    },
    resumeAndProcessNow() {
      suppressed = false;
      scheduleProcessing();
    },
  };
}
