import { existsSync, mkdirSync } from "node:fs";
import { appendFile, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { entryKey } from "./catalog.js";
import { VectorIndex } from "./vectorIndex.js";
import type { CatalogEntry } from "./types.js";

// On-disk format of the fingerprint library (a folder on this PC):
//
//   manifest.json   what built it (model, when, from which card list)
//   entries.json    one record per fingerprinted card face
//   vectors.i8      the fingerprints, 8-bit, entries × dims
//   scales.f32      one float scale per fingerprint
//
// Replaced atomically (written to a temp folder, then swapped in), so a
// crash or power cut mid-update leaves the previous library intact. While
// building, finished fingerprints are appended to a "parts" folder so an
// interrupted overnight build picks up where it stopped.

export const LIBRARY_FORMAT = 1;

export interface LibraryManifest {
  format: number;
  model: { id: string; dims: number };
  builtAt: string;
  /** When the shop's Scryfall card list (scryfall_bulk_cards) was last refreshed. */
  cardListRefreshedAt: string | null;
  entries: number;
  /** Printings the card list had (some have no paper image and are skipped). */
  printings: number;
}

export interface Library {
  manifest: LibraryManifest;
  entries: CatalogEntry[];
  index: VectorIndex;
}

type StoredEntry = [id: string, face: number, name: string, set: string, cn: string, lang: string, ill: string | null, img: string, finishes: string[], layout: string];

function pack(e: CatalogEntry): StoredEntry {
  return [e.id, e.face, e.name, e.set, e.cn, e.lang, e.ill, e.img, e.finishes, e.layout];
}

function unpack(s: StoredEntry): CatalogEntry {
  return { id: s[0], face: s[1], name: s[2], set: s[3], cn: s[4], lang: s[5], ill: s[6], img: s[7], finishes: s[8], layout: s[9] };
}

/**
 * rename() that rides out the brief locks Windows puts on freshly written
 * files (antivirus scanning, the search indexer) instead of failing the
 * whole library update over them.
 */
async function renameRetrying(from: string, to: string): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      await rename(from, to);
      return;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (attempt >= 8 || (code !== "EPERM" && code !== "EBUSY" && code !== "EACCES")) throw err;
      await new Promise((r) => setTimeout(r, 100 * 2 ** Math.min(attempt, 4)));
    }
  }
}

const RM_OPTIONS = { recursive: true, force: true, maxRetries: 5, retryDelay: 200 } as const;

/**
 * If the PC lost power in the instant between moving the old library aside
 * and moving the new one in, put back whichever complete copy is there.
 */
async function recoverInterruptedSwap(dir: string): Promise<void> {
  if (existsSync(path.join(dir, "manifest.json"))) return;
  const parent = path.dirname(dir);
  const base = path.basename(dir);
  const siblings = await readdir(parent).catch(() => [] as string[]);
  // A finished new copy beats the old one.
  for (const prefix of [`${base}.tmp-`, `${base}.old-`]) {
    for (const name of siblings.filter((n) => n.startsWith(prefix))) {
      const candidate = path.join(parent, name);
      if (!existsSync(path.join(candidate, "manifest.json"))) continue;
      await rm(dir, RM_OPTIONS);
      await renameRetrying(candidate, dir).catch(() => undefined);
      if (existsSync(path.join(dir, "manifest.json"))) return;
    }
  }
}

export async function loadLibrary(dir: string): Promise<Library | null> {
  await recoverInterruptedSwap(dir);
  if (!existsSync(path.join(dir, "manifest.json"))) return null;
  const manifest = JSON.parse(await readFile(path.join(dir, "manifest.json"), "utf8")) as LibraryManifest;
  if (manifest.format !== LIBRARY_FORMAT) return null;
  const stored = JSON.parse(await readFile(path.join(dir, "entries.json"), "utf8")) as StoredEntry[];
  const vecBuf = await readFile(path.join(dir, "vectors.i8"));
  const scaleBuf = await readFile(path.join(dir, "scales.f32"));
  const vectors = new Int8Array(vecBuf.buffer, vecBuf.byteOffset, vecBuf.byteLength);
  const scales = new Float32Array(scaleBuf.buffer.slice(scaleBuf.byteOffset, scaleBuf.byteOffset + scaleBuf.byteLength));
  const entries = stored.map(unpack);
  if (entries.length !== scales.length) throw new Error("The card library on disk is damaged (entry count mismatch).");
  return { manifest, entries, index: new VectorIndex(manifest.model.dims, vectors, scales) };
}

