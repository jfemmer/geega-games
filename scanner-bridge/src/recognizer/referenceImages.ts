import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import { readdir, readFile, rename, stat, unlink, utimes, writeFile } from "node:fs/promises";
import path from "node:path";
import { decodeGray } from "./image.js";
import type { GrayImage } from "./types.js";
import { makeViews, VERIFY_HEIGHT, VERIFY_WIDTH, type CardViews } from "./verify.js";

// Scryfall reference images for the pixel-level check, fetched only for the
// handful of candidates each scan needs and kept in a size-capped folder on
// this PC (least recently used files go first). Scryfall's image servers
// (*.scryfall.io) aren't rate-limited, but a card already seen is never
// downloaded twice while it's in the cache.

export interface ReferenceProvider {
  /** The reference image as comparison views, or null if it can't be fetched. */
  views(url: string): Promise<CardViews | null>;
  /**
   * Raw image bytes. `cache: false` skips the disk cache (the library build
   * reads every image exactly once — caching 110k images would just churn
   * the disk).
   */
  bytes(url: string, options?: { cache?: boolean }): Promise<Buffer | null>;
}

export interface ReferenceCacheOptions {
  cacheDir: string;
  maxBytes: number;
  fetchImpl?: typeof fetch;
  userAgent?: string;
  /** Decoded grayscale images kept in memory (≈330 KB each). */
  memoryEntries?: number;
}

const FETCH_TIMEOUT_MS = 15_000;

export function createReferenceProvider(options: ReferenceCacheOptions): ReferenceProvider {
  const fetchImpl = options.fetchImpl ?? fetch;
  const memoryLimit = options.memoryEntries ?? 300;
  mkdirSync(options.cacheDir, { recursive: true });
  const memory = new Map<string, GrayImage>();
  const inflight = new Map<string, Promise<Buffer | null>>();
  let knownBytes: number | null = null;
  let writesSincePrune = 0;

  const fileFor = (url: string) => path.join(options.cacheDir, `${createHash("sha1").update(url).digest("hex")}.jpg`);

  async function download(url: string): Promise<Buffer | null> {
    for (let attempt = 0; attempt < 3; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
      try {
        const res = await fetchImpl(url, {
          headers: { "User-Agent": options.userAgent ?? "GeegaScannerBridge/1.0", Accept: "image/*" },
          signal: controller.signal,
        });
        if (res.status === 404) return null;
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return Buffer.from(await res.arrayBuffer());
      } catch {
        if (attempt < 2) await new Promise((r) => setTimeout(r, 400 * 2 ** attempt));
      } finally {
        clearTimeout(timer);
      }
    }
    return null;
  }

  async function prune(): Promise<void> {
    const names = await readdir(options.cacheDir).catch(() => [] as string[]);
    const files = await Promise.all(
      names
        .filter((n) => n.endsWith(".jpg"))
        .map(async (n) => {
          const full = path.join(options.cacheDir, n);
          const s = await stat(full).catch(() => null);
          return s ? { full, size: s.size, used: s.mtimeMs } : null;
        }),
    );
    const list = files.filter((f): f is NonNullable<typeof f> => !!f).sort((a, b) => a.used - b.used);
    let total = list.reduce((sum, f) => sum + f.size, 0);
    for (const f of list) {
      if (total <= options.maxBytes * 0.9) break;
      await unlink(f.full).catch(() => undefined);
      total -= f.size;
    }
    knownBytes = total;
  }

  async function bytes(url: string, opts: { cache?: boolean } = {}): Promise<Buffer | null> {
    const file = fileFor(url);
    const cached = await readFile(file).catch(() => null);
    if (cached) {
      const now = new Date();
      void utimes(file, now, now).catch(() => undefined);
      return cached;
    }
    if (opts.cache === false) return download(url);
    let pending = inflight.get(url);
    if (!pending) {
      pending = (async () => {
        const data = await download(url);
        if (data) {
          const tmp = `${file}.${process.pid}.tmp`;
          await writeFile(tmp, data).then(() => rename(tmp, file)).catch(() => undefined);
          if (knownBytes !== null) knownBytes += data.length;
          writesSincePrune++;
          if (knownBytes === null || knownBytes > options.maxBytes || writesSincePrune >= 500) {
            writesSincePrune = 0;
            void prune();
          }
        }
        return data;
      })().finally(() => inflight.delete(url));
      inflight.set(url, pending);
    }
    return pending;
  }

  return {
    bytes,
    async views(url: string): Promise<CardViews | null> {
      const hit = memory.get(url);
      if (hit) {
        memory.delete(url);
        memory.set(url, hit);
        return makeViews(hit);
      }
      const data = await bytes(url);
      if (!data) return null;
      try {
        const gray = await decodeGray(data, VERIFY_WIDTH, VERIFY_HEIGHT);
        memory.set(url, gray);
        while (memory.size > memoryLimit) {
          const oldest = memory.keys().next().value;
          if (oldest === undefined) break;
          memory.delete(oldest);
        }
        return makeViews(gray);
      } catch {
        return null;
      }
    },
  };
}
