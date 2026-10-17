import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { findCard } from "./cardFinder.js";
import { decodeFit, decodeGray, resizeRgb, rotate180Rgb, toGray } from "./image.js";
import { driverCropScan, type DriverCropOptions } from "./selfTest.js";
import { cardSvg, type SyntheticPrinting } from "./testing/syntheticCards.js";
import { fitTightCrop, isTightCrop, outlineCutOff } from "./tightCrop.js";
import { compareCards, makeViews, VERIFY_HEIGHT, VERIFY_WIDTH } from "./verify.js";

// Scans the way the fi-8170's driver actually delivers them (the shop's
// first real batch): trimmed to the card plus about 1 mm of grey feeder
// background, not straightened, shaded, noisy, and with a dark shadow band
// along the trailing edge. The old finder had too little background to work
// with and used the whole image, so 7 of 9 correct matches scored ~50 % on
// the picture check and needed a manual pick. These pin the card's outline
// to within about a pixel instead.

const card: SyntheticPrinting = { id: "x", name: "Oliphaunt", set: "LTR", cn: "426", art: 11, symbol: 1 };

/** Art to the very edge, pale like a misty sky: almost the feeder's own grey. */
function paleBorderless(p: SyntheticPrinting): string {
  return cardSvg(p)
    .replace(/<rect x="0" y="0" width="63" height="88" rx="3" fill="[^"]+"\/>/, '<rect x="0" y="0" width="63" height="88" rx="3" fill="#d9cfb8"/>')
    .replace('<rect x="3" y="3" width="57" height="79.5" rx="1" fill="#b9a27a"/>', '<rect x="0" y="0" width="63" height="88" rx="3" fill="#ddd2bb"/>');
}

const looks: Record<string, string> = {
  "black border": cardSvg(card),
  "white border": cardSvg({ ...card, border: "white" }),
  "pale borderless art": paleBorderless(card),
};

function seeded(seed: number): () => number {
  let s = seed;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}

async function driverScan(svg: string, options: DriverCropOptions): Promise<Buffer> {
  const png = await sharp(Buffer.from(svg)).resize(744, 1039, { fit: "fill" }).png().toBuffer();
  const page = await driverCropScan(png, { random: seeded(7), ...options });
  return sharp(page).jpeg({ quality: 95 }).withMetadata({ density: 300 }).toBuffer();
}

/** Where driverCropScan put the card: the rotated card's bounding box sits `margin` in from the top left. */
async function truth(scan: Buffer, options: DriverCropOptions) {
  const meta = await sharp(scan).metadata();
  const margin = options.margin ?? 12;
  const topMargin = options.topMargin ?? margin;
  const shadow = options.shadow ?? 9;
  const boxW = meta.width! - 2 * margin;
  const boxH = meta.height! - topMargin - (shadow > 0 ? shadow : margin);
  return { cx: margin + boxW / 2, cy: topMargin + boxH / 2 };
}

const deg = (rad: number) => (rad * 180) / Math.PI;

describe("isTightCrop", () => {
  it("takes images about one card in size, either way round", () => {
    expect(isTightCrop(769, 1058, 744, 1039)).toBe(true);
    expect(isTightCrop(1058, 769, 744, 1039)).toBe(true);
    expect(isTightCrop(744, 1039, 744, 1039)).toBe(true);
    expect(isTightCrop(1000, 1300, 744, 1039)).toBe(false); // a page of background
    expect(isTightCrop(2550, 3508, 744, 1039)).toBe(false); // the whole feeder width
    expect(isTightCrop(600, 840, 744, 1039)).toBe(false); // not a whole card
  });
});

