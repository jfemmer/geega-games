import { describe, expect, it } from "vitest";
import { convexHull, minAreaRect, rectBounds, rectCorners, scaleRect, toPortrait } from "./geometry.js";
import type { Point } from "./types.js";

function rotatedRectPoints(cx: number, cy: number, w: number, h: number, angleDeg: number, step = 2): Point[] {
  const a = (angleDeg * Math.PI) / 180;
  const ux = Math.cos(a);
  const uy = Math.sin(a);
  const pts: Point[] = [];
  for (let x = -w / 2; x <= w / 2; x += step) {
    for (let y = -h / 2; y <= h / 2; y += step) {
      pts.push({ x: cx + x * ux - y * uy, y: cy + x * uy + y * ux });
    }
  }
  return pts;
}

describe("convexHull", () => {
  it("keeps only the outline, dropping interior and collinear points", () => {
    const pts = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
      { x: 5, y: 5 },
      { x: 5, y: 0 },
    ];
    const hull = convexHull(pts);
    expect(hull).toHaveLength(4);
    expect(hull).toEqual(expect.arrayContaining([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }]));
  });
});

describe("minAreaRect", () => {
  it("recovers a tilted rectangle's size, centre and tilt", () => {
    const rect = toPortrait(minAreaRect(convexHull(rotatedRectPoints(400, 500, 300, 420, 7)))!);
    expect(rect.cx).toBeCloseTo(400, 0);
    expect(rect.cy).toBeCloseTo(500, 0);
    expect(rect.width).toBeCloseTo(300, 0);
    expect(rect.height).toBeCloseTo(420, 0);
    expect((rect.angle * 180) / Math.PI).toBeCloseTo(7, 1);
  });

  it("describes a landscape outline as portrait, turned a quarter", () => {
    const rect = toPortrait(minAreaRect(convexHull(rotatedRectPoints(0, 0, 420, 300, 0)))!);
    expect(rect.width).toBeCloseTo(300, 0);
    expect(rect.height).toBeCloseTo(420, 0);
    expect(Math.abs(rect.angle)).toBeCloseTo(Math.PI / 2, 3);
  });
});

describe("rect helpers", () => {
  it("corners, bounds and rescaling agree", () => {
    const rect = { cx: 10, cy: 20, width: 4, height: 6, angle: 0 };
    expect(rectCorners(rect)).toEqual([
      { x: 8, y: 17 },
      { x: 12, y: 17 },
      { x: 12, y: 23 },
      { x: 8, y: 23 },
    ]);
    expect(rectBounds(rect)).toEqual({ left: 8, top: 17, right: 12, bottom: 23 });
    expect(scaleRect(rect, 2, 1, 1)).toEqual({ cx: 21, cy: 41, width: 8, height: 12, angle: 0 });
  });
});
