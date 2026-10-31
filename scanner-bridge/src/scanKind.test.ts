import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ApiClient } from "./apiClient.js";
import type { BridgeConfig } from "./config.js";
import {
  allSessionStateFiles,
  CONDITION_SCAN_DPI,
  filePrefixFor,
  isScanNowFile,
  parseScanKind,
  scanDpiByKind,
  scanKindOfFile,
  scanSettingsFor,
  sessionStateFileFor,
} from "./scanKind.js";
import { ensureSession } from "./uploader.js";

describe("scan types", () => {
  it("names each type's pages so the watcher can tell them apart", () => {
    expect(filePrefixFor("card_matching", 123)).toBe("geega-inventory_123");
    expect(filePrefixFor("condition", 123)).toBe("geega-condition_123");
    expect(filePrefixFor("both", 123)).toBe("geega-condition-inventory_123");
    for (const kind of ["card_matching", "condition", "both"] as const) {
      const file = path.join("C:", "scans", `${filePrefixFor(kind, 5)}_0001.jpg`);
      expect(scanKindOfFile(file, "both")).toBe(kind);
      expect(isScanNowFile(file)).toBe(true);
    }
    // PaperStream's own files (and older "Scan now" ones) are the bridge's SCAN_MODE.
    expect(scanKindOfFile("card_00001.tif", "card_matching")).toBe("card_matching");
    expect(scanKindOfFile("scan_123_0001.jpg", "both")).toBe("both");
    expect(isScanNowFile("card_00001.tif")).toBe(false);
  });

  it("scans Inventory fronts only at the inventory resolution, and anything that grades both sides at 600 dpi", () => {
    expect(scanSettingsFor("card_matching", { inventoryScanDpi: 240 })).toEqual({ duplex: false, dpi: 240 });
    expect(scanSettingsFor("condition", { inventoryScanDpi: 240 })).toEqual({ duplex: true, dpi: 600 });
    expect(scanSettingsFor("both", { inventoryScanDpi: 240 })).toEqual({ duplex: true, dpi: 600 });
    expect(CONDITION_SCAN_DPI).toBe(600);
    expect(scanDpiByKind({ inventoryScanDpi: 300 })).toEqual({ card_matching: 300, condition: 600, both: 600 });
  });

  it("keeps each type's session id in its own file, the full scan keeping the old name", () => {
    const stateFile = path.join("C:", "scans", ".geega-session-id");
    expect(sessionStateFileFor("both", stateFile)).toBe(stateFile);
    expect(sessionStateFileFor("condition", stateFile)).toBe(path.join("C:", "scans", ".geega-condition-session-id"));
    expect(sessionStateFileFor("card_matching", stateFile)).toBe(path.join("C:", "scans", ".geega-inventory-session-id"));
    expect(new Set(allSessionStateFiles(stateFile)).size).toBe(3);
  });

  it("accepts the three types, and \"standard\" from a 1.2.0 dashboard as the bridge's own mode", () => {
    expect(parseScanKind("card_matching", "both")).toBe("card_matching");
    expect(parseScanKind("condition", "both")).toBe("condition");
    expect(parseScanKind("both", "card_matching")).toBe("both");
    expect(parseScanKind("standard", "card_matching")).toBe("card_matching");
    expect(parseScanKind("deluxe", "both")).toBeNull();
    expect(parseScanKind(undefined, "both")).toBeNull();
  });
});

describe("ensureSession per scan type", () => {
  let dir: string;
  let config: BridgeConfig;
  let calls: { url: string; body: unknown }[];
  let api: ApiClient;
  let existing: { id: string; scan_mode: string } | null;
  const supabase = {
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: existing, error: null }) }) }) }),
  } as unknown as SupabaseClient;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "geega-session-test-"));
    config = {
      scannerName: "Ricoh fi-8170",
      scanMode: "card_matching",
      sessionStateFile: path.join(dir, ".geega-session-id"),
    } as BridgeConfig;
    calls = [];
    existing = null;
    let n = 0;
    api = {
      call: vi.fn(async (url: string, init: { body?: unknown }) => {
        calls.push({ url, body: init.body });
        return { id: `session-${++n}` };
      }),
    } as unknown as ApiClient;
  });

  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("creates a condition session with its own id file, labelled by its type", async () => {
    const id = await ensureSession(config, api, supabase, "condition");
    expect(id).toBe("session-1");
    expect(calls[0].body).toEqual({
      scannerName: "Ricoh fi-8170",
      sourceType: "scanner_bridge",
      scanMode: "condition",
      labelByMode: true,
    });
    expect(readFileSync(sessionStateFileFor("condition", config.sessionStateFile), "utf8")).toBe("session-1");
    expect(existsSync(sessionStateFileFor("card_matching", config.sessionStateFile))).toBe(false);
  });

  it("uses the bridge's SCAN_MODE when no type is given (PaperStream batches)", async () => {
    await ensureSession(config, api, supabase);
    expect(calls[0].body).toMatchObject({ scanMode: "card_matching" });
    expect(readFileSync(sessionStateFileFor("card_matching", config.sessionStateFile), "utf8")).toBe("session-1");
  });

  it("continues an open session of the same type", async () => {
    writeFileSync(sessionStateFileFor("both", config.sessionStateFile), "open-1", "utf8");
    existing = { id: "open-1", scan_mode: "both" };
    expect(await ensureSession(config, api, supabase, "both")).toBe("open-1");
    expect(calls).toHaveLength(0);
  });

  it("never continues a session that scans another way (an id file left by an older bridge)", async () => {
    writeFileSync(sessionStateFileFor("both", config.sessionStateFile), "old-1", "utf8");
    existing = { id: "old-1", scan_mode: "card_matching" };
    expect(await ensureSession(config, api, supabase, "both")).toBe("session-1");
    expect(calls[0].body).toMatchObject({ scanMode: "both" });
  });
});
