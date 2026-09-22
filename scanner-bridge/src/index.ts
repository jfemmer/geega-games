import "dotenv/config";
import { loadConfig } from "./config.js";
import { createAuthedClient } from "./auth.js";
import { createApiClient } from "./apiClient.js";
import { createStatus, startStatusServer } from "./statusServer.js";
import { startWatcher } from "./watcher.js";

async function main() {
  console.log("[geega-scanner-bridge] Starting…");
  const config = loadConfig();

  const { supabase, getAccessToken } = await createAuthedClient(config);
  console.log(`[geega-scanner-bridge] Signed in as ${config.staffEmail}.`);

  const api = createApiClient(config.apiBaseUrl, getAccessToken);
  const status = createStatus(config.watchFolder);

  const watcherControl = startWatcher(config, api, supabase, status);
  startStatusServer(config.statusPort, status, {
    allowedOrigin: config.apiBaseUrl,
    sessionStateFile: config.sessionStateFile,
    watchFolder: config.watchFolder,
    naps2ConsolePath: config.naps2ConsolePath,
    scannerDriver: config.scannerDriver,
    scannerDeviceNameMatch: config.scannerDeviceNameMatch,
    duplex: config.duplex,
    watcherControl,
  });

  console.log(
    `[geega-scanner-bridge] Ready. Duplex: ${config.duplex}. Scanner: ${config.scannerName}.`,
  );
}

main().catch((err) => {
  console.error("[geega-scanner-bridge] Fatal startup error:", err instanceof Error ? err.message : err);
  process.exit(1);
});

process.on("unhandledRejection", (err) => {
  console.error("[geega-scanner-bridge] Unhandled rejection (continuing):", err);
});
