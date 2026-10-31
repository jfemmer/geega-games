import type http from "node:http";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createApiClient, type ApiClient } from "./apiClient.js";
import { createAuthedClient, SignInError, type AuthedClient } from "./auth.js";
import type { BridgeConfig } from "./config.js";
import { explainRecognizerLoadFailure } from "./recognizer/loadFailure.js";
import type { CardRecognizer } from "./recognizer/recognizer.js";
import type { RecognizerRuntime } from "./recognizer/runtime.js";
import { createRecognizerStatus, unavailableRecognizerStatus } from "./recognizer/status.js";
import type { rerunStoredScan } from "./rerun.js";
import { createStatus, startStatusServer, whenListening, type BridgeStatus, type StatusServerOptions } from "./statusServer.js";
import { BRIDGE_VERSION, pendingUpdateChecker } from "./version.js";
import { startWatcher } from "./watcher.js";

// Starts the bridge in the order that keeps the dashboard informed:
//
// 1. The status server, first. From then on the Scanner panel can see the
//    bridge and anything wrong with it, instead of "Not connected".
// 2. The card recognizer's code, loaded with a dynamic import() (never a
//    static one). It pulls in ONNX Runtime and sharp, whose native code may
//    not load on a given PC (on Windows ONNX Runtime needs the Microsoft
//    Visual C++ Redistributable). When it doesn't, the recognizer reports
//    "unavailable" with the fix, and everything else carries on: scans
//    upload and the website identifies them, as before.
// 3. Sign-in as the staff account, retried until it works (the network may
//    not be up yet when Windows starts the bridge at log-on). The reason
//    shows in the panel meanwhile.
// 4. The folder watcher, then the recognizer runtime.
//
// src/coreImports.test.ts checks that nothing on the bridge's static import
// graph reaches ONNX Runtime or sharp, so step 2 can't quietly regress.

export interface RecognizerModules {
  RecognizerRuntime: typeof RecognizerRuntime;
  rerunStoredScan: typeof rerunStoredScan;
}

/** Loads the recognizer's code: ONNX Runtime, sharp and everything built on them. */
export async function loadRecognizerModules(): Promise<RecognizerModules> {
  const [runtime, rerun] = await Promise.all([import("./recognizer/runtime.js"), import("./rerun.js")]);
  return { RecognizerRuntime: runtime.RecognizerRuntime, rerunStoredScan: rerun.rerunStoredScan };
}

/** Sign-in retry delay: quick at first for a network that's still coming up, then every 5 minutes. */
export function signInRetryDelayMs(attempt: number, network: boolean): number {
  if (!network) return 5 * 60_000;
  return Math.min(5 * 60_000, 15_000 * 2 ** Math.max(0, attempt - 1));
}

function delayText(ms: number): string {
  return ms < 60_000 ? `${Math.round(ms / 1000)} seconds` : `${Math.round(ms / 60_000)} minute${ms === 60_000 ? "" : "s"}`;
}

export interface BridgeDeps {
  /** The scanner-bridge folder: GET /status then notices an update there that isn't running yet. */
  bridgeDir?: string;
  signIn?: (config: BridgeConfig) => Promise<AuthedClient>;
  loadRecognizer?: () => Promise<RecognizerModules>;
  startWatcher?: typeof startWatcher;
  signInRetryDelayMs?: (attempt: number, network: boolean) => number;
  log?: (message: string) => void;
  logError?: (message: string) => void;
}

export interface RunningBridge {
  status: BridgeStatus;
  server: http.Server;
  /** Settles once the bridge has signed in and is watching (or was stopped first). Never rejects. */
  ready: Promise<void>;
  /** The recognizer runtime, once loaded and started (null when it's off or can't run). */
  runtime(): RecognizerRuntime | null;
  stop(): Promise<void>;
}

/**
 * Starts the status server and the rest of the bridge. Resolves once the
 * status server is listening, and rejects only when it can't (the port is
 * taken). Everything after that reports through the status instead.
 */
