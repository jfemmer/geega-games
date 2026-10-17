import http from "node:http";
import { existsSync, unlinkSync } from "node:fs";
import type { WatcherControl } from "./watcher.js";
import { listScanDevices, runScan } from "./naps2Scan.js";
import { createRecognizerStatus, type RecognizerStatus } from "./recognizer/status.js";
import type { BatchFinish } from "./recognizer/types.js";
import { BRIDGE_VERSION, type PendingUpdate } from "./version.js";

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
// Every POST also checks the Origin header when a browser sends one: only
// the Geega app itself may trigger anything here. (A browser always sends
// Origin on a cross-site request, so another website open on this PC can't
// start a scan or a library rebuild; local tools like curl send none.) And
// every request must be addressed to 127.0.0.1 / localhost, which shuts out
// "DNS rebinding" (a website pointing its own domain at this PC).
//
// GET /status also says which version of the bridge is running, and whether
// its folder holds a newer one it isn't using yet (pulled but not rebuilt,
// or rebuilt but not restarted; see version.ts), so the dashboard can say
// exactly what's left to do.
//
// The card recognizer (src/recognizer) adds: GET /status's `recognizer`
// block, POST /settings (the foil / non-foil switch next to "Scan now"),
// POST /library/update, POST /library/self-test, and POST /recognize
// (re-run recognition for one stored scan on this PC).
//
// This server starts before anything else in the bridge (bridge.ts), so the
// dashboard can always see what's going on: still signing in, a sign-in
// that failed and why, or a card recognizer that can't run on this PC. Until
// the bridge has signed in and is watching the folder, `watcherControl` is
// null and "Scan now" answers 503 with the reason.
//
// GET /scan/devices and POST /scan/start (Phase 2) drive the scanner
// directly via NAPS2 (naps2Scan.ts, NAPS2.Console.exe) — no PaperStream IP
// window. Scanned pages land in WATCH_FOLDER, so the existing watcher/
// pairing/upload/recognition pipeline in watcher.ts handles them completely
// unchanged; this file's job is just process lifecycle (don't let two scans
// overlap, suppress the watcher's own auto-processing for the duration —
// see WatcherControl in watcher.ts for why) and status reporting.

export type BridgeState = "starting" | "watching" | "uploading" | "scanning" | "error";

export interface BridgeStatus {
  /** The running bridge's version (version.ts). */
  version: string;
  /** A newer version in the bridge's folder that isn't running yet (null: none). */
  pendingUpdate: PendingUpdate | null;
  state: BridgeState;
  watchFolder: string;
  pendingFiles: number;
  /** Cards (not files) in the most recent batch. */
  lastBatchSize: number;
  lastBatchAt: string | null;
  totalCardsCreated: number;
  totalCardsRecognized: number;
  /** Of totalCardsRecognized, identified on this PC (the rest went to cloud recognition). */
  totalCardsRecognizedOnPc: number;
  totalRecognitionFailures: number;
  lastError: string | null;
  startedAt: string;
  /** Null until the first batch resolves a session (see watcher.ts). Also
   * null right after a POST /session/end, until the next batch creates a
   * fresh one. */
  currentSessionId: string | null;
  /** Result of the most recent direct scan (POST /scan/start) — NAPS2's own
   * page count/error, exactly as logged to this process's console, but
   * surfaced here too so the dashboard can show it without anyone needing
   * to go find that console window. Independent of whether those pages
   * have finished uploading yet (that's status.state/lastBatchAt). Null
   * until the first direct scan completes. */
  lastScanResult: {
    ok: boolean;
    pagesScanned: number;
    message: string;
    at: string;
  } | null;
  /** Applied to cards as they arrive; set from the switch next to "Scan now". */
  batchFinish: BatchFinish;
  /** Resolution "Scan now" uses. */
  scanDpi: number;
  /** The on-PC card recognizer (model, card library, self-test). */
  recognizer: RecognizerStatus;
}

