import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { appendFileSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { BuildParts, libraryRowsByKey, loadLibrary, writeLibrary, LIBRARY_FORMAT } from "./indexStore.js";
import type { CatalogEntry } from "./types.js";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "geega-library-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function entry(i: number): CatalogEntry {
  return { id: `id-${i}`, face: 0, name: `Card ${i}`, set: "TST", cn: String(i), lang: "en", ill: `ill-${i}`, img: `https://img/${i}.jpg?1`, finishes: ["nonfoil"], layout: "normal" };
}

describe("writeLibrary / loadLibrary", () => {
  it("round-trips entries and fingerprints, replacing the old library atomically", async () => {
    const libDir = path.join(dir, "library");
    const dims = 4;
    const manifest = { format: LIBRARY_FORMAT, model: { id: "m", dims }, builtAt: "2026-10-12T00:00:00Z", cardListRefreshedAt: null, entries: 2, printings: 2 };
    await writeLibrary(libDir, manifest, [entry(1), entry(2)], Int8Array.from([1, 2, 3, 4, -1, -2, -3, -4]), Float32Array.from([0.01, 0.02]));
    await writeLibrary(libDir, { ...manifest, entries: 1 }, [entry(3)], Int8Array.from([9, 9, 9, 9]), Float32Array.from([0.5]));
    const lib = await loadLibrary(libDir);
    expect(lib!.entries).toEqual([entry(3)]);
    expect(Array.from(lib!.index.vector(0))).toEqual([4.5, 4.5, 4.5, 4.5]);
    expect(existsSync(`${libDir}.old-${process.pid}`)).toBe(false);
    expect(existsSync(`${libDir}.tmp-${process.pid}`)).toBe(false);
  });

  it("has nothing to load before the first build", async () => {
    expect(await loadLibrary(path.join(dir, "missing"))).toBeNull();
  });

  it("recovers a library left aside by a power cut mid-swap, preferring the finished new copy", async () => {
    const libDir = path.join(dir, "library");
    const dims = 2;
    const manifest = { format: LIBRARY_FORMAT, model: { id: "m", dims }, builtAt: "2026-10-12T00:00:00Z", cardListRefreshedAt: null, entries: 1, printings: 1 };
    // The old library moved aside, the new one written but not yet moved in.
    await writeLibrary(`${libDir}.old-123`, manifest, [entry(1)], Int8Array.from([1, 1]), Float32Array.from([1]));
    await writeLibrary(`${libDir}.tmp-123`, manifest, [entry(2)], Int8Array.from([2, 2]), Float32Array.from([1]));
    const lib = await loadLibrary(libDir);
    expect(lib!.entries).toEqual([entry(2)]);
    expect(existsSync(path.join(libDir, "manifest.json"))).toBe(true);

    // Only the old copy left: that one comes back.
    const other = path.join(dir, "other");
    await writeLibrary(`${other}.old-9`, manifest, [entry(5)], Int8Array.from([5, 5]), Float32Array.from([1]));
    expect((await loadLibrary(other))!.entries).toEqual([entry(5)]);
  });
});

describe("libraryRowsByKey", () => {
  it("only reuses fingerprints made by the same model", async () => {
    const libDir = path.join(dir, "library");
    await writeLibrary(
      libDir,
      { format: LIBRARY_FORMAT, model: { id: "m1", dims: 1 }, builtAt: "x", cardListRefreshedAt: null, entries: 1, printings: 1 },
      [entry(1)],
      Int8Array.from([1]),
      Float32Array.from([1]),
    );
    const lib = await loadLibrary(libDir);
    expect(libraryRowsByKey(lib, "m1").get("id-1:0:https://img/1.jpg?1")).toBe(0);
    expect(libraryRowsByKey(lib, "m2").size).toBe(0);
  });
});

describe("BuildParts", () => {
  it("keeps finished fingerprints across an interruption, including a half-written append", async () => {
    const parts = new BuildParts(path.join(dir, "parts"), "m", 3);
    await parts.append(["a", "b"], [Int8Array.from([1, 2, 3]), Int8Array.from([4, 5, 6])], [0.1, 0.2]);
    // Simulate a crash after the vectors were written but before the key was.
    appendFileSync(path.join(dir, "parts", "vectors.i8"), Buffer.from([7, 8, 9]));
    appendFileSync(path.join(dir, "parts", "scales.f32"), Buffer.from(new Float32Array([0.3]).buffer));

    const reloaded = await new BuildParts(path.join(dir, "parts"), "m", 3).load();
    expect([...reloaded.keys()]).toEqual(["a", "b"]);
    expect(Array.from(reloaded.get("b")!.vector)).toEqual([4, 5, 6]);
    expect(reloaded.get("b")!.scale).toBeCloseTo(0.2, 6);

    // And it stays aligned for the next append.
    const again = new BuildParts(path.join(dir, "parts"), "m", 3);
    await again.append(["c"], [Int8Array.from([7, 7, 7])], [0.4]);
    expect([...(await again.load()).keys()]).toEqual(["a", "b", "c"]);
  });

  it("starts over when the model changed", async () => {
    const old = new BuildParts(path.join(dir, "parts"), "old-model", 3);
    await old.append(["a"], [Int8Array.from([1, 2, 3])], [0.1]);
    const fresh = await new BuildParts(path.join(dir, "parts"), "new-model", 3).load();
    expect(fresh.size).toBe(0);
  });
});
