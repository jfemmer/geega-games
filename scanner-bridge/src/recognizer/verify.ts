import { shrinkGray } from "./image.js";
import type { GrayImage } from "./types.js";

// The pixel-level check that picks the exact printing.
//
// The fingerprint search finds the right ART almost every time, but the same
// art is often printed many times (core sets, Commander decks, The List,
// promos), and those printings differ only in small spots: the set symbol,
// the collector-number corner, a promo stamp, the frame. Here the scan is
// lined up with each candidate's Scryfall image and compared tile by tile.
// Two candidates that look alike are then told apart using ONLY the tiles
// where their own reference images differ — so a tiny set-symbol difference
// isn't drowned out by the hundreds of tiles they share.
//
// Grayscale at Scryfall's "normal" size (488 × 680). Normalised cross-
// correlation ignores brightness/contrast differences between this scanner
// and Scryfall's own scans. The broad comparison runs at half size (fast);
// telling two look-alikes apart runs at full size on just the tiles that
// differ.

export const VERIFY_WIDTH = 488;
export const VERIFY_HEIGHT = 680;
export const TILE_COLS = 20;
export const TILE_ROWS = 28;
const FULL_TILE = 24;
const FULL_ORIGIN = 4;
const HALF_TILE = 12;
const HALF_ORIGIN = 2;
const FLAT_STD = 5;

/**
 * A card image at the sizes the comparisons use, with running sums for fast
 * window statistics. The full-size tables (≈5 MB) are only built if a
 * look-alike comparison actually needs them.
 */
export interface CardViews {
  readonly full: Integrated;
  readonly half: Integrated;
  readonly quarter: Integrated;
}

interface Integrated {
  img: GrayImage;
  /** (w+1)×(h+1) summed-area tables. */
  sum: Float64Array;
  sumSq: Float64Array;
}

function integrate(img: GrayImage): Integrated {
  const w = img.width;
  const h = img.height;
  const sum = new Float64Array((w + 1) * (h + 1));
  const sumSq = new Float64Array((w + 1) * (h + 1));
  for (let y = 0; y < h; y++) {
    let rowSum = 0;
    let rowSq = 0;
    for (let x = 0; x < w; x++) {
      const v = img.data[y * w + x];
      rowSum += v;
      rowSq += v * v;
      const i = (y + 1) * (w + 1) + (x + 1);
      sum[i] = sum[i - (w + 1)] + rowSum;
      sumSq[i] = sumSq[i - (w + 1)] + rowSq;
    }
  }
  return { img, sum, sumSq };
}

class LazyViews implements CardViews {
  readonly half: Integrated;
  readonly quarter: Integrated;
  #full: Integrated | null = null;
  readonly #image: GrayImage;

  constructor(image: GrayImage) {
    this.#image = image;
    const half = shrinkGray(image, 2);
    this.half = integrate(half);
    this.quarter = integrate(shrinkGray(half, 2));
  }