export function createStatus(watchFolder: string, scanDpi = 300): BridgeStatus {
  return {
    version: BRIDGE_VERSION,
    pendingUpdate: null,
    state: "starting",
    watchFolder,
    pendingFiles: 0,
    lastBatchSize: 0,
    lastBatchAt: null,
    totalCardsCreated: 0,
    totalCardsRecognized: 0,
    totalCardsRecognizedOnPc: 0,
    totalRecognitionFailures: 0,
    lastError: null,
    startedAt: new Date().toISOString(),
    currentSessionId: null,
    lastScanResult: null,
    batchFinish: "nonfoil",
    scanDpi,
    recognizer: createRecognizerStatus(false),
  };
}

/** What the status server needs from the recognizer runtime (src/recognizer/runtime.ts). */
export interface RecognizerControl {
  requestUpdate(): boolean;
  selfTest(): Promise<unknown>;
  /** Re-runs recognition for one stored scan; resolves with a message for the dashboard. */
  rerun(scanId: string): Promise<{ ok: boolean; status: number; message: string }>;
}

const MAX_BODY_BYTES = 16 * 1024;

function readJson(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error("Request body too large."));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      const text = Buffer.concat(chunks).toString("utf8").trim();
      if (!text) return resolve({});
      try {
        const parsed = JSON.parse(text) as unknown;
        resolve(parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {});
      } catch {
        reject(new Error("Body must be JSON."));
      }
    });
    req.on("error", reject);
  });
}

function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LOOPBACK_HOST = /^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/i;

export interface StatusServerOptions {
  /** The deployed Geega app's origin (config.apiBaseUrl) — the only origin
   * this server answers cross-origin requests for. */
  allowedOrigin: string;
  /** Path to the persisted session id file (config.sessionStateFile). */
  sessionStateFile: string;
  /** Where a direct scan's pages get saved (config.watchFolder) — the SAME
   * folder the watcher already watches. */
  watchFolder: string;
  /** config.naps2ConsolePath. */
  naps2ConsolePath: string;
  /** config.scannerDriver. */
  scannerDriver: string;
  /** config.scannerDeviceNameMatch. */
  scannerDeviceNameMatch: string;
  /** config.duplex — same front/back-pairing decision a direct scan uses as
   * a PaperStream-driven one. */
  duplex: boolean;
  /** Returned by startWatcher() — lets a direct scan hold off the
   * watcher's own auto-processing for its duration. Null until the bridge
   * has signed in and started watching (scans are refused until then). */
  watcherControl: WatcherControl | null;
  /** config.scanDpi — resolution for "Scan now". */
  scanDpi?: number;
  /** The card recognizer's controls; null when it's turned off. */
  recognizer?: RecognizerControl | null;
  /** Looks for an update on disk the running bridge isn't using yet (version.ts), for GET /status. */
  checkForUpdate?: () => PendingUpdate | null;
}

/**
 * Resolves once the server is listening; rejects with a plain-English
 * reason when it can't (the usual one: another copy of the bridge already
 * has the port).
 */
export function whenListening(server: http.Server, port: number): Promise<void> {
  if (server.listening) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const onListening = () => {
      server.off("error", onError);
      resolve();
    };
    const onError = (err: NodeJS.ErrnoException) => {
      server.off("listening", onListening);
      reject(
        Object.assign(
          new Error(
            err.code === "EADDRINUSE"
              ? `Port ${port} on this PC is already in use.`
              : `Couldn't open the status port 127.0.0.1:${port}: ${err.message}`,
          ),
          { code: err.code },
        ),
      );
    };
    server.once("listening", onListening);
    server.once("error", onError);
  });
}

