import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { checkConsolePath, runScan } from "./naps2Scan.js";

// checkConsolePath and the directory-based page counting inside runScan are
// real, mechanically testable Node behavior (filesystem existence checks,
// reading a directory back) — the one thing NOT testable here is
// NAPS2.Console.exe's actual conversation with the scanner, same boundary
// wiaScan.ts had with powershell.exe before it. That boundary is exactly
// where statusServer.test.ts mocks this module.

describe("checkConsolePath", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "geega-naps2-test-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("returns null when the path exists", () => {
    const exePath = path.join(dir, "NAPS2.Console.exe");
    writeFileSync(exePath, "", "utf8");
    expect(checkConsolePath(exePath)).toBeNull();
  });

  it("returns a clear, actionable message when the path does not exist", () => {
    const missing = path.join(dir, "does-not-exist", "NAPS2.Console.exe");
    const message = checkConsolePath(missing);
    expect(message).toMatch(/could not find/i);
    expect(message).toMatch(/naps2\.com\/download/i);
    expect(message).toMatch(/NAPS2_CONSOLE_PATH/);
  });
});

describe("runScan", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "geega-naps2-test-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("fails fast with a clear message when NAPS2.Console.exe isn't at the configured path", async () => {
    const result = await runScan({
      consolePath: path.join(dir, "nonexistent", "NAPS2.Console.exe"),
      outputFolder: dir,
      filePrefix: "scan_test",
      driver: "twain",
      deviceNameMatch: "8170",
      duplex: true,
      resolution: 600,
    });
    expect(result.ok).toBe(false);
    expect(result.pagesScanned).toBe(0);
    expect(result.message).toMatch(/could not find/i);
  });

  it("counts only files matching this run's unique prefix, ignoring unrelated files already in the folder", async () => {
    // A fake "console.exe" that's really just something executable-looking
    // isn't needed here: consolePath deliberately points at a real file (so
    // checkConsolePath passes) that isn't actually runnable as a scanner
    // driver, so execFile itself fails fast — exercising the exact same
    // "process ran, but errored" path a real failed scan would, while still
    // proving pagesScanned reflects real directory contents rather than
    // trusting the process's own exit code alone.
    const fakeExe = path.join(dir, "NAPS2.Console.exe");
    writeFileSync(fakeExe, "not a real executable", "utf8");

    writeFileSync(path.join(dir, "leftover_from_paperstream.tif"), "", "utf8");
    writeFileSync(path.join(dir, "scan_test0001.tiff"), "", "utf8");
    writeFileSync(path.join(dir, "scan_test0002.tiff"), "", "utf8");

    const result = await runScan({
      consolePath: fakeExe,
      outputFolder: dir,
      filePrefix: "scan_test",
      driver: "twain",
      deviceNameMatch: "8170",
      duplex: true,
      resolution: 600,
    });

    // The fake exe can't actually run, so this reports failure — but the
    // page count is computed independently of that, straight from disk.
    expect(result.pagesScanned).toBe(2);
  });
});
