import sharp from "sharp";

// Perceptual hashing for visual candidate verification (Part 6.4) and set-
// symbol shape matching (Part 6.5). A dHash (difference hash): resize to a
// tiny grayscale grid, compare each pixel to its right neighbor, pack the
// bits — the hash is a shape/gradient signature that's stable across
// re-encoding, minor scan lighting differences, and JPEG artifacts, and
// cheap to compare (Hamming distance = popcount of an XOR). This is ONE
// signal among several (see verification.ts) — it verifies/narrows
// candidates, never chooses a printing on its own, per Part 6.4's explicit
// "don't compare only the art crop, and don't let one signal decide" rule.

const HASH_WIDTH = 9; // 9x8 grayscale grid -> 8x8 = 64 comparison bits
const HASH_HEIGHT = 8;

/** A 64-bit dHash, stored as a bigint for cheap XOR/popcount comparison. */
export type ImageHash = bigint;

export async function computeImageHash(image: Buffer): Promise<ImageHash> {
  const { data } = await sharp(image)
    .resize(HASH_WIDTH, HASH_HEIGHT, { fit: "fill" })
    .grayscale()
    .raw()
    .toBuffer({ resolveWithObject: true });

  let hash = 0n;
  let bit = 0n;
  for (let row = 0; row < HASH_HEIGHT; row++) {
    for (let col = 0; col < HASH_WIDTH - 1; col++) {
      const left = data[row * HASH_WIDTH + col];
      const right = data[row * HASH_WIDTH + col + 1];
      if (left > right) hash |= 1n << bit;
      bit += 1n;
    }
  }
  return hash;
}

/** Hamming distance between two hashes — 0 = identical, 64 = maximally different. */
export function hashDistance(a: ImageHash, b: ImageHash): number {
  let x = a ^ b;
  let count = 0;
  while (x > 0n) {
    count += Number(x & 1n);
    x >>= 1n;
  }
  return count;
}

/** Convert a Hamming distance (0–64) to a 0–1 similarity score. */
export function hashSimilarity(distance: number): number {
  return Math.max(0, 1 - distance / 64);
}

/** Fetch a remote image (Scryfall CDN) and compute its hash. Caching is the
 * caller's job (see referenceImageCache.ts) — this is the raw primitive. */
export async function hashRemoteImage(url: string): Promise<ImageHash | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    return await computeImageHash(buf);
  } catch {
    return null;
  }
}
