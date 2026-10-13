import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { applyCardSize, candidateDpis, CARD_OUT_HEIGHT, CARD_OUT_WIDTH, findCard } from "./cardFinder.js";
import { cardSvg, fakeScan, renderCard, type SyntheticPrinting } from "./testing/syntheticCards.js";
import { toGray } from "./image.js";

// The card finder turns any scan — crooked, upside down, on a white or black
// scanner background, with or without the driver's own crop — into the
// same upright 744 × 1039 card. Everything downstream compares fixed spots on
// that image, so these cases are what "near perfect" rests on.

const card: SyntheticPrinting = { id: "x", name: "Test Card", set: "TST", cn: "12", art: 5, symbol: 0 };

async function straightReference(p: SyntheticPrinting) {
  const { data, info } = await sharp(Buffer.from(cardSvg(p)))
    .resize(CARD_OUT_WIDTH, CARD_OUT_HEIGHT, { fit: "fill" })
    .flatten({ background: "#ffffff" })
    .raw()
    .toBuffer({ resolveWithObject: true });
  return toGray({ width: info.width, height: info.height, data: new Uint8Array(data) });
}

/**
 * Mean absolute grey difference after the best small shift (quarter size,
 * ±20 px): the outline on a same-colour background can only be placed from
 * the card's known size, so a few pixels of offset are expected there — the
 * recognizer registers that away against the matched printing.
 */
function shiftTolerantDiff(a: { data: Uint8Array; width: number; height: number }, b: { data: Uint8Array; width: number; height: number }) {
  const q = (img: { data: Uint8Array; width: number; height: number }) => {
    const w = Math.floor(img.width / 4);
    const h = Math.floor(img.height / 4);
    const out = new Float32Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) out[y * w + x] = img.data[y * 4 * img.width + x * 4];
    return { w, h, out };
  };
  const qa = q(a);
  const qb = q(b);
  let best = Number.POSITIVE_INFINITY;
  for (let dy = -5; dy <= 5; dy++) {
    for (let dx = -5; dx <= 5; dx++) {
      let sum = 0;
      let n = 0;
      for (let y = 12; y < qa.h - 12; y++) {
        for (let x = 12; x < qa.w - 12; x++) {
          sum += Math.abs(qa.out[y * qa.w + x] - qb.out[(y + dy) * qb.w + x + dx]);
          n++;
        }
      }
      best = Math.min(best, sum / n);
    }
  }
  return best;
}

/** Mean absolute grey difference over the card's inside (corners excluded). */
function meanDiff(a: { data: Uint8Array; width: number; height: number }, b: { data: Uint8Array }) {
  let sum = 0;
  let n = 0;
  for (let y = 40; y < a.height - 40; y++) {
    for (let x = 40; x < a.width - 40; x++) {
      sum += Math.abs(a.data[y * a.width + x] - b.data[y * a.width + x]);
      n++;
    }
  }
  return sum / n;
}

