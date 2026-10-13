import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { checkConsolePath, naps2ScanArgs, runScan } from "./naps2Scan.js";
import { pairScannedFiles, sortScannedFileNames } from "./pairing.js";

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
    writeFileSync(path.join(dir, "scan_test_0001.jpg"), "", "utf8");
    writeFileSync(path.join(dir, "scan_test_0002.jpg"), "", "utf8");

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

describe("naps2ScanArgs", () => {
  it("scans the feeder (both sides) into numbered high-quality JPEGs at the chosen resolution", () => {
    const args = naps2ScanArgs({
      outputFolder: path.join("C:", "GeegaScans", "Incoming"),
      filePrefix: "scan_1760300000000",
      driver: "twain",
      deviceNameMatch: "8170",
      duplex: true,
      resolution: 300,
    });
    const value = (flag: string) => args[args.indexOf(flag) + 1];
    expect(value("--driver")).toBe("twain");
    expect(value("--device")).toBe("8170");
    expect(value("--source")).toBe("duplex");
    expect(value("--dpi")).toBe("300");
    expect(value("--bitdepth")).toBe("color");
    expect(value("--jpegquality")).toBe("95");
    expect(path.basename(value("-o"))).toBe("scan_1760300000000_$(nnnn).jpg");
    expect(args).toContain("--noprofile");
    // TIFF-only splitting no longer applies: every JPEG page is its own file.
    expect(args).not.toContain("--split");
    expect(naps2ScanArgs({ outputFolder: "x", filePrefix: "p", driver: "wia", deviceNameMatch: "d", duplex: false, resolution: 600 })).toContain("feeder");
  });

  it("names pages so pairing puts them back in feed order, past 9999 too", () => {
    const names = ["scan_1760300000000_0010.jpg", "scan_1760300000000_0002.jpg", "scan_1760300000000_0001.jpg", "scan_1760300000000_0009.jpg"];
    const sorted = sortScannedFileNames(names);
    expect(sorted).toEqual([
      "scan_1760300000000_0001.jpg",
      "scan_1760300000000_0002.jpg",
      "scan_1760300000000_0009.jpg",
      "scan_1760300000000_0010.jpg",
    ]);
    expect(pairScannedFiles(sorted, true)[0]).toEqual({ sequenceHint: 1, front: sorted[0], back: sorted[1] });
    expect(sortScannedFileNames(["scan_1_10000.jpg", "scan_1_9999.jpg"])).toEqual(["scan_1_9999.jpg", "scan_1_10000.jpg"]);
  });
});
