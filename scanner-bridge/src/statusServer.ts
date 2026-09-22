import http from "node:http";
import { existsSync, unlinkSync } from "node:fs";
import type { WatcherControl } from "./watcher.js";
import { listWiaDevices, runWiaScan } from "./wiaScan.js";

// A local status + control endpoint — bound to 127.0.0.1 ONLY, never
// 0.0.0.0, so it is never reachable from the network (Part 3's explicit
// "bind any local service to localhost only"). CORS is scoped to exactly
// the deployed Geega app's origin (never "*"): that's the one legitimate
// cross-origin caller (the admin dashboard's Scan Sessions page, running in
// a browser on this same machine), not an open door.
//
// GET /status is read-only, safe for anyone with access to this machine to
// poll. POST /session/end deletes the persisted session id — the exact
// same effect as manually deleting the .geega-session-id file per the
// README, just reachable from the dashboard instead of the filesystem. It
// never touches an in-flight upload: ensureSession() only reads this file
// at the START of a batch, so a batch already running keeps using its own
// already-resolved session id regardless of when this fires.
//
// GET /scan/devices and POST /scan/start (Phase 2) drive the scanner
// directly via scripts/wia-scan.ps1 — no PaperStream IP window. Scanned
// pages land in WATCH_FOLDER, so the existing watcher/pairing/upload/
// recognition pipeline in watcher.ts handles them completely unchanged;
// this file's job is just process lifecycle (don't let two scans overlap,
// suppress the watcher's own auto-processing for the duration — see
// WatcherControl in watcher.ts for why) and status reporting.

export type BridgeState = "starting" | "watching" | "uploading" | "scanning" | "error";

export interface BridgeStatus {
  state: BridgeState;
  watchFolder: string;
  pendingFiles: number;
  lastBatchSize: number;
  lastBatchAt: string | null;
  totalCardsCreated: number;
  totalCardsRecognized: number;
  totalRecognitionFailures: number;
  lastError: string | null;
  startedAt: string;
  /** Null until the first batch resolves a session (see watcher.ts). Also
   * null right after a POST /session/end, until the next batch creates a
   * fresh one. */
  currentSessionId: string | null;
}

export function createStatus(watchFolder: string): BridgeStatus {
  return {
    state: "starting",
    watchFolder,
    pendingFiles: 0,
    lastBatchSize: 0,
    lastBatchAt: null,
    totalCardsCreated: 0,
    totalCardsRecognized: 0,
    totalRecognitionFailures: 0,
    lastError: null,
    startedAt: new Date().toISOString(),
    currentSessionId: null,
  };
}

export interface StatusServerOptions {
  /** The deployed Geega app's origin (config.apiBaseUrl) — the only origin
   * this server answers cross-origin requests for. */
  allowedOrigin: string;
  /** Path to the persisted session id file (config.sessionStateFile). */
  sessionStateFile: string;
  /** Where a direct WIA scan's pages get saved (config.watchFolder) — the
   * SAME folder the watcher already watches. */
  watchFolder: string;
  /** config.wiaDeviceNameMatch. */
  wiaDeviceNameMatch: string;
  /** config.duplex — same front/back-pairing decision a WIA-driven scan
   * uses as a PaperStream-driven one. */
  duplex: boolean;
  /** Returned by startWatcher() — lets a direct scan hold off the
   * watcher's own auto-processing for its duration. */
  watcherControl: WatcherControl;
}

export function startStatusServer(
  port: number,
  status: BridgeStatus,
  options: StatusServerOptions,
): http.Server {
  const server = http.createServer((req, res) => {
    res.setHeader("Access-Control-Allow-Origin", options.allowedOrigin);
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    res.setHeader("Vary", "Origin");

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    if (req.method === "GET" && (req.url === "/status" || req.url === "/")) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(status, null, 2));
      return;
    }

    if (req.method === "POST" && req.url === "/session/end") {
      try {
        // Idempotent: no file at all (no session yet) is success, not an
        // error — the caller's intent ("no active session") is already true.
        if (existsSync(options.sessionStateFile)) unlinkSync(options.sessionStateFile);
        status.currentSessionId = null;
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
      } catch (err) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            ok: false,
            error: err instanceof Error ? err.message : String(err),
          }),
        );
      }
      return;
    }

    if (req.method === "GET" && req.url === "/scan/devices") {
      // Diagnostic only — never touches the feeder. The safe first thing to
      // try, before ever attempting a real scan.
      listWiaDevices(options.wiaDeviceNameMatch)
        .then((result) => {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify(result));
        })
        .catch((err) => {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              ok: false,
              message: err instanceof Error ? err.message : String(err),
              rawOutput: "",
            }),
          );
        });
      return;
    }

    if (req.method === "POST" && req.url === "/scan/start") {
      if (status.state === "scanning") {
        res.writeHead(409, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false, message: "A scan is already running." }));
        return;
      }

      status.state = "scanning";
      status.lastError = null;
      res.writeHead(202, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ started: true }));

      // Unique per run so a WIA batch's files can never collide with
      // leftover PaperStream-written ones sitting in the same folder.
      const filePrefix = `wia_${Date.now()}`;
      options.watcherControl.suppressAutoProcess();

      runWiaScan({
        outputFolder: options.watchFolder,
        filePrefix,
        deviceNameMatch: options.wiaDeviceNameMatch,
        duplex: options.duplex,
        resolution: 600,
      })
        .then((result) => {
          if (!result.ok) {
            status.lastError = result.message;
            console.error(`[geega-scanner-bridge] WIA scan reported an error: ${result.message}`);
          }
          console.log(`[geega-scanner-bridge] WIA scan finished: ${result.pagesScanned} page(s) saved.`);
        })
        .catch((err) => {
          status.lastError = err instanceof Error ? err.message : String(err);
          console.error("[geega-scanner-bridge] WIA scan threw unexpectedly:", err);
        })
        .finally(() => {
          // Fallback for "nothing was saved" — processBatch()'s own finally
          // block already resets state to "watching" whenever it actually
          // runs (i.e. whenever anything WAS saved), so this only matters
          // when pending stays empty and resumeAndProcessNow() is a no-op.
          status.state = "watching";
          options.watcherControl.resumeAndProcessNow();
        });
      return;
    }

    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        error: "Not found. Try GET /status, POST /session/end, GET /scan/devices, or POST /scan/start.",
      }),
    );
  });
  server.listen(port, "127.0.0.1", () => {
    console.log(`[geega-scanner-bridge] Status: http://127.0.0.1:${port}/status`);
  });
  return server;
}
