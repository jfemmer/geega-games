import { rename } from "node:fs/promises";
import path from "node:path";
import chokidar from "chokidar";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ApiClient } from "./apiClient.js";
import type { BridgeConfig } from "./config.js";
import { pairScannedFiles, sortScannedFileNames } from "./pairing.js";
import { ensureSession, uploadBatch } from "./uploader.js";
import type { BridgeStatus } from "./statusServer.js";

const IMAGE_EXTENSIONS = new Set([".tif", ".tiff", ".jpg", ".jpeg", ".png"]);
const BATCH_RETRY_DELAY_MS = 30_000;

function isScannedImage(filePath: string): boolean {
  return IMAGE_EXTENSIONS.has(path.extname(filePath).toLowerCase());
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
): void {
  const pending = new Set<string>();
  let quietTimer: NodeJS.Timeout | null = null;
  let retryTimer: NodeJS.Timeout | null = null;
  let processing = false;

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
    if (quietTimer) clearTimeout(quietTimer);
    quietTimer = setTimeout(() => {
      void processBatch();
    }, config.batchQuietMs);
  }

  async function processBatch() {
    if (processing || pending.size === 0) return;
    processing = true;
    const files = Array.from(pending);
    pending.clear();
    status.state = "uploading";
    status.lastBatchSize = files.length;

    try {
      const byName = new Map(files.map((f) => [path.basename(f), f]));
      const sortedNames = sortScannedFileNames(Array.from(byName.keys()));
      const sortedPaths = sortedNames.map((n) => byName.get(n)!);
      const pairs = pairScannedFiles(sortedPaths, config.duplex);

      console.log(
        `[geega-scanner-bridge] Processing ${files.length} file(s) as ${pairs.length} card(s)…`,
      );

      const sessionId = await ensureSession(config, api, supabase);
      status.currentSessionId = sessionId;
      const result = await uploadBatch(api, supabase, sessionId, pairs);

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

      status.totalCardsCreated += result.cardsCreated;
      status.totalCardsRecognized += result.cardsRecognized;
      status.totalRecognitionFailures += result.cardsFailedRecognition;
      status.lastError = null;
      status.lastBatchAt = new Date().toISOString();
      console.log(
        `[geega-scanner-bridge] Batch done: ${result.cardsCreated} card(s) created, ` +
          `${result.cardsRecognized} recognized, ${result.cardsFailedRecognition} recognition failures.`,
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
}
