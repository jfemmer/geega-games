import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { readdir } from "node:fs/promises";
import path from "node:path";

// Drives NAPS2 (naps2.com) — a free, actively maintained third-party
// scanning utility — via its console mode (NAPS2.Console.exe) to pull pages
// from the scanner with no PaperStream IP window involved.
//
// This replaces an earlier approach (scripts/wia-scan.ps1, removed) that
// scripted Windows' legacy WIA Automation Layer (WIA.DeviceManager /
// WIA.CommonDialog via wiaaut.dll) directly. Real-hardware testing against
// a Ricoh fi-8170 ruled out every script-controllable variable — format
// GUID, resolution, Current Intent validity, even matching the item's own
// live Format property exactly — while Item.Transfer()/CommonDialog.
// ShowTransfer() failed identically every single time with E_INVALIDARG
// ("The parameter is incorrect.", HRESULT 0x80070057) — including with NO
// format argument at all. Combined with the device's own status flags
// confirming paper WAS loaded in the feeder throughout, the evidence
// pointed at this driver's WIA Automation Layer implementing property
// read/write correctly but not Transfer at all, even though the SAME
// physical driver works fine through PaperStream IP — which, like most
// production/ADF scanner vendors' software (Fujitsu/PFU included), almost
// certainly drives it via TWAIN, not WIA. NAPS2 supports TWAIN directly,
// which sidesteps the broken layer entirely rather than working around it.
//
// Like the WIA approach before it, this writes scanned pages straight into
// the bridge's own WATCH_FOLDER, so the EXISTING chokidar watcher/pairing/
// upload/recognition pipeline (watcher.ts) picks them up exactly as if
// PaperStream IP had written them — nothing downstream of "a TIFF appears
// in the watch folder" needed to change for this feature.

// A full ~100-card duplex batch at the fi-8170's rated 70ppm is a few
// minutes; this leaves generous headroom above that rather than risk
// killing a real, still-progressing scan.
const SCAN_TIMEOUT_MS = 10 * 60_000;

interface Naps2Run {
  stdout: string;
  stderr: string;
  /** Non-null whenever the process failed to start, was killed (timeout),
   * or exited non-zero. */
  error: { message: string; killed?: boolean } | null;
}

function runNaps2(consolePath: string, args: string[]): Promise<Naps2Run> {
  return new Promise((resolve) => {
    execFile(
      consolePath,
      args,
      { timeout: SCAN_TIMEOUT_MS, maxBuffer: 10 * 1024 * 1024 },
      (error, stdout, stderr) => {
        resolve({
          stdout,
          stderr,
          error: error ? { message: error.message, killed: error.killed } : null,
        });
      },
    );
  });
}

function combinedOutput(run: Naps2Run): string {
  return run.stdout + (run.stderr ? `\n[stderr]\n${run.stderr}` : "");
}

/** No single "RESULT:" contract here — NAPS2.Console.exe is a third-party
 * binary we don't control the output format of, unlike the old .ps1 script.
 * Falls back to the last non-empty stdout line (where -v/--verbose puts its
 * own error summary), then to something diagnosable either way. */
function describeFailure(run: Naps2Run): string {
  if (run.error?.killed) {
    return `Timed out after ${SCAN_TIMEOUT_MS / 1000}s without finishing.`;
  }
  const lastLine = [...run.stdout.split(/\r?\n/)].reverse().find((l) => l.trim().length > 0);
  if (lastLine) return lastLine.trim();
  if (run.error) {
    return `NAPS2.Console.exe did not run to completion: ${run.error.message}${
      run.stderr ? ` | stderr: ${run.stderr.trim()}` : ""
    }`;
  }
  return "NAPS2.Console.exe exited with an error — see raw output.";
}

/** Exported so config.ts and the /scan endpoints can give the same clear,
 * actionable message rather than a generic ENOENT, and so this is checked
 * lazily (at point of use) instead of blocking the whole bridge's startup —
 * NAPS2 is only required for the OPTIONAL direct-scan feature, not for the
 * core watch-and-upload path PaperStream-driven scanning still uses. */