  get full(): Integrated {
    if (!this.#full) this.#full = integrate(this.#image);
    return this.#full;
  }
}

export function makeViews(full: GrayImage): CardViews {
  if (full.width !== VERIFY_WIDTH || full.height !== VERIFY_HEIGHT) {
    throw new Error(`Card views need a ${VERIFY_WIDTH}×${VERIFY_HEIGHT} image.`);
  }
  return new LazyViews(full);
}

/** Window statistics from the summed-area tables (window clamped to the image). */
function stats(t: Integrated, x: number, y: number, w: number, h: number): { mean: number; std: number; n: number } {
  const W = t.img.width;
  const x0 = Math.max(0, x);
  const y0 = Math.max(0, y);
  const x1 = Math.min(W, x + w);
  const y1 = Math.min(t.img.height, y + h);
  const n = (x1 - x0) * (y1 - y0);
  if (n <= 0) return { mean: 0, std: 0, n: 0 };
  const s = W + 1;
  const a = y0 * s + x0;
  const b = y0 * s + x1;
  const c = y1 * s + x0;
  const d = y1 * s + x1;
  const sum = t.sum[d] - t.sum[b] - t.sum[c] + t.sum[a];
  const sq = t.sumSq[d] - t.sumSq[b] - t.sumSq[c] + t.sumSq[a];
  const mean = sum / n;
  return { mean, std: Math.sqrt(Math.max(0, sq / n - mean * mean)), n };
}

/**
 * Normalised cross-correlation of a w × h window of `a` at (ax, ay) with the
 * same-size window of `b` at (bx, by). Windows partly outside an image use
 * the overlapping part only.
 */
function ncc(a: Integrated, ax: number, ay: number, b: Integrated, bx: number, by: number, w: number, h: number): number {
  const A = a.img;
  const B = b.img;
  // Overlap of both windows with their images, in window coordinates.
  const x0 = Math.max(0, -ax, -bx);
  const y0 = Math.max(0, -ay, -by);
  const x1 = Math.min(w, A.width - ax, B.width - bx);
  const y1 = Math.min(h, A.height - ay, B.height - by);
  if (x1 - x0 < 2 || y1 - y0 < 2) return 0;
  const sa = stats(a, ax + x0, ay + y0, x1 - x0, y1 - y0);
  const sb = stats(b, bx + x0, by + y0, x1 - x0, y1 - y0);
  if (sa.std < 1e-3 || sb.std < 1e-3) return 0;
  let cross = 0;
  const ad = A.data;
  const bd = B.data;
  for (let y = y0; y < y1; y++) {
    let ia = (ay + y) * A.width + ax + x0;
    let ib = (by + y) * B.width + bx + x0;
    for (let x = x0; x < x1; x++) cross += ad[ia++] * bd[ib++];
  }
  const n = sa.n;
  return (cross / n - sa.mean * sb.mean) / (sa.std * sb.std);
}

/** Best global shift of `ref` against `scan` within ±range around (cx, cy), over the central 84 %. */
function bestShift(scan: Integrated, ref: Integrated, range: number, cx: number, cy: number): { dx: number; dy: number } {
  const mx = Math.round(scan.img.width * 0.08);
  const my = Math.round(scan.img.height * 0.08);
  const w = scan.img.width - mx * 2;
  const h = scan.img.height - my * 2;
  let best = Number.NEGATIVE_INFINITY;
  let out = { dx: cx, dy: cy };
  for (let dy = cy - range; dy <= cy + range; dy++) {
    for (let dx = cx - range; dx <= cx + range; dx++) {
      const v = ncc(scan, mx, my, ref, mx + dx, my + dy, w, h);
      if (v > best) {
        best = v;
        out = { dx, dy };
      }
    }
  }
  return out;
}

/**
 * Similarity of one tile, 0–1, searching ±range around (dx, dy). Flat tiles
 * (borders, empty text boxes) carry no structure to correlate, so they're
 * compared by brightness; flat against detailed counts as a mismatch.
 */
function tileSimilarity(
  scan: Integrated,
  ref: Integrated,
  x: number,
  y: number,
  size: number,
  dx: number,
  dy: number,
  range: number,
): number {
  const s = stats(scan, x, y, size, size);
  let best = 0;
  for (let oy = -range; oy <= range; oy++) {
    for (let ox = -range; ox <= range; ox++) {
      const rx = x + dx + ox;
      const ry = y + dy + oy;
      const r = stats(ref, rx, ry, size, size);
      let sim: number;
      if (s.std < FLAT_STD && r.std < FLAT_STD) {
        sim = 1 - Math.min(1, Math.abs(s.mean - r.mean) / 60);
      } else if (s.std < FLAT_STD || r.std < FLAT_STD) {
        sim = (Math.min(s.std, r.std) / Math.max(s.std, r.std)) * 0.5;
      } else {
        sim = Math.max(0, ncc(scan, x, y, ref, rx, ry, size, size));
      }
      if (sim > best) best = sim;
      if (best >= 0.995) return best;
    }
  }
  return best;
}

export interface CardComparison {
  /** Mean tile similarity, 0–1. */
  score: number;
  /** Per-tile similarity, row-major TILE_ROWS × TILE_COLS. */
  tiles: Float32Array;
  /** Global shift of the reference against the scan, in full-size pixels. */
  dx: number;
  dy: number;
}

/** Lines `ref` up with `scan` and compares them tile by tile (half size). */
export function compareCards(scan: CardViews, ref: CardViews): CardComparison {
  // Quarter size ±4 px (±16 at full size), then half size ±1.
  const coarse = bestShift(scan.quarter, ref.quarter, 4, 0, 0);
  const mid = bestShift(scan.half, ref.half, 1, coarse.dx * 2, coarse.dy * 2);
  const tiles = new Float32Array(TILE_ROWS * TILE_COLS);
  let sum = 0;
  for (let ty = 0; ty < TILE_ROWS; ty++) {
    for (let tx = 0; tx < TILE_COLS; tx++) {
      const sim = tileSimilarity(
        scan.half,
        ref.half,
        HALF_ORIGIN + tx * HALF_TILE,
        HALF_ORIGIN + ty * HALF_TILE,
        HALF_TILE,
        mid.dx,
        mid.dy,
        1,
      );
      tiles[ty * TILE_COLS + tx] = sim;
      sum += sim;
    }
  }
  return { score: sum / tiles.length, tiles, dx: mid.dx * 2, dy: mid.dy * 2 };
}

/** Full-size similarity for selected tiles (±range px search around the global shift). */
function fullTiles(scan: CardViews, ref: CardViews, dx: number, dy: number, indices: number[], range: number): Float32Array {
  const out = new Float32Array(indices.length);
  for (let k = 0; k < indices.length; k++) {
    const i = indices[k];
    const tx = i % TILE_COLS;
    const ty = (i - tx) / TILE_COLS;
    out[k] = tileSimilarity(scan.full, ref.full, FULL_ORIGIN + tx * FULL_TILE, FULL_ORIGIN + ty * FULL_TILE, FULL_TILE, dx, dy, range);
  }
  return out;
}

/**
 * Tiles where two reference images genuinely differ (full size) — the only
 * places that can tell those two printings apart. Returned as tile indices.
 */
export function differingTiles(refA: CardViews, refB: CardViews, threshold = 0.8): number[] {
  const coarse = bestShift(refA.quarter, refB.quarter, 2, 0, 0);
  const mid = bestShift(refA.half, refB.half, 1, coarse.dx * 2, coarse.dy * 2);
  const all = Array.from({ length: TILE_ROWS * TILE_COLS }, (_, i) => i);
  // Two Scryfall images line up closely with each other, so ±1 px is enough.
  const sims = fullTiles(refA, refB, mid.dx * 2, mid.dy * 2, all, 1);
  const out: number[] = [];
  for (let i = 0; i < sims.length; i++) if (sims[i] < threshold) out.push(i);
  return out;
}

export interface Discrimination {
  /** How many tiles differ between the two references (0 = they look identical). */
  differingTiles: number;
  /** Scan agreement with A minus agreement with B over those tiles. Positive favours A. */
  margin: number;
}

/** Decides between two look-alike candidates using only the tiles where they differ. */
export function discriminate(
  scan: CardViews,
  a: { views: CardViews; comparison: CardComparison },
  b: { views: CardViews; comparison: CardComparison },
  tiles: number[],
): Discrimination {
  if (tiles.length === 0) return { differingTiles: 0, margin: 0 };
  const simA = fullTiles(scan, a.views, a.comparison.dx, a.comparison.dy, tiles, 2);
  const simB = fullTiles(scan, b.views, b.comparison.dx, b.comparison.dy, tiles, 2);
  let sa = 0;
  let sb = 0;
  for (let k = 0; k < tiles.length; k++) {
    sa += simA[k];
    sb += simB[k];
  }
  return { differingTiles: tiles.length, margin: (sa - sb) / tiles.length };
}
