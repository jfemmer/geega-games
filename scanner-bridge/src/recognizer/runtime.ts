import { existsSync, mkdirSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createPaddleTextReader, type TextReader } from "./collectorOcr.js";
import { createOnnxEmbedder, type ImageEmbedder } from "./embedder.js";
import { createOnnxLibrarySearch, jsLibrarySearch, type LibrarySearch } from "./fastSearch.js";
import { buildLibrary, type BuildProgress } from "./indexBuilder.js";
import { loadLibrary, type Library } from "./indexStore.js";
import { ensureModel, FINGERPRINT_MODEL, ocrModelPaths } from "./modelFiles.js";
import { CardRecognizer } from "./recognizer.js";
import { createReferenceProvider, type ReferenceProvider } from "./referenceImages.js";
import { runSelfTest, type SelfTestReport } from "./selfTest.js";

// Keeps the recognizer running inside the bridge: loads the model and the
// card library at startup, builds the library in the background the first
// time (and refreshes it when it's a week old), runs the self-test after
// each build, and reports all of it to the dashboard's Scanner panel through
// the bridge's /status endpoint. Scans keep flowing the whole time — until
// the library is ready they simply go to the old cloud recognizer.

export type RecognizerState =
  | "off"
  | "starting"
  | "downloading_model"
  | "building_library"
  | "ready"
  | "error";

export interface RecognizerStatus {
  state: RecognizerState;
  message: string;
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
    library: null,
    build: null,
    modelDownload: null,
    selfTest: null,
    selfTestRunning: false,
    textReader: false,
    lastError: null,
  };
}

export class RecognizerRuntime {
  readonly status: RecognizerStatus;
  private readonly config: RecognizerRuntimeConfig;
  private readonly supabase: SupabaseClient;
  private readonly isBusy: () => boolean;
  private readonly log: (msg: string) => void;
  private embedder: ImageEmbedder | null = null;
  private reader: TextReader | null = null;
  private references: ReferenceProvider | null = null;
  private current: CardRecognizer | null = null;
  private building: Promise<void> | null = null;
  private updateTimer: NodeJS.Timeout | null = null;

  constructor(options: {
    config: RecognizerRuntimeConfig;
    supabase: SupabaseClient;
    /** True while the bridge is scanning or uploading — the library build pauses then. */
    isBusy: () => boolean;
    log?: (msg: string) => void;
  }) {
    this.config = options.config;
    this.supabase = options.supabase;
    this.isBusy = options.isBusy;
    this.log = options.log ?? ((m) => console.log(`[geega-scanner-bridge] ${m}`));
    this.status = createRecognizerStatus(options.config.enabled);
  }

  /** The ready recognizer, or null (scans then use the cloud recognizer). */
  get recognizer(): CardRecognizer | null {
    return this.current;
  }

  private get libraryDir(): string {
    return path.join(this.config.dataDir, "library");
  }

  private get selfTestFile(): string {
    return path.join(this.config.dataDir, "self-test.json");
  }

  async start(): Promise<void> {
    if (!this.config.enabled) return;
    try {
      mkdirSync(this.config.dataDir, { recursive: true });
      this.references = createReferenceProvider({
        cacheDir: path.join(this.config.dataDir, "reference-cache"),
        maxBytes: this.config.referenceCacheBytes,
      });
      this.status.selfTest = await readFile(this.selfTestFile, "utf8")
        .then((t) => JSON.parse(t) as SelfTestReport)
        .catch(() => null);

      const ocr = ocrModelPaths();
      if (ocr) {
        this.reader = await createPaddleTextReader(ocr.recognitionPath, ocr.dictionaryPath, Math.min(2, this.config.threads));
        this.status.textReader = true;
      } else {
        this.log("Collector-number reader model not found — recognition will rely on pictures only.");
      }

      const modelPath = path.join(this.config.dataDir, "models", FINGERPRINT_MODEL.fileName);
      if (!existsSync(modelPath)) {
        if (!this.config.autoUpdate) {
          this.setState("error", "The fingerprint model isn't downloaded yet. Run `npm run build-index` once.");
          return;
        }
        this.setState("downloading_model", "Downloading the card-recognition model (88 MB, one time)…");
      }
      const verifiedPath = await ensureModel(path.join(this.config.dataDir, "models"), FINGERPRINT_MODEL, {
        onProgress: (p) => {
          this.status.modelDownload = p;
        },
      });
      this.status.modelDownload = null;
      this.embedder = await createOnnxEmbedder({
        modelPath: verifiedPath,
        modelId: FINGERPRINT_MODEL.id,
        inputSize: FINGERPRINT_MODEL.inputSize,
        threads: this.config.threads,
      });

      const library = await loadLibrary(this.libraryDir).catch((err) => {
        this.log(`Couldn't read the card library (${err instanceof Error ? err.message : err}) — it will be rebuilt.`);
        return null;
      });
      if (library && library.manifest.model.id === this.embedder.modelId) {
        await this.activate(library);
        if (this.isStale(library)) this.requestUpdate();
      } else if (this.config.autoUpdate) {
        this.requestUpdate();
      } else {
        this.setState("error", "No card library yet. Run `npm run build-index` once.");
      }
      // Check daily whether the library is due for a refresh.
      this.updateTimer = setInterval(() => {
        if (this.current && this.config.autoUpdate && this.isStale(this.current.library)) this.requestUpdate();
      }, 24 * 3600_000);
      this.updateTimer.unref();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.status.lastError = message;
      this.setState("error", `Card recognizer couldn't start: ${message}`);
      this.log(`Card recognizer couldn't start: ${message}`);
    }
  }

