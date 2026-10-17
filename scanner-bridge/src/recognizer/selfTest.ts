import sharp from "sharp";
import type { CardRecognizer } from "./recognizer.js";
import type { ReferenceProvider } from "./referenceImages.js";
import type { CatalogEntry } from "./types.js";

// Self-test: how well does the recognizer do on this PC, with this library,
// before a single real card is scanned?
//
// Takes a sample of printings — half random, half deliberately hard (art
// that was printed more than once, where the exact printing is the whole
// question) — and turns each one's Scryfall "large" image into a fake scan:
// a different image size than the library uses, colour-shifted, blurred,
// JPEG-compressed, sometimes upside down, and either placed crooked on a page
// of scanner background or trimmed the way the fi-8170's driver delivers it
// (a narrow grey margin, a slight tilt, a shadow along the trailing edge).
// Then runs the full recognizer and counts.
//
// It's a lower bar than real scans in one way (the picture underneath is
// Scryfall's own) and a higher bar in others (heavier blur and colour shift
// than a flatbed-quality scanner produces). Real accuracy comes from the
// first reviewed batches; this catches setup problems and gives a baseline.

export interface SelfTestCase {
  expected: string;
  expectedLabel: string;
  got: string | null;
  gotLabel: string | null;
  decision: string;
  correct: boolean;
  /** Pixel-check score of the first suggestion (null when references couldn't be fetched). */
  visual: number | null;
  ms: number;
}

export interface SelfTestReport {
  at: string;
  samples: number;
  /** First suggestion is exactly the right printing. */
  exactPrinting: number;
  /** First suggestion is the right card name (any printing). */
  rightName: number;
  sure: number;
  sureCorrect: number;
  check: number;
  none: number;
  meanMs: number;
  p95Ms: number;
  /**
   * Pixel-check scores of correct first suggestions: the median and the
   * lowest tenth. How far these sit above the "sure" cut-off (0.55) shows
   * how much headroom real scans will have.
   */
  visualCorrectMedian: number | null;
  visualCorrectP10: number | null;
  /** Up to 12 misses, for diagnosing. */
  misses: SelfTestCase[];
}

export interface SelfTestOptions {
  recognizer: CardRecognizer;
  references: ReferenceProvider;
  samples?: number;
  seed?: number;
  onProgress?: (done: number, total: number) => void;
  signal?: AbortSignal;
}

/** Small seeded PRNG so a self-test run is reproducible. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function pickSamples(entries: CatalogEntry[], count: number, random: () => number): CatalogEntry[] {
  const fronts = entries.filter((e) => e.face === 0 && e.layout !== "token" && e.layout !== "art_series");
  const byIll = new Map<string, CatalogEntry[]>();
  for (const e of fronts) {
    if (!e.ill) continue;
    const list = byIll.get(e.ill);
    if (list) list.push(e);
    else byIll.set(e.ill, [e]);
  }
  const shared = [...byIll.values()].filter((l) => l.length > 1).flat();
  const chosen = new Map<string, CatalogEntry>();
  const take = (pool: CatalogEntry[], n: number) => {
    for (let tries = 0; tries < n * 20 && chosen.size < n && pool.length > 0; tries++) {
      const e = pool[Math.floor(random() * pool.length)];
      chosen.set(e.id, e);
    }
  };
  take(shared, Math.floor(count / 2));
  take(fronts, count);
  return [...chosen.values()].slice(0, count);
}

/** Scryfall image URLs differ only by the size segment. */
export function largeImageUrl(normalUrl: string): string {
  return normalUrl.replace("/normal/", "/large/");
}

const CARD_W = 744;
const CARD_H = 1039;
/** A Magic card's corner radius (about 3 mm) at 300 dpi. */
const CORNER_RADIUS = 35;

export interface DriverCropOptions {
  /** Tilt in degrees, clockwise. */
  angle?: number;
  /** The light-grey margin the driver leaves around the card, in pixels. */
  margin?: number;
  /** The margin above the card's leading edge (default: `margin`). The driver sometimes trims it right off. */
  topMargin?: number;
  /** Height of the dark shadow band from the card's trailing edge to the bottom of the image (0: none). */
  shadow?: number;
  upsideDown?: boolean;
  /** Noise source (seeded in the self-test, so a run is reproducible). */
  random?: () => number;
}