describe("fitTightCrop", () => {
  for (const [look, svg] of Object.entries(looks)) {
    for (const angle of [0, 0.8, -1.4]) {
      for (const shadow of [0, 9]) {
        it(`finds a ${look} card tilted ${angle}° ${shadow ? "with" : "without"} the trailing-edge shadow`, async () => {
          const options: DriverCropOptions = { angle, shadow, margin: 12 };
          const scan = await driverScan(svg, options);
          const fit = fitTightCrop(await decodeFit(scan, 4000), { width: 744.09, height: 1039.37 });
          expect(fit).not.toBeNull();
          const where = await truth(scan, options);
          expect(Math.abs(deg(fit!.rect.angle) - angle)).toBeLessThan(0.06);
          expect(Math.abs(fit!.rect.cx - where.cx)).toBeLessThan(1.5);
          expect(Math.abs(fit!.rect.cy - where.cy)).toBeLessThan(2);
          expect(Math.abs(fit!.rect.width / 744 - 1)).toBeLessThan(0.004);
          expect(Math.abs(fit!.rect.height / 1039 - 1)).toBeLessThan(0.006);
          expect(fit!.cutOff).toBe(false);
          // The left, right and top margins are clean background, so those edges are measured.
          expect(fit!.measured).toMatchObject({ left: true, right: true, top: true });
        });
      }
    }
  }

  // The driver sometimes trims the leading margin right off (the shop's
  // second batch came out 7–11 px shorter than the first). With no margin
  // above the card and the shadow below it, neither edge can place the card
  // along the feed, but it spans the image: it's centred there.
  for (const look of ["black border", "white border", "pale borderless art"]) {
    for (const angle of [0.6, -1.1]) {
      for (const trim of [12, 14]) {
        it(`centres a ${look} card tilted ${angle}° when the top margin is trimmed off (${trim} px)`, async () => {
          const options: DriverCropOptions = { angle, shadow: 9, margin: 12 };
          const full = await driverScan(looks[look], options);
          const where = await truth(full, options);
          const meta = await sharp(full).metadata();
          const scan = await sharp(full)
            .extract({ left: 0, top: trim, width: meta.width!, height: meta.height! - trim })
            .jpeg({ quality: 95 })
            .withMetadata({ density: 300 })
            .toBuffer();
          const fit = fitTightCrop(await decodeFit(scan, 4000), { width: 744.09, height: 1039.37 });
          expect(fit).not.toBeNull();
          // Across the feed the margins are clean; along it, the edges are
          // measured where a sliver of margin is left, else the card is centred.
          expect(fit!.measured).toMatchObject({ left: true, right: true });
          expect(Math.abs(deg(fit!.rect.angle) - angle)).toBeLessThan(0.06);
          expect(Math.abs(fit!.rect.cx - where.cx)).toBeLessThan(1.5);
          // Off by half the leftover: the 9 px shadow, plus the 2 px cut off at 14.
          expect(Math.abs(fit!.rect.cy - (where.cy - trim))).toBeLessThan(trim === 12 ? 5.5 : 6.5);
          expect(fit!.cutOff).toBe(false);
        });
      }
    }
  }

  it("centres a card the driver cropped with no top margin at all", async () => {
    const options: DriverCropOptions = { angle: -0.7, shadow: 10, margin: 11, topMargin: 0 };
    const scan = await driverScan(looks["black border"], options);
    const fit = fitTightCrop(await decodeFit(scan, 4000), { width: 744.09, height: 1039.37 });
    expect(fit).not.toBeNull();
    const where = await truth(scan, options);
    expect(Math.abs(fit!.rect.cx - where.cx)).toBeLessThan(1.5);
    expect(Math.abs(fit!.rect.cy - where.cy)).toBeLessThan(5.5);
    expect(fit!.cutOff).toBe(false);
  });

  it("doesn't centre a card in an image much longer than it", async () => {
    // No top margin and a 40 px shadow: where the card sits along the feed is anyone's guess.
    const options: DriverCropOptions = { angle: 0.4, shadow: 40, margin: 12 };
    const full = await driverScan(looks["black border"], options);
    const meta = await sharp(full).metadata();
    const scan = await sharp(full).extract({ left: 0, top: 12, width: meta.width!, height: meta.height! - 12 }).png().toBuffer();
    expect(fitTightCrop(await decodeFit(scan, 4000), { width: 744.09, height: 1039.37 })).toBeNull();
  });

  it("doesn't use a scan with no background to read edges against", async () => {
    // Exactly the card, no margin: every side's "margin" is the card itself.
    const png = await sharp(Buffer.from(cardSvg(card))).resize(744, 1039, { fit: "fill" }).flatten({ background: "#ffffff" }).png().toBuffer();
    expect(fitTightCrop(await decodeFit(png, 4000), { width: 744.09, height: 1039.37 })).toBeNull();
  });
});

