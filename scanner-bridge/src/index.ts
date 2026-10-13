import "dotenv/config";
import { loadConfig } from "./config.js";
import { createAuthedClient } from "./auth.js";
import { createApiClient } from "./apiClient.js";
import { createStatus, startStatusServer } from "./statusServer.js";
import { startWatcher } from "./watcher.js";
import { RecognizerRuntime } from "./recognizer/runtime.js";
import { rerunStoredScan } from "./rerun.js";

async function main() {
  console.log("[geega-scanner-bridge] Starting…");
  const config = loadConfig();

  const { supabase, getAccessToken } = await createAuthedClient(config);
  console.log(`[geega-scanner-bridge] Signed in as ${config.staffEmail}.`);

  const api = createApiClient(config.apiBaseUrl, getAccessToken);
  const status = createStatus(config.watchFolder, config.scanDpi);

  // The on-PC card recognizer. Starts in the background — the bridge
  // watches and uploads right away, and cards go to cloud recognition until
  // the card library is ready.
  const runtime = new RecognizerRuntime({
    config: config.recognizer,
    supabase,
    isBusy: () => status.state === "scanning" || status.state === "uploading",
  });
  status.recognizer = runtime.status;
  void runtime.start();

  const watcherControl = startWatcher(config, api, supabase, status, () => runtime.recognizer);
  startStatusServer(config.statusPort, status, {
    allowedOrigin: config.apiBaseUrl,
    sessionStateFile: config.sessionStateFile,
    watchFolder: config.watchFolder,
    naps2ConsolePath: config.naps2ConsolePath,
    scannerDriver: config.scannerDriver,
    scannerDeviceNameMatch: config.scannerDeviceNameMatch,
    duplex: config.duplex,
    watcherControl,
    scanDpi: config.scanDpi,
    recognizer: config.recognizer.enabled
      ? {
          requestUpdate: () => runtime.requestUpdate(),
          selfTest: () => runtime.selfTest(),
          rerun: async (scanId) => {
            const recognizer = runtime.recognizer;
            if (!recognizer) return { ok: false, status: 503, message: "The card library isn't ready yet." };
            return rerunStoredScan(scanId, { supabase, api, recognizer });
          },
        }
      : null,
  });

  console.log(
    `[geega-scanner-bridge] Ready. Duplex: ${config.duplex}. Scanner: ${config.scannerName}. ` +
      `Scan resolution: ${config.scanDpi} dpi. Card recognizer: ${config.recognizer.enabled ? "on" : "off"} ` +
      `(data in ${config.recognizer.dataDir}).`,
  );
}

main().catch((err) => {
  console.error("[geega-scanner-bridge] Fatal startup error:", err instanceof Error ? err.message : err);
  process.exit(1);
});

process.on("unhandledRejection", (err) => {
  console.error("[geega-scanner-bridge] Unhandled rejection (continuing):", err);
});