export function startStatusServer(
  port: number,
  status: BridgeStatus,
  options: StatusServerOptions,
): http.Server {
  const server = http.createServer((req, res) => {
    // Only requests addressed to this PC's loopback name. A website that
    // points its own domain at 127.0.0.1 ("DNS rebinding") would otherwise
    // count as same-origin and get past the CORS and Origin checks.
    if (!LOOPBACK_HOST.test(req.headers.host ?? "")) {
      res.writeHead(403, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false, message: "The scanner bridge only answers on 127.0.0.1." }));
      return;
    }
    res.setHeader("Access-Control-Allow-Origin", options.allowedOrigin);
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    res.setHeader("Vary", "Origin");
    // Chrome asks before a public website (the Geega app) may reach this
    // PC's own address ("Private Network Access"); answer that we allow it.
    // The allowed origin above still limits it to the Geega app.
    if (req.headers["access-control-request-private-network"] === "true") {
      res.setHeader("Access-Control-Allow-Private-Network", "true");
    }

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    if (req.method === "POST") {
      const origin = req.headers.origin;
      if (origin !== undefined && origin !== options.allowedOrigin) {
        sendJson(res, 403, { ok: false, message: "Only the Geega app can control the scanner bridge." });
        return;
      }
    }

    if (req.method === "POST" && req.url === "/settings") {
      readJson(req)
        .then((body) => {
          if (body.batchFinish !== undefined) {
            if (body.batchFinish !== "foil" && body.batchFinish !== "nonfoil") {
              sendJson(res, 400, { ok: false, message: 'batchFinish must be "foil" or "nonfoil".' });
              return;
            }
            status.batchFinish = body.batchFinish;
          }
          sendJson(res, 200, { ok: true, batchFinish: status.batchFinish });
        })
        .catch((err: Error) => sendJson(res, 400, { ok: false, message: err.message }));
      return;
    }

    if (req.method === "POST" && req.url === "/library/update") {
      if (!options.recognizer || status.recognizer.state === "off") {
        sendJson(res, 409, { ok: false, message: "The card recognizer is turned off on this PC (RECOGNIZER=off)." });
        return;
      }
      if (status.recognizer.state === "unavailable") {
        // Needs something installed on this PC and a restart; nothing to retry here.
        sendJson(res, 409, { ok: false, message: status.recognizer.message });
        return;
      }
      const retrying = status.recognizer.state === "error";
      const started = options.recognizer.requestUpdate();
      sendJson(res, started ? 202 : 409, {
        ok: started,
        message: started
          ? retrying
            ? "Trying again — this can take a minute."
            : "Updating the card library in the background."
          : "The card library is already updating (or the recognizer is still starting).",
      });
      return;
    }

    if (req.method === "POST" && req.url === "/library/self-test") {
      if (!options.recognizer || status.recognizer.state !== "ready") {
        sendJson(res, 409, { ok: false, message: "The card library isn't ready yet." });
        return;
      }
      if (status.recognizer.selfTestRunning) {
        sendJson(res, 409, { ok: false, message: "A self-test is already running." });
        return;
      }
      void options.recognizer.selfTest();
      sendJson(res, 202, { ok: true, message: "Self-test started — results appear here in a few minutes." });
      return;
    }

    if (req.method === "POST" && req.url === "/recognize") {
      const recognizer = options.recognizer;
      if (!recognizer || status.recognizer.state !== "ready") {
        sendJson(res, 503, { ok: false, message: "The card recognizer on this PC isn't ready yet." });
        return;
      }
      readJson(req)
        .then(async (body) => {
          const scanId = typeof body.scanId === "string" ? body.scanId : "";
          if (!UUID.test(scanId)) {
            sendJson(res, 400, { ok: false, message: "scanId must be a scan id." });
            return;
          }
          const outcome = await recognizer.rerun(scanId);
          sendJson(res, outcome.status, { ok: outcome.ok, message: outcome.message });
        })
        .catch((err: Error) => sendJson(res, 500, { ok: false, message: err.message }));
      return;
    }

    if (req.method === "GET" && (req.url === "/status" || req.url === "/")) {
      if (options.checkForUpdate) status.pendingUpdate = options.checkForUpdate();
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
      listScanDevices(options.naps2ConsolePath, options.scannerDriver)
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
      const watcherControl = options.watcherControl;
      if (!watcherControl) {
        sendJson(res, 503, {
          ok: false,
          message: status.lastError
            ? `The scanner bridge can't scan yet: ${status.lastError}`
            : "The scanner bridge is still starting up — try again in a few seconds.",
        });
        return;
      }
      if (status.state === "scanning") {
        res.writeHead(409, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false, message: "A scan is already running." }));
        return;
      }

      // Claim the scanner before reading the (optional) body, so two quick
      // clicks can never both start NAPS2.
      status.state = "scanning";
      status.lastError = null;
      void readJson(req)
        .catch(() => ({}) as Record<string, unknown>)
        .then((body) => {
          // The dashboard sends the foil / non-foil switch with the click, so
          // this run's cards get it even if the switch moved a moment ago.
          if (body.batchFinish === "foil" || body.batchFinish === "nonfoil") status.batchFinish = body.batchFinish;
          res.writeHead(202, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ started: true }));
          startDirectScan(status, options, watcherControl);
        });
      return;
    }

    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        error:
          "Not found. Try GET /status, POST /session/end, GET /scan/devices, POST /scan/start, POST /settings, POST /library/update, POST /library/self-test, or POST /recognize.",
      }),
    );
  });
  // Errors before listening (the port is taken) are whenListening()'s to
  // report; any later one is logged rather than taking the bridge down.
  server.on("error", (err) => {
    if (server.listening) console.error(`[geega-scanner-bridge] Status server error: ${err.message}`);
  });
  server.listen(port, "127.0.0.1", () => {
    const address = server.address();
    const actualPort = address && typeof address === "object" ? address.port : port;
    console.log(`[geega-scanner-bridge] Status: http://127.0.0.1:${actualPort}/status`);
  });
  return server;
}

