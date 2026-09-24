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
  // Tuned against two real scans of very different cards (Vampire Nighthawk,
  // an old-border foil DCI promo; Ragged Short Spear, a 2026 modern-frame
  // card), not measured on a diagram or guessed from a description. The
  // original {y:0.025, width:0.92} caught the card's own outer border at
  // the top (confidence 0, empty read) and the mana cost symbols at the
  // right (real name text present, but symbol-noise dragged confidence
  // under the 0.55 usable threshold). A first fix {y:0.045, width:0.70,
  // height:0.075} cleared the threshold on Vampire Nighthawk alone
  // (confidence 64) but wasn't generous enough for Ragged Short Spear's
  // slightly different title-banner geometry. This version was verified
  // against BOTH real images together with the actual OCR provider (same
  // PSM/preprocessing config as production) so a fix for one card can't
  // silently regress the other. A later round ran BOTH cards through the
  // real normalizeCardImage() (not just a raw screenshot crop — see below)
  // and tried tightening the vertical bounds to shed a thin border sliver;
  // every tighter variant scored EQUAL OR WORSE (e.g. Nighthawk dropped from
  // 76 to 43), so this rectangle is left as-is rather than "fixed" on
  // guesswork alone.
  //
  // NOTE ON VERIFICATION METHOD: this round ran the REAL
  // normalizeCardImage() -> cropRegion() -> ocrRegion()/tesseractOcrProvider
  // pipeline (imported directly, not reimplemented) against the two real
  // card photos above, PLUS attempted to pull several more real Scryfall
  // printings spanning different frame eras (1993/2003/2015/borderless) for
  // broader coverage — that part failed: this sandbox's outbound network
  // policy blocks api.scryfall.com entirely (CONNECT tunnel 403, confirmed
  // with a bare curl, not something request headers can work around), so
  // frame-era coverage beyond these two cards is still future work, ideally
  // from real bridge scans once more accumulate. See
  // CardRecognitionResult.normalizedDimensions if a mismatch needs
  // diagnosing without a screenshot round-trip: compare it against a card's
  // real aspect ratio to check whether normalizeCardImage() is producing
  // what these percentages assume.
  title: { x: 0.04, y: 0.035, width: 0.7, height: 0.095 },
  art: { x: 0.06, y: 0.1, width: 0.88, height: 0.44 },
  typeLine: { x: 0.04, y: 0.545, width: 0.92, height: 0.055 },
  // Set symbol sits at the right end of the type line on modern frames.
  // The old {x:0.85, y:0.54, w:0.11, h:0.06} was NEVER checked against a
  // real card until this round — it turned out to miss badly, mostly
  // capturing empty banner background with the icon barely clipped at the
  // edge (hash distance 38/64 against Ragged Short Spear's real cached
  // HOB hash — nowhere near matching). Re-measured from an upscaled crop of
  // the actual normalized image, then confirmed with a ~300-point local
  // grid search (varying x/y/size) for the position that minimizes hash
  // distance against that real cached hash: this rectangle is that
  // minimum (distance 21/64, similarity 0.67) — a real fix (right area,
  // not empty background), but still short of
  // RECOGNITION_THRESHOLDS.setSymbolMaxHashDistance (12), so it alone
  // won't auto-match on THIS specific test image. That image is a phone
  // photo re-compressed through WebP and this chat, not a flatbed scan —
  // real scanner-bridge output should have materially less compression
  // noise, but that's an expectation, not something verified here.
  setSymbol: { x: 0.855, y: 0.5525, width: 0.06, height: 0.045 },
  rulesText: { x: 0.06, y: 0.6, width: 0.88, height: 0.28 },
  // Lower-left collector line, split into its two real stacked lines
  // (confirmed from an upscaled real crop) rather than one crop spanning
  // both: collectorInfo is JUST the collector-number line ("C 0108"),
  // collectorInfoLine2 is JUST the set-code/language/artist line
  // ("HOB • EN ➤ Miklós Ligeti"). An earlier attempt at this exact split
  // (see git history) used thin, roughly-half-height crops and scored WORSE
  // than the single combined crop (confidence 2-11) — not because splitting
  // is wrong, but because a ~15px-tall crop is too short for reliable OCR.
  // This version uses GENEROUS per-line heights instead of a razor 50/50
  // cut, verified against Ragged Short Spear's real normalized image: line
  // 1 alone reads "C 0108" at 90% confidence (was ~25%, garbled, blended
  // with line 2, when both lines shared one crop); line 2 alone reads
  // "HOB * EN % MIKLOS LIGETI" at 79% confidence (was never usable at all
  // before — collectorInfo's whitelist, correctly tuned for the number
  // line, forbids the lowercase/accented letters an artist name needs).
  // Modern (M15+) cards only; both are absent on older frames — confirmed
  // harmless there too (Vampire Nighthawk's old promo layout reads low
  // confidence on both new crops, same as it already did on the old single
  // crop, so nothing regresses for pre-M15 cards).
  collectorInfo: { x: 0.03, y: 0.92, width: 0.25, height: 0.026 },
  collectorInfoLine2: { x: 0.03, y: 0.945, width: 0.4, height: 0.032 },
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
