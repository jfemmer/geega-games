import { convexHull, minAreaRect, rectBounds, scaleRect, toPortrait } from "./geometry.js";
import { decodeFit, decodeRegion, halveRgb, imageInfo, warpRect, type ImageInput } from "./image.js";
import type { Point, RgbImage, RotatedRect } from "./types.js";

// Finds the card in a raw scan and returns it cropped and straightened.
//
// Everything after this step compares fixed spots on the card (the art, the
// set symbol, the collector number corner), so the card has to land in
// exactly the same place every time — whether the scanner's own auto-crop
// ran (PaperStream) or not ("Scan now" through NAPS2 has no auto-crop and
// hands back the whole feeder width), and whether the card went in crooked.
//
// How: estimate the scanner background from the image border, mark every
// pixel that clearly differs from it, keep the biggest blob, and fit the
// smallest rotated rectangle around it. A Magic card is 63 × 88 mm, so when
// the scan resolution is known the rectangle is snapped to exactly that
// size — which also rescues a white-bordered card on a white background,
// where only the inside of the white border stands out.

export const CARD_WIDTH_MM = 63;
export const CARD_HEIGHT_MM = 88;
export const CARD_ASPECT = CARD_WIDTH_MM / CARD_HEIGHT_MM;

/** Canonical output: the card at 300 dpi. */
export const CARD_OUT_WIDTH = 744;
export const CARD_OUT_HEIGHT = 1039;

const DETECT_MAX_SIDE = 600;

export interface DetectedRect {
  rect: RotatedRect;
  /** Fraction of the fitted rectangle covered by the blob's outline (≈1 for one card; less for two overlapping). */
  fill: number;
  /** The blob reaches the image edge — the card may be cut off. */
  touchesEdge: boolean;
}

export interface FoundCard {
  /** The card, upright up to a possible 180° flip, CARD_OUT_WIDTH × CARD_OUT_HEIGHT. */
  image: RgbImage;
  /** True when a card outline was actually found (false: the whole image was used). */
  found: boolean;
  /** The outline in the original image's pixels (null when not found). */
  rect: RotatedRect | null;
  dpi: number | null;
  warnings: string[];
  /**
   * Re-crops with the window moved by (dx, dy) output pixels in the card's
   * own frame: the new image at p shows what the old one showed at p + (dx, dy).
   * Used to register the card exactly once its printing is known.
   */
  recrop?: (dx: number, dy: number) => Promise<RgbImage>;
  /**
   * For scans finer than 300 dpi (600 dpi condition batches): the same
   * straightened card — same framing, same optional shift as `recrop` — at
   * the scan's own resolution, for the upload, so condition grading and
   * zooming in Scan Review keep the detail that was scanned. Absent when
   * the scan is ~300 dpi and `image` already is full resolution.
   */
  renderFull?: (dx?: number, dy?: number) => Promise<RgbImage>;
}

/** Scans above this many output pixels per card pixel get a full-resolution upload (~345 dpi and up). */
const FULL_RES_MIN_SCALE = 1.15;
/** Full-resolution uploads are capped at about 660 dpi (1636 × 2286). */
const FULL_RES_MAX_SCALE = 2.2;

function fullResScale(rect: RotatedRect): number | null {
  const scale = rect.height / CARD_OUT_HEIGHT;
  return scale >= FULL_RES_MIN_SCALE ? Math.min(scale, FULL_RES_MAX_SCALE) : null;
}

function shifted(rect: RotatedRect, dx: number, dy: number): RotatedRect {
  const scale = rect.width / CARD_OUT_WIDTH;
  const ux = Math.cos(rect.angle);
  const uy = Math.sin(rect.angle);
  return {
    ...rect,
    cx: rect.cx + (ux * dx - uy * dy) * scale,
    cy: rect.cy + (uy * dx + ux * dy) * scale,
  };
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = values.slice().sort((a, b) => a - b);
  return sorted[sorted.length >> 1];
}

/** Otsu's threshold on a 0–255 histogram. */
function otsu(hist: Uint32Array, total: number): number {
  let sumAll = 0;
  for (let i = 0; i < 256; i++) sumAll += i * hist[i];
  let sumB = 0;
  let wB = 0;
  let best = 0;
  let threshold = 0;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (wB === 0) continue;
    const wF = total - wB;
    if (wF === 0) break;
    sumB += t * hist[t];
    const mB = sumB / wB;
    const mF = (sumAll - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > best) {
      best = between;
      threshold = t;
    }
  }
  return threshold;
}

