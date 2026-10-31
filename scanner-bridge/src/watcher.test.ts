import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ApiClient } from "./apiClient.js";
import type { BridgeConfig } from "./config.js";
import { createStatus } from "./statusServer.js";

// Regression coverage for a real production bug: a multi-card batch scanned
// through the bridge produced only ONE card_scans row instead of several
// (confirmed at the database level — one session, one front-only row, one
// Storage object, total_files: 1). Root cause traced to two related races
// in processBatch()'s quiet-period trigger, neither hit by
// statusServer.test.ts (which mocks this module out entirely):
//
// 1. A file whose own quiet timer fires while a PREVIOUS batch is still
//    uploading used to be silently dropped — processBatch()'s guard
//    returned early with no reschedule, and nothing else would ever
//    re-trigger it short of an unrelated future scan.
// 2. resumeAndProcessNow() (called the instant a direct scan's NAPS2
//    process exits) used to call processBatch() immediately, racing
//    chokidar's awaitWriteFinish — a page finished writing just before
//    NAPS2 exits may not have been stable for its 1s stabilityThreshold
//    yet, so it wasn't in `pending` at all when processing started.
//
// uploader.ts is mocked (no real network/Supabase calls); chokidar's real
// filesystem watching and timers are NOT mocked — this exercises the real
// race, not a description of it. That means these tests take real
// wall-clock seconds (chokidar's stabilityThreshold is 1000ms, hardcoded)
// rather than being instant. startWatcher() has no teardown API (matches
// index.ts, which never shuts the bridge down gracefully either — it's a
// long-running console program), so each test leaks one chokidar handle
// for the life of the test process; harmless, and out of scope to fix here.

vi.mock("./uploader.js", () => ({
  ensureSession: vi.fn(),
  uploadBatch: vi.fn(),
}));
const { ensureSession, uploadBatch } = await import("./uploader.js");
const mockEnsureSession = vi.mocked(ensureSession);
const mockUploadBatch = vi.mocked(uploadBatch);

const { startWatcher } = await import("./watcher.js");

type BatchResult = Awaited<ReturnType<typeof uploadBatch>>;
type PairedCard = Parameters<typeof uploadBatch>[3][number];

function emptyBatchResult(): BatchResult {
  return {
    cardsCreated: 0,
    cardsRecognized: 0,
    cardsFailedRecognition: 0,
    cardsRecognizedOnPc: 0,
    fileOutcomes: [],
    retryLater: [],
    retryReason: null,
  };
}

function testConfig(dir: string, overrides: Partial<BridgeConfig> = {}): BridgeConfig {
  return {
    apiBaseUrl: "https://example.test",
    supabaseUrl: "https://x.supabase.co",
    supabaseAnonKey: "anon-key",
    staffEmail: "staff@example.test",
    staffPassword: "pw",
    watchFolder: dir,
    processedFolder: path.join(dir, "_processed"),
    failedFolder: path.join(dir, "_failed"),
    duplex: false,
    scannerName: "Ricoh fi-8170",
    naps2ConsolePath: "C:\\NAPS2.Console.exe",
    scannerDriver: "twain",
    scannerDeviceNameMatch: "8170",
    scanMode: "card_matching",
    batchQuietMs: 50,
    statusPort: 0,
    sessionStateFile: path.join(dir, ".geega-session-id"),
    scanDpi: 300,
    inventoryScanDpi: 300,
    recognizer: {
      enabled: false,
      dataDir: path.join(dir, "data"),
      autoUpdate: false,
      maxLibraryAgeDays: 7,
      downloadConcurrency: 1,
      referenceCacheBytes: 1024 * 1024,
      threads: 1,
      fallbackDpi: 300,
      selfTestSamples: 20,
    },
    ...overrides,
  };
}

const fakeApi = {} as unknown as ApiClient;
const fakeSupabase = {} as unknown as SupabaseClient;

