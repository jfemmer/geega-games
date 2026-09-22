import http from "node:http";
import { existsSync, unlinkSync } from "node:fs";

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

export type BridgeState = "starting" | "watching" | "uploading" | "error";

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

    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Not found. Try GET /status or POST /session/end." }));
  });
  server.listen(port, "127.0.0.1", () => {
    console.log(`[geega-scanner-bridge] Status: http://127.0.0.1:${port}/status`);
  });
  return server;
}