/**
 * Separable square max (dilate) or min (erode) filter on a 0/1 mask, using a
 * running count over the window so each pixel costs O(1) whatever the radius.
 */
function morph(mask: Uint8Array, w: number, h: number, radius: number, dilate: boolean): Uint8Array {
  const tmp = new Uint8Array(mask.length);
  const out = new Uint8Array(mask.length);
  // Dilate: any 1 in the window → 1. Erode: any 0 in the window → 0
  // (pixels outside the image count as 0 for dilate and 1 for erode).
  const hit = dilate ? 1 : 0;
  for (let y = 0; y < h; y++) {
    const row = y * w;
    let count = 0;
    for (let k = 0; k <= Math.min(radius, w - 1); k++) if (mask[row + k] === hit) count++;
    for (let x = 0; x < w; x++) {
      tmp[row + x] = count > 0 ? hit : 1 - hit;
      const leaving = x - radius;
      const entering = x + radius + 1;
      if (leaving >= 0 && mask[row + leaving] === hit) count--;
      if (entering < w && mask[row + entering] === hit) count++;
    }
  }
  for (let x = 0; x < w; x++) {
    let count = 0;
    for (let k = 0; k <= Math.min(radius, h - 1); k++) if (tmp[k * w + x] === hit) count++;
    for (let y = 0; y < h; y++) {
      out[y * w + x] = count > 0 ? hit : 1 - hit;
      const leaving = y - radius;
      const entering = y + radius + 1;
      if (leaving >= 0 && tmp[leaving * w + x] === hit) count--;
      if (entering < h && tmp[entering * w + x] === hit) count++;
    }
  }
  return out;
}

/**
 * Finds the card outline in an image that shows the card on a scanner
 * background. Returns null when there's no clear background to separate
 * from (e.g. the image is already cropped to the card).
 */
