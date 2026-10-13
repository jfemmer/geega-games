import { existsSync } from "node:fs";
import path from "node:path";
import type { RecognizerHelp } from "./status.js";

// Turns "the recognizer's code couldn't load on this PC" into words staff
// can act on. The cases, most likely first:
//
// * Windows without the Microsoft Visual C++ Redistributable. ONNX Runtime's
//   Windows DLLs (onnxruntime.dll and onnxruntime_binding.node in
//   onnxruntime-node 1.30.0) import MSVCP140.dll, MSVCP140_1.dll,
//   MSVCP140_ATOMIC_WAIT.dll, VCRUNTIME140.dll and VCRUNTIME140_1.dll.
//   Node.js carries its own copy of the C++ runtime, so a PC can run Node and
//   the rest of the bridge without them, and an older Redistributable
//   (2015/2017) lacks the newer three. Windows reports it as "The specified
//   module could not be found", or "…procedure…" for an outdated one.
// * `npm install` not run after updating, so a package is missing.
// * sharp's own loader refusing (it says why: Node.js too old, a broken install).

export const VC_REDIST_URL: Readonly<Record<string, string>> = {
  x64: "https://aka.ms/vs/17/release/vc_redist.x64.exe",
  arm64: "https://aka.ms/vs/17/release/vc_redist.arm64.exe",
};

export const VC_RUNTIME_DLLS: readonly string[] = [
  "MSVCP140.dll",
  "MSVCP140_1.dll",
  "MSVCP140_ATOMIC_WAIT.dll",
  "VCRUNTIME140.dll",
  "VCRUNTIME140_1.dll",
];

const STILL_WORKS = "Until then, scans still upload and are identified online, as before.";

export interface LoadFailureExplanation {
  /** For the dashboard's Scanner panel. */
  message: string;
  /** A link to the fix, when there is one. */
  help: RecognizerHelp | null;
  /** The underlying error's first line (console and status.lastError). */
  detail: string;
}

export interface LoadFailureContext {
  platform?: NodeJS.Platform;
  arch?: string;
  /** Windows' System32 folder, where the Redistributable installs its DLLs. Null to skip the check. */
  systemDir?: string | null;
  fileExists?: (file: string) => boolean;
  nodeVersion?: string;
}

function firstLine(text: string): string {
  return (
    text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean) ?? text.trim()
  );
}

function describe(err: unknown): { code: string | undefined; message: string } {
  if (err instanceof Error) {
    const code = (err as NodeJS.ErrnoException).code;
    return { code: typeof code === "string" ? code : undefined, message: err.message };
  }
  return { code: undefined, message: String(err) };
}

function defaultSystemDir(): string {
  return path.win32.join(process.env.SystemRoot ?? process.env.windir ?? "C:\\Windows", "System32");
}

/** "onnxruntime-node" from "onnxruntime-node", "@scope/pkg/x.js" or a path inside node_modules. */
function packageName(specifier: string): string {
  const parts = specifier.split(/[\\/]/);
  const nm = parts.lastIndexOf("node_modules");
  const rest = nm >= 0 ? parts.slice(nm + 1) : parts;
  if (rest[0]?.startsWith("@") && rest[1]) return `${rest[0]}/${rest[1]}`;
  return nm >= 0 || !/[\\/]/.test(specifier) ? (rest[0] ?? specifier) : path.basename(specifier);
}

/** Which of the Visual C++ runtime DLLs aren't in System32 (a Windows path). */
export function missingVcRuntimeDlls(systemDir: string, fileExists: (file: string) => boolean = existsSync): string[] {
  return VC_RUNTIME_DLLS.filter((dll) => !fileExists(path.win32.join(systemDir, dll)));
}

export function explainRecognizerLoadFailure(err: unknown, context: LoadFailureContext = {}): LoadFailureExplanation {
  const platform = context.platform ?? process.platform;
  const arch = context.arch ?? process.arch;
  const { code, message } = describe(err);
  const detail = firstLine(message);

  // sharp checks its own install and says what's wrong.
  if (/Could not load the "sharp" module/i.test(message)) {
    if (/Please upgrade Node\.js/i.test(message)) {
      return {
        message: `Card recognition can't start on this PC: it needs a newer Node.js than ${context.nodeVersion ?? process.version}. Install the current LTS version, then in the scanner-bridge folder run npm install and restart the bridge. ${STILL_WORKS}`,
        help: { label: "Download Node.js", url: "https://nodejs.org/en/download" },
        detail,
      };
    }
    return {
      message: `Card recognition can't start on this PC: its image library (sharp) isn't installed properly. In the scanner-bridge folder run npm install, then restart the bridge. ${STILL_WORKS}`,
      help: null,
      detail,
    };
  }

  // A package or file that isn't there: `npm install` / `npm run build` not
  // run after updating. (Checked before native loading: a missing .node file
  // is an incomplete install, not a missing Windows component.)
  if (code === "ERR_MODULE_NOT_FOUND" || code === "MODULE_NOT_FOUND" || /Cannot find (package|module) '/i.test(message)) {
    const missing = /Cannot find (?:package|module) '([^']+)'/i.exec(message)?.[1];
    return {
      message: `Card recognition can't start on this PC: part of the bridge isn't installed${missing ? ` (${packageName(missing)})` : ""}. In the scanner-bridge folder run npm install, then npm run build, and restart the bridge. ${STILL_WORKS}`,
      help: null,
      detail,
    };
  }

  // A native library Windows (or Linux/macOS) wouldn't load.
  if (
    code === "ERR_DLOPEN_FAILED" ||
    /onnxruntime|specified (module|procedure) could not be found|DLL initialization routine failed/i.test(message)
  ) {
    if (platform === "win32") {
      const systemDir = context.systemDir === undefined ? defaultSystemDir() : context.systemDir;
      const missing = systemDir ? missingVcRuntimeDlls(systemDir, context.fileExists) : [];
      return {
        message:
          missing.length > 0
            ? `Card recognition can't start on this PC: Windows is missing the Microsoft Visual C++ Redistributable it needs (${missing.join(", ")} not found). Install it (free, from Microsoft), then restart the scanner bridge. ${STILL_WORKS}`
            : `Card recognition can't start on this PC: a Windows component it needs wouldn't load. Install the latest Microsoft Visual C++ Redistributable, run npm install in the scanner-bridge folder, then restart the bridge. ${STILL_WORKS}`,
        help: { label: "Download the Visual C++ Redistributable", url: VC_REDIST_URL[arch] ?? VC_REDIST_URL.x64 },
        detail,
      };
    }
    return {
      message: `Card recognition can't start on this PC: its AI runtime wouldn't load (${detail}). Run npm install in the scanner-bridge folder, then restart the bridge. ${STILL_WORKS}`,
      help: null,
      detail,
    };
  }

  return {
    message: `Card recognition can't start on this PC: ${detail.replace(/\.?$/, ".")} ${STILL_WORKS}`,
    help: null,
    detail,
  };
}