export async function startBridge(config: BridgeConfig, deps: BridgeDeps = {}): Promise<RunningBridge> {
  const log = deps.log ?? ((m: string) => console.log(`[geega-scanner-bridge] ${m}`));
  const logError = deps.logError ?? ((m: string) => console.error(`[geega-scanner-bridge] ${m}`));
  const signIn = deps.signIn ?? createAuthedClient;
  const loadRecognizer = deps.loadRecognizer ?? loadRecognizerModules;
  const watch = deps.startWatcher ?? startWatcher;
  const retryDelay = deps.signInRetryDelayMs ?? signInRetryDelayMs;

  const status = createStatus(config.watchFolder, config.scanDpi, config.inventoryScanDpi);
  status.recognizer = createRecognizerStatus(config.recognizer.enabled);

  let stopped = false;
  let retryTimer: NodeJS.Timeout | null = null;
  let wakeRetry: (() => void) | null = null;
  let supabase: SupabaseClient | null = null;
  let api: ApiClient | null = null;
  let runtime: RecognizerRuntime | null = null;
  let rerun: RecognizerModules["rerunStoredScan"] | null = null;

  const isBusy = () => status.state === "scanning" || status.state === "uploading";

  const controls: StatusServerOptions = {
    allowedOrigin: config.apiBaseUrl,
    sessionStateFile: config.sessionStateFile,
    watchFolder: config.watchFolder,
    naps2ConsolePath: config.naps2ConsolePath,
    scannerDriver: config.scannerDriver,
    scannerDeviceNameMatch: config.scannerDeviceNameMatch,
    duplex: config.duplex,
    watcherControl: null,
    scanDpi: config.scanDpi,
    scanMode: config.scanMode,
    inventoryScanDpi: config.inventoryScanDpi,
    checkForUpdate: deps.bridgeDir ? pendingUpdateChecker(deps.bridgeDir) : undefined,
    recognizer: config.recognizer.enabled
      ? {
          requestUpdate: () => runtime?.requestUpdate() ?? false,
          selfTest: async () => (runtime ? runtime.selfTest() : null),
          rerun: async (scanId) => {
            const recognizer: CardRecognizer | null = runtime?.recognizer ?? null;
            if (!recognizer || !rerun || !supabase || !api) {
              return { ok: false, status: 503, message: "The card library isn't ready yet." };
            }
            return rerun(scanId, { supabase, api, recognizer });
          },
        }
      : null,
  };

  // 1. The status server.
  const server = startStatusServer(config.statusPort, status, controls);
  try {
    await whenListening(server, config.statusPort);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "EADDRINUSE") throw new Error(await describePortConflict(config.statusPort));
    throw err;
  }

  // 2. The recognizer's code, in parallel with signing in.
  const recognizerModules: Promise<RecognizerModules | null> = config.recognizer.enabled
    ? loadRecognizer().catch((err: unknown) => {
        const why = explainRecognizerLoadFailure(err);
        status.recognizer = unavailableRecognizerStatus(why.message, why.help, why.detail);
        logError(`Card recognition can't run on this PC: ${why.detail}`);
        log(why.message);
        return null;
      })
    : Promise.resolve(null);

  // 3. Sign in, retrying until it works.
  async function signInUntilDone(): Promise<AuthedClient | null> {
    for (let attempt = 1; !stopped; attempt++) {
      try {
        const authed = await signIn(config);
        status.lastError = null;
        if (status.state === "error") status.state = "starting";
        return authed;
      } catch (err) {
        const network = err instanceof SignInError ? err.network : true;
        const reason = err instanceof Error ? err.message : String(err);
        const delay = retryDelay(attempt, network);
        status.state = "error";
        status.lastError = network ? `${reason} Trying again in ${delayText(delay)}.` : reason;
        if (status.recognizer.state === "starting") status.recognizer.message = "Waiting for the bridge to sign in…";
        logError(`Sign-in failed: ${reason} Trying again in ${delayText(delay)}.`);
        await new Promise<void>((resolve) => {
          wakeRetry = resolve;
          retryTimer = setTimeout(resolve, delay);
        });
        retryTimer = null;
        wakeRetry = null;
      }
    }
    return null;
  }

  const ready = (async () => {
    const authed = await signInUntilDone();
    if (!authed || stopped) return;
    supabase = authed.supabase;
    api = createApiClient(config.apiBaseUrl, authed.getAccessToken);
    log(`Signed in as ${config.staffEmail}.`);

    // 4. The watcher, then the recognizer runtime.
    controls.watcherControl = watch(config, api, authed.supabase, status, () => runtime?.recognizer ?? null);

    const modules = await recognizerModules;
    if (modules && !stopped) {
      try {
        runtime = new modules.RecognizerRuntime({ config: config.recognizer, supabase: authed.supabase, isBusy });
        rerun = modules.rerunStoredScan;
        status.recognizer = runtime.status;
        void runtime.start();
      } catch (err) {
        const why = explainRecognizerLoadFailure(err);
        runtime = null;
        status.recognizer = unavailableRecognizerStatus(why.message, why.help, why.detail);
        logError(`Card recognition can't run on this PC: ${why.detail}`);
      }
    }
  })().catch((err: unknown) => {
    // Nothing above should throw; if something does, say so instead of dying quietly.
    const reason = err instanceof Error ? err.message : String(err);
    status.state = "error";
    status.lastError = `The bridge couldn't finish starting: ${reason}`;
    logError(status.lastError);
  });

  return {
    status,
    server,
    ready,
    runtime: () => runtime,
    async stop() {
      stopped = true;
      if (retryTimer) clearTimeout(retryTimer);
      wakeRetry?.();
      runtime?.dispose();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

/**
 * Why the status port is taken, in words for the console: another copy of
 * the bridge (the usual case) or some other program.
 */
export async function describePortConflict(port: number, fetchImpl: typeof fetch = fetch): Promise<string> {
  try {
    const res = await fetchImpl(`http://127.0.0.1:${port}/status`, { signal: AbortSignal.timeout(2000) });
    const body = (await res.json()) as { watchFolder?: unknown; startedAt?: unknown; version?: unknown };
    if (typeof body.watchFolder === "string" && typeof body.startedAt === "string") {
      const since = new Date(body.startedAt).toLocaleString();
      const stopIt = 'close its window, or end its "Node.js" task in Task Manager';
      if (body.version !== BRIDGE_VERSION) {
        // Usually: updated while the old copy kept running (Task Scheduler started it at log-on).
        const which =
          typeof body.version === "string" ? `Version ${body.version} of the scanner bridge` : "An older version of the scanner bridge";
        return (
          `${which} is still running on this PC (since ${since}), and this is version ${BRIDGE_VERSION}. ` +
          `To finish updating, stop the old one (${stopIt}), then start the bridge again.`
        );
      }
      return (
        `The scanner bridge is already running on this PC (since ${since}), and the dashboard is talking to that ` +
        `copy. Use that one, or stop it first to restart the bridge: ${stopIt}.`
      );
    }
  } catch {
    // Not a bridge (or not answering): fall through.
  }
  return (
    `Another program on this PC is using port ${port}, which the scanner bridge needs for the dashboard to reach it. ` +
    "Close that program (or restart the PC), then start the bridge again."
  );
}
