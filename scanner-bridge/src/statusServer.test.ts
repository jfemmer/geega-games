import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Server } from "node:http";
import { createStatus, startStatusServer, type BridgeStatus } from "./statusServer.js";

// Real HTTP requests against a real (ephemeral, 127.0.0.1-bound) instance —
// this is the exact same server the admin dashboard's Scan panel talks to,
// so its CORS headers and /session/end contract need to be verified for
// real, not assumed from reading the handler.

const ALLOWED_ORIGIN = "https://geega-games.example";

describe("startStatusServer", () => {
  let dir: string;
  let sessionStateFile: string;
  let status: BridgeStatus;
  let server: Server;
  let baseUrl: string;

  beforeEach(async () => {
    dir = mkdtempSync(path.join(tmpdir(), "geega-bridge-test-"));
    sessionStateFile = path.join(dir, ".geega-session-id");
    status = createStatus(dir);
    server = startStatusServer(0, status, {
      allowedOrigin: ALLOWED_ORIGIN,
      sessionStateFile,
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
});
