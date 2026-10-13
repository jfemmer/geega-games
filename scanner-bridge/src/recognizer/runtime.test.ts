import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";

// The model download and the collector-number reader are swapped for
// controllable stand-ins where a test needs them to fail; otherwise the
// real ones run (the reader's model ships in node_modules).
vi.mock("./modelFiles.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./modelFiles.js")>();
  return { ...actual, ensureModel: vi.fn(actual.ensureModel) };
});
vi.mock("./collectorOcr.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./collectorOcr.js")>();
  return { ...actual, createPaddleTextReader: vi.fn(actual.createPaddleTextReader) };
});

const { ensureModel } = await import("./modelFiles.js");
const { createPaddleTextReader } = await import("./collectorOcr.js");
const { RecognizerRuntime, startRetryDelayMs } = await import("./runtime.js");
type RecognizerRuntimeConfig = import("./runtime.js").RecognizerRuntimeConfig;

let dir: string;
let runtimes: InstanceType<typeof RecognizerRuntime>[] = [];
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "geega-runtime-"));
  runtimes = [];
});
afterEach(() => {
  for (const r of runtimes) r.dispose();
  vi.useRealTimers();
  vi.mocked(ensureModel).mockReset();
  vi.mocked(createPaddleTextReader).mockReset();
  rmSync(dir, { recursive: true, force: true });
});

function config(overrides: Partial<RecognizerRuntimeConfig> = {}): RecognizerRuntimeConfig {
  return {
    enabled: true,
    dataDir: dir,
    autoUpdate: false,
    maxLibraryAgeDays: 7,
    downloadConcurrency: 1,
    referenceCacheBytes: 10_000_000,
    threads: 1,
    fallbackDpi: 300,
    selfTestSamples: 20,
    ...overrides,
  };
}

const supabase = {} as SupabaseClient;

function runtime(overrides: Partial<RecognizerRuntimeConfig> = {}, log: (m: string) => void = () => undefined) {
  const r = new RecognizerRuntime({ config: config(overrides), supabase, isBusy: () => false, log });
  runtimes.push(r);
  return r;
}

/** What Node's fetch throws without internet. */
function offline(): Error {
  return Object.assign(new TypeError("fetch failed"), { cause: Object.assign(new Error("getaddrinfo ENOTFOUND huggingface.co"), { code: "ENOTFOUND" }) });
}

describe("RecognizerRuntime", () => {
  it("stays off when turned off", async () => {
    const r = runtime({ enabled: false });
    await r.start();
    expect(r.status.state).toBe("off");
    expect(r.recognizer).toBeNull();
    expect(r.requestUpdate()).toBe(false);
  });

  it("explains what to do when there's no model yet and automatic setup is off", async () => {
    const r = runtime();
    await r.start();
    expect(r.status.state).toBe("error");
    expect(r.status.message).toMatch(/npm run build-index/);
    expect(r.status.textReader).toBe(true);
    expect(r.recognizer).toBeNull();
  });

  it("carries on without the collector-number reader when it can't start", async () => {
    vi.mocked(createPaddleTextReader).mockRejectedValueOnce(new Error("Load model failed"));
    const logs: string[] = [];
    const r = runtime({}, (m) => logs.push(m));
    await r.start();
    expect(r.status.textReader).toBe(false);
    expect(r.status.message).toMatch(/npm run build-index/);
    expect(logs.join("\n")).toMatch(/Collector-number reader couldn't start \(Load model failed\)/);
  });

  it("says why the model download failed, retries on its own, and retries now on request", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
    // No ONNX Runtime needed for this one.
    vi.mocked(createPaddleTextReader).mockResolvedValue({ readLines: async () => [] } as unknown as Awaited<
      ReturnType<typeof createPaddleTextReader>
    >);
    const { ensureModel: realEnsureModel } = await vi.importActual<typeof import("./modelFiles.js")>("./modelFiles.js");
    // The real downloader's message for "no internet", without touching the network.
    vi.mocked(ensureModel).mockImplementation((modelsDir, spec) =>
      realEnsureModel(modelsDir, spec, { fetchImpl: () => Promise.reject(offline()) }),
    );
    const r = runtime({ autoUpdate: true });

    await r.start();
    expect(r.status.state).toBe("error");
    expect(r.status.message).toBe(
      "Card recognizer couldn't start: Couldn't reach huggingface.co to download the card-recognition model (ENOTFOUND). " +
        "Check this PC's internet connection. It will try again in 2 minutes, or click \"Try again\".",
    );
    expect(r.status.lastError).toMatch(/ENOTFOUND/);
    expect(r.status.modelDownload).toBeNull();
    expect(ensureModel).toHaveBeenCalledTimes(1);

    // On its own, after 2 minutes (then 10, 30, and hourly).
    await vi.advanceTimersByTimeAsync(startRetryDelayMs(1) - 1000);
    expect(ensureModel).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1000);
    await vi.waitFor(() => expect(r.status.message).toMatch(/try again in 10 minutes/));
    expect(ensureModel).toHaveBeenCalledTimes(2);

    // "Try again" in the dashboard: right away, and it replaces the pending timer.
    expect(r.requestUpdate()).toBe(true);
    await vi.waitFor(() => expect(r.status.message).toMatch(/try again in 30 minutes/));
    expect(ensureModel).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(startRetryDelayMs(2));
    expect(ensureModel).toHaveBeenCalledTimes(3);
  });

  it("spaces retries out to hourly", () => {
    expect([1, 2, 3, 4, 5, 20].map((n) => startRetryDelayMs(n) / 60_000)).toEqual([2, 10, 30, 60, 60, 60]);
  });
});
