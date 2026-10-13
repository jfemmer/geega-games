import { existsSync, mkdirSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createPaddleTextReader, type TextReader } from "./collectorOcr.js";
import { createOnnxEmbedder, type ImageEmbedder } from "./embedder.js";
import { createOnnxLibrarySearch, jsLibrarySearch, type LibrarySearch } from "./fastSearch.js";
import { buildLibrary } from "./indexBuilder.js";
import { loadLibrary, type Library } from "./indexStore.js";
import { ensureModel, FINGERPRINT_MODEL, ocrModelPaths } from "./modelFiles.js";
import { CardRecognizer } from "./recognizer.js";
import { createReferenceProvider, type ReferenceProvider } from "./referenceImages.js";
import { runSelfTest, type SelfTestReport } from "./selfTest.js";
import { createRecognizerStatus, type RecognizerRuntimeConfig, type RecognizerState, type RecognizerStatus } from "./status.js";

export type { RecognizerRuntimeConfig, RecognizerState, RecognizerStatus } from "./status.js";

// Keeps the recognizer running inside the bridge: loads the model and the
// card library at startup, builds the library in the background the first
// time (and refreshes it when it's a week old), runs the self-test after
// each build, and reports all of it to the dashboard's Scanner panel through
// the bridge's /status endpoint. Scans keep flowing the whole time. Until
// the library is ready, they simply go to the old cloud recognizer.
//
// The bridge loads this module lazily (index.ts → bridge.ts), never through
// a static import: it pulls in ONNX Runtime and sharp, and if their native
// code can't load on a PC, that must not stop scanning (see status.ts).
//
// A start that fails (no internet for the model download, say) tries again
// on its own, soon at first and then hourly. "Try again" in the dashboard
// (POST /library/update) retries right away.

/** Minutes before retrying a failed start, by how many have failed in a row. */
const START_RETRY_MINUTES = [2, 10, 30, 60];

export function startRetryDelayMs(failures: number): number {
  const i = Math.min(Math.max(1, failures), START_RETRY_MINUTES.length) - 1;
  return START_RETRY_MINUTES[i] * 60_000;
}

function minutesText(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  return minutes >= 60 && minutes % 60 === 0
    ? `${minutes / 60} hour${minutes === 60 ? "" : "s"}`
    : `${minutes} minute${minutes === 1 ? "" : "s"}`;
}

function asSentence(text: string): string {
  const t = text.trim();
  return /[.!?…]$/.test(t) ? t : `${t}.`;
}

export class RecognizerRuntime {
  readonly status: RecognizerStatus;
  private readonly config: RecognizerRuntimeConfig;
  private readonly supabase: SupabaseClient;
  private readonly isBusy: () => boolean;
  private readonly log: (msg: string) => void;
  private readonly retryFailedStart: boolean;
  private embedder: ImageEmbedder | null = null;
  private reader: TextReader | null = null;
  private readerTried = false;
  private references: ReferenceProvider | null = null;
  private current: CardRecognizer | null = null;
  private building: Promise<void> | null = null;
  private starting: Promise<void> | null = null;
  private startFailures = 0;
  private buildFailures = 0;
  private retryTimer: NodeJS.Timeout | null = null;
  private updateTimer: NodeJS.Timeout | null = null;

