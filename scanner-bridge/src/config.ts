import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";

// All configuration is read from environment variables (.env in this
// folder, loaded by index.ts) — nothing is hardcoded, so the same build
// works for any Geega deployment and any staff account. Fails loudly and
// immediately on a missing required value rather than limping along with a
// guessed default (Part 19: no silent misconfiguration).

function required(name: string): string {
  const v = process.env[name]?.trim();
  if (!v) {
    throw new Error(
      `Missing required environment variable ${name}. Copy .env.example to .env and fill it in.`,
    );
  }
  return v;
}

function optional(name: string, fallback: string): string {
  const v = process.env[name]?.trim();
  return v && v.length > 0 ? v : fallback;
}

function optionalInt(name: string, fallback: number): number {
  const v = process.env[name]?.trim();
  if (!v) return fallback;
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : fallback;
}

export interface BridgeConfig {
  /** Full base URL of the deployed Geega app, e.g. https://app.geegagames.com — no trailing slash. */
  apiBaseUrl: string;
  supabaseUrl: string;
  supabaseAnonKey: string;
  staffEmail: string;
  staffPassword: string;
  watchFolder: string;
  processedFolder: string;
  failedFolder: string;
  /** True: consecutive files alternate front/back of the same card (fi-8170
   * duplex ADF batch). Derived from scanMode, not a separate choice —
   * condition grading needs both sides, card-matching-only needs just the
   * front. See scanMode below. */
  duplex: boolean;
  scannerName: string;
  /** Path to NAPS2's console executable (NAPS2.Console.exe), which drives
   * the scanner directly for the dashboard's "Scan now" button — no
   * PaperStream IP window. NAPS2 is a free, separately-installed
   * third-party tool (https://www.naps2.com/download); see
   * scanner-bridge/README.md section 7 for setup and why NAPS2 rather than
   * scripting WIA directly. Not validated at startup (unlike watchFolder)
   * since it's only needed for this one optional feature — the bridge's
   * core watch-and-upload path works fine without it. */
  naps2ConsolePath: string;
  /** Scanning backend NAPS2 uses to talk to the driver. "twain" is the
   * default: confirmed on real hardware that this fi-8170's WIA driver
   * implements property read/write but not Transfer at all, while
   * PaperStream IP itself — like most production/ADF scanner vendors'
   * software — almost certainly drives it via TWAIN, so that's the backend
   * actually proven to work with this device. "wia" is available to try as
   * a fallback (NAPS2's own WIA support goes through the modern low-level
   * WIA2 interfaces, not the legacy Automation Layer that failed here, so
   * it isn't necessarily subject to the same bug) — see .env.example. */
  scannerDriver: ScannerDriver;
  /** Substring to match against scan device names (case-insensitive), in
   * case more than one scanner is ever registered on this PC. The real
   * string the driver reports isn't verified here, so this is adjustable
   * without a code change: run the "Check scanner connection" action in
   * the admin dashboard to see the real name and set this if the "8170"
   * default doesn't match it. */
  scannerDeviceNameMatch: string;
  /** What the recognition pipeline does for every card in sessions this
   * bridge creates. "both" (default) identifies and grades condition;
   * "card_matching" skips condition (and only needs a front scan);
   * "condition" skips identity (and needs both sides). */
  scanMode: "card_matching" | "condition" | "both";
  /** How long to wait for no new files before processing an accumulated batch — PaperStream writes a whole feed run's pages in a burst, not one at a time. */
  batchQuietMs: number;
  /** Bound to 127.0.0.1 only — never exposed beyond this machine. */
  statusPort: number;
  /** Where the current session id is persisted so a restart resumes instead of fragmenting into a new session. */
  sessionStateFile: string;
}

export function parseScanMode(value: string): "card_matching" | "condition" | "both" {
  if (value === "card_matching" || value === "condition" || value === "both") return value;
  throw new Error(
    `Invalid SCAN_MODE "${value}" — must be "card_matching", "condition", or "both".`,
  );
}

const SCANNER_DRIVERS = ["twain", "wia", "escl", "sane", "apple"] as const;
export type ScannerDriver = (typeof SCANNER_DRIVERS)[number];

export function parseScannerDriver(value: string): ScannerDriver {
  if ((SCANNER_DRIVERS as readonly string[]).includes(value)) return value as ScannerDriver;
  throw new Error(
    `Invalid SCANNER_DRIVER "${value}" — must be one of: ${SCANNER_DRIVERS.join(", ")}.`,
  );
}

/** Condition grading needs both sides; card-matching-only needs just the front. */
export function duplexForMode(mode: "card_matching" | "condition" | "both"): boolean {
  return mode !== "card_matching";
}

export function loadConfig(): BridgeConfig {
  const apiBaseUrl = required("GEEGA_API_BASE_URL").replace(/\/+$/, "");
  const watchFolder = path.resolve(required("WATCH_FOLDER"));
  if (!existsSync(watchFolder)) {
    throw new Error(`WATCH_FOLDER does not exist: ${watchFolder}`);
  }

  const processedFolder = path.resolve(
    optional("PROCESSED_FOLDER", path.join(watchFolder, "_processed")),
  );
  const failedFolder = path.resolve(
    optional("FAILED_FOLDER", path.join(watchFolder, "_failed")),
  );
  for (const dir of [processedFolder, failedFolder]) {
    mkdirSync(dir, { recursive: true });
  }

  const scanMode = parseScanMode(optional("SCAN_MODE", "both"));

  return {
    apiBaseUrl,
    supabaseUrl: required("SUPABASE_URL"),
    supabaseAnonKey: required("SUPABASE_ANON_KEY"),
    staffEmail: required("GEEGA_STAFF_EMAIL"),
    staffPassword: required("GEEGA_STAFF_PASSWORD"),
    watchFolder,
    processedFolder,
    failedFolder,
    duplex: duplexForMode(scanMode),
    scannerName: optional("SCANNER_NAME", "Ricoh fi-8170"),
    naps2ConsolePath: optional(
      "NAPS2_CONSOLE_PATH",
      "C:\\Program Files\\NAPS2\\NAPS2.Console.exe",
    ),
    scannerDriver: parseScannerDriver(optional("SCANNER_DRIVER", "twain")),
    scannerDeviceNameMatch: optional("SCANNER_DEVICE_NAME_MATCH", "8170"),
    scanMode,
    batchQuietMs: optionalInt("BATCH_QUIET_MS", 5000),
    statusPort: optionalInt("STATUS_PORT", 8787),
    sessionStateFile: path.join(watchFolder, ".geega-session-id"),
  };
}