export function detectCardRect(img: RgbImage): DetectedRect | null {
  const { width: w, height: h, data } = img;
  if (w < 16 || h < 16) return null;

  // 1. Background colour from a thin ring around the image border.
  const band = Math.max(2, Math.round(Math.min(w, h) * 0.015));
  const rs: number[] = [];
  const gs: number[] = [];
  const bs: number[] = [];
  const sample = (x: number, y: number) => {
    const i = (y * w + x) * 3;
    rs.push(data[i]);
    gs.push(data[i + 1]);
    bs.push(data[i + 2]);
  };
  const step = Math.max(1, Math.floor(Math.max(w, h) / 600));
  for (let y = 0; y < h; y += step) {
    for (let b = 0; b < band; b++) {
      sample(b, y);
      sample(w - 1 - b, y);
    }
  }
  for (let x = 0; x < w; x += step) {
    for (let b = 0; b < band; b++) {
      sample(x, b);
      sample(x, h - 1 - b);
    }
  }
  const bg = [median(rs), median(gs), median(bs)];
  let close = 0;
  for (let i = 0; i < rs.length; i++) {
    if (Math.max(Math.abs(rs[i] - bg[0]), Math.abs(gs[i] - bg[1]), Math.abs(bs[i] - bg[2])) <= 40) close++;
  }
  // Most of the border should be background; otherwise the card fills the frame.
  if (close / rs.length < 0.6) return null;

  // 2. Distance from the background colour, thresholded (Otsu, clamped).
  const dist = new Uint8Array(w * h);
  const hist = new Uint32Array(256);
  for (let i = 0, j = 0; i < dist.length; i++, j += 3) {
    const d = Math.max(Math.abs(data[j] - bg[0]), Math.abs(data[j + 1] - bg[1]), Math.abs(data[j + 2] - bg[2]));
    dist[i] = d;
    hist[d]++;
  }
  const threshold = Math.min(90, Math.max(22, otsu(hist, dist.length)));
  let mask: Uint8Array = new Uint8Array(w * h);
  for (let i = 0; i < dist.length; i++) mask[i] = dist[i] > threshold ? 1 : 0;

  // 3. Close small gaps, then drop speckles.
  mask = morph(morph(mask, w, h, 2, true), w, h, 2, false);
  mask = morph(morph(mask, w, h, 1, false), w, h, 1, true);

  // 4. Largest 4-connected blob.
  const labels = new Int32Array(w * h);
  const stack = new Int32Array(w * h);
  let bestLabel = 0;
  let bestArea = 0;
  let label = 0;
  for (let start = 0; start < mask.length; start++) {
    if (mask[start] === 0 || labels[start] !== 0) continue;
    label++;
    let top = 0;
    stack[top++] = start;
    labels[start] = label;
    let area = 0;
    while (top > 0) {
      const p = stack[--top];
      area++;
      const x = p % w;
      const y = (p - x) / w;
      if (x > 0 && mask[p - 1] && !labels[p - 1]) {
        labels[p - 1] = label;
        stack[top++] = p - 1;
      }
      if (x < w - 1 && mask[p + 1] && !labels[p + 1]) {
        labels[p + 1] = label;
        stack[top++] = p + 1;
      }
      if (y > 0 && mask[p - w] && !labels[p - w]) {
        labels[p - w] = label;
        stack[top++] = p - w;
      }
      if (y < h - 1 && mask[p + w] && !labels[p + w]) {
        labels[p + w] = label;
        stack[top++] = p + w;
      }
    }
    if (area > bestArea) {
      bestArea = area;
      bestLabel = label;
    }
  }
  if (bestArea < w * h * 0.02) return null;

  // 5. Boundary points of that blob → hull → minimum-area rectangle.
  const boundary: Point[] = [];
  let touchesEdge = false;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = y * w + x;
      if (labels[p] !== bestLabel) continue;
      const edge =
        x === 0 ||
        y === 0 ||
        x === w - 1 ||
        y === h - 1 ||
        labels[p - 1] !== bestLabel ||
        labels[p + 1] !== bestLabel ||
        labels[p - w] !== bestLabel ||
        labels[p + w] !== bestLabel;
      if (!edge) continue;
      if (x <= 1 || y <= 1 || x >= w - 2 || y >= h - 2) touchesEdge = true;
      // Pixel corners, so the rectangle hugs the outer edge of the blob.
      boundary.push({ x, y }, { x: x + 1, y }, { x, y: y + 1 }, { x: x + 1, y: y + 1 });
    }
  }
  const hull = convexHull(boundary);
  const rect = minAreaRect(hull);
  if (!rect || rect.width < 8 || rect.height < 8) return null;
  const portrait = toPortrait(rect);
  const fill = polygonArea(hull) / (portrait.width * portrait.height);
  // The hull runs along the OUTER corners of the edge pixels, but an edge
  // pixel is only partly card (it's included once it's more card than
  // background), so on average the true edge sits half a pixel further in
  // on every side. Measured on straightened test scans this takes the
  // outline from ~0.3 % too big to within a pixel of the real card.
  portrait.width -= 1;
  portrait.height -= 1;
  return { rect: portrait, fill, touchesEdge };
}

function polygonArea(points: Point[]): number {
  let area = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    area += a.x * b.y - b.x * a.y;
  }
  return Math.abs(area) / 2;
}

/** Card size in pixels at a given resolution. */
export function expectedCardSize(dpi: number): { width: number; height: number } {
  return { width: (CARD_WIDTH_MM / 25.4) * dpi, height: (CARD_HEIGHT_MM / 25.4) * dpi };
}

/** A measured outline within this fraction of a real card's size is the card's own edge. */
export const MEASURED_SIZE_TOLERANCE = 0.03;

/**
 * Applies what we know about a real card to a fitted rectangle: 63 × 88 mm.
 * `dpis` are the resolutions it might have been scanned at, most trusted
 * first (the file's own value is sometimes a meaningless 72/96 the scanning
 * software wrote by default). The first one at which the rectangle is
 * plausibly one card wins:
 *
 *  * within 3 % of a card in both directions, the card's own edges were
 *    found — the measured outline is kept as it is, since it follows the
 *    card even when the feeder stretched the scan slightly lengthwise;
 *  * clearly smaller (down to 80 %), only part of the card stood out — a
 *    white-bordered card on a white background shows just the inside of its
 *    border — so exactly one card is placed around what was found.
 */
