import { rectCorners, toPortrait } from "./geometry.js";
import type { RgbImage, RotatedRect } from "./types.js";

// Straightens a scan the scanner's own driver already trimmed to the card.
//
// The fi-8170's TWAIN driver crops each page to the card plus a narrow
// margin (about 1 mm of light-grey feeder background), without
// straightening it, and its trailing edge often comes with a dark shadow
// band where the card leaves the background. The card fills nearly the whole
// image, so finding it by "everything that differs from the background"
// (cardFinder's detectCardRect) has too little background to go on.
//
// Instead, each side of the image is read inward, scanline by scanline,
// until the card's edge: the point halfway up the step from the background to
// the card, measured to a fraction of a pixel. A straight line fitted
// through those points (ignoring the odd stray one) is that edge of the card.
//
//  * Clean sides (background like the image's corners, which are always
//    background: the card's corners are rounded) are trusted.
//  * A side whose margin isn't background (the shadow band, or no margin at
//    all) is only trusted when it agrees with the card's known 63 × 88 mm
//    shape. Otherwise that edge is placed from the opposite one and the
//    card's shape.
//  * When neither edge along an axis can place the card (the driver trimmed
//    one margin away entirely and the other side is the shadow), but the
//    image is barely longer than the card that way, the card is centred in
//    it: it spans the image, so it's off by at most half the leftover.
//
// The result is the card's outline to within about a pixel (a few pixels
// when it had to be centred), the same as a card found on open background,
// so everything downstream lines up.

export const CARD_ASPECT_LONG_OVER_SHORT = 88 / 63;

/** An image counts as a tight crop when it's within this much of one card's size. */
const TIGHT_CROP_TOLERANCE = 0.12;
/** How far in from the image's edge a card's edge may be, as a fraction of that dimension. */
const MAX_DEPTH = 0.15;
/** Scanlines run along the middle 80 % of each side, clear of the rounded corners. */
const SIDE_MARGIN = 0.1;
/** Colours this close (max channel difference) are the same background. */
const SAME_BACKGROUND = 40;
/** The colour difference from the margin must rise at least this much within 3 px at the card's edge. */
const EDGE_RISE = 12;
/**
 * Centring an axis no edge could place: the image may be at most this much
 * longer than the card that way (as a fraction of the card)…
 */
const CENTRE_MAX_LEFTOVER = 0.025;
/** …or this much shorter (the card's length from its width overshooting a little). */
const CENTRE_MAX_SHORTFALL = 0.015;
/**
 * How far a card's outline may run past the image's edge, as a fraction of
 * its length, and still be a whole card. Along the feed, a sheet-fed
 * scanner's scale depends on the feed speed, so an outline placed from the
 * card's width and one edge can overshoot by about this much on a card
 * that's whole. And under 1 mm of border missing doesn't change which card it is.
 */
const CUT_OFF_SLACK = 0.01;

/**
 * Part of the card's outline lies clearly outside the image. A card whose
 * edges merely touch the image's edge (a tight driver crop) is whole.
 */
export function outlineCutOff(rect: RotatedRect, image: { width: number; height: number }): boolean {
  const slack = Math.max(3, CUT_OFF_SLACK * Math.max(rect.width, rect.height));
  return rectCorners(rect).some((c) => c.x < -slack || c.y < -slack || c.x > image.width + slack || c.y > image.height + slack);
}

type Side = "left" | "right" | "top" | "bottom";
const SIDES: Side[] = ["left", "right", "top", "bottom"];

export interface TightCropFit {
  /** The card's outline in the image's pixels (portrait: height ≥ width). */
  rect: RotatedRect;
  /** Which edges were measured; the rest were placed from the card's known shape. */
  measured: Record<Side, boolean>;
  /** Part of the card lies outside the image. */
  cutOff: boolean;
}

/** True when the image is about one card's size at this resolution (either way round). */
export function isTightCrop(width: number, height: number, cardWidthPx: number, cardHeightPx: number): boolean {
  const short = Math.min(width, height);
  const long = Math.max(width, height);
  return (
    short >= cardWidthPx * (1 - 0.02) &&
    long >= cardHeightPx * (1 - 0.02) &&
    short <= cardWidthPx * (1 + TIGHT_CROP_TOLERANCE) &&
    long <= cardHeightPx * (1 + TIGHT_CROP_TOLERANCE)
  );
}

