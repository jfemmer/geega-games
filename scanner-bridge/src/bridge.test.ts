import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { SignInError, type AuthedClient } from "./auth.js";
import { describePortConflict, signInRetryDelayMs, startBridge, type RecognizerModules, type RunningBridge } from "./bridge.js";
import { BRIDGE_VERSION } from "./version.js";
import type { BridgeConfig } from "./config.js";
import { createRecognizerStatus } from "./recognizer/status.js";
import type { BridgeStatus } from "./statusServer.js";
import type { WatcherControl } from "./watcher.js";

// Startup as the dashboard sees it: the status server answers first, the
// bridge keeps going when the card recognizer can't load on this PC (the
// crash that showed as "Not connected"), sign-in failures show their reason
// and retry, and a second copy refuses to start with a clear message.

vi.mock("./naps2Scan.js", () => ({
  listScanDevices: vi.fn(async () => ({ ok: true, message: "Listed devices", rawOutput: "fi-8170\n" })),
  runScan: vi.fn(async () => ({ ok: true, pagesScanned: 0, message: "0 page(s) scanned", rawOutput: "" })),
}));

const ORIGIN = "https://geega-games.example";

let dir: string;
let bridges: RunningBridge[] = [];

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "geega-bridge-start-"));
  bridges = [];
});

afterEach(async () => {
  for (const b of bridges) await b.stop();
  rmSync(dir, { recursive: true, force: true });
});

function config(overrides: Partial<BridgeConfig> = {}): BridgeConfig {
  return {
    apiBaseUrl: ORIGIN,
    supabaseUrl: "https://project.supabase.example",
    supabaseAnonKey: "anon",
    staffEmail: "scanner@example.com",
    staffPassword: "pw",
    watchFolder: dir,
    processedFolder: path.join(dir, "_processed"),
    failedFolder: path.join(dir, "_failed"),
    duplex: true,
    scannerName: "Ricoh fi-8170",
    naps2ConsolePath: "C:\\Program Files\\NAPS2\\NAPS2.Console.exe",
    scannerDriver: "twain",
    scannerDeviceNameMatch: "8170",
    scanMode: "both",
    batchQuietMs: 5000,
    statusPort: 0,
    sessionStateFile: path.join(dir, ".geega-session-id"),
    scanDpi: 300,
    recognizer: {
      enabled: true,
      dataDir: path.join(dir, "data"),
      autoUpdate: true,
      maxLibraryAgeDays: 7,
      downloadConcurrency: 1,
      referenceCacheBytes: 10_000_000,
      threads: 1,
      fallbackDpi: 300,
      selfTestSamples: 20,
    },
    ...overrides,
  };
}

const authed: AuthedClient = { supabase: {} as SupabaseClient, getAccessToken: async () => "token" };

function fakeWatcher() {
  const control: WatcherControl = { suppressAutoProcess: vi.fn(), resumeAndProcessNow: vi.fn() };
  const start = vi.fn((_c: BridgeConfig, _a: unknown, _s: unknown, status: BridgeStatus, _getRecognizer?: () => unknown) => {
    status.state = "watching";
    return control;
  });
  return { start, control };
}

/** What Node throws on Windows when onnxruntime's DLLs can't load (no Visual C++ Redistributable). */
function missingVcRuntime(): Promise<RecognizerModules> {
  return Promise.reject(
    Object.assign(new Error("The specified module could not be found.\r\n\\\\?\\C:\\bridge\\node_modules\\onnxruntime-node\\bin\\napi-v6\\win32\\x64\\onnxruntime_binding.node"), {
      code: "ERR_DLOPEN_FAILED",
    }),
  );
}

class FakeRuntime {
  static instances: FakeRuntime[] = [];
  status = { ...createRecognizerStatus(true), state: "ready" as const, message: "Ready — 3 card faces in the library." };
  start = vi.fn(async () => undefined);
  requestUpdate = vi.fn(() => true);
  selfTest = vi.fn(async () => null);
  dispose = vi.fn();
  recognizer = null;
  constructor(readonly options: unknown) {
    FakeRuntime.instances.push(this);
  }
}