/**
 * A card image as a scan the fi-8170's driver delivers it (through NAPS2 or
 * PaperStream IP): trimmed to the card plus a narrow light-grey margin but
 * not straightened, the feeder background shaded lighter toward the top,
 * sensor noise, and a dark shadow band from the card's trailing edge to the
 * bottom of the image. PNG, before any blur or JPEG.
 */
export async function driverCropScan(cardImage: Buffer, options: DriverCropOptions = {}): Promise<Buffer> {
  const random = options.random ?? Math.random;
  const angle = options.angle ?? 0;
  const margin = options.margin ?? 12;
  const topMargin = options.topMargin ?? margin;
  const shadow = options.shadow ?? 9;
  const corners = Buffer.from(
    `<svg width="${CARD_W}" height="${CARD_H}"><rect width="${CARD_W}" height="${CARD_H}" rx="${CORNER_RADIUS}" ry="${CORNER_RADIUS}" fill="#fff"/></svg>`,
  );
  let rounded = await sharp(cardImage)
    .resize(CARD_W, CARD_H, { fit: "fill" })
    .removeAlpha()
    .ensureAlpha()
    .composite([{ input: corners, blend: "dest-in" }])
    .png()
    .toBuffer();
  if (options.upsideDown) rounded = await sharp(rounded).rotate(180).png().toBuffer();
  const tilted = await sharp(rounded).rotate(angle, { background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
  const { width: tw = CARD_W, height: th = CARD_H } = await sharp(tilted).metadata();
  const w = tw + 2 * margin;
  const h = th + topMargin + (shadow > 0 ? shadow : margin);

  const page = new Uint8Array(w * h * 3);
  const topShade = 220 + random() * 8;
  const bottomShade = topShade - 24 - random() * 10;
  for (let y = 0; y < h; y++) {
    const base = topShade + ((bottomShade - topShade) * y) / h;
    for (let x = 0; x < w; x++) {
      const v = Math.max(0, Math.min(255, Math.round(base + (random() - 0.5) * 7)));
      const i = (y * w + x) * 3;
      page[i] = v;
      page[i + 1] = Math.min(255, v + 2);
      page[i + 2] = v;
    }
  }
  if (shadow > 0) {
    // Under the card's lowest edge, between its rounded corners, down to the bottom.
    const rad = (angle * Math.PI) / 180;
    const cx = margin + tw / 2;
    const cy = topMargin + th / 2;
    const at = (dx: number, dy: number) => ({ x: cx + dx * Math.cos(rad) - dy * Math.sin(rad), y: cy + dx * Math.sin(rad) + dy * Math.cos(rad) });
    const a = at(-CARD_W / 2, CARD_H / 2);
    const b = at(CARD_W / 2, CARD_H / 2);
    for (let x = Math.ceil(a.x + CORNER_RADIUS); x < Math.floor(b.x - CORNER_RADIUS); x++) {
      const edge = a.y + ((x - a.x) * (b.y - a.y)) / (b.x - a.x);
      for (let y = Math.max(0, Math.floor(edge) - 1); y < h; y++) {
        const i = (y * w + x) * 3;
        const v = Math.round(12 + random() * 8);
        page[i] = page[i + 1] = page[i + 2] = v;
      }
    }
  }
  return sharp(Buffer.from(page), { raw: { width: w, height: h, channels: 3 } })
    .composite([{ input: tilted, left: margin, top: topMargin }])
    .png()
    .toBuffer();
}

/**
 * A fake 300 dpi scan of a card image (see the header comment): half laid
 * crooked on a page of scanner background, half the way the fi-8170's driver
 * actually delivers them (driverCropScan), so the score reflects this PC's
 * own scans.
 */
export async function synthesizeScan(cardImage: Buffer, random: () => number): Promise<Buffer> {
  const brightness = 0.92 + random() * 0.16;
  const saturation = 0.88 + random() * 0.24;
  const contrast = 0.9 + random() * 0.2;
  const card = await sharp(cardImage)
    .resize(CARD_W, CARD_H, { fit: "fill" })
    .modulate({ brightness, saturation })
    .linear(contrast, 128 * (1 - contrast))
    .removeAlpha()
    .png()
    .toBuffer();
  let buf: Buffer;
  if (random() < 0.5) {
    buf = await driverCropScan(card, {
      angle: (random() - 0.5) * 3,
      margin: 8 + Math.floor(random() * 9),
      // Now and then the driver trims the leading margin almost to nothing.
      topMargin: random() < 0.25 ? Math.floor(random() * 3) : undefined,
      shadow: random() < 0.8 ? 7 + Math.floor(random() * 5) : 0,
      upsideDown: random() < 0.25,
      random,
    });
  } else {
    const canvasW = 1000;
    const canvasH = 1300;
    const shade = 236 + Math.floor(random() * 19);
    const left = Math.floor(60 + random() * (canvasW - CARD_W - 120));
    const top = Math.floor(60 + random() * (canvasH - CARD_H - 120));
    const angle = (random() - 0.5) * 6;
    const page = await sharp({ create: { width: canvasW, height: canvasH, channels: 3, background: { r: shade, g: shade, b: shade } } })
      .composite([{ input: card, left, top }])
      .png()
      .toBuffer();
    buf = await sharp(page)
      .rotate(angle + (random() < 0.25 ? 180 : 0), { background: { r: shade, g: shade, b: shade } })
      .png()
      .toBuffer();
  }
  const sigma = 0.3 + random() * 0.6;
  return sharp(buf)
    .blur(sigma)
    .jpeg({ quality: Math.floor(75 + random() * 17) })
    .withMetadata({ density: 300 })
    .toBuffer();
}

export async function runSelfTest(options: SelfTestOptions): Promise<SelfTestReport> {
  const random = mulberry32(options.seed ?? 20261012);
  const entries = options.recognizer.library.entries;
  const sample = pickSamples(entries, options.samples ?? 200, random);
  const nameById = new Map(entries.map((e) => [e.id, e]));
  const cases: SelfTestCase[] = [];
  let done = 0;
  for (const entry of sample) {
    if (options.signal?.aborted) break;
    const image = await options.references.bytes(largeImageUrl(entry.img), { cache: false });
    done++;
    options.onProgress?.(done, sample.length);
    if (!image) continue;
    const scan = await synthesizeScan(image, random);
    const t0 = performance.now();
    const { result } = await options.recognizer.recognizePair({ front: scan, back: null, finish: null });
    const ms = performance.now() - t0;
    const top = result.candidates[0]?.scryfallId ?? null;
    const topEntry = top ? nameById.get(top) : undefined;
    cases.push({
      expected: entry.id,
      expectedLabel: `${entry.name} (${entry.set} #${entry.cn})`,
      got: top,
      gotLabel: topEntry ? `${topEntry.name} (${topEntry.set} #${topEntry.cn})` : null,
      decision: result.decision,
      correct: top === entry.id,
      visual: result.candidates[0]?.visual ?? null,
      ms,
    });
  }
  const n = cases.length;
  const sure = cases.filter((c) => c.decision === "sure");
  const sorted = cases.map((c) => c.ms).sort((a, b) => a - b);
  const correctVisual = cases
    .filter((c) => c.correct && c.visual !== null)
    .map((c) => c.visual as number)
    .sort((a, b) => a - b);
  const quantile = (q: number) =>
    correctVisual.length ? Math.round(correctVisual[Math.min(correctVisual.length - 1, Math.floor(correctVisual.length * q))] * 1000) / 1000 : null;
  return {
    at: new Date().toISOString(),
    samples: n,
    exactPrinting: n ? cases.filter((c) => c.correct).length / n : 0,
    rightName: n
      ? cases.filter((c) => c.got && nameById.get(c.got)?.name === nameById.get(c.expected)?.name).length / n
      : 0,
    sure: sure.length,
    sureCorrect: sure.filter((c) => c.correct).length,
    check: cases.filter((c) => c.decision === "check").length,
    none: cases.filter((c) => c.decision === "none").length,
    meanMs: n ? Math.round(cases.reduce((s, c) => s + c.ms, 0) / n) : 0,
    p95Ms: n ? Math.round(sorted[Math.min(n - 1, Math.floor(n * 0.95))]) : 0,
    visualCorrectMedian: quantile(0.5),
    visualCorrectP10: quantile(0.1),
    misses: cases.filter((c) => !c.correct).slice(0, 12),
  };
}
