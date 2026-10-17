import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import http, { type Server } from "node:http";
import {
  createStatus,
  startStatusServer,
  whenListening,
  type BridgeStatus,
  type RecognizerControl,
  type StatusServerOptions,
} from "./statusServer.js";
import { createRecognizerStatus, unavailableRecognizerStatus } from "./recognizer/status.js";
import type { WatcherControl } from "./watcher.js";
import type { ScanDeviceCheckResult, ScanResult } from "./naps2Scan.js";
import { BRIDGE_VERSION } from "./version.js";

// Real HTTP requests against a real (ephemeral, 127.0.0.1-bound) instance —
// this is the exact same server the admin dashboard's Scan panel talks to,
// so its CORS headers and endpoint contracts need to be verified for real,
// not assumed from reading the handler. naps2Scan.ts itself is mocked: the
// Node-side wiring (routing, the concurrency guard, suppress/resume calls
// around a scan, status transitions) is fully testable without real
// hardware — only NAPS2.Console.exe's actual scanner interaction isn't, and
// that boundary is exactly where the mock sits.

vi.mock("./naps2Scan.js", () => ({
  listScanDevices: vi.fn(),
  runScan: vi.fn(),
}));
const { listScanDevices, runScan } = await import("./naps2Scan.js");
const mockListScanDevices = vi.mocked(listScanDevices);
const mockRunScan = vi.mocked(runScan);

const ALLOWED_ORIGIN = "https://geega-games.example";

function deviceResult(overrides: Partial<ScanDeviceCheckResult> = {}): ScanDeviceCheckResult {
  return { ok: true, message: "Listed devices — see raw output below.", rawOutput: "RICOH fi-8170\n", ...overrides };
}

function scanResult(overrides: Partial<ScanResult> = {}): ScanResult {
  return { ok: true, pagesScanned: 2, message: "2 page(s) scanned", rawOutput: "", ...overrides };
}