  private isStale(library: Library): boolean {
    const age = Date.now() - Date.parse(library.manifest.builtAt);
    return !Number.isFinite(age) || age > this.config.maxLibraryAgeDays * 24 * 3600_000;
  }

  private async activate(library: Library): Promise<void> {
    if (!this.embedder || !this.references) return;
    let search: LibrarySearch;
    try {
      search = await createOnnxLibrarySearch(library.index, this.config.threads);
    } catch (err) {
      // Slower but equivalent — never a reason not to recognize.
      this.log(`Fast library search unavailable (${err instanceof Error ? err.message : err}) — using the built-in search.`);
      search = jsLibrarySearch(library.index);
    }
    this.current = new CardRecognizer({
      embedder: this.embedder,
      library,
      search,
      references: this.references,
      reader: this.reader,
      fallbackDpi: this.config.fallbackDpi,
    });
    this.status.library = {
      entries: library.entries.length,
      builtAt: library.manifest.builtAt,
      cardListRefreshedAt: library.manifest.cardListRefreshedAt,
    };
    this.setState("ready", `Ready — ${library.entries.length.toLocaleString("en-US")} card faces in the library.`);
  }

  private setState(state: RecognizerState, message: string): void {
    this.status.state = state;
    this.status.message = message;
  }

  /** Starts a library build/update in the background. False if one is already running or it can't run. */
  requestUpdate(): boolean {
    if (!this.config.enabled || !this.embedder || !this.references || this.building) return false;
    const embedder = this.embedder;
    const references = this.references;
    if (!this.current) this.setState("building_library", "Building the card library (first time: a few hours)…");
    this.building = (async () => {
      try {
        const result = await buildLibrary({
          supabase: this.supabase,
          libraryDir: this.libraryDir,
          embedder,
          references,
          concurrency: this.config.downloadConcurrency,
          shouldPause: this.isBusy,
          log: this.log,
          onProgress: (p) => {
            this.status.build = p;
            if (!this.current) {
              const pct = p.total > 0 ? Math.floor((p.done / p.total) * 100) : 0;
              this.status.message =
                p.phase === "reading_card_list"
                  ? "Reading the Scryfall card list…"
                  : p.phase === "fingerprinting"
                    ? `Building the card library… ${pct}% (${p.done.toLocaleString("en-US")} of ${p.total.toLocaleString("en-US")})`
                    : "Saving the card library…";
            }
          },
        });
        this.status.build = null;
        this.status.lastError = null;
        await this.activate(result.library);
        this.log(`Card library ready: ${result.library.entries.length} faces (${result.added} new) in ${Math.round(result.durationMs / 60000)} min.`);
        if (result.added > 0 || !this.status.selfTest) await this.selfTest();
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        this.status.lastError = message;
        this.status.build = null;
        if (this.current) {
          this.log(`Card library update failed (keeping the current one): ${message}`);
        } else {
          this.setState("error", `Building the card library failed: ${message}. It will try again on the next start, or click "Update card library".`);
        }
      } finally {
        this.building = null;
      }
    })();
    return true;
  }

  /** Runs the self-test against the current library and saves the report. */
  async selfTest(samples = this.config.selfTestSamples): Promise<SelfTestReport | null> {
    if (!this.current || !this.references || this.status.selfTestRunning) return null;
    this.status.selfTestRunning = true;
    try {
      const report = await runSelfTest({ recognizer: this.current, references: this.references, samples });
      this.status.selfTest = report;
      await writeFile(this.selfTestFile, JSON.stringify(report, null, 2)).catch(() => undefined);
      this.log(
        `Self-test: ${(report.exactPrinting * 100).toFixed(1)}% exact printing, ${(report.rightName * 100).toFixed(1)}% right card, ` +
          `${report.sureCorrect}/${report.sure} "sure" correct, ~${report.meanMs} ms per card.`,
      );
      return report;
    } catch (err) {
      this.log(`Self-test failed: ${err instanceof Error ? err.message : err}`);
      return null;
    } finally {
      this.status.selfTestRunning = false;
    }
  }

  /** Waits for a running build (CLI use). */
  async waitForBuild(): Promise<void> {
    await this.building;
  }
}
