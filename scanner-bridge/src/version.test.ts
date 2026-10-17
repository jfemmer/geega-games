import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { BRIDGE_VERSION, builtVersion, installedVersion, pendingUpdate, pendingUpdateChecker } from "./version.js";

// The version the dashboard shows for the scanning PC, and what it says is
// left to do after `git pull`: the three update steps are easy to half-do,
// and a half-done update leaves the old code running with no sign of it.

const BRIDGE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("BRIDGE_VERSION", () => {
  it("matches package.json", () => {
    const pkg = JSON.parse(readFileSync(path.join(BRIDGE_DIR, "package.json"), "utf8")) as { version: string };
    expect(BRIDGE_VERSION).toBe(pkg.version);
    expect(installedVersion(BRIDGE_DIR)).toBe(BRIDGE_VERSION);
  });
});

describe("pendingUpdate", () => {
  let dir: string;
  const writePackage = (version: string) => writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: "geega-scanner-bridge", version }));
  const writeBuilt = (version: string) => {
    mkdirSync(path.join(dir, "dist"), { recursive: true });
    // What tsc emits for version.ts.
    writeFileSync(path.join(dir, "dist", "version.js"), `import { readFileSync } from "node:fs";\nexport const BRIDGE_VERSION = "${version}";\n`);
  };

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "bridge-version-"));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("is null when the files on disk are the version that's running", () => {
    writePackage("1.1.0");
    writeBuilt("1.1.0");
    expect(pendingUpdate(dir, "1.1.0")).toBeNull();
  });

  it("asks for a build when the files were pulled but dist/ is older", () => {
    writePackage("1.2.0");
    writeBuilt("1.1.0");
    expect(pendingUpdate(dir, "1.1.0")).toEqual({ version: "1.2.0", step: "build" });
    // dist/ from before version reporting (no version.js) is older too.
    rmSync(path.join(dir, "dist"), { recursive: true });
    expect(builtVersion(dir)).toBeNull();
    expect(pendingUpdate(dir, "1.1.0")).toEqual({ version: "1.2.0", step: "build" });
  });

  it("asks for a restart when it was rebuilt but the old code is still running", () => {
    writePackage("1.2.0");
    writeBuilt("1.2.0");
    expect(pendingUpdate(dir, "1.1.0")).toEqual({ version: "1.2.0", step: "restart" });
  });

  it("stays quiet when package.json can't be read", () => {
    expect(pendingUpdate(dir, "1.1.0")).toBeNull();
    writeFileSync(path.join(dir, "package.json"), "{ not json");
    expect(pendingUpdate(dir, "1.1.0")).toBeNull();
  });

  it("reads the disk at most once per interval", () => {
    writePackage(BRIDGE_VERSION);
    let now = 0;
    const check = pendingUpdateChecker(dir, 30_000, () => now);
    expect(check()).toBeNull();
    writePackage("99.0.0");
    now = 10_000;
    expect(check()).toBeNull();
    now = 30_000;
    expect(check()).toEqual({ version: "99.0.0", step: "build" });
  });
});
