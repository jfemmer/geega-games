import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { compareVersions, LATEST_BRIDGE_VERSION } from "../src/admin/utils/scannerBridge";

// The Scanner panel asks the scanning PC to update when its bridge reports a
// version older than LATEST_BRIDGE_VERSION, so that constant has to move with
// every bridge release: it must always equal scanner-bridge/package.json.

describe("LATEST_BRIDGE_VERSION", () => {
  it("is the version in scanner-bridge/package.json", () => {
    const pkg = JSON.parse(readFileSync(path.resolve(__dirname, "../scanner-bridge/package.json"), "utf8")) as { version: string };
    expect(LATEST_BRIDGE_VERSION).toBe(pkg.version);
  });
});

describe("compareVersions", () => {
  it("compares each part as a number", () => {
    expect(compareVersions("1.1.0", "1.1.0")).toBe(0);
    expect(compareVersions("1.0.0", "1.1.0")).toBeLessThan(0);
    expect(compareVersions("1.10.0", "1.9.2")).toBeGreaterThan(0);
    expect(compareVersions("2.0", "1.99.99")).toBeGreaterThan(0);
    expect(compareVersions("1.1", "1.1.0")).toBe(0);
  });
});