export function applyCardSize(rect: RotatedRect, dpis: number[]): { rect: RotatedRect; dpi: number | null; warning: string | null } {
  for (const dpi of dpis) {
    const expected = expectedCardSize(dpi);
    const rw = rect.width / expected.width;
    const rh = rect.height / expected.height;
    if (Math.abs(rw - 1) <= MEASURED_SIZE_TOLERANCE && Math.abs(rh - 1) <= MEASURED_SIZE_TOLERANCE) {
      return { rect, dpi, warning: null };
    }
    if (rw >= 0.8 && rh >= 0.8 && rw <= 1.04 && rh <= 1.04) {
      return { rect: { ...rect, width: expected.width, height: expected.height }, dpi, warning: null };
    }
  }
  if (dpis.length > 0) {
    const expected = expectedCardSize(dpis[0]);
    const rw = rect.width / expected.width;
    const rh = rect.height / expected.height;
    if (rw > 1.04 || rh > 1.04) {
      return { rect, dpi: dpis[0], warning: "This scan looks bigger than one card — two cards may have gone through together." };
    }
    if (rw < 0.8 || rh < 0.8) {
      return { rect, dpi: dpis[0], warning: "Only part of a card was found in this scan." };
    }
  }
  const aspect = rect.width / rect.height;
  if (Math.abs(aspect - CARD_ASPECT) > 0.08) {
    return { rect, dpi: null, warning: "The card's outline didn't look card-shaped — double-check this one." };
  }
  return { rect, dpi: null, warning: null };
}

/** Resolutions to try, most trusted first. */
export function candidateDpis(fileDensity: number | null, fallback: number | null | undefined): number[] {
  const list: number[] = [];
  // 72 and 96 are what software writes when it doesn't know.
  if (fileDensity && fileDensity >= 150) list.push(fileDensity);
  if (fallback) list.push(fallback);
  if (fileDensity && fileDensity < 150) list.push(fileDensity);
  return [...new Set(list)];
}

export interface FindCardOptions {
  /** Used when the file doesn't say what resolution it was scanned at. */
  fallbackDpi?: number | null;
}

/** Nearly uniform image (an empty feeder pass, a blank sheet). */
function isBlank(img: RgbImage): boolean {
  let sum = 0;
  let sumSq = 0;
  const n = img.width * img.height;
  for (let i = 0; i < img.data.length; i += 3) {
    const v = (img.data[i] + img.data[i + 1] + img.data[i + 2]) / 3;
    sum += v;
    sumSq += v * v;
  }
  const mean = sum / n;
  return Math.sqrt(Math.max(0, sumSq / n - mean * mean)) < 6;
}

