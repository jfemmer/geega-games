import { appendFileSync, existsSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { loadConfig } from "./config.js";
import { startBridge } from "./bridge.js";

// The bridge's entry point (`npm start`). Startup order and why: bridge.ts.
//
// Anything that stops the bridge is also appended to bridge-error.log in the
// scanner-bridge folder, because when Task Scheduler starts it at log-on
// there's no console window to read.

/** The scanner-bridge folder (this file is dist/index.js or src/index.ts). */
const BRIDGE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ERROR_LOG = path.join(BRIDGE_DIR, "bridge-error.log");
const ERROR_LOG_MAX_BYTES = 512 * 1024;

// .env from the bridge's own folder, whichever folder it was started from
// (a Task Scheduler task with no "Start in" runs in C:\Windows\System32).
const bridgeEnv = path.join(BRIDGE_DIR, ".env");
const envFile = existsSync(bridgeEnv) ? bridgeEnv : path.resolve(".env");
dotenv.config({ path: envFile, quiet: true });

function recordStop(reason: string): void {
  try {
    const line = `${new Date().toISOString()}  ${reason.replace(/\s+/g, " ").trim()}\n`;
    const tooBig = existsSync(ERROR_LOG) && statSync(ERROR_LOG).size > ERROR_LOG_MAX_BYTES;
    if (tooBig) writeFileSync(ERROR_LOG, line);
    else appendFileSync(ERROR_LOG, line);
  } catch {
    // Logging must never be the thing that fails.
  }
}

function stop(reason: string): never {
  console.error(`[geega-scanner-bridge] Stopped: ${reason}`);
  recordStop(reason);
  process.exit(1);
}

function warnIfOldNode(): void {
  const major = Number.parseInt(process.versions.node.split(".")[0] ?? "0", 10);
  if (major < 22) {
    console.warn(
      `[geega-scanner-bridge] This bridge needs Node.js 22 or newer, and this PC has ${process.version}. ` +
        "Install the current LTS from https://nodejs.org, then run npm install and npm run build again.",
    );
  }
}

async function main() {
  console.log(
    `[geega-scanner-bridge] Starting… (settings: ${existsSync(envFile) ? envFile : `no .env found in ${BRIDGE_DIR}`})`,
  );
  warnIfOldNode();
  const config = loadConfig();
  const bridge = await startBridge(config);
  await bridge.ready;
  const recognizer = bridge.status.recognizer;
  console.log(
    `[geega-scanner-bridge] Ready. Duplex: ${config.duplex}. Scanner: ${config.scannerName}. ` +
      `Scan resolution: ${config.scanDpi} dpi. Card recognizer: ` +
      (config.recognizer.enabled
        ? recognizer.state === "unavailable"
          ? "can't run on this PC (see the dashboard's Scanner panel)"
          : `on (data in ${config.recognizer.dataDir})`
        : "off") +
      ".",
  );
}

process.on("unhandledRejection", (err) => {
  console.error("[geega-scanner-bridge] Unhandled rejection (continuing):", err);
});

process.on("uncaughtException", (err) => {
  stop(`Unexpected error: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`);
});

main().catch((err) => {
  stop(err instanceof Error ? err.message : String(err));
});