type Rgb = [number, number, number];

function colourDistance(a: Rgb, b: Rgb): number {
  return Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]), Math.abs(a[2] - b[2]));
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = values.slice().sort((x, y) => x - y);
  return sorted[sorted.length >> 1];
}

function medianColour(colours: Rgb[]): Rgb {
  return [median(colours.map((c) => c[0])), median(colours.map((c) => c[1])), median(colours.map((c) => c[2]))];
}

/** Reads one side of the image: scanline t (along the side), k pixels in from the border. */
function sideReader(img: RgbImage, side: Side) {
  const { width: w, height: h, data } = img;
  const length = side === "left" || side === "right" ? h : w;
  const depth = side === "left" || side === "right" ? w : h;
  const index = (t: number, k: number): number => {
    switch (side) {
      case "left":
        return (t * w + k) * 3;
      case "right":
        return (t * w + (w - 1 - k)) * 3;
      case "top":
        return (k * w + t) * 3;
      case "bottom":
        return ((h - 1 - k) * w + t) * 3;
    }
  };
  const colour = (t: number, k: number): Rgb => {
    const i = index(t, k);
    return [data[i], data[i + 1], data[i + 2]];
  };
  return { length, depth, colour };
}

/** Background colour from the four corners (always background: the card's corners are rounded). */
function cornerBackground(img: RgbImage): Rgb | null {
  const { width: w, height: h, data } = img;
  const corners: Rgb[] = [];
  for (const [x0, y0, sx, sy] of [
    [1, 1, 1, 1],
    [w - 2, 1, -1, 1],
    [1, h - 2, 1, -1],
    [w - 2, h - 2, -1, -1],
  ]) {
    const patch: Rgb[] = [];
    for (let j = 0; j < 4; j++) {
      for (let i = 0; i < 4; i++) {
        const p = ((y0 + sy * j) * w + (x0 + sx * i)) * 3;
        patch.push([data[p], data[p + 1], data[p + 2]]);
      }
    }
    corners.push(medianColour(patch));
  }
  const reference = medianColour(corners);
  const agreeing = corners.filter((c) => colourDistance(c, reference) <= SAME_BACKGROUND).length;
  return agreeing >= 3 ? reference : null;
}

interface EdgePoint {
  /** Position along the side (pixel centre). */
  t: number;
  /** Distance of the edge in from the image border, in pixels. */
  d: number;
}

interface SideFit {
  side: Side;
  /** Edge distance from the border: d = a + b·t. */
  a: number;
  b: number;
  /** The side's margin is background like the corners (not a shadow, not the card). */
  clean: boolean;
  inliers: number;
  attempted: number;
  rms: number;
}

/**
 * Where the card's edge crosses one scanline: the steepest point of the
 * first clear rise away from the margin's colour, to a fraction of a pixel.
 *
 * Steepness rather than a fixed colour difference, because the step can be
 * small (a white border on light-grey background, pale borderless art) while
 * the margin often darkens gently toward the card (its soft shadow): the
 * card's edge is the sharp part. Null when this scanline shows no clear edge.
 */
function edgeOnScanline(colour: (t: number, k: number) => Rgb, t: number, maxDepth: number, background: Rgb): number | null {
  const n = maxDepth;
  const raw = new Float32Array(n);
  for (let k = 0; k < n; k++) raw[k] = colourDistance(colour(t, k), background);
  // Light [1 2 1] smoothing against sensor noise (σ ≈ 3–4 on these scanners).
  const p = new Float32Array(n);
  p[0] = raw[0];
  p[n - 1] = raw[n - 1];
  for (let k = 1; k < n - 1; k++) p[k] = (raw[k - 1] + 2 * raw[k] + raw[k + 1]) / 4;
  const slope = (j: number): number => p[j + 1] - p[j - 1];
  for (let k = 2; k < n - 7; k++) {
    // A clear rise over 3 px that keeps going: the card, not noise or a speck.
    if (p[k + 2] - p[k - 1] < EDGE_RISE || p[k + 5] - p[k - 1] < EDGE_RISE) continue;
    let peak = k - 1;
    for (let j = k; j <= k + 3; j++) if (slope(j) > slope(peak)) peak = j;
    const g0 = slope(peak - 1);
    const g1 = slope(peak);
    const g2 = slope(peak + 1);
    const curvature = g0 - 2 * g1 + g2;
    const offset = curvature < 0 ? Math.max(-0.5, Math.min(0.5, (0.5 * (g0 - g2)) / curvature)) : 0;
    // Pixel k covers [k, k + 1): a slope peak at pixel j means the step sits at j + 0.5.
    return peak + offset + 0.5;
  }
  return null;
}