export async function writeLibrary(
  dir: string,
  manifest: LibraryManifest,
  entries: CatalogEntry[],
  vectors: Int8Array,
  scales: Float32Array,
): Promise<void> {
  const parent = path.dirname(dir);
  mkdirSync(parent, { recursive: true });
  const tmp = `${dir}.tmp-${process.pid}`;
  const old = `${dir}.old-${process.pid}`;
  await rm(tmp, RM_OPTIONS);
  mkdirSync(tmp, { recursive: true });
  await writeFile(path.join(tmp, "entries.json"), JSON.stringify(entries.map(pack)));
  await writeFile(path.join(tmp, "vectors.i8"), vectors);
  await writeFile(path.join(tmp, "scales.f32"), new Uint8Array(scales.buffer, scales.byteOffset, scales.byteLength));
  // Manifest last: a folder without one is never loaded.
  await writeFile(path.join(tmp, "manifest.json"), JSON.stringify(manifest, null, 2));
  await rm(old, RM_OPTIONS);
  if (existsSync(dir)) await renameRetrying(dir, old);
  try {
    await renameRetrying(tmp, dir);
  } catch (err) {
    // Never leave the PC without a library: put the previous one back.
    if (existsSync(old) && !existsSync(dir)) await renameRetrying(old, dir).catch(() => undefined);
    throw err;
  }
  await rm(old, RM_OPTIONS);
}

/**
 * Append-only store of fingerprints finished during a build. Each append is
 * one line of JSON metadata plus the matching rows in two binary files.
 */
export class BuildParts {
  readonly dir: string;
  readonly modelId: string;
  readonly dims: number;

  constructor(dir: string, modelId: string, dims: number) {
    this.dir = dir;
    this.modelId = modelId;
    this.dims = dims;
  }

  private file(name: string): string {
    return path.join(this.dir, name);
  }

  /** Finished fingerprints from an earlier, interrupted run with the same model. */
  async load(): Promise<Map<string, { vector: Int8Array; scale: number }>> {
    const done = new Map<string, { vector: Int8Array; scale: number }>();
    const metaFile = this.file("meta.json");
    if (!existsSync(metaFile)) return done;
    const meta = JSON.parse(await readFile(metaFile, "utf8")) as { modelId: string; dims: number };
    if (meta.modelId !== this.modelId || meta.dims !== this.dims) {
      await this.clear();
      return done;
    }
    const keys = (await readFile(this.file("keys.txt"), "utf8").catch(() => "")).split("\n").filter(Boolean);
    const vecBuf = await readFile(this.file("vectors.i8")).catch(() => Buffer.alloc(0));
    const scaleBuf = await readFile(this.file("scales.f32")).catch(() => Buffer.alloc(0));
    // A crash mid-append can leave the three files at different lengths;
    // only rows present in all three count.
    const rows = Math.min(keys.length, Math.floor(vecBuf.length / this.dims), Math.floor(scaleBuf.length / 4));
    const scales = new Float32Array(scaleBuf.buffer.slice(scaleBuf.byteOffset, scaleBuf.byteOffset + rows * 4));
    for (let r = 0; r < rows; r++) {
      const vector = new Int8Array(vecBuf.buffer, vecBuf.byteOffset + r * this.dims, this.dims).slice();
      done.set(keys[r], { vector, scale: scales[r] });
    }
    if (rows < keys.length || rows * this.dims < vecBuf.length) {
      // Rewrite cleanly so later appends stay aligned.
      await this.clear();
      await this.append(
        [...done.keys()],
        [...done.values()].map((v) => v.vector),
        [...done.values()].map((v) => v.scale),
      );
    }
    return done;
  }

  async append(keys: string[], vectors: Int8Array[], scales: number[]): Promise<void> {
    if (keys.length === 0) return;
    mkdirSync(this.dir, { recursive: true });
    const metaFile = this.file("meta.json");
    if (!existsSync(metaFile)) await writeFile(metaFile, JSON.stringify({ modelId: this.modelId, dims: this.dims }));
    const vec = new Int8Array(vectors.length * this.dims);
    vectors.forEach((v, i) => vec.set(v, i * this.dims));
    await appendFile(this.file("vectors.i8"), vec);
    await appendFile(this.file("scales.f32"), new Uint8Array(new Float32Array(scales).buffer));
    // Keys last, so a key is only ever recorded once its vector is on disk.
    await appendFile(this.file("keys.txt"), keys.map((k) => `${k}\n`).join(""));
  }

  async clear(): Promise<void> {
    await rm(this.dir, RM_OPTIONS);
  }
}

/** Existing library rows by entry key, for reuse when only part of the card list changed. */
export function libraryRowsByKey(library: Library | null, modelId: string): Map<string, number> {
  const map = new Map<string, number>();
  if (!library || library.manifest.model.id !== modelId) return map;
  library.entries.forEach((e, row) => map.set(entryKey(e), row));
  return map;
}
