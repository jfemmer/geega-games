import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Server } from "node:http";
import { createStatus, startStatusServer, type BridgeStatus } from "./statusServer.js";
import type { WatcherControl } from "./watcher.js";
import type { WiaDeviceCheckResult, WiaScanResult } from "./wiaScan.js";

// Real HTTP requests against a real (ephemeral, 127.0.0.1-bound) instance —
// this is the exact same server the admin dashboard's Scan panel talks to,
// so its CORS headers and endpoint contracts need to be verified for real,
// not assumed from reading the handler. wiaScan.ts itself is mocked: the
// Node-side wiring (routing, the concurrency guard, suppress/resume calls
// around a scan, status transitions) is fully testable without real
// hardware — only the PowerShell script's actual scanner interaction
// isn't, and that boundary is exactly where the mock sits.

vi.mock("./wiaScan.js", () => ({
  listWiaDevices: vi.fn(),
  runWiaScan: vi.fn(),
}));
const { listWiaDevices, runWiaScan } = await import("./wiaScan.js");
const mockListWiaDevices = vi.mocked(listWiaDevices);
const mockRunWiaScan = vi.mocked(runWiaScan);

const ALLOWED_ORIGIN = "https://geega-games.example";

function deviceResult(overrides: Partial<WiaDeviceCheckResult> = {}): WiaDeviceCheckResult {
  return { ok: true, message: "listed 1 device(s)", rawOutput: "DEVICE:RICOH fi-8170\n", ...overrides };
}

function scanResult(overrides: Partial<WiaScanResult> = {}): WiaScanResult {
  return { ok: true, pagesScanned: 2, message: "2 page(s) scanned", rawOutput: "", ...overrides };
}

describe("startStatusServer", () => {
  let dir: string;
  let sessionStateFile: string;
  let status: BridgeStatus;
  let server: Server;
  let baseUrl: string;
  let suppressAutoProcess: ReturnType<typeof vi.fn>;
  let resumeAndProcessNow: ReturnType<typeof vi.fn>;
  let watcherControl: WatcherControl;

  beforeEach(async () => {
    dir = mkdtempSync(path.join(tmpdir(), "geega-bridge-test-"));
    sessionStateFile = path.join(dir, ".geega-session-id");
    status = createStatus(dir);
    suppressAutoProcess = vi.fn();
    resumeAndProcessNow = vi.fn();
    watcherControl = { suppressAutoProcess, resumeAndProcessNow } as unknown as WatcherControl;
    mockListWiaDevices.mockReset();
    mockRunWiaScan.mockReset();

    server = startStatusServer(0, status, {
      allowedOrigin: ALLOWED_ORIGIN,
      sessionStateFile,
      watchFolder: dir,
      wiaDeviceNameMatch: "8170",
      duplex: true,
      watcherControl,
    });
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

  it("GET /scan/devices relays the WIA device check result", async () => {
    mockListWiaDevices.mockResolvedValueOnce(deviceResult());
    const res = await fetch(`${baseUrl}/scan/devices`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as WiaDeviceCheckResult;
    expect(body.ok).toBe(true);
    expect(mockListWiaDevices).toHaveBeenCalledWith("8170");
  });

  it("POST /scan/start returns 202 immediately, suppresses auto-processing, then resumes it once the scan finishes", async () => {
    let resolveScan!: (r: WiaScanResult) => void;
    mockRunWiaScan.mockReturnValueOnce(new Promise((resolve) => (resolveScan = resolve)));

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
  });

  it("POST /scan/start records lastError when the scan script reports failure, but still resumes the watcher", async () => {
    mockRunWiaScan.mockResolvedValueOnce(
      scanResult({ ok: false, pagesScanned: 0, message: "No WIA device found matching '*8170*'." }),
    );

    const res = await fetch(`${baseUrl}/scan/start`, { method: "POST" });
    expect(res.status).toBe(202);

    await vi.waitFor(() => {
      expect(resumeAndProcessNow).toHaveBeenCalledTimes(1);
    });
    expect(status.lastError).toMatch(/no wia device/i);
  });

  it("POST /scan/start refuses to start a second scan while one is already running", async () => {
    mockRunWiaScan.mockReturnValueOnce(new Promise(() => {})); // never resolves during this test
    const first = await fetch(`${baseUrl}/scan/start`, { method: "POST" });
    expect(first.status).toBe(202);

    const second = await fetch(`${baseUrl}/scan/start`, { method: "POST" });
    expect(second.status).toBe(409);
    expect(mockRunWiaScan).toHaveBeenCalledTimes(1);
  });
});
