import path from "node:path";
import type { BridgeConfig } from "./config.js";

// "Scan now" has three kinds of batch, picked on the dashboard next to the
// Foil / Non-foil switch. They are the session scan modes the rest of the
// app already knows (scan_recognition_mode):
//
// - "card_matching" — Inventory scan: identify each card from its front.
//   No grading. Fronts only, at the inventory resolution (300 dpi unless
//   SCAN_DPI says otherwise).
// - "condition" — Condition scan: grade each card from both sides at 600
//   dpi so wear shows. No matching (staff match with Find Match).
// - "both" — Inventory + condition scan: identify AND grade, both sides at
//   600 dpi.
//
// Each kind goes into its own session, so a session never mixes batches
// that were paired, scanned or processed differently. PaperStream-dropped
// files are the bridge's own SCAN_MODE.
//
// A batch's kind travels in its file names (the NAPS2 file prefix), not in
// shared state: pages can still be settling on disk after the scan ends, or
// a second batch can start before the first one uploads, and neither may
// mix into another kind's batch (front/back pairing and the session both
// depend on it).

export type ScanKind = BridgeConfig["scanMode"];

export const SCAN_KINDS: readonly ScanKind[] = ["card_matching", "condition", "both"];

/** What staff call each kind (the dashboard's switch says the same). */
export const SCAN_KIND_NAME: Record<ScanKind, string> = {
  card_matching: "inventory scan",
  condition: "condition scan",
  both: "inventory + condition scan",
};

/** Wear and whitening show far better at 600 dpi; every batch that grades uses it. */
export const CONDITION_SCAN_DPI = 600;

const FILE_TAG: Record<ScanKind, string> = {
  card_matching: "inventory",
  condition: "condition",
  both: "condition-inventory",
};
const FILE_PREFIX = /^geega-(inventory|condition|condition-inventory)_/;
const KIND_BY_TAG = new Map(SCAN_KINDS.map((k) => [FILE_TAG[k], k]));

export function isScanKind(value: unknown): value is ScanKind {
  return value === "card_matching" || value === "condition" || value === "both";
}

/**
 * A scan type from the dashboard; "standard" (sent by the 1.2.0 dashboard)
 * means the bridge's own SCAN_MODE. Null for anything else.
 */
export function parseScanKind(value: unknown, standard: ScanKind): ScanKind | null {
  if (isScanKind(value)) return value;
  if (value === "standard") return standard;
  return null;
}

/** NAPS2 file prefix for one "Scan now" run, unique per run. */
export function filePrefixFor(kind: ScanKind, now = Date.now()): string {
  return `geega-${FILE_TAG[kind]}_${now}`;
}

/** True for pages "Scan now" saved (as opposed to PaperStream's own files). */
export function isScanNowFile(filePath: string): boolean {
  return FILE_PREFIX.test(path.basename(filePath));
}

/** Which kind of batch a scanned file belongs to; files not from "Scan now" are the bridge's own mode. */
export function scanKindOfFile(filePath: string, fallback: ScanKind): ScanKind {
  const tag = path.basename(filePath).match(FILE_PREFIX)?.[1];
  return (tag && KIND_BY_TAG.get(tag)) || fallback;
}

/** How one kind of batch is scanned and paired: both sides or fronts only, and at what resolution. */
export function scanSettingsFor(
  kind: ScanKind,
  config: Pick<BridgeConfig, "inventoryScanDpi">,
): { duplex: boolean; dpi: number } {
  return kind === "card_matching"
    ? { duplex: false, dpi: config.inventoryScanDpi }
    : { duplex: true, dpi: CONDITION_SCAN_DPI };
}

/** Resolution of each kind of batch, for the dashboard. */
export function scanDpiByKind(config: Pick<BridgeConfig, "inventoryScanDpi">): Record<ScanKind, number> {
  return {
    card_matching: scanSettingsFor("card_matching", config).dpi,
    condition: scanSettingsFor("condition", config).dpi,
    both: scanSettingsFor("both", config).dpi,
  };
}

const SESSION_FILE: Record<ScanKind, string> = {
  // The name every bridge before 1.3.0 used, so an open session carries
  // over (ensureSession only reuses it if its mode matches).
  both: ".geega-session-id",
  condition: ".geega-condition-session-id",
  card_matching: ".geega-inventory-session-id",
};

/** Where one kind's current session id is kept between batches and restarts. */
export function sessionStateFileFor(kind: ScanKind, sessionStateFile: string): string {
  return path.join(path.dirname(sessionStateFile), SESSION_FILE[kind]);
}

/** Every kind's session id file (POST /session/end clears them all). */
export function allSessionStateFiles(sessionStateFile: string): string[] {
  return SCAN_KINDS.map((k) => sessionStateFileFor(k, sessionStateFile));
}