const workingRecognizer = async (): Promise<RecognizerModules> =>
  ({ RecognizerRuntime: FakeRuntime, rerunStoredScan: vi.fn() }) as unknown as RecognizerModules;

async function start(cfg: BridgeConfig, deps: Parameters<typeof startBridge>[1]) {
  const bridge = await startBridge(cfg, { log: () => undefined, logError: () => undefined, ...deps });
  bridges.push(bridge);
  const address = bridge.server.address();
  if (!address || typeof address === "string") throw new Error("no port");
  return { bridge, url: `http://127.0.0.1:${address.port}`, port: address.port };
}

async function getStatus(url: string): Promise<BridgeStatus> {
  const res = await fetch(`${url}/status`);
  expect(res.status).toBe(200);
  return (await res.json()) as BridgeStatus;
}

describe("startBridge", () => {
  it("keeps scanning and answering the dashboard when the card recognizer can't load", async () => {
    const watcher = fakeWatcher();
    const { bridge, url } = await start(config(), {
      signIn: async () => authed,
      loadRecognizer: missingVcRuntime,
      startWatcher: watcher.start,
    });
    await bridge.ready;

    const status = await getStatus(url);
    expect(status.state).toBe("watching");
    expect(status.lastError).toBeNull();
    expect(status.recognizer.state).toBe("unavailable");
    expect(status.recognizer.message).toMatch(/Card recognition can't start on this PC/);
    expect(status.recognizer.message).toMatch(/scans still upload/);
    expect(status.recognizer.lastError).toBe("The specified module could not be found.");
    expect(watcher.start).toHaveBeenCalledTimes(1);
    // The watcher has no recognizer to use, so every card goes to cloud recognition.
    const getRecognizer = watcher.start.mock.calls[0][4];
    expect(getRecognizer?.()).toBeNull();

    // "Scan now" still works…
    const scan = await fetch(`${url}/scan/start`, { method: "POST", headers: { Origin: ORIGIN } });
    expect(scan.status).toBe(202);
    // …and "Update card library" explains instead of pretending to retry.
    const update = await fetch(`${url}/library/update`, { method: "POST", headers: { Origin: ORIGIN } });
    expect(update.status).toBe(409);
    expect(((await update.json()) as { message: string }).message).toMatch(/Card recognition can't start/);
  });

  it("answers /status before sign-in finishes, and refuses to scan until then", async () => {
    let finishSignIn: (a: AuthedClient) => void = () => undefined;
    const watcher = fakeWatcher();
    const { bridge, url } = await start(config(), {
      signIn: () => new Promise((resolve) => (finishSignIn = resolve)),
      loadRecognizer: workingRecognizer,
      startWatcher: watcher.start,
    });

    expect((await getStatus(url)).state).toBe("starting");
    const early = await fetch(`${url}/scan/start`, { method: "POST", headers: { Origin: ORIGIN } });
    expect(early.status).toBe(503);
    expect(((await early.json()) as { message: string }).message).toMatch(/still starting up/);

    finishSignIn(authed);
    await bridge.ready;
    const status = await getStatus(url);
    expect(status.state).toBe("watching");
    expect(status.recognizer.state).toBe("ready");
    expect(FakeRuntime.instances.at(-1)!.start).toHaveBeenCalledTimes(1);
    expect(bridge.runtime()).toBe(FakeRuntime.instances.at(-1));
  });

  it("shows why sign-in failed, keeps trying, and carries on once it works", async () => {
    // The second attempt waits until the test has looked at the failed state.
    let releaseSecondAttempt: () => void = () => undefined;
    const secondAttempt = new Promise<void>((resolve) => (releaseSecondAttempt = resolve));
    const signIn = vi
      .fn<() => Promise<AuthedClient>>()
      .mockRejectedValueOnce(new SignInError("Couldn't reach Supabase to sign in as scanner@example.com (fetch failed).", true))
      .mockImplementationOnce(async () => {
        await secondAttempt;
        return authed;
      });
    const watcher = fakeWatcher();
    const { bridge, url } = await start(config(), {
      signIn,
      loadRecognizer: workingRecognizer,
      startWatcher: watcher.start,
      signInRetryDelayMs: () => 1,
    });

    await vi.waitFor(() => expect(signIn).toHaveBeenCalledTimes(2));
    const failed = await getStatus(url);
    expect(failed.state).toBe("error");
    expect(failed.lastError).toMatch(/Couldn't reach Supabase.*Trying again in 0 seconds/);
    const refused = await fetch(`${url}/scan/start`, { method: "POST", headers: { Origin: ORIGIN } });
    expect(refused.status).toBe(503);
    expect(((await refused.json()) as { message: string }).message).toMatch(/can't scan yet: Couldn't reach Supabase/);

    releaseSecondAttempt();
    await bridge.ready;
    const status = await getStatus(url);
    expect(signIn).toHaveBeenCalledTimes(2);
    expect(status.state).toBe("watching");
    expect(status.lastError).toBeNull();
  });

  it("refuses to start a second copy, saying the bridge is already running", async () => {
    const first = await start(config(), { signIn: async () => authed, loadRecognizer: workingRecognizer, startWatcher: fakeWatcher().start });
    await first.bridge.ready;
    await expect(
      startBridge(config({ statusPort: first.port }), {
        signIn: async () => authed,
        loadRecognizer: workingRecognizer,
        startWatcher: fakeWatcher().start,
        log: () => undefined,
        logError: () => undefined,
      }),
    ).rejects.toThrow(/already running on this PC/);
  });

  it("leaves the recognizer alone when it's turned off", async () => {
    const loadRecognizer = vi.fn(workingRecognizer);
    const { bridge, url } = await start(config({ recognizer: { ...config().recognizer, enabled: false } }), {
      signIn: async () => authed,
      loadRecognizer,
      startWatcher: fakeWatcher().start,
    });
    await bridge.ready;
    expect(loadRecognizer).not.toHaveBeenCalled();
    expect((await getStatus(url)).recognizer.state).toBe("off");
  });
});

describe("describePortConflict", () => {
  const runningBridge = (extra: Record<string, unknown>) =>
    vi.fn(async () =>
      Response.json({ watchFolder: "C:\\Scans", startedAt: "2026-10-13T21:00:00.000Z", ...extra }),
    ) as unknown as typeof fetch;

  it("names another program when whatever holds the port isn't a bridge", async () => {
    const fetchImpl = vi.fn(async () => new Response("<html>", { status: 200 })) as unknown as typeof fetch;
    expect(await describePortConflict(8787, fetchImpl)).toMatch(/Another program on this PC is using port 8787/);
  });

  it("points at the copy that's already running when it's this same version", async () => {
    const why = await describePortConflict(8787, runningBridge({ version: BRIDGE_VERSION }));
    expect(why).toMatch(/already running on this PC/);
    expect(why).toMatch(/Use that one/);
  });

  it("says an update isn't finished while an older copy keeps running", async () => {
    const unversioned = await describePortConflict(8787, runningBridge({}));
    expect(unversioned).toMatch(new RegExp(`An older version of the scanner bridge is still running .*this is version ${BRIDGE_VERSION.replace(/\./g, "\\.")}`));
    expect(unversioned).toMatch(/To finish updating, stop the old one .*Task Manager\), then start the bridge again/);
    expect(await describePortConflict(8787, runningBridge({ version: "1.0.5" }))).toMatch(/^Version 1\.0\.5 of the scanner bridge is still running/);
  });
});

describe("signInRetryDelayMs", () => {
  it("retries a network failure quickly at first, then every 5 minutes; a refused login every 5 minutes", () => {
    expect([1, 2, 3, 4, 5, 6, 10].map((n) => signInRetryDelayMs(n, true) / 1000)).toEqual([15, 30, 60, 120, 240, 300, 300]);
    expect(signInRetryDelayMs(1, false)).toBe(300_000);
  });
});