/** Finds, crops and straightens the card in one scanned side. */
export async function findCard(input: ImageInput, options: FindCardOptions = {}): Promise<FoundCard> {
  const info = await imageInfo(input);
  const dpis = candidateDpis(info.density, options.fallbackDpi);
  const warnings: string[] = [];

  // Already exactly one card in size (PaperStream's tight crop, or an image
  // this PC straightened before): use it whole. A raw scan always carries
  // some background beyond the card, so it never lands this close.
  for (const dpi of dpis) {
    const expected = expectedCardSize(dpi);
    const portraitW = Math.min(info.width, info.height);
    const portraitH = Math.max(info.width, info.height);
    if (Math.abs(portraitW / expected.width - 1) < 0.03 && Math.abs(portraitH / expected.height - 1) < 0.03) {
      const whole = toPortrait({ cx: info.width / 2, cy: info.height / 2, width: info.width, height: info.height, angle: 0 });
      const image = await cropFromSource(input, info, whole);
      const full = fullResScale(whole);
      return {
        image,
        found: true,
        rect: whole,
        dpi,
        warnings,
        recrop: (dx, dy) => cropFromSource(input, info, shifted(whole, dx, dy)),
        renderFull: full ? (dx = 0, dy = 0) => cropFromSource(input, info, shifted(whole, dx, dy), full) : undefined,
      };
    }
  }

  // Pass 1: the whole image, shrunk.
  const small = await decodeFit(input, DETECT_MAX_SIDE);
  const scale1 = info.width / small.width;
  const coarse = detectCardRect(small);

  if (!coarse) {
    // No background around it: already cropped to the card (or not a card
    // at all — the matcher will say so). Use the whole image.
    if (isBlank(small)) {
      warnings.push("This scan looks blank — no card was found.");
    } else {
      const aspect = info.width / info.height;
      if (Math.abs(aspect - CARD_ASPECT) > 0.08 && Math.abs(1 / aspect - CARD_ASPECT) > 0.08) {
        warnings.push("Couldn't find the card's edges in this scan.");
      }
    }
    const whole: RotatedRect = toPortrait({
      cx: info.width / 2,
      cy: info.height / 2,
      width: info.width,
      height: info.height,
      angle: 0,
    });
    const image = await cropFromSource(input, info, whole);
    return { image, found: false, rect: null, dpi: dpis[0] ?? null, warnings };
  }

  let rect = scaleRect(coarse.rect, scale1);
  let touchesEdge = coarse.touchesEdge;
  // A card's outline is convex and rectangular; two cards stuck together
  // (or a folded corner) make a lumpier outline.
  if (coarse.fill < 0.92) warnings.push("This scan doesn't look like one flat card — double-check it.");

  // Pass 2: decode just the area around the card at the final output scale,
  // find the outline again on a half-size copy (accurate to ~2 output
  // pixels instead of `scale1`), and warp from the same decoded pixels.
  const region = paddedBounds(rect, info, 0.06);
  const scale = CARD_OUT_HEIGHT / Math.max(1, rect.height);
  const src = await decodeRegion(input, region, scale);
  const sx = src.width / region.width;
  const sy = src.height / region.height;
  const fine = detectCardRect(halveRgb(src));
  let local: RotatedRect = {
    cx: (rect.cx - region.left) * sx,
    cy: (rect.cy - region.top) * sy,
    width: rect.width * ((sx + sy) / 2),
    height: rect.height * ((sx + sy) / 2),
    angle: rect.angle,
  };
  if (fine && Math.abs(fine.rect.height * 2 - local.height) / local.height < 0.2) {
    local = scaleRect(fine.rect, 2);
    touchesEdge = fine.touchesEdge && coarse.touchesEdge;
  }
  // Back to original-image pixels, for the size check and the caller.
  rect = {
    cx: local.cx / sx + region.left,
    cy: local.cy / sy + region.top,
    width: local.width / ((sx + sy) / 2),
    height: local.height / ((sx + sy) / 2),
    angle: local.angle,
  };

  const sized = applyCardSize(rect, dpis);
  if (sized.warning) warnings.push(sized.warning);
  if (touchesEdge) warnings.push("The card touches the edge of the scan — part of it may be cut off.");
  const k = (sx + sy) / 2;
  const finalLocal: RotatedRect = {
    cx: (sized.rect.cx - region.left) * sx,
    cy: (sized.rect.cy - region.top) * sy,
    width: sized.rect.width * k,
    height: sized.rect.height * k,
    angle: sized.rect.angle,
  };
  const image = warpRect(src, finalLocal, CARD_OUT_WIDTH, CARD_OUT_HEIGHT);
  const finalRect = sized.rect;
  const full = fullResScale(finalRect);
  return {
    image,
    found: true,
    rect: finalRect,
    dpi: sized.dpi,
    warnings,
    recrop: (dx, dy) => cropFromSource(input, info, shifted(finalRect, dx, dy)),
    renderFull: full ? (dx = 0, dy = 0) => cropFromSource(input, info, shifted(finalRect, dx, dy), full) : undefined,
  };
}

function paddedBounds(
  rect: RotatedRect,
  info: { width: number; height: number },
  pad: number,
): { left: number; top: number; width: number; height: number } {
  const b = rectBounds(rect);
  const margin = Math.max(rect.width, rect.height) * pad;
  const left = Math.max(0, Math.floor(b.left - margin));
  const top = Math.max(0, Math.floor(b.top - margin));
  const right = Math.min(info.width, Math.ceil(b.right + margin));
  const bottom = Math.min(info.height, Math.ceil(b.bottom + margin));
  return { left, top, width: Math.max(1, right - left), height: Math.max(1, bottom - top) };
}

/**
 * Decodes only the region around `rect`, at the scale that makes the card
 * CARD_OUT_HEIGHT × `multiplier` tall, and warps it upright into a card of
 * the canonical shape — never holding a whole 600 dpi page in memory.
 */
async function cropFromSource(
  input: ImageInput,
  info: { width: number; height: number },
  rect: RotatedRect,
  multiplier = 1,
): Promise<RgbImage> {
  const outW = Math.round(CARD_OUT_WIDTH * multiplier);
  const outH = Math.round(CARD_OUT_HEIGHT * multiplier);
  const region = paddedBounds(rect, info, 0.02);
  const scale = outH / Math.max(1, rect.height);
  const src = await decodeRegion(input, region, scale);
  const sx = src.width / region.width;
  const sy = src.height / region.height;
  const s = (sx + sy) / 2;
  const local: RotatedRect = {
    cx: (rect.cx - region.left) * sx,
    cy: (rect.cy - region.top) * sy,
    width: rect.width * s,
    height: rect.height * s,
    angle: rect.angle,
  };
  return warpRect(src, local, outW, outH);
}