describe("findCard", () => {
  it("finds a crooked card on the white feeder background and straightens it", async () => {
    const found = await findCard(await fakeScan(card, { angle: 2.5 }), { fallbackDpi: 300 });
    expect(found.found).toBe(true);
    expect(found.warnings).toEqual([]);
    // Measured from the card's own edges: within a pixel or two of its real 744 × 1039.
    expect(Math.abs(found.rect!.width - 744)).toBeLessThan(2);
    expect(Math.abs(found.rect!.height - 1039)).toBeLessThan(2);
    expect((found.rect!.angle * 180) / Math.PI).toBeCloseTo(2.5, 0);
    expect(found.image.width).toBe(CARD_OUT_WIDTH);
    expect(found.image.height).toBe(CARD_OUT_HEIGHT);
    expect(meanDiff(toGray(found.image), await straightReference(card))).toBeLessThan(12);
  });

  it("works on a black background too", async () => {
    const found = await findCard(await fakeScan(card, { angle: -3, background: { r: 12, g: 12, b: 12 } }), { fallbackDpi: 300 });
    expect(found.warnings).toEqual([]);
    expect((found.rect!.angle * 180) / Math.PI).toBeCloseTo(-3, 0);
    expect(shiftTolerantDiff(toGray(found.image), await straightReference(card))).toBeLessThan(12);
  });

  it("recovers a white-bordered card on a white background from the card's known size", async () => {
    const old = { ...card, border: "white" as const };
    const found = await findCard(await fakeScan(old, { angle: 1.5 }), { fallbackDpi: 300 });
    expect(found.warnings).toEqual([]);
    expect(found.rect!.width).toBeCloseTo(744, 0);
    expect(found.rect!.height).toBeCloseTo(1039, 0);
    expect(shiftTolerantDiff(toGray(found.image), await straightReference(old))).toBeLessThan(14);
  });

  it("handles 600 dpi scans and files that don't say their resolution", async () => {
    const scan = await fakeScan(card, { angle: 1 });
    const meta = await sharp(scan).metadata();
    const at600 = await sharp(scan)
      .resize(meta.width! * 2, meta.height! * 2)
      .jpeg()
      .withMetadata({ density: 600 })
      .toBuffer();
    const big = await findCard(at600, { fallbackDpi: 300 });
    expect(big.dpi).toBe(600);
    expect(Math.abs(big.rect!.height - 2078)).toBeLessThan(5);
    expect(big.image.height).toBe(CARD_OUT_HEIGHT);
    const noDensity = await sharp(scan).jpeg().toBuffer();
    const found = await findCard(noDensity, { fallbackDpi: 300 });
    expect(found.warnings).toEqual([]);
    expect(Math.abs(found.rect!.height - 1039)).toBeLessThan(2);
  });

  it("follows the card when the feeder stretched the scan lengthwise", async () => {
    // A 1.5 % longer scan, as an ADF with a slightly fast feed produces.
    const scan = await fakeScan(card, { angle: -1.2 });
    const meta = await sharp(scan).metadata();
    const stretched = await sharp(scan)
      .resize(meta.width!, Math.round(meta.height! * 1.015), { fit: "fill" })
      .jpeg()
      .withMetadata({ density: 300 })
      .toBuffer();
    const found = await findCard(stretched, { fallbackDpi: 300 });
    expect(found.warnings).toEqual([]);
    expect(Math.abs(found.rect!.height - 1039 * 1.015)).toBeLessThan(4);
    // Squeezed back to the card's true shape, so it lines up with Scryfall's image.
    expect(meanDiff(toGray(found.image), await straightReference(card))).toBeLessThan(14);
  });

  it("uses an already-cropped card as it is", async () => {
    const found = await findCard(await renderCard(card, 744, 1039), { fallbackDpi: 300 });
    expect(found.found).toBe(true);
    expect(found.rect).toMatchObject({ cx: 372, cy: 519.5, angle: 0 });
    expect(found.warnings).toEqual([]);
  });

  it("warns when two cards went through together, a card is cut off, or the scan is blank", async () => {
    const c1 = await sharp(Buffer.from(cardSvg(card))).resize(744, 1039).png().toBuffer();
    const c2 = await sharp(Buffer.from(cardSvg({ ...card, art: 9 }))).resize(744, 1039).png().toBuffer();
    const double = await sharp({ create: { width: 1400, height: 1600, channels: 3, background: { r: 246, g: 246, b: 244 } } })
      .composite([{ input: c1, left: 150, top: 150 }, { input: c2, left: 350, top: 380 }])
      .jpeg()
      .withMetadata({ density: 300 })
      .toBuffer();
    expect((await findCard(double, { fallbackDpi: 300 })).warnings.join(" ")).toMatch(/two cards/);

    const cut = await fakeScan(card, { offset: { x: -300, y: 0 } });
    expect((await findCard(cut, { fallbackDpi: 300 })).warnings.join(" ")).toMatch(/cut off/);

    const blank = await sharp({ create: { width: 1100, height: 1400, channels: 3, background: { r: 246, g: 246, b: 244 } } })
      .jpeg()
      .withMetadata({ density: 300 })
      .toBuffer();
    const nothing = await findCard(blank, { fallbackDpi: 300 });
    expect(nothing.found).toBe(false);
    expect(nothing.warnings.join(" ")).toMatch(/blank/);
  });
});

describe("applyCardSize / candidateDpis", () => {
  it("places exactly one card around an outline that only caught the inside of the border", () => {
    const sized = applyCardSize({ cx: 0, cy: 0, width: 690, height: 960, angle: 0 }, [300]);
    expect(sized.rect.width).toBeCloseTo(744.09, 1);
    expect(sized.rect.height).toBeCloseTo(1039.37, 1);
    expect(sized.dpi).toBe(300);
    expect(sized.warning).toBeNull();
  });

  it("keeps an outline measured within 3 % of a card as it is", () => {
    const measured = { cx: 10, cy: 20, width: 746, height: 1052, angle: 0.01 };
    expect(applyCardSize(measured, [300])).toEqual({ rect: measured, dpi: 300, warning: null });
    // At the second resolution when the file's own value doesn't fit.
    expect(applyCardSize(measured, [600, 300]).dpi).toBe(300);
  });

  it("prefers a real scanner resolution over a placeholder 72 dpi", () => {
    expect(candidateDpis(72, 300)).toEqual([300, 72]);
    expect(candidateDpis(600, 300)).toEqual([600, 300]);
    expect(candidateDpis(null, 300)).toEqual([300]);
  });
});