  constructor(options: {
    config: RecognizerRuntimeConfig;
    supabase: SupabaseClient;
    /** True while the bridge is scanning or uploading. The library build pauses then. */
    isBusy: () => boolean;
    log?: (msg: string) => void;
    /** Retry a failed start on a timer (default true; the command-line tools turn it off). */
    retryFailedStart?: boolean;
  }) {
    this.config = options.config;
    this.supabase = options.supabase;
    this.isBusy = options.isBusy;
    this.log = options.log ?? ((m) => console.log(`[geega-scanner-bridge] ${m}`));
    this.retryFailedStart = options.retryFailedStart ?? true;
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

  /**
   * Loads the model and the card library, downloading or building whatever
   * is missing. Safe to call again: it carries on from where a failed
   * attempt stopped, and concurrent calls share one attempt.
   */
  start(): Promise<void> {
    if (!this.config.enabled) return Promise.resolve();
    if (!this.starting) {
      this.starting = this.startOnce().finally(() => {
        this.starting = null;
      });
    }
    return this.starting;
  }

  private async startOnce(): Promise<void> {
    this.clearRetry();
    try {
      mkdirSync(this.config.dataDir, { recursive: true });
      this.references ??= createReferenceProvider({
        cacheDir: path.join(this.config.dataDir, "reference-cache"),
        maxBytes: this.config.referenceCacheBytes,
      });
      this.status.selfTest ??= await readFile(this.selfTestFile, "utf8")
        .then((t) => JSON.parse(t) as SelfTestReport)
        .catch(() => null);
      if (!this.readerTried) await this.startTextReader();

      if (!this.embedder) {
        const modelsDir = path.join(this.config.dataDir, "models");
        if (!existsSync(path.join(modelsDir, FINGERPRINT_MODEL.fileName))) {
          if (!this.config.autoUpdate) {
            this.setState("error", "The fingerprint model isn't downloaded yet. Run `npm run build-index` once.");
            return;
          }
          this.setState("downloading_model", "Downloading the card-recognition model (88 MB, one time)…");
        } else if (this.status.state === "error") {
          this.setState("starting", "Starting the card recognizer…");
        }
        const verifiedPath = await ensureModel(modelsDir, FINGERPRINT_MODEL, {
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
        this.status.lastError = null;
      }

      if (!this.current && !this.building) {
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
      }
      this.startFailures = 0;
      if (!this.updateTimer) {
        // Check daily whether the library is due for a refresh.
        this.updateTimer = setInterval(() => {
          if (this.current && this.config.autoUpdate && this.isStale(this.current.library)) this.requestUpdate();
        }, 24 * 3600_000);
        this.updateTimer.unref();
      }
    } catch (err) {
      this.status.modelDownload = null;
      const reason = err instanceof Error ? err.message : String(err);
      this.status.lastError = reason;
      this.startFailures++;
      if (this.retryFailedStart) {
        const delay = startRetryDelayMs(this.startFailures);
        this.setState(
          "error",
          `Card recognizer couldn't start: ${asSentence(reason)} It will try again in ${minutesText(delay)}, or click "Try again".`,
        );
        this.log(`Card recognizer couldn't start: ${asSentence(reason)} Trying again in ${minutesText(delay)}.`);
        this.retryTimer = setTimeout(() => void this.start(), delay);
        this.retryTimer.unref();
      } else {
        this.setState("error", `Card recognizer couldn't start: ${asSentence(reason)}`);
        this.log(`Card recognizer couldn't start: ${reason}`);
      }
    }
  }

  /** The collector-number reader is a bonus: without it, recognition relies on pictures alone. */
  private async startTextReader(): Promise<void> {
    this.readerTried = true;
    const ocr = ocrModelPaths();
    if (!ocr) {
      this.log("Collector-number reader model not found — recognition will rely on pictures only.");
      return;
    }
    try {
      this.reader = await createPaddleTextReader(ocr.recognitionPath, ocr.dictionaryPath, Math.min(2, this.config.threads));
      this.status.textReader = true;
    } catch (err) {
      this.log(
        `Collector-number reader couldn't start (${err instanceof Error ? err.message : err}) — recognition will rely on pictures only.`,
      );
    }
  }

  private clearRetry(): void {
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
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
      // Slower but equivalent, so never a reason not to recognize.
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
    this.status.lastError = null;
    this.setState("ready", `Ready — ${library.entries.length.toLocaleString("en-US")} card faces in the library.`);
  }

  private setState(state: RecognizerState, message: string): void {
    this.status.state = state;
    this.status.message = message;
  }

  /**
   * Starts a library build/update in the background, or, if the recognizer
   * never finished starting (its model download failed, say), tries starting
   * it again. False if that's already under way or can't happen.
   */
  requestUpdate(): boolean {
    if (!this.config.enabled || this.building) return false;
    if (!this.embedder || !this.references) {
      if (this.starting) return false;
      void this.start();
      return true;
    }
    const embedder = this.embedder;
    const references = this.references;
    this.clearRetry();
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
        this.buildFailures = 0;
        await this.activate(result.library);
        this.log(`Card library ready: ${result.library.entries.length} faces (${result.added} new) in ${Math.round(result.durationMs / 60000)} min.`);
        if (result.added > 0 || !this.status.selfTest) await this.selfTest();
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        this.status.lastError = message;
        this.status.build = null;
        if (this.current) {
          // The daily check tries again tomorrow; the current library keeps working.
          this.log(`Card library update failed (keeping the current one): ${message}`);
        } else if (this.retryFailedStart) {
          // No library at all yet (the first, overnight build): don't wait for
          // a restart. The build is resumable, so a retry continues from here.
          this.buildFailures++;
          const delay = startRetryDelayMs(this.buildFailures);
          this.setState(
            "error",
            `Building the card library failed: ${asSentence(message)} It will try again in ${minutesText(delay)}, or click "Try again".`,
          );
          this.log(`Building the card library failed: ${asSentence(message)} Trying again in ${minutesText(delay)}.`);
          this.retryTimer = setTimeout(() => this.requestUpdate(), delay);
          this.retryTimer.unref();
        } else {
          this.setState("error", `Building the card library failed: ${asSentence(message)}`);
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

  /** Waits for a running start and build (command-line use). */
  async waitForBuild(): Promise<void> {
    await this.starting;
    await this.building;
  }

  /** Stops the background timers (tests, command-line tools). */
  dispose(): void {
    this.clearRetry();
    if (this.updateTimer) {
      clearInterval(this.updateTimer);
      this.updateTimer = null;
    }
  }
}