export function checkConsolePath(consolePath: string): string | null {
  if (existsSync(consolePath)) return null;
  return (
    `Could not find NAPS2.Console.exe at ${consolePath}. Install NAPS2 ` +
    `(https://www.naps2.com/download), then set NAPS2_CONSOLE_PATH in .env ` +
    `if it's installed somewhere other than the default location.`
  );
}

export interface ScanDeviceCheckResult {
  ok: boolean;
  message: string;
  rawOutput: string;
}

/** Diagnostic-only: lists devices NAPS2 can see through the given driver,
 * never touches the feeder. Meant to be tried before ever attempting a real
 * scan. */
export async function listScanDevices(
  consolePath: string,
  driver: string,
): Promise<ScanDeviceCheckResult> {
  const pathError = checkConsolePath(consolePath);
  if (pathError) return { ok: false, message: pathError, rawOutput: "" };

  const run = await runNaps2(consolePath, ["--noprofile", "--driver", driver, "--listdevices"]);
  const ok = run.error === null;
  return {
    ok,
    message: ok ? "Listed devices — see raw output below." : describeFailure(run),
    rawOutput: combinedOutput(run),
  };
}

/** Counts pages a run actually produced by reading the watch folder back,
 * rather than trusting NAPS2's own exit code/output alone — filePrefix is
 * unique per run (caller uses a timestamp), so any file whose name starts
 * with it can only have come from this run. This is deliberately the same
 * "the filesystem is truth" approach watcher.ts already uses downstream:
 * robust regardless of NAPS2's exact --split naming/numbering scheme, and
 * still correct even on a partial failure (a jam mid-batch) where some
 * pages saved before the error. */
async function countScannedPages(outputFolder: string, filePrefix: string): Promise<number> {
  const entries = await readdir(outputFolder).catch(() => [] as string[]);
  return entries.filter((name) => name.startsWith(filePrefix)).length;
}

export interface ScanOptions {
  consolePath: string;
  outputFolder: string;
  filePrefix: string;
  driver: string;
  deviceNameMatch: string;
  duplex: boolean;
  resolution: number;
}

export interface ScanResult {
  ok: boolean;
  pagesScanned: number;
  message: string;
  rawOutput: string;
}

export async function runScan(options: ScanOptions): Promise<ScanResult> {
  const pathError = checkConsolePath(options.consolePath);
  if (pathError) return { ok: false, pagesScanned: 0, message: pathError, rawOutput: "" };

  const outputPath = path.join(options.outputFolder, `${options.filePrefix}.tiff`);
  const args = [
    "--noprofile",
    "-v",
    "-f",
    "--split",
    "--driver",
    options.driver,
    "--device",
    options.deviceNameMatch,
    "--source",
    options.duplex ? "duplex" : "feeder",
    "--dpi",
    String(options.resolution),
    "--bitdepth",
    "color",
    "-o",
    outputPath,
  ];

  const run = await runNaps2(options.consolePath, args);
  const pagesScanned = await countScannedPages(options.outputFolder, options.filePrefix);
  const rawOutput = combinedOutput(run);

  if (run.error === null && pagesScanned > 0) {
    return { ok: true, pagesScanned, message: `${pagesScanned} page(s) scanned`, rawOutput };
  }
  if (run.error === null && pagesScanned === 0) {
    return {
      ok: false,
      pagesScanned: 0,
      message: "No pages were scanned - was anything in the feeder?",
      rawOutput,
    };
  }
  // run.error !== null: report whatever pagesScanned actually landed before
  // the failure (e.g. a jam partway through a batch) rather than discarding
  // that — nothing scanned successfully is hidden just because the run as a
  // whole errored. The watcher picks these files up regardless of what this
  // function reports; see watcher.ts.
  return { ok: false, pagesScanned, message: describeFailure(run), rawOutput };
}
