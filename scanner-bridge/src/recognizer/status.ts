import os from "node:os";
import path from "node:path";
import type { BuildProgress } from "./indexBuilder.js";
import type { SelfTestReport } from "./selfTest.js";

// The recognizer's settings and the status it reports to the dashboard.
//
// They live apart from runtime.ts on purpose. runtime.ts loads ONNX Runtime
// and sharp, whose native code can fail to load on a given PC. On Windows,
// ONNX Runtime needs the Microsoft Visual C++ Redistributable, which Node.js
// itself doesn't. The rest of the bridge (config, status server, watcher,
// uploads) only ever imports this file, so it keeps scanning and uploading
// whatever happens to the recognizer. index.ts loads the recognizer itself
// with a dynamic import() and reports any failure here.
// src/coreImports.test.ts guards that boundary.

export type RecognizerState =
  | "off"
  | "starting"
  | "downloading_model"
  | "building_library"
  | "ready"
  /** Something went wrong; it retries on its own, and "Try again" retries now. */
  | "error"
  /** Can't run on this PC until something is installed or fixed; see `help`. */
  | "unavailable";

/** A link to the fix, shown as a button next to the message. */
export interface RecognizerHelp {
  label: string;
  url: string;
}

export interface RecognizerStatus {
  state: RecognizerState;
  message: string;
  help: RecognizerHelp | null;
  library: {
    entries: number;
    builtAt: string;
    cardListRefreshedAt: string | null;
  } | null;
  build: BuildProgress | null;
  /** Bytes of the model download so far (while downloading). */
  modelDownload: { receivedBytes: number; totalBytes: number | null } | null;
  selfTest: SelfTestReport | null;
  selfTestRunning: boolean;
  textReader: boolean;
  lastError: string | null;
}

export interface RecognizerRuntimeConfig {
  enabled: boolean;
  dataDir: string;
  autoUpdate: boolean;
  maxLibraryAgeDays: number;
  downloadConcurrency: number;
  referenceCacheBytes: number;
  threads: number;
  fallbackDpi: number;
  selfTestSamples: number;
}

export function defaultDataDir(): string {
  const base = process.env.LOCALAPPDATA ?? path.join(os.homedir(), ".local", "share");
  return path.join(base, "GeegaScannerBridge");
}

export function createRecognizerStatus(enabled: boolean): RecognizerStatus {
  return {
    state: enabled ? "starting" : "off",
    message: enabled ? "Starting the card recognizer…" : "Card recognizer is turned off (RECOGNIZER=off).",
    help: null,
    library: null,
    build: null,
    modelDownload: null,
    selfTest: null,
    selfTestRunning: false,
    textReader: false,
    lastError: null,
  };
}

/** The status shown when the recognizer can't load on this PC at all. */
export function unavailableRecognizerStatus(message: string, help: RecognizerHelp | null, detail: string): RecognizerStatus {
  return { ...createRecognizerStatus(true), state: "unavailable", message, help, lastError: detail };
}