/** Runs one NAPS2 scan into the watch folder, holding off the watcher's own processing meanwhile. */
function startDirectScan(status: BridgeStatus, options: StatusServerOptions, watcherControl: WatcherControl): void {
  // Unique per run so a direct-scan batch's files can never collide
  // with leftover PaperStream-written ones sitting in the same folder.
  const filePrefix = `scan_${Date.now()}`;
  watcherControl.suppressAutoProcess();

  runScan({
    consolePath: options.naps2ConsolePath,
    outputFolder: options.watchFolder,
    filePrefix,
    driver: options.scannerDriver,
    deviceNameMatch: options.scannerDeviceNameMatch,
    duplex: options.duplex,
    resolution: options.scanDpi ?? status.scanDpi,
  })
    .then((result) => {
      status.lastScanResult = {
        ok: result.ok,
        pagesScanned: result.pagesScanned,
        message: result.message,
        at: new Date().toISOString(),
      };
      if (!result.ok) {
        status.lastError = result.message;
        console.error(`[geega-scanner-bridge] Scan reported an error: ${result.message}`);
      }
      console.log(`[geega-scanner-bridge] Scan finished: ${result.pagesScanned} page(s) saved.`);
    })
    .catch((err) => {
      const message = err instanceof Error ? err.message : String(err);
      status.lastScanResult = { ok: false, pagesScanned: 0, message, at: new Date().toISOString() };
      status.lastError = message;
      console.error("[geega-scanner-bridge] Scan threw unexpectedly:", err);
    })
    .finally(() => {
      // Fallback for "nothing was saved" — processBatch()'s own finally
      // block already resets state to "watching" whenever it actually
      // runs (i.e. whenever anything WAS saved), so this only matters
      // when pending stays empty and resumeAndProcessNow() is a no-op.
      status.state = "watching";
      watcherControl.resumeAndProcessNow();
    });
}
