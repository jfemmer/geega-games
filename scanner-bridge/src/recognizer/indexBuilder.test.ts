import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { CatalogRow } from "./catalog.js";
import type { ImageEmbedder } from "./embedder.js";
import { buildLibrary } from "./indexBuilder.js";
import { decodeFit } from "./image.js";
import { renderCard, type SyntheticPrinting } from "./testing/syntheticCards.js";
import { tinyEmbedder } from "./testing/syntheticLibrary.js";
import type { ReferenceProvider } from "./referenceImages.js";

// Building the card library from the shop's Scryfall card list: first build,
// an update that only fingerprints what's new, resuming after a stop, and
// carrying on past images that can't be downloaded.

const printings: SyntheticPrinting[] = Array.from({ length: 40 }, (_, i) => ({
  id: `bbbbbbbb-0000-4000-8000-${String(i).padStart(12, "0")}`,
  name: `Card ${i}`,
  set: i % 2 ? "ODD" : "EVN",
  cn: String(i + 1),
  art: 100 + i,
  symbol: i % 4,
}));

const url = (p: SyntheticPrinting) => `https://cards.test/normal/front/${p.id}.jpg?1`;

function row(p: SyntheticPrinting): CatalogRow {
  return {
    scryfall_id: p.id,
    card_name: p.name,
    set_code: p.set,
    collector_number: p.cn,
    lang: "en",
    layout: "normal",
    finishes: ["nonfoil"],
    bulk_updated_at: "2026-09-16T03:22:29.000Z",
    image_uris: { normal: url(p) },
    card_faces: null,
    games: ["paper"],
    illustration_id: `ill-${p.art}`,
    oversized: false,
  };
}

function fakeSupabase(rows: () => CatalogRow[]): SupabaseClient {
  return {
    from() {
      let gt: string | null = null;
      let limit = 1000;
      const q = {
        select: () => q,
        order: () => q,
        limit: (n: number) => ((limit = n), q),
        gt: (_c: string, v: string) => ((gt = v), q),
        then(resolve: (v: unknown) => void) {
          const sorted = rows().slice().sort((a, b) => a.scryfall_id.localeCompare(b.scryfall_id));
          const start = gt ? sorted.findIndex((r) => r.scryfall_id === gt) + 1 : 0;
          resolve({ data: sorted.slice(start, start + limit), error: null });
        },
      };
      return q;
    },
  } as unknown as SupabaseClient;
}

let embedder: ImageEmbedder;
const images = new Map<string, Buffer>();
let fetches: Map<string, number>;
let dir: string;
let broken: Set<string>;

const references: ReferenceProvider = {
  async views() {
    return null;
  },
  async bytes(u, opts) {
    expect(opts).toEqual({ cache: false });
    fetches.set(u, (fetches.get(u) ?? 0) + 1);
    return broken.has(u) ? null : (images.get(u) ?? null);
  },
};

beforeAll(async () => {
  embedder = await tinyEmbedder();
  for (const p of printings) images.set(url(p), await renderCard(p));
}, 60_000);

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "geega-build-"));
  fetches = new Map();
  broken = new Set();
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("buildLibrary", () => {
  it("fingerprints every card on the first build and finds each card again", async () => {
    const libraryDir = path.join(dir, "library");
    const phases = new Set<string>();
    const result = await buildLibrary({
      supabase: fakeSupabase(() => printings.slice(0, 20).map(row)),
      libraryDir,
      embedder,
      references,
      concurrency: 4,
      onProgress: (p) => phases.add(p.phase),
    });
    expect(result).toMatchObject({ added: 20, reused: 0, failed: 0 });
    expect(result.library.entries).toHaveLength(20);
    expect(result.library.manifest).toMatchObject({ entries: 20, printings: 20, cardListRefreshedAt: "2026-09-16T03:22:29.000Z", model: { id: "tiny-test" } });
    expect([...phases]).toEqual(["reading_card_list", "fingerprinting", "saving", "done"]);
    expect(existsSync(`${libraryDir}-build`)).toBe(false);

    const p = printings[7];
    const [query] = await embedder.embed([await decodeFit(images.get(url(p))!, 680)]);
    const [hits] = result.library.index.search([query], 1);
    expect(result.library.entries[hits[0].row].id).toBe(p.id);
  }, 60_000);

  it("only fingerprints new cards on an update", async () => {
    const libraryDir = path.join(dir, "library");
    let current = printings.slice(0, 20);
    const supabase = fakeSupabase(() => current.map(row));
    await buildLibrary({ supabase, libraryDir, embedder, references });
    fetches.clear();
    current = printings.slice(0, 23);
    const second = await buildLibrary({ supabase, libraryDir, embedder, references });
    expect(second).toMatchObject({ added: 3, reused: 20 });
    expect(second.library.entries).toHaveLength(23);
    expect([...fetches.keys()].sort()).toEqual(printings.slice(20, 23).map(url).sort());
  }, 60_000);

  it("picks up where it stopped after being interrupted", async () => {
    const libraryDir = path.join(dir, "library");
    const supabase = fakeSupabase(() => printings.map(row));
    const controller = new AbortController();
    await expect(
      buildLibrary({
        supabase,
        libraryDir,
        embedder,
        references,
        concurrency: 2,
        signal: controller.signal,
        onProgress: (p) => {
          if (p.phase === "fingerprinting" && p.done >= 16) controller.abort();
        },
      }),
    ).rejects.toThrow(/cancelled/);
    expect(existsSync(`${libraryDir}-build`)).toBe(true);

    const resumed = await buildLibrary({ supabase, libraryDir, embedder, references });
    expect(resumed.reused).toBeGreaterThanOrEqual(16);
    expect(resumed.added + resumed.reused).toBe(40);
    expect(resumed.library.entries).toHaveLength(40);
  }, 60_000);

  it("skips images it can't download (and counts them) instead of failing the build", async () => {
    broken.add(url(printings[2]));
    const result = await buildLibrary({
      supabase: fakeSupabase(() => printings.slice(0, 5).map(row)),
      libraryDir: path.join(dir, "library"),
      embedder,
      references,
    });
    expect(result.failed).toBe(1);
    expect(result.library.entries.map((e) => e.id)).not.toContain(printings[2].id);
    expect(result.library.entries).toHaveLength(4);
  }, 60_000);

  it("refuses to build while another process holds the folder's lock, but takes over a stale one", async () => {
    const libraryDir = path.join(dir, "library");
    const supabase = fakeSupabase(() => printings.slice(0, 3).map(row));
    // Another live process (our parent) holds it.
    writeFileSync(`${libraryDir}.lock`, String(process.ppid));
    await expect(buildLibrary({ supabase, libraryDir, embedder, references })).rejects.toThrow(/already being updated/);
    // A crashed process left it behind.
    writeFileSync(`${libraryDir}.lock`, "999999999");
    const result = await buildLibrary({ supabase, libraryDir, embedder, references });
    expect(result.library.entries).toHaveLength(3);
    expect(existsSync(`${libraryDir}.lock`)).toBe(false);
  }, 60_000);
});