/** Robust straight-line fit d = a + b·t: Theil–Sen to start, then least squares on the points that agree. */
function fitLine(points: EdgePoint[]): { a: number; b: number; inliers: number; rms: number } | null {
  if (points.length < 12) return null;
  const sample = points.filter((_, i) => i % Math.max(1, Math.floor(points.length / 60)) === 0);
  const slopes: number[] = [];
  for (let i = 0; i < sample.length; i++) {
    for (let j = i + 1; j < sample.length; j++) {
      const dt = sample[j].t - sample[i].t;
      if (dt !== 0) slopes.push((sample[j].d - sample[i].d) / dt);
    }
  }
  let b = median(slopes);
  let a = median(points.map((p) => p.d - b * p.t));
  let inliers: EdgePoint[] = points;
  for (const tolerance of [3, 2, 1.25]) {
    inliers = points.filter((p) => Math.abs(p.d - (a + b * p.t)) <= tolerance);
    if (inliers.length < 10) return null;
    let st = 0;
    let sd = 0;
    let stt = 0;
    let std = 0;
    for (const p of inliers) {
      st += p.t;
      sd += p.d;
      stt += p.t * p.t;
      std += p.t * p.d;
    }
    const n = inliers.length;
    const det = n * stt - st * st;
    if (Math.abs(det) < 1e-9) return null;
    b = (n * std - st * sd) / det;
    a = (sd - b * st) / n;
  }
  let sq = 0;
  for (const p of inliers) sq += (p.d - (a + b * p.t)) ** 2;
  return { a, b, inliers: inliers.length, rms: Math.sqrt(sq / inliers.length) };
}

function fitSide(img: RgbImage, side: Side, background: Rgb): SideFit | null {
  const { length, depth, colour } = sideReader(img, side);
  const maxDepth = Math.max(16, Math.round(depth * MAX_DEPTH));
  const t0 = Math.round(length * SIDE_MARGIN);
  const t1 = Math.round(length * (1 - SIDE_MARGIN));
  const step = Math.max(1, Math.round(length / 400));

  const band: Rgb[] = [];
  for (let t = t0; t < t1; t += step * 4) for (let k = 1; k <= 3; k++) band.push(colour(t, k));
  const clean = colourDistance(medianColour(band), background) <= SAME_BACKGROUND;

  const points: EdgePoint[] = [];
  let attempted = 0;
  for (let t = t0; t < t1; t += step) {
    attempted++;
    const near = medianColour([colour(t, 1), colour(t, 2), colour(t, 3)]);
    // On a clean side, a scanline whose margin isn't background has the
    // card (or a speck) right at the border: nothing to measure there.
    if (clean && colourDistance(near, background) > SAME_BACKGROUND) continue;
    const d = edgeOnScanline(colour, t, maxDepth, near);
    if (d !== null) points.push({ t: t + 0.5, d });
  }
  const line = fitLine(points);
  if (!line) return null;
  return { side, ...line, clean, attempted };
}

/** The angle (radians) a fitted side gives the card's width axis. */
function sideAngle(fit: SideFit): number {
  // Left/right: x moves by b per unit of y along the card's height axis
  // (−sin α, cos α), so b = −tan α (the right side's d runs the other way).
  // Top/bottom: y moves by b per unit of x along the width axis (cos α, sin α).
  switch (fit.side) {
    case "left":
      return -Math.atan(fit.b);
    case "right":
      return Math.atan(fit.b);
    case "top":
      return Math.atan(fit.b);
    case "bottom":
      return -Math.atan(fit.b);
  }
}

