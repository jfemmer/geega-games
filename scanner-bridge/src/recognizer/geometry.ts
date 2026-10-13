import type { Point, RotatedRect } from "./types.js";

// Pure 2-D geometry for finding a card's outline: convex hull + the
// minimum-area enclosing rectangle (rotating calipers). A card's straight
// edges define that rectangle exactly; its rounded corners never do, so the
// result is the card's true outline even though the corners are cut.

/** Andrew's monotone chain. Returns the hull counter-clockwise (y up) without repeating the first point. */
export function convexHull(points: Point[]): Point[] {
  if (points.length <= 2) return points.slice();
  const pts = points.slice().sort((a, b) => (a.x === b.x ? a.y - b.y : a.x - b.x));
  const cross = (o: Point, a: Point, b: Point) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower: Point[] = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper: Point[] = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

/** Smallest-area rectangle containing every hull point. */
export function minAreaRect(hull: Point[]): RotatedRect | null {
  if (hull.length === 0) return null;
  if (hull.length === 1) return { cx: hull[0].x, cy: hull[0].y, width: 0, height: 0, angle: 0 };
  let best: RotatedRect | null = null;
  let bestArea = Number.POSITIVE_INFINITY;
  for (let i = 0; i < hull.length; i++) {
    const a = hull[i];
    const b = hull[(i + 1) % hull.length];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len === 0) continue;
    const ux = (b.x - a.x) / len;
    const uy = (b.y - a.y) / len;
    // Normal to the edge.
    const vx = -uy;
    const vy = ux;
    let minU = Number.POSITIVE_INFINITY;
    let maxU = Number.NEGATIVE_INFINITY;
    let minV = Number.POSITIVE_INFINITY;
    let maxV = Number.NEGATIVE_INFINITY;
    for (const p of hull) {
      const pu = p.x * ux + p.y * uy;
      const pv = p.x * vx + p.y * vy;
      if (pu < minU) minU = pu;
      if (pu > maxU) maxU = pu;
      if (pv < minV) minV = pv;
      if (pv > maxV) maxV = pv;
    }
    const area = (maxU - minU) * (maxV - minV);
    if (area < bestArea) {
      bestArea = area;
      const mu = (minU + maxU) / 2;
      const mv = (minV + maxV) / 2;
      best = {
        cx: mu * ux + mv * vx,
        cy: mu * uy + mv * vy,
        width: maxU - minU,
        height: maxV - minV,
        angle: Math.atan2(uy, ux),
      };
    }
  }
  return best;
}

/** Wraps an angle into (-π/2, π/2]. */
function wrapHalfTurn(angle: number): number {
  let a = angle;
  while (a <= -Math.PI / 2) a += Math.PI;
  while (a > Math.PI / 2) a -= Math.PI;
  return a;
}

/**
 * The same rectangle described as portrait (height ≥ width) with the
 * smallest tilt, so "up" on the card is as close to "up" in the image as
 * the rectangle allows. Whether the card is upside down is decided later by
 * matching both orientations.
 */
export function toPortrait(rect: RotatedRect): RotatedRect {
  let { width, height, angle } = rect;
  if (width > height) {
    [width, height] = [height, width];
    angle += Math.PI / 2;
  }
  return { cx: rect.cx, cy: rect.cy, width, height, angle: wrapHalfTurn(angle) };
}

/** Corners in card order: top-left, top-right, bottom-right, bottom-left. */
export function rectCorners(rect: RotatedRect): Point[] {
  const ux = Math.cos(rect.angle);
  const uy = Math.sin(rect.angle);
  const vx = -uy;
  const vy = ux;
  const hw = rect.width / 2;
  const hh = rect.height / 2;
  return [
    { x: rect.cx - hw * ux - hh * vx, y: rect.cy - hw * uy - hh * vy },
    { x: rect.cx + hw * ux - hh * vx, y: rect.cy + hw * uy - hh * vy },
    { x: rect.cx + hw * ux + hh * vx, y: rect.cy + hw * uy + hh * vy },
    { x: rect.cx - hw * ux + hh * vx, y: rect.cy - hw * uy + hh * vy },
  ];
}

/** Axis-aligned bounding box of a rotated rectangle. */
export function rectBounds(rect: RotatedRect): { left: number; top: number; right: number; bottom: number } {
  const corners = rectCorners(rect);
  return {
    left: Math.min(...corners.map((c) => c.x)),
    top: Math.min(...corners.map((c) => c.y)),
    right: Math.max(...corners.map((c) => c.x)),
    bottom: Math.max(...corners.map((c) => c.y)),
  };
}

/** Rescales a rectangle found in a resized image back to the original's coordinates. */
export function scaleRect(rect: RotatedRect, scale: number, offsetX = 0, offsetY = 0): RotatedRect {
  return {
    cx: rect.cx * scale + offsetX,
    cy: rect.cy * scale + offsetY,
    width: rect.width * scale,
    height: rect.height * scale,
    angle: rect.angle,
  };
}
