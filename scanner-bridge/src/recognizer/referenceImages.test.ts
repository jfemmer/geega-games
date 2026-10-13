import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createReferenceProvider } from "./referenceImages.js";
import { renderCard } from "./testing/syntheticCards.js";

let dir: string;
let jpeg: Buffer;
beforeEach(async () => {
  dir = mkdtempSync(path.join(tmpdir(), "geega-refs-"));
  jpeg ??= await renderCard({ id: "x", name: "X", set: "AAA", cn: "1", art: 1, symbol: 0 });
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function fetchImpl(status = 200) {
  return vi.fn(async () => new Response(status === 200 ? jpeg : null, { status }));
}

describe("createReferenceProvider", () => {
  it("downloads a reference once, then serves it from disk and memory", async () => {
    const f = fetchImpl();
    const refs = createReferenceProvider({ cacheDir: dir, maxBytes: 50_000_000, fetchImpl: f });
    const a = await refs.views("https://cards.test/normal/a.jpg?1");
    expect(a?.half.img.width).toBe(244);
    expect(await refs.bytes("https://cards.test/normal/a.jpg?1")).toEqual(jpeg);
    await refs.views("https://cards.test/normal/a.jpg?1");
    expect(f).toHaveBeenCalledTimes(1);
    expect(readdirSync(dir).filter((n) => n.endsWith(".jpg"))).toHaveLength(1);

    // A fresh provider (bridge restart) still has it on disk.
    const again = createReferenceProvider({ cacheDir: dir, maxBytes: 50_000_000, fetchImpl: f });
    await again.views("https://cards.test/normal/a.jpg?1");
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("can skip the disk cache (the library build reads each image once)", async () => {
    const f = fetchImpl();
    const refs = createReferenceProvider({ cacheDir: dir, maxBytes: 50_000_000, fetchImpl: f });
    expect(await refs.bytes("https://cards.test/normal/b.jpg", { cache: false })).toEqual(jpeg);
    expect(readdirSync(dir)).toEqual([]);
  });

  it("returns null for an image Scryfall doesn't have", async () => {
    const refs = createReferenceProvider({ cacheDir: dir, maxBytes: 50_000_000, fetchImpl: fetchImpl(404) });
    expect(await refs.views("https://cards.test/normal/missing.jpg")).toBeNull();
  });

  it("shares one download between simultaneous requests for the same image", async () => {
    const f = fetchImpl();
    const refs = createReferenceProvider({ cacheDir: dir, maxBytes: 50_000_000, fetchImpl: f });
    await Promise.all([refs.bytes("https://cards.test/c.jpg"), refs.bytes("https://cards.test/c.jpg"), refs.bytes("https://cards.test/c.jpg")]);
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("keeps the folder under its size cap, dropping the least recently used first", async () => {
    const f = fetchImpl();
    const refs = createReferenceProvider({ cacheDir: dir, maxBytes: jpeg.length * 2.5, fetchImpl: f });
    for (const name of ["1", "2", "3", "4"]) {
      await refs.bytes(`https://cards.test/${name}.jpg`);
      await new Promise((r) => setTimeout(r, 15));
    }
    await vi.waitFor(() => expect(readdirSync(dir).filter((n) => n.endsWith(".jpg")).length).toBeLessThanOrEqual(2));
  });
});
