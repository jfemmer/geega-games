import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolvePowerShellExecutable } from "./wiaScan.js";

// Regression test for a real failure seen on a real Windows machine:
// spawning the bare command "powershell.exe" threw ENOENT even though
// powershell.exe plainly worked from that machine's own interactive
// terminal — Node's child_process spawn/execFile on Windows doesn't
// reliably search PATH the same way a shell does. resolvePowerShellExecutable
// sidesteps PATH lookup entirely by resolving PowerShell 5.1's standard,
// effectively-universal install location directly.

describe("resolvePowerShellExecutable", () => {
  const original = { SystemRoot: process.env.SystemRoot, windir: process.env.windir };

  beforeEach(() => {
    delete process.env.SystemRoot;
    delete process.env.windir;
  });

  afterEach(() => {
    if (original.SystemRoot === undefined) delete process.env.SystemRoot;
    else process.env.SystemRoot = original.SystemRoot;
    if (original.windir === undefined) delete process.env.windir;
    else process.env.windir = original.windir;
  });

  it("builds the full path from SystemRoot", () => {
    process.env.SystemRoot = "C:\\Windows";
    expect(resolvePowerShellExecutable()).toBe(
      "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
    );
  });

  it("falls back to windir when SystemRoot is unset", () => {
    process.env.windir = "D:\\Windows";
    expect(resolvePowerShellExecutable()).toBe(
      "D:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
    );
  });

  it("falls back to the bare command when neither is set (never expected on real Windows)", () => {
    expect(resolvePowerShellExecutable()).toBe("powershell.exe");
  });
});