describe("startWatcher — straggler-file races", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "geega-watcher-test-"));
    mkdirSync(path.join(dir, "_processed"), { recursive: true });
    mkdirSync(path.join(dir, "_failed"), { recursive: true });
    mockEnsureSession.mockReset();
    mockUploadBatch.mockReset();
    mockEnsureSession.mockResolvedValue("session-1");
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("does not drop a file that arrives mid-upload — picks it up once the in-flight batch finishes", async () => {
    const config = testConfig(dir, { batchQuietMs: 30 });
    let resolveFirstUpload!: (r: BatchResult) => void;
    mockUploadBatch.mockImplementationOnce(
      () => new Promise<BatchResult>((resolve) => (resolveFirstUpload = resolve)),
    );
    mockUploadBatch.mockResolvedValueOnce(emptyBatchResult());

    const status = createStatus(dir);
    startWatcher(config, fakeApi, fakeSupabase, status);

    writeFileSync(path.join(dir, "card1.tiff"), "a");

    // Wait for the first batch to actually start uploading (i.e.
    // processing === true internally).
    await vi.waitFor(() => expect(mockUploadBatch).toHaveBeenCalledTimes(1), { timeout: 3000 });

    // A second file lands WHILE the first upload is still in flight. Give
    // chokidar's awaitWriteFinish (1s) plus this file's own quiet timer
    // time to fire before the first upload resolves — this is exactly the
    // window where the old code dropped it.
    writeFileSync(path.join(dir, "card2.tiff"), "b");
    await new Promise((r) => setTimeout(r, 1500));
    expect(mockUploadBatch).toHaveBeenCalledTimes(1); // still just the first, in-flight call

    resolveFirstUpload(emptyBatchResult());

    await vi.waitFor(() => expect(mockUploadBatch).toHaveBeenCalledTimes(2), { timeout: 3000 });
    const secondCallPairs = mockUploadBatch.mock.calls[1][3] as PairedCard[];
    expect(secondCallPairs).toHaveLength(1);
    expect(secondCallPairs[0].front).toContain("card2.tiff");
  }, 10_000);

  it(
    "resumeAndProcessNow waits for a still-stabilizing straggler instead of splitting the batch",
    async () => {
      // batchQuietMs must be comfortably larger than chokidar's real
      // stabilization window (stabilityThreshold 1000ms + pollInterval
      // 200ms, hardcoded in watcher.ts) — that margin is exactly what lets
      // resumeAndProcessNow()'s timer get reset by a still-stabilizing
      // straggler's own later "add" event instead of firing too early and
      // splitting the batch. This mirrors the 5s production default, just
      // shorter so the test doesn't take that long for real.
      const config = testConfig(dir, { batchQuietMs: 2000 });
      mockUploadBatch.mockResolvedValue(emptyBatchResult());

      const status = createStatus(dir);
      const control = startWatcher(config, fakeApi, fakeSupabase, status);

      control.suppressAutoProcess();

      // card1 is written and allowed to fully stabilize while suppressed —
      // mirrors an early page in a multi-page direct scan.
      writeFileSync(path.join(dir, "card1.tiff"), "a");
      await new Promise((r) => setTimeout(r, 1600));

      // card2 lands just before the scan "finishes" — still inside
      // chokidar's stability window when resumeAndProcessNow() fires,
      // mirroring the last page written right before NAPS2's process exits.
      writeFileSync(path.join(dir, "card2.tiff"), "b");
      control.resumeAndProcessNow();

      await vi.waitFor(() => expect(mockUploadBatch).toHaveBeenCalled(), { timeout: 8000 });
      // Give plenty of extra time after the first call, so a second (wrong)
      // call — which the old code fired almost immediately — has every
      // chance to happen before we check.
      await new Promise((r) => setTimeout(r, 2500));

      expect(mockUploadBatch).toHaveBeenCalledTimes(1);
      const pairs = mockUploadBatch.mock.calls[0][3] as PairedCard[];
      const allFiles = pairs.flatMap((p) => [p.front, p.back]).filter((f): f is string => !!f);
      expect(allFiles.some((f) => f.includes("card1.tiff"))).toBe(true);
      expect(allFiles.some((f) => f.includes("card2.tiff"))).toBe(true);
      // The Scanner panel's "Last batch" counts cards, not scanned sides.
      expect(status.lastBatchSize).toBe(pairs.length);
    },
    20_000,
  );
});

