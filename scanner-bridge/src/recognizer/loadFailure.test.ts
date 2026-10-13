import { describe, expect, it } from "vitest";
import { explainRecognizerLoadFailure, missingVcRuntimeDlls, VC_REDIST_URL, VC_RUNTIME_DLLS } from "./loadFailure.js";

// What staff see in the Scanner panel when the recognizer can't load on the
// scanning PC. The errors are the ones Node.js and the packages really throw.

function dlopenError(message: string): Error {
  return Object.assign(new Error(message), { code: "ERR_DLOPEN_FAILED" });
}

const BINDING = "C:\\GeegaBridge\\scanner-bridge\\node_modules\\onnxruntime-node\\bin\\napi-v6\\win32\\x64\\onnxruntime_binding.node";
const SYSTEM32 = "C:\\Windows\\System32";

describe("explainRecognizerLoadFailure", () => {
  it("names the missing Visual C++ Redistributable on Windows, with the download", () => {
    const present = new Set(["MSVCP140.dll", "VCRUNTIME140.dll"]);
    const why = explainRecognizerLoadFailure(dlopenError(`The specified module could not be found.\r\n\\\\?\\${BINDING}`), {
      platform: "win32",
      arch: "x64",
      systemDir: SYSTEM32,
      fileExists: (file) => present.has(file.split("\\").pop()!),
    });
    expect(why.message).toMatch(/Visual C\+\+ Redistributable/);
    expect(why.message).toMatch(/MSVCP140_1\.dll, MSVCP140_ATOMIC_WAIT\.dll, VCRUNTIME140_1\.dll not found/);
    expect(why.message).toMatch(/restart the scanner bridge/);
    expect(why.message).toMatch(/scans still upload/);
    expect(why.help).toEqual({ label: "Download the Visual C++ Redistributable", url: VC_REDIST_URL.x64 });
    expect(why.detail).toBe("The specified module could not be found.");
  });

  it("points at an outdated Redistributable when the DLLs are there but won't load", () => {
    const why = explainRecognizerLoadFailure(dlopenError(`The specified procedure could not be found.\r\n\\\\?\\${BINDING}`), {
      platform: "win32",
      arch: "arm64",
      systemDir: SYSTEM32,
      fileExists: () => true,
    });
    expect(why.message).toMatch(/latest Microsoft Visual C\+\+ Redistributable/);
    expect(why.help?.url).toBe(VC_REDIST_URL.arm64);
  });

  it("asks for npm install when a package is missing (updated without installing)", () => {
    const err = Object.assign(
      new Error("Cannot find package 'onnxruntime-node' imported from C:\\GeegaBridge\\scanner-bridge\\dist\\recognizer\\embedder.js"),
      { code: "ERR_MODULE_NOT_FOUND" },
    );
    const why = explainRecognizerLoadFailure(err, { platform: "win32" });
    expect(why.message).toMatch(/isn't installed \(onnxruntime-node\)/);
    expect(why.message).toMatch(/npm install, then npm run build/);
    expect(why.help).toBeNull();
  });

  it("treats a missing native file as an incomplete install, not a Windows problem", () => {
    const err = Object.assign(new Error(`Cannot find module '${BINDING}'`), { code: "MODULE_NOT_FOUND" });
    const why = explainRecognizerLoadFailure(err, { platform: "win32", systemDir: SYSTEM32, fileExists: () => false });
    expect(why.message).toMatch(/isn't installed \(onnxruntime-node\)/);
    expect(why.help).toBeNull();
  });

  it("relays sharp's own diagnosis: Node.js too old", () => {
    const err = new Error(
      'Could not load the "sharp" module using the win32-x64 runtime\nPossible solutions:\n- Please upgrade Node.js:\n    Found 18.19.0\n    Requires >=20.9.0',
    );
    const why = explainRecognizerLoadFailure(err, { platform: "win32", nodeVersion: "v18.19.0" });
    expect(why.message).toMatch(/newer Node\.js than v18\.19\.0/);
    expect(why.help?.url).toMatch(/nodejs\.org/);
  });

  it("relays sharp's own diagnosis: a broken install", () => {
    const err = new Error('Could not load the "sharp" module using the win32-x64 runtime\nERR_DLOPEN_FAILED: …');
    const why = explainRecognizerLoadFailure(err, { platform: "win32" });
    expect(why.message).toMatch(/image library \(sharp\)/);
    expect(why.message).toMatch(/npm install/);
  });

  it("explains a native load failure off Windows without the Windows advice", () => {
    const why = explainRecognizerLoadFailure(dlopenError("libonnxruntime.so.1: cannot open shared object file"), { platform: "linux" });
    expect(why.message).toMatch(/AI runtime wouldn't load/);
    expect(why.message).not.toMatch(/Visual C\+\+/);
  });

  it("falls back to the error itself for anything else", () => {
    const why = explainRecognizerLoadFailure(new Error("Something unexpected"), { platform: "win32" });
    expect(why.message).toBe(
      "Card recognition can't start on this PC: Something unexpected. Until then, scans still upload and are identified online, as before.",
    );
  });
});

describe("missingVcRuntimeDlls", () => {
  it("lists the DLLs that aren't in System32", () => {
    expect(missingVcRuntimeDlls(SYSTEM32, () => true)).toEqual([]);
    expect(missingVcRuntimeDlls(SYSTEM32, () => false)).toEqual([...VC_RUNTIME_DLLS]);
  });
});
