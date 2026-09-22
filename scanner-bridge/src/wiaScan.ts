import { execFile } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Drives scripts/wia-scan.ps1 — the piece that actually talks to the
// scanner hardware via Windows' WIA driver, with no PaperStream IP window
// involved. Everything here is ordinary, testable Node (spawn a process,
// parse its output) — the hardware-dependent, UNTESTED-against-real-
// hardware part is entirely inside that script; see its own header comment
// for exactly what's assumed and why.
//
// The script writes scanned pages straight into the bridge's own
// WATCH_FOLDER, so once a page is saved, the EXISTING chokidar
// watcher/pairing/upload/recognition pipeline (watcher.ts) picks it up
// exactly as if PaperStream IP had written it — nothing downstream of "a
// TIFF appears in the watch folder" needed to change for this feature.

const SCRIPT_PATH = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "scripts",
  "wia-scan.ps1",
);

// A full ~100-card duplex batch at the fi-8170's rated 70ppm is a few
// minutes; this leaves generous headroom above that rather than risk
// killing a real, still-progressing scan.
const SCAN_TIMEOUT_MS = 10 * 60_000;

/**
 * Windows PowerShell 5.1's standard, effectively-universal install
 * location — ships as part of Windows itself since Windows 7, and stays
 * installed even on machines that also have PowerShell 7+ (pwsh.exe)
 * alongside it. Resolved directly rather than spawning the bare command
 * "powershell.exe" and trusting PATH lookup: confirmed against a real
 * machine that Node's child_process spawn/execFile on Windows does not
 * reliably search PATH the same way an interactive shell does — it failed
 * with ENOENT there even though powershell.exe plainly worked from that
 * same machine's own terminal. Falls back to the bare command only if
 * SystemRoot/windir are somehow both unset (not expected on any real
 * Windows install).
 */
export function resolvePowerShellExecutable(): string {
  const systemRoot = process.env.SystemRoot ?? process.env.windir;
  if (!systemRoot) return "powershell.exe";
  // path.win32 explicitly, not the platform-dependent path.join: SystemRoot
  // is a Windows-only environment variable in the first place (this whole
  // function only ever means anything on Windows), and explicit .win32
  // keeps this correctly testable from a non-Windows dev machine too,
  // rather than silently depending on whatever OS happens to run the test.
  return path.win32.join(systemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
}

interface PowerShellRun {
  stdout: string;
  stderr: string;
  /** Non-null only when the process failed to start, was killed (timeout),
   * or exited non-zero. */
  error: { message: string; killed?: boolean } | null;
}

function runPowerShell(args: string[]): Promise<PowerShellRun> {
  return new Promise((resolve) => {
    execFile(
      resolvePowerShellExecutable(),
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", SCRIPT_PATH, ...args],
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

interface ParsedResult {
  ok: boolean;
  message: string;
}

/** The script's contract: a single "RESULT:OK:<msg>" or "RESULT:ERROR:<msg>"
 * line, always last. Falls back to something diagnosable (not just "no
 * result line") when the script never got that far — e.g. powershell.exe
 * itself wasn't found, or it hit an uncaught terminating error. */
function parseResult(run: PowerShellRun): ParsedResult {
  const lines = run.stdout.split(/\r?\n/);
  const resultLine = [...lines].reverse().find((l) => l.startsWith("RESULT:"));
  if (resultLine) {
    const [, status, ...rest] = resultLine.split(":");
    return { ok: status === "OK", message: rest.join(":").trim() || "(no message)" };
  }
  if (run.error?.killed) {
    return { ok: false, message: `Timed out after ${SCAN_TIMEOUT_MS / 1000}s without finishing.` };
  }
  if (run.error) {
    return {
      ok: false,
      message: `powershell.exe did not run to completion: ${run.error.message}${
        run.stderr ? ` | stderr: ${run.stderr.trim()}` : ""
      }`,
    };
  }
  return { ok: false, message: "Script produced no RESULT line — see raw output." };
}

export interface WiaDeviceCheckResult {
  ok: boolean;
  message: string;
  rawOutput: string;
}

/** Diagnostic-only: lists WIA devices this PC can see, never touches the
 * feeder. Meant to be tried before ever attempting a real scan. */
export async function listWiaDevices(deviceNameMatch: string): Promise<WiaDeviceCheckResult> {
  // OutputFolder is required by the script even in list-only mode (it's
  // validated before the list/scan branch), but never written to here —
  // the OS temp dir always exists, so this never depends on bridge config.
  const run = await runPowerShell([
    "-OutputFolder",
    tmpdir(),
    "-DeviceNameMatch",
    deviceNameMatch,
    "-ListDevicesOnly",
  ]);
  const { ok, message } = parseResult(run);
  return { ok, message, rawOutput: run.stdout + (run.stderr ? `\n[stderr]\n${run.stderr}` : "") };
}

export interface WiaScanOptions {
  outputFolder: string;
  filePrefix: string;
  deviceNameMatch: string;
  duplex: boolean;
  resolution: number;
}

export interface WiaScanResult {
  ok: boolean;
  pagesScanned: number;
  message: string;
  rawOutput: string;
}

export async function runWiaScan(options: WiaScanOptions): Promise<WiaScanResult> {
  const args = [
    "-OutputFolder",
    options.outputFolder,
    "-FilePrefix",
    options.filePrefix,
    "-DeviceNameMatch",
    options.deviceNameMatch,
    "-Resolution",
    String(options.resolution),
  ];
  if (options.duplex) args.push("-Duplex");

  const run = await runPowerShell(args);
  const { ok, message } = parseResult(run);
  const pagesMatch = message.match(/(\d+) page/);
  return {
    ok,
    pagesScanned: pagesMatch ? Number.parseInt(pagesMatch[1], 10) : 0,
    message,
    rawOutput: run.stdout + (run.stderr ? `\n[stderr]\n${run.stderr}` : ""),
  };
}