/** A point on the fitted edge, in image pixels, at the middle of its side. */
function sideMidpoint(fit: SideFit, w: number, h: number): { x: number; y: number } {
  if (fit.side === "left" || fit.side === "right") {
    const y = h / 2;
    const d = fit.a + fit.b * y;
    return { x: fit.side === "left" ? d : w - d, y };
  }
  const x = w / 2;
  const d = fit.a + fit.b * x;
  return { x, y: fit.side === "top" ? d : h - d };
}

/**
 * Finds the card's outline in an image the scanner already trimmed close
 * to the card. `card` is the expected card size in this image's pixels.
 * Null when the edges can't be found reliably (the caller falls back).
 */
export function fitTightCrop(img: RgbImage, card: { width: number; height: number }): TightCropFit | null {
  const { width: w, height: h } = img;
  if (w < 64 || h < 64) return null;
  const background = cornerBackground(img);
  if (!background) return null;

  // Which image axis is the card's long side.
  const portrait = h >= w;
  const expectX = portrait ? card.width : card.height;
  const expectY = portrait ? card.height : card.width;

  const fits = new Map<Side, SideFit>();
  for (const side of SIDES) {
    const fit = fitSide(img, side, background);
    if (fit && fit.inliers >= fit.attempted * 0.5 && fit.rms <= 1.5) fits.set(side, fit);
  }

  // One rotation for the whole card: sides that disagree with the rest are dropped.
  const angles = [...fits.values()].map((f) => sideAngle(f));
  if (angles.length < 2) return null;
  const typical = median(angles);
  for (const [side, fit] of [...fits]) {
    if (Math.abs(sideAngle(fit) - typical) > (0.6 * Math.PI) / 180) fits.delete(side);
  }
  if (fits.size < 2) return null;
  // The tilt from the sides with clean margins when there are two or more
  // (a shadow's edge needn't run quite parallel to the card's).
  const clean = [...fits.values()].filter((f) => f.clean);
  let weight = 0;
  let angle = 0;
  for (const fit of clean.length >= 2 ? clean : fits.values()) {
    angle += sideAngle(fit) * fit.inliers;
    weight += fit.inliers;
  }
  angle /= weight;

  // Each edge's position across the card, along its own axis.
  const ux = Math.cos(angle);
  const uy = Math.sin(angle);
  const vx = -uy;
  const vy = ux;
  const along = (side: Side): number | null => {
    const fit = fits.get(side);
    if (!fit) return null;
    const p = sideMidpoint(fit, w, h);
    return side === "left" || side === "right" ? p.x * ux + p.y * uy : p.x * vx + p.y * vy;
  };
  const left = along("left");
  const right = along("right");
  const top = along("top");
  const bottom = along("bottom");
  const isClean = (side: Side) => fits.get(side)?.clean ?? false;

  const ratio = expectY / expectX;
  // Measured extents, kept only when they're plausibly one card. Across the
  // feed (left/right) the margins are clean and the size is the card's own;
  // a side without a clean margin may be a line inside the card, so it must
  // agree closely with the expected size.
  let extentX = left !== null && right !== null ? right - left : null;
  let extentY = top !== null && bottom !== null ? bottom - top : null;
  const xTolerance = isClean("left") && isClean("right") ? 0.04 : 0.015;
  if (extentX !== null && Math.abs(extentX / expectX - 1) > xTolerance) extentX = null;
  if (extentY !== null && Math.abs(extentY / expectY - 1) > 0.06) extentY = null;
  // Along the feed (top/bottom) a shadow band can sit right against the
  // card, so a measured length is trusted only when it gives the card's own
  // shape; otherwise the length follows from the width (63 × 88 mm).
  if (extentY !== null) {
    const fromWidth = extentX !== null ? extentX * ratio : expectY;
    if (Math.abs(extentY / fromWidth - 1) > 0.006) extentY = null;
  }
  const sizeX = extentX ?? (extentY !== null ? extentY / ratio : expectX);
  const sizeY = extentY ?? sizeX * ratio;

  // Where the card's centre can sit along each axis, most trusted first:
  // between both edges when they were measured as a pair, else one edge
  // with a clean margin plus the card's size. A lone edge without a clean
  // margin may be the shadow or a line inside the card, so it never places
  // the card by itself.
  interface Placement {
    at: number;
    sides: Side[];
  }
  const placements = (low: number | null, high: number | null, lowSide: Side, highSide: Side, size: number, pair: boolean): Placement[] => {
    const list: Placement[] = [];
    if (pair && low !== null && high !== null) list.push({ at: (low + high) / 2, sides: [lowSide, highSide] });
    if (low !== null && isClean(lowSide)) list.push({ at: low + size / 2, sides: [lowSide] });
    if (high !== null && isClean(highSide)) list.push({ at: high - size / 2, sides: [highSide] });
    return list;
  };
  const uPlacements = placements(left, right, "left", "right", sizeX, extentX !== null);
  const vPlacements = placements(top, bottom, "top", "bottom", sizeY, extentY !== null);

  // The driver's crop holds the whole card, so a placement that runs the
  // card off the image is wrong: a white border or pale art right at the
  // image's edge passes for clean margin, and its "edge" is a line inside
  // the card. (Image position of a centre (cu, cv): cu·u + cv·v.)
  const cos = Math.abs(Math.cos(angle));
  const sin = Math.abs(Math.sin(angle));
  const spanX = sizeX * cos + sizeY * sin;
  const spanY = sizeY * cos + sizeX * sin;
  const slack = Math.max(3, CUT_OFF_SLACK * Math.max(sizeX, sizeY));
  const insideX = (cu: number, cv: number) => Math.abs(cu * ux + cv * vx - w / 2) <= (w - spanX) / 2 + slack;
  const insideY = (cu: number, cv: number) => Math.abs(cu * uy + cv * vy - h / 2) <= (h - spanY) / 2 + slack;
  // The image's centre in the card's frame (stands in for an axis not placed yet).
  const uMid = (w / 2) * ux + (h / 2) * uy;
  const vMid = (w / 2) * vx + (h / 2) * vy;

  const measured: Record<Side, boolean> = { left: false, right: false, top: false, bottom: false };
  const adopt = (p: Placement): number => {
    for (const side of p.sides) measured[side] = true;
    return p.at;
  };
  const pu = uPlacements.find((p) => insideX(p.at, vMid));
  let cu = pu ? adopt(pu) : null;
  const pv = vPlacements.find((p) => insideY(cu ?? uMid, p.at));
  let cv = pv ? adopt(pv) : null;

  // An axis nothing places (no margin left on one side, the shadow on the
  // other) while the other axis is placed: if the image is barely longer than
  // the card that way, the card spans it, so centre it there. It's off by at
  // most half the leftover, which the picture check's alignment then takes
  // out. Never both axes: an image with no edges to read at all (already
  // cropped exactly) is left whole.
  const spans = (imageLength: number, cardSpan: number, cardLength: number): boolean => {
    const leftover = imageLength - cardSpan;
    return leftover <= CENTRE_MAX_LEFTOVER * cardLength && leftover >= -CENTRE_MAX_SHORTFALL * cardLength;
  };
  if (cu === null && cv !== null && spans(w, spanX, sizeX)) {
    cu = (w / 2 - cv * vx) / ux; // cu·ux + cv·vx = w / 2
  } else if (cu === null && uPlacements.length > 0) {
    // Runs off the image, but it's what the edges say (flagged as cut off).
    cu = adopt(uPlacements[0]);
  }
  if (cv === null && cu !== null && spans(h, spanY, sizeY)) {
    cv = (h / 2 - cu * uy) / vy; // cu·uy + cv·vy = h / 2
  } else if (cv === null && vPlacements.length > 0) {
    cv = adopt(vPlacements[0]);
  }
  if (cu === null || cv === null) return null;

  const rect: RotatedRect = {
    cx: cu * ux + cv * vx,
    cy: cu * uy + cv * vy,
    width: sizeX,
    height: sizeY,
    angle,
  };
  return { rect: toPortrait(rect), measured, cutOff: outlineCutOff(rect, img) };
}