describe("startStatusServer", () => {
  let dir: string;
  let sessionStateFile: string;
  let status: BridgeStatus;
  let server: Server;
  let serverOptions: StatusServerOptions;
  let baseUrl: string;
  let suppressAutoProcess: ReturnType<typeof vi.fn>;
  let resumeAndProcessNow: ReturnType<typeof vi.fn>;
  let watcherControl: WatcherControl;
  let recognizerControl: {
    requestUpdate: ReturnType<typeof vi.fn>;
    selfTest: ReturnType<typeof vi.fn>;
    rerun: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    dir = mkdtempSync(path.join(tmpdir(), "geega-bridge-test-"));
    sessionStateFile = path.join(dir, ".geega-session-id");
    status = createStatus(dir);
    suppressAutoProcess = vi.fn();
    resumeAndProcessNow = vi.fn();
    watcherControl = { suppressAutoProcess, resumeAndProcessNow } as unknown as WatcherControl;
    mockListScanDevices.mockReset();
    mockRunScan.mockReset();

    recognizerControl = {
      requestUpdate: vi.fn(() => true),
      selfTest: vi.fn(async () => null),
      rerun: vi.fn(async () => ({ ok: true, status: 200, message: "Re-recognized on the scanner PC." })),
    };
    serverOptions = {
      allowedOrigin: ALLOWED_ORIGIN,
      sessionStateFile,
      watchFolder: dir,
      naps2ConsolePath: "C:\\Program Files\\NAPS2\\NAPS2.Console.exe",
      scannerDriver: "twain",
      scannerDeviceNameMatch: "8170",
      duplex: true,
      watcherControl,
      scanDpi: 300,
      recognizer: recognizerControl as unknown as RecognizerControl,
    };
    server = startStatusServer(0, status, serverOptions);
    await new Promise<void>((resolve) => server.once("listening", resolve));
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("no port");
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    rmSync(dir, { recursive: true, force: true });
  });

  it("GET /status returns the live status object with CORS scoped to the allowed origin", async () => {
    status.state = "watching";
    status.pendingFiles = 3;
    const res = await fetch(`${baseUrl}/status`);
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBe(ALLOWED_ORIGIN);
    const body = (await res.json()) as BridgeStatus;
    expect(body.state).toBe("watching");
    expect(body.pendingFiles).toBe(3);
  });

  it("GET / also serves status (same as /status)", async () => {
    const res = await fetch(`${baseUrl}/`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as BridgeStatus;
    expect(body.state).toBeDefined();
  });

  it("answers an OPTIONS preflight with 204 and CORS headers, never falling through to 404", async () => {
    const res = await fetch(`${baseUrl}/session/end`, { method: "OPTIONS" });
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe(ALLOWED_ORIGIN);
    expect(res.headers.get("access-control-allow-methods")).toContain("POST");
    expect(res.headers.get("access-control-allow-private-network")).toBeNull();
  });

  it("refuses requests addressed to any other host name (DNS rebinding)", async () => {
    const port = new URL(baseUrl).port;
    const status = await new Promise<number>((resolve, reject) => {
      const req = http.request({ host: "127.0.0.1", port, path: "/status", headers: { Host: `evil.example:${port}` } }, (res) => {
        res.resume();
        resolve(res.statusCode ?? 0);
      });
      req.on("error", reject);
      req.end();
    });
    expect(status).toBe(403);
    expect((await fetch(`${baseUrl}/status`)).status).toBe(200);
  });

  it("answers Chrome's private-network preflight so the Geega app can reach this PC", async () => {
    const res = await fetch(`${baseUrl}/scan/start`, {
      method: "OPTIONS",
      headers: { "Access-Control-Request-Private-Network": "true", "Access-Control-Request-Method": "POST" },
    });
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-private-network")).toBe("true");
    expect(res.headers.get("access-control-allow-origin")).toBe(ALLOWED_ORIGIN);
  });

  it("POST /session/end deletes the session file and clears currentSessionId", async () => {
    writeFileSync(sessionStateFile, "some-session-id", "utf8");
    status.currentSessionId = "some-session-id";

    const res = await fetch(`${baseUrl}/session/end`, { method: "POST" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean };
    expect(body.ok).toBe(true);
    expect(existsSync(sessionStateFile)).toBe(false);
    expect(status.currentSessionId).toBeNull();
  });

  it("POST /session/end is idempotent when there is no session file yet", async () => {
    expect(existsSync(sessionStateFile)).toBe(false);
    const res = await fetch(`${baseUrl}/session/end`, { method: "POST" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean };
    expect(body.ok).toBe(true);
  });

  it("returns 404 with a helpful message for an unknown route", async () => {
    const res = await fetch(`${baseUrl}/nonsense`);
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/status|session\/end/i);
  });

  it("GET /scan/devices relays the scan device check result", async () => {
    mockListScanDevices.mockResolvedValueOnce(deviceResult());
    const res = await fetch(`${baseUrl}/scan/devices`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as ScanDeviceCheckResult;
    expect(body.ok).toBe(true);
    expect(mockListScanDevices).toHaveBeenCalledWith(
      "C:\\Program Files\\NAPS2\\NAPS2.Console.exe",
      "twain",
    );
  });

  it("POST /scan/start returns 202 immediately, suppresses auto-processing, then resumes it once the scan finishes", async () => {
    let resolveScan!: (r: ScanResult) => void;
    mockRunScan.mockReturnValueOnce(new Promise((resolve) => (resolveScan = resolve)));

    const res = await fetch(`${baseUrl}/scan/start`, { method: "POST" });
    expect(res.status).toBe(202);
    expect(status.state).toBe("scanning");
    expect(suppressAutoProcess).toHaveBeenCalledTimes(1);
    expect(resumeAndProcessNow).not.toHaveBeenCalled();

    resolveScan(scanResult());
    await vi.waitFor(() => {
      expect(resumeAndProcessNow).toHaveBeenCalledTimes(1);
    });
    expect(status.state).toBe("watching");
    expect(status.lastError).toBeNull();
    expect(status.lastScanResult).toMatchObject({ ok: true, pagesScanned: 2 });
  });

  it("POST /scan/start records lastError when the scan reports failure, but still resumes the watcher", async () => {
    mockRunScan.mockResolvedValueOnce(
      scanResult({ ok: false, pagesScanned: 0, message: "No device found matching '8170'." }),
    );

    const res = await fetch(`${baseUrl}/scan/start`, { method: "POST" });
    expect(res.status).toBe(202);

    await vi.waitFor(() => {
      expect(resumeAndProcessNow).toHaveBeenCalledTimes(1);
    });
    expect(status.lastError).toMatch(/no device found/i);
    expect(status.lastScanResult).toMatchObject({
      ok: false,
      pagesScanned: 0,
      message: expect.stringMatching(/no device found/i),
    });
  });

  it("POST /scan/start records lastScanResult even when runScan itself throws", async () => {
    mockRunScan.mockRejectedValueOnce(new Error("NAPS2.Console.exe ENOENT"));

    const res = await fetch(`${baseUrl}/scan/start`, { method: "POST" });
    expect(res.status).toBe(202);

    await vi.waitFor(() => {
      expect(resumeAndProcessNow).toHaveBeenCalledTimes(1);
    });
    expect(status.lastScanResult).toMatchObject({
      ok: false,
      pagesScanned: 0,
      message: expect.stringMatching(/enoent/i),
    });
  });

  it("POST /scan/start refuses to start a second scan while one is already running", async () => {
    mockRunScan.mockReturnValueOnce(new Promise(() => {})); // never resolves during this test
    const first = await fetch(`${baseUrl}/scan/start`, { method: "POST" });
    expect(first.status).toBe(202);

    const second = await fetch(`${baseUrl}/scan/start`, { method: "POST" });
    expect(second.status).toBe(409);
    expect(mockRunScan).toHaveBeenCalledTimes(1);
  });
  it("POST /scan/start scans at the configured resolution and takes the foil switch from the click", async () => {
    mockRunScan.mockResolvedValueOnce(scanResult());
    const res = await fetch(`${baseUrl}/scan/start`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: ALLOWED_ORIGIN },
      body: JSON.stringify({ batchFinish: "foil" }),
    });
    expect(res.status).toBe(202);
    await vi.waitFor(() => expect(resumeAndProcessNow).toHaveBeenCalledTimes(1));
    expect(mockRunScan).toHaveBeenCalledWith(expect.objectContaining({ resolution: 300 }));
    expect(status.batchFinish).toBe("foil");
  });

  it("POST /settings sets the foil / non-foil switch, and rejects anything else", async () => {
    const ok = await fetch(`${baseUrl}/settings`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: ALLOWED_ORIGIN },
      body: JSON.stringify({ batchFinish: "foil" }),
    });
    expect(await ok.json()).toEqual({ ok: true, batchFinish: "foil" });
    expect(status.batchFinish).toBe("foil");
    const bad = await fetch(`${baseUrl}/settings`, { method: "POST", body: JSON.stringify({ batchFinish: "etched" }) });
    expect(bad.status).toBe(400);
    expect(status.batchFinish).toBe("foil");
  });

  it("refuses POSTs from any other website", async () => {
    const res = await fetch(`${baseUrl}/scan/start`, { method: "POST", headers: { Origin: "https://evil.example" } });
    expect(res.status).toBe(403);
    expect(mockRunScan).not.toHaveBeenCalled();
    expect(status.state).not.toBe("scanning");
    const settings = await fetch(`${baseUrl}/settings`, {
      method: "POST",
      headers: { Origin: "https://evil.example" },
      body: JSON.stringify({ batchFinish: "foil" }),
    });
    expect(settings.status).toBe(403);
    expect(status.batchFinish).toBe("nonfoil");
  });

  it("POST /library/update starts a background update", async () => {
    status.recognizer = createRecognizerStatus(true);
    const res = await fetch(`${baseUrl}/library/update`, { method: "POST" });
    expect(res.status).toBe(202);
    expect(recognizerControl.requestUpdate).toHaveBeenCalledTimes(1);
    recognizerControl.requestUpdate.mockReturnValueOnce(false);
    expect((await fetch(`${baseUrl}/library/update`, { method: "POST" })).status).toBe(409);
  });

  it("POST /library/update retries a recognizer that failed to start", async () => {
    status.recognizer = { ...createRecognizerStatus(true), state: "error", message: "Card recognizer couldn't start: no internet." };
    const res = await fetch(`${baseUrl}/library/update`, { method: "POST" });
    expect(res.status).toBe(202);
    expect(((await res.json()) as { message: string }).message).toMatch(/Trying again/);
    expect(recognizerControl.requestUpdate).toHaveBeenCalledTimes(1);
  });

  it("POST /library/update explains, rather than retries, when the recognizer can't run on this PC", async () => {
    status.recognizer = unavailableRecognizerStatus(
      "Card recognition can't start on this PC: Windows is missing the Microsoft Visual C++ Redistributable it needs.",
      { label: "Download the Visual C++ Redistributable", url: "https://aka.ms/vs/17/release/vc_redist.x64.exe" },
      "The specified module could not be found.",
    );
    const res = await fetch(`${baseUrl}/library/update`, { method: "POST" });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { message: string }).message).toMatch(/Visual C\+\+ Redistributable/);
    expect(recognizerControl.requestUpdate).not.toHaveBeenCalled();
    const body = (await (await fetch(`${baseUrl}/status`)).json()) as BridgeStatus;
    expect(body.recognizer).toMatchObject({ state: "unavailable", help: { url: "https://aka.ms/vs/17/release/vc_redist.x64.exe" } });
  });

  it("POST /scan/start is refused with the reason until the bridge is signed in and watching", async () => {
    serverOptions.watcherControl = null;
    const starting = await fetch(`${baseUrl}/scan/start`, { method: "POST" });
    expect(starting.status).toBe(503);
    expect(((await starting.json()) as { message: string }).message).toMatch(/still starting up/);
    status.lastError = "Could not sign in as scanner@example.com: Invalid login credentials.";
    const failed = await fetch(`${baseUrl}/scan/start`, { method: "POST" });
    expect(((await failed.json()) as { message: string }).message).toMatch(/can't scan yet: Could not sign in/);
    expect(mockRunScan).not.toHaveBeenCalled();
    expect(status.state).not.toBe("scanning");
  });

  it("POST /library/self-test only runs with a ready library, one at a time", async () => {
    expect((await fetch(`${baseUrl}/library/self-test`, { method: "POST" })).status).toBe(409);
    status.recognizer.state = "ready";
    expect((await fetch(`${baseUrl}/library/self-test`, { method: "POST" })).status).toBe(202);
    expect(recognizerControl.selfTest).toHaveBeenCalledTimes(1);
    status.recognizer.selfTestRunning = true;
    expect((await fetch(`${baseUrl}/library/self-test`, { method: "POST" })).status).toBe(409);
  });

  it("POST /recognize re-runs one stored scan on this PC once the library is ready", async () => {
    const scanId = "3f2a1b4c-5d6e-4f70-8a9b-0c1d2e3f4a5b";
    const notReady = await fetch(`${baseUrl}/recognize`, { method: "POST", body: JSON.stringify({ scanId }) });
    expect(notReady.status).toBe(503);
    status.recognizer.state = "ready";
    const bad = await fetch(`${baseUrl}/recognize`, { method: "POST", body: JSON.stringify({ scanId: "../etc" }) });
    expect(bad.status).toBe(400);
    const res = await fetch(`${baseUrl}/recognize`, { method: "POST", body: JSON.stringify({ scanId }) });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, message: "Re-recognized on the scanner PC." });
    expect(recognizerControl.rerun).toHaveBeenCalledWith(scanId);
  });

  it("GET /status includes the recognizer, the foil switch and the scan resolution", async () => {
    const body = (await (await fetch(`${baseUrl}/status`)).json()) as BridgeStatus;
    expect(body).toMatchObject({ batchFinish: "nonfoil", scanDpi: 300, totalCardsRecognizedOnPc: 0 });
    expect(body.recognizer).toMatchObject({ state: "off", library: null });
  });

  it("GET /status says which version is running, and an update on disk that isn't running yet", async () => {
    let body = (await (await fetch(`${baseUrl}/status`)).json()) as BridgeStatus;
    expect(body.version).toBe(BRIDGE_VERSION);
    expect(body.pendingUpdate).toBeNull();

    // Checked when the dashboard asks, so a `git pull` while running shows up.
    const checkForUpdate = vi.fn(() => ({ version: "9.9.9", step: "build" as const }));
    serverOptions.checkForUpdate = checkForUpdate;
    body = (await (await fetch(`${baseUrl}/status`)).json()) as BridgeStatus;
    expect(checkForUpdate).toHaveBeenCalledTimes(1);
    expect(body.pendingUpdate).toEqual({ version: "9.9.9", step: "build" });
  });
});

describe("whenListening", () => {
  it("rejects with EADDRINUSE when another copy already has the port", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "geega-bridge-port-"));
    const options = {
      allowedOrigin: ALLOWED_ORIGIN,
      sessionStateFile: path.join(dir, ".geega-session-id"),
      watchFolder: dir,
      naps2ConsolePath: "NAPS2.Console.exe",
      scannerDriver: "twain",
      scannerDeviceNameMatch: "8170",
      duplex: true,
      watcherControl: null,
    } satisfies StatusServerOptions;
    const first = startStatusServer(0, createStatus(dir), options);
    await whenListening(first, 0);
    const address = first.address();
    if (!address || typeof address === "string") throw new Error("no port");
    const second = startStatusServer(address.port, createStatus(dir), options);
    await expect(whenListening(second, address.port)).rejects.toMatchObject({ code: "EADDRINUSE" });
    await new Promise<void>((resolve) => first.close(() => resolve()));
    rmSync(dir, { recursive: true, force: true });
  });
});