describe("findCard on the driver's crops", () => {
  it("straightens them as well as a card found on open background, with no warnings", async () => {
    const reference = makeViews(
      await decodeGray(await sharp(Buffer.from(cardSvg(card))).resize(488, 680, { fit: "fill" }).flatten({ background: "#ffffff" }).png().toBuffer(), VERIFY_WIDTH, VERIFY_HEIGHT),
    );
    for (const options of [{ angle: 1.2, shadow: 9 }, { angle: -0.4, shadow: 0, upsideDown: true }] as DriverCropOptions[]) {
      const found = await findCard(await driverScan(cardSvg(card), options), { fallbackDpi: 300 });
      expect(found.found).toBe(true);
      expect(found.warnings).toEqual([]);
      expect(found.dpi).toBe(300);
      // The finder leaves a 180° turn to the matcher (it tries both ways).
      const upright = options.upsideDown ? rotate180Rgb(found.image) : found.image;
      const score = compareCards(makeViews(toGray(await resizeRgb(upright, VERIFY_WIDTH, VERIFY_HEIGHT))), reference).score;
      expect(score).toBeGreaterThan(0.9);
    }
  });

  it("straightens a crop with the top margin trimmed off, with no warnings", async () => {
    const reference = makeViews(
      await decodeGray(await sharp(Buffer.from(cardSvg(card))).resize(488, 680, { fit: "fill" }).flatten({ background: "#ffffff" }).png().toBuffer(), VERIFY_WIDTH, VERIFY_HEIGHT),
    );
    const full = await driverScan(cardSvg(card), { angle: 0.9, shadow: 9, margin: 12 });
    const meta = await sharp(full).metadata();
    const scan = await sharp(full)
      .extract({ left: 0, top: 13, width: meta.width!, height: meta.height! - 13 })
      .jpeg({ quality: 95 })
      .withMetadata({ density: 300 })
      .toBuffer();
    const found = await findCard(scan, { fallbackDpi: 300 });
    expect(found.found).toBe(true);
    expect(found.warnings).toEqual([]);
    const score = compareCards(makeViews(toGray(await resizeRgb(found.image, VERIFY_WIDTH, VERIFY_HEIGHT))), reference).score;
    expect(score).toBeGreaterThan(0.9);
  });

  it("says when the card runs off the trimmed scan", async () => {
    const full = await driverScan(cardSvg(card), { angle: 0.5, shadow: 0, margin: 12 });
    const meta = await sharp(full).metadata();
    const cut = await sharp(full)
      .extract({ left: 0, top: 60, width: meta.width!, height: meta.height! - 60 })
      .jpeg({ quality: 95 })
      .withMetadata({ density: 300 })
      .toBuffer();
    const found = await findCard(cut, { fallbackDpi: 300 });
    expect(found.warnings.join(" ")).toMatch(/cut off/);
  });

  it("uses the whole image when a tight crop has no edges to read", async () => {
    const plain = await sharp({ create: { width: 770, height: 1060, channels: 3, background: { r: 210, g: 212, b: 210 } } })
      .jpeg()
      .withMetadata({ density: 300 })
      .toBuffer();
    const found = await findCard(plain, { fallbackDpi: 300 });
    expect(found.found).toBe(false);
    expect(found.warnings.join(" ")).toMatch(/blank/);
  });
});

describe("outlineCutOff", () => {
  it("is false for a card whose corners only touch the edge, true once it runs off", () => {
    const image = { width: 768, height: 1053 };
    expect(outlineCutOff({ cx: 384, cy: 526.5, width: 744, height: 1039, angle: (1.3 * Math.PI) / 180 }, image)).toBe(false);
    expect(outlineCutOff({ cx: 384, cy: 500, width: 744, height: 1039, angle: 0 }, image)).toBe(true);
  });

  it("allows 1 % of the card's length past the edge: the feed direction's scale is only that good", () => {
    const image = { width: 768, height: 1030 };
    // A 1039 px card in a 1030 px image: 4.5 px past each end.
    expect(outlineCutOff({ cx: 384, cy: 515, width: 744, height: 1039, angle: 0 }, image)).toBe(false);
    // 9.5 px past the top: still within 10.4 px (1 %).
    expect(outlineCutOff({ cx: 384, cy: 510, width: 744, height: 1039, angle: 0 }, image)).toBe(false);
    // 14.5 px past the top: part of the card is missing.
    expect(outlineCutOff({ cx: 384, cy: 505, width: 744, height: 1039, angle: 0 }, image)).toBe(true);
  });
});
