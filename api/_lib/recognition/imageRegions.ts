import sharp from "sharp";

// Card normalization + targeted region cropping (Part 6.1).
//
// GEOMETRIC CORRECTION IS DONE AT THE SOURCE, NOT HERE: the Geega MTG Cards
// fi-8170 PaperStream IP profile (see docs/scanner-bridge/paperstream-profile.md)
// has PaperStream IP's own mature auto-crop + deskew do the perspective/
// rotation correction — that's a purpose-built, reliable scanner-driver
// feature, not something worth reimplementing with brittle from-scratch
// contour detection (no OpenCV in this Node/Vercel stack; a hand-rolled
// edge-detection perspective corrector would be unreliable on real scans and
// give false confidence). This module's job is lighter: trim any uniform
// scan-bed border the driver left behind, confirm the result is
// card-shaped, and cut out the named regions recognition needs.
//
// Region rectangles are calibrated to the MODERN (8th edition / M15-style)
// frame, expressed as fractions of the normalized card's width/height so
// they scale to any input resolution. They're deliberately generous
// (favoring "include a bit of neighboring content" over "cut off the target
// text") since a slightly wider crop costs OCR accuracy far less than a
// clipped one. Pre-M15 cards have different footer layouts (no lower-left
// set-code line) — the recognition pipeline (era.ts) accounts for that by
// weighting fields differently, not by using different crop rectangles;
// the wider defaults here still capture older layouts adequately.

export interface Rect {
  /** All fractions of the normalized card's width/height, 0–1. */
  x: number;
  y: number;
  width: number;
  height: number;
}

export const CARD_ASPECT_RATIO = 2.5 / 3.5; // width / height, standard poker card

/** Named crop regions, as fractions of the full (already-trimmed) card. */
export const REGIONS: Record<string, Rect> = {
  full: { x: 0, y: 0, width: 1, height: 1 },
  title: { x: 0.04, y: 0.025, width: 0.92, height: 0.075 },
  art: { x: 0.06, y: 0.1, width: 0.88, height: 0.44 },
  typeLine: { x: 0.04, y: 0.545, width: 0.92, height: 0.055 },
  // Set symbol sits at the right end of the type line on modern frames.
  setSymbol: { x: 0.85, y: 0.54, width: 0.11, height: 0.06 },
  rulesText: { x: 0.06, y: 0.6, width: 0.88, height: 0.28 },
  // Lower-left collector line (set code / collector number / rarity /
  // language) — modern (M15+) cards only; absent on older frames.
  collectorInfo: { x: 0.03, y: 0.925, width: 0.42, height: 0.045 },
  // Artist / copyright footer spans the full width, thin strip at the base.
  footer: { x: 0.03, y: 0.965, width: 0.94, height: 0.03 },
  // Corner/edge crops for condition analysis (Part 9) — small, tight
  // regions so defect analysis isn't diluted by card interior.
  cornerTopLeft: { x: 0, y: 0, width: 0.12, height: 0.09 },
  cornerTopRight: { x: 0.88, y: 0, width: 0.12, height: 0.09 },
  cornerBottomLeft: { x: 0, y: 0.91, width: 0.12, height: 0.09 },
  cornerBottomRight: { x: 0.88, y: 0.91, width: 0.12, height: 0.09 },
  edgeTop: { x: 0.12, y: 0, width: 0.76, height: 0.04 },
  edgeBottom: { x: 0.12, y: 0.96, width: 0.76, height: 0.04 },
  edgeLeft: { x: 0, y: 0.09, width: 0.04, height: 0.82 },
  edgeRight: { x: 0.96, y: 0.09, width: 0.04, height: 0.82 },
};

export type RegionName = keyof typeof REGIONS;

/**
 * Normalize a raw scan: trim any uniform scan-bed border PaperStream's own
 * crop left behind, and orient to portrait (MTG cards are always scanned/
 * displayed portrait; a duplex feed can occasionally hand back a
 * landscape-rotated image, so rotate 90° when the aspect ratio says so).
 * Returns the trimmed buffer plus its final dimensions.
 */
export async function normalizeCardImage(
  input: Buffer,
): Promise<{ buffer: Buffer; width: number; height: number }> {
  let image = sharp(input, { failOn: "none" }).rotate(); // auto-orient via EXIF if present
  const meta = await image.metadata();

  if ((meta.width ?? 0) > (meta.height ?? 0)) {
    image = image.rotate(90);
  }

  // trim() removes a uniform-color border (the scan bed / any residual
  // margin PaperStream's crop left). threshold is intentionally lenient —
  // aggressive trimming risks cutting into the card itself.
  const trimmed = await image
    .trim({ threshold: 12 })
    .toFormat("png")
    .toBuffer({ resolveWithObject: true });

  return {
    buffer: trimmed.data,
    width: trimmed.info.width,
    height: trimmed.info.height,
  };
}

/** Cut one named (or explicit) region out of a normalized card image. */
export async function cropRegion(
  normalized: Buffer,
  width: number,
  height: number,
  region: RegionName | Rect,
): Promise<Buffer> {
  const rect = typeof region === "string" ? REGIONS[region] : region;
  const left = Math.max(0, Math.round(rect.x * width));
  const top = Math.max(0, Math.round(rect.y * height));
  const cropWidth = Math.max(1, Math.min(width - left, Math.round(rect.width * width)));
  const cropHeight = Math.max(1, Math.min(height - top, Math.round(rect.height * height)));

  return sharp(normalized)
    .extract({ left, top, width: cropWidth, height: cropHeight })
    .png()
    .toBuffer();
}

/**
 * OCR preprocessing passes for one crop (Part 6.2's "multiple preprocessing
 * passes... original color, grayscale, contrast enhanced, adaptive
 * threshold, scaled crop"). Returns each variant so the caller can OCR all
 * of them and combine results — a single pass can fail on foil glare, ink
 * bleed, or low contrast where a different variant succeeds.
 */
export async function preprocessVariants(crop: Buffer): Promise<{
  original: Buffer;
  grayscale: Buffer;
  contrastEnhanced: Buffer;
  threshold: Buffer;
  scaled2x: Buffer;
}> {
  const base = sharp(crop);
  const meta = await base.metadata();
  const [original, grayscale, contrastEnhanced, threshold, scaled2x] =
    await Promise.all([
      base.clone().png().toBuffer(),
      base.clone().grayscale().png().toBuffer(),
      base.clone().grayscale().normalize().linear(1.3, -20).png().toBuffer(),
      base.clone().grayscale().threshold(128).png().toBuffer(),
      base
        .clone()
        .resize({
          width: Math.round((meta.width ?? 200) * 2),
          height: Math.round((meta.height ?? 100) * 2),
        })
        .grayscale()
        .normalize()
        .png()
        .toBuffer(),
    ]);
  return { original, grayscale, contrastEnhanced, threshold, scaled2x };
}
