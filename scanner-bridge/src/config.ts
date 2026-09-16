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
    scanMode,
    batchQuietMs: optionalInt("BATCH_QUIET_MS", 5000),
    statusPort: optionalInt("STATUS_PORT", 8787),
    sessionStateFile: path.join(watchFolder, ".geega-session-id"),
  };
}
