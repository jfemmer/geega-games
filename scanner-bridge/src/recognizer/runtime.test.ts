import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { RecognizerRuntime, type RecognizerRuntimeConfig } from "./runtime.js";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "geega-runtime-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

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

describe("RecognizerRuntime", () => {
  it("stays off when turned off", async () => {
    const runtime = new RecognizerRuntime({ config: config({ enabled: false }), supabase, isBusy: () => false, log: () => undefined });
    await runtime.start();
    expect(runtime.status.state).toBe("off");
    expect(runtime.recognizer).toBeNull();
    expect(runtime.requestUpdate()).toBe(false);
  });

  it("explains what to do when there's no model yet and automatic setup is off", async () => {
    const runtime = new RecognizerRuntime({ config: config(), supabase, isBusy: () => false, log: () => undefined });
    await runtime.start();
    expect(runtime.status.state).toBe("error");
    expect(runtime.status.message).toMatch(/npm run build-index/);
    expect(runtime.status.textReader).toBe(true);
    expect(runtime.recognizer).toBeNull();
  });
});