describe("startWatcher — scan types", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "geega-watcher-kind-test-"));
    mkdirSync(path.join(dir, "_processed"), { recursive: true });
    mkdirSync(path.join(dir, "_failed"), { recursive: true });
    mockEnsureSession.mockReset();
    mockUploadBatch.mockReset();
    mockEnsureSession.mockImplementation(async (_c, _a, _s, kind) => `${kind}-session`);
    mockUploadBatch.mockResolvedValue(emptyBatchResult());
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it(
    "never mixes them: each type is paired its own way and goes into its own session",
    async () => {
      // The bridge's own SCAN_MODE is the full scan (PaperStream files pair as front/back).
      const config = testConfig(dir, { scanMode: "both", duplex: true, batchQuietMs: 1500 });
      const status = createStatus(dir);
      const control = startWatcher(config, fakeApi, fakeSupabase, status);

      control.suppressAutoProcess();
      writeFileSync(path.join(dir, "geega-inventory_100_0001.jpg"), "i1");
      writeFileSync(path.join(dir, "geega-inventory_100_0002.jpg"), "i2");
      writeFileSync(path.join(dir, "geega-condition_200_0001.jpg"), "c1-front");
      writeFileSync(path.join(dir, "geega-condition_200_0002.jpg"), "c1-back");
      writeFileSync(path.join(dir, "geega-condition-inventory_300_0001.jpg"), "b1-front");
      writeFileSync(path.join(dir, "geega-condition-inventory_300_0002.jpg"), "b1-back");
      writeFileSync(path.join(dir, "card_00001.tif"), "p1-front");
      writeFileSync(path.join(dir, "card_00002.tif"), "p1-back");
      await new Promise((r) => setTimeout(r, 1600));
      control.resumeAndProcessNow();

      await vi.waitFor(() => expect(mockUploadBatch).toHaveBeenCalledTimes(4), { timeout: 8000 });

      const batches = mockUploadBatch.mock.calls.map((c) => ({ session: c[2], pairs: c[3] as PairedCard[], dpi: c[4]?.scanDpi }));
      const find = (session: string, name: string) =>
        batches.find((b) => b.session === session && b.pairs.some((p) => p.front?.includes(name)))!;

      // Inventory: two front-only cards, at 300 dpi.
      const inventory = find("card_matching-session", "geega-inventory_");
      expect(inventory.pairs).toHaveLength(2);
      expect(inventory.pairs.every((p) => p.back === null)).toBe(true);
      expect(inventory.dpi).toBe(300);
      // Condition and the full scan: one card each, front and back paired, at 600 dpi.
      const condition = find("condition-session", "geega-condition_");
      expect(condition.pairs).toEqual([expect.objectContaining({ back: expect.stringContaining("geega-condition_200_0002.jpg") })]);
      expect(condition.dpi).toBe(600);
      const full = find("both-session", "geega-condition-inventory_");
      expect(full.pairs).toHaveLength(1);
      expect(full.dpi).toBe(600);
      // PaperStream's pages: the bridge's own mode, paired by its own setting, resolution left to the file.
      const paperstream = find("both-session", "card_00001.tif");
      expect(paperstream.pairs).toEqual([expect.objectContaining({ back: expect.stringContaining("card_00002.tif") })]);
      expect(paperstream.dpi).toBeNull();

      expect(status.sessionsByKind).toEqual({
        card_matching: "card_matching-session",
        condition: "condition-session",
        both: "both-session",
      });
    },
    20_000,
  );

  it(
    "retries only the type that failed",
    async () => {
      const config = testConfig(dir, { batchQuietMs: 1500 });
      mockEnsureSession.mockImplementation(async (_c, _a, _s, kind) => {
        if (kind === "condition") throw new Error("server busy");
        return `${kind}-session`;
      });
      const status = createStatus(dir);
      const control = startWatcher(config, fakeApi, fakeSupabase, status);

      control.suppressAutoProcess();
      writeFileSync(path.join(dir, "geega-inventory_100_0001.jpg"), "i1");
      writeFileSync(path.join(dir, "geega-condition_200_0001.jpg"), "c1-front");
      writeFileSync(path.join(dir, "geega-condition_200_0002.jpg"), "c1-back");
      await new Promise((r) => setTimeout(r, 1600));
      control.resumeAndProcessNow();

      await vi.waitFor(() => expect(mockUploadBatch).toHaveBeenCalledTimes(1), { timeout: 8000 });
      await vi.waitFor(() => expect(status.state).toBe("watching"), { timeout: 3000 });
      expect(mockUploadBatch.mock.calls[0][2]).toBe("card_matching-session");
      expect(status.lastError).toBe("server busy");
      expect(status.sessionsByKind.condition).toBeNull();
    },
    20_000,
  );
});
