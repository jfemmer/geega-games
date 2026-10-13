import { readFile } from "node:fs/promises";
import * as ort from "onnxruntime-node";
import sharp from "sharp";
import { cropRgb, toGray } from "./image.js";
import type { OcrEvidence } from "./decide.js";
import type { RgbImage } from "./types.js";

// Reads the small print in a card's lower-left corner ("0123 R", "DMU • EN")
// — when two printings still look identical after the picture check, and to
// double-check a sure match against the set code printed on modern cards.
//
// Uses PaddleOCR's PP-OCRv4 text-line recogniser (Apache-2.0, shipped through
// the @gutenye/ocr-models npm package, run with the same ONNX Runtime as the
// fingerprints). Because we already know exactly where the text sits on a
// straightened card, there's no text *detection* step: the corner is cut
// out, split into its lines, and each line is read once — instead of the
// old pipeline's ten Tesseract passes over guessed regions.

export interface TextLine {
  text: string;
  confidence: number;
}

export interface TextReader {
  readLines(lines: RgbImage[]): Promise<TextLine[]>;
}

const REC_HEIGHT = 48;
const REC_MAX_WIDTH = 640;

export async function createPaddleTextReader(
  modelPath: string,
  dictionaryPath: string,
  threads = 2,
): Promise<TextReader> {
  const dictText = await readFile(dictionaryPath, "utf8");
  const dict = dictText.split(/\r?\n/);
  if (dict.length > 0 && dict[dict.length - 1] === "") dict.pop();
  const session = await ort.InferenceSession.create(modelPath, {
    executionProviders: ["cpu"],
    intraOpNumThreads: threads,
    graphOptimizationLevel: "all",
  });
  const inputName = session.inputNames[0];
  const outputName = session.outputNames[0];
  let queue: Promise<unknown> = Promise.resolve();

  async function readOne(img: RgbImage): Promise<TextLine> {
    const tensor = await toRecTensor(img);
    const out = await session.run({ [inputName]: tensor });
    const probs = out[outputName];
    const dims = probs.dims as number[];
    const steps = dims[1];
    const classes = dims[2];
    // Class 0 is the CTC blank; then the dictionary; then (usually) a space.
    const charset = classes === dict.length + 2 ? [...dict, " "] : dict;
    return ctcDecode(probs.data as Float32Array, steps, classes, charset);
  }

  return {
    async readLines(lines: RgbImage[]): Promise<TextLine[]> {
      const run = queue.then(async () => {
        const results: TextLine[] = [];
        for (const line of lines) results.push(await readOne(line));
        return results;
      });
      queue = run.catch(() => undefined);
      return run;
    },
  };
}

async function toRecTensor(img: RgbImage): Promise<ort.Tensor> {
  const width = Math.max(16, Math.min(REC_MAX_WIDTH, Math.round((img.width * REC_HEIGHT) / img.height)));
  const { data } = await sharp(Buffer.from(img.data.buffer, img.data.byteOffset, img.data.length), {
    raw: { width: img.width, height: img.height, channels: 3 },
  })
    .resize(width, REC_HEIGHT, { fit: "fill", kernel: "cubic" })
    .raw()
    .toBuffer({ resolveWithObject: true });
  // PaddleOCR's models are trained on OpenCV images: channels in B, G, R
  // order, scaled to -1…1.
  const plane = width * REC_HEIGHT;
  const chw = new Float32Array(3 * plane);
  for (let i = 0; i < plane; i++) {
    chw[i] = data[i * 3 + 2] / 127.5 - 1;
    chw[plane + i] = data[i * 3 + 1] / 127.5 - 1;
    chw[2 * plane + i] = data[i * 3] / 127.5 - 1;
  }
  return new ort.Tensor("float32", chw, [1, 3, REC_HEIGHT, width]);
}

/** Greedy CTC decoding of a [steps × classes] probability matrix. */
export function ctcDecode(probs: Float32Array, steps: number, classes: number, charset: string[]): TextLine {
  let text = "";
  let confSum = 0;
  let kept = 0;
  let prev = -1;
  for (let t = 0; t < steps; t++) {
    let best = 0;
    let bestP = probs[t * classes];
    for (let c = 1; c < classes; c++) {
      const p = probs[t * classes + c];
      if (p > bestP) {
        bestP = p;
        best = c;
      }
    }
    if (best !== 0 && best !== prev) {
      const ch = charset[best - 1];
      if (ch !== undefined) {
        text += ch;
        confSum += bestP;
        kept++;
      }
    }
    prev = best;
  }
  return { text: text.trim(), confidence: kept > 0 ? confSum / kept : 0 };
}

/**
 * Cuts the collector-info corner out of a straightened card and splits it
 * into text lines (light text on the black border is inverted to dark on
 * light, which the recogniser reads best).
 */
export function collectorLines(card: RgbImage): RgbImage[] {
  const left = card.width * 0.025;
  const top = card.height * 0.91;
  const region = cropRgb(card, left, top, card.width * 0.53, card.height * 0.08);
  const gray = toGray(region);
  const { width: w, height: h, data } = gray;

  // Row "ink": horizontal gradient energy — text rows are full of edges
  // whatever their colour.
  const energy = new Float64Array(h);
  for (let y = 0; y < h; y++) {
    let e = 0;
    for (let x = 1; x < w; x++) e += Math.abs(data[y * w + x] - data[y * w + x - 1]);
    energy[y] = e / w;
  }
  const smooth = energy.map((_, y) => (energy[Math.max(0, y - 1)] + energy[y] + energy[Math.min(h - 1, y + 1)]) / 3);
  const max = Math.max(...smooth);
  const bands: { y0: number; y1: number }[] = [];
  if (max > 4) {
    const cut = max * 0.3;
    let start = -1;
    for (let y = 0; y <= h; y++) {
      const on = y < h && smooth[y] > cut;
      if (on && start < 0) start = y;
      if (!on && start >= 0) {
        if (bands.length > 0 && start - bands[bands.length - 1].y1 <= 2) bands[bands.length - 1].y1 = y;
        else bands.push({ y0: start, y1: y });
        start = -1;
      }
    }
  }
  const usable = bands.filter((b) => b.y1 - b.y0 >= 5 && b.y1 - b.y0 <= h * 0.7).slice(0, 3);
  const chosen = usable.length > 0 ? usable : [{ y0: 0, y1: Math.round(h / 2) }, { y0: Math.round(h / 2), y1: h }];

  return chosen.map((b) => {
    const pad = 3;
    const y0 = Math.max(0, b.y0 - pad);
    const y1 = Math.min(h, b.y1 + pad);
    // Trim empty columns on the right so the line isn't mostly blank.
    let lastInk = 0;
    for (let x = 0; x < w; x++) {
      let colEnergy = 0;
      for (let y = y0 + 1; y < y1; y++) colEnergy += Math.abs(data[y * w + x] - data[(y - 1) * w + x]);
      if (colEnergy / (y1 - y0) > 12) lastInk = x;
    }
    const right = Math.min(w, Math.max(lastInk + 12, Math.round(w * 0.3)));
    const line = cropRgb(region, 0, y0, right, y1 - y0);
    // Invert light-on-dark text.
    let sum = 0;
    for (let i = 0; i < line.data.length; i++) sum += line.data[i];
    if (sum / line.data.length < 110) {
      for (let i = 0; i < line.data.length; i++) line.data[i] = 255 - line.data[i];
    }
    return line;
  });
}

/** OCR misreads that are common in this font, folded together for comparison. */
function fold(s: string): string {
  return s
    .toUpperCase()
    .replace(/O|Q|D(?=\d)/g, "0")
    .replace(/[IL|]/g, "1")
    .replace(/S/g, "5")
    .replace(/B/g, "8")
    .replace(/Z/g, "2");
}

function tokens(line: string): string[] {
  return line
    .toUpperCase()
    .replace(/[•·∙‧*°+.,:;_~"'`()[\]{}-]/g, " ")
    .split(/[\s/\\]+/)
    .filter(Boolean);
}

/** Language codes printed after the set code in the modern collector line. */
const LANGUAGE_CODES = new Set(["EN", "DE", "FR", "IT", "ES", "SP", "PT", "JA", "JP", "KO", "KR", "RU", "ZHS", "ZHT", "CS", "CT", "PH", "LA", "HE", "AR"]);

export interface PrintedSetCode {
  /** As read, e.g. "DSK". */
  raw: string;
  /** With common misreads folded together, for comparing. */
  folded: string;
}

/**
 * Set codes read from the modern (2015-frame and later) collector line,
 * where the set code sits right before the language: "DSK • EN". Requiring
 * that pattern keeps artist names and copyright text on older cards from
 * being mistaken for a set code.
 */
export function printedSetCodes(lines: TextLine[], minConfidence = 0.6): PrintedSetCode[] {
  const found = new Map<string, PrintedSetCode>();
  for (const line of lines) {
    if (line.confidence < minConfidence) continue;
    const toks = tokens(line.text);
    for (let i = 0; i + 1 < toks.length; i++) {
      const t = toks[i];
      if (!/^[A-Z0-9]{2,5}$/.test(t) || /^\d+$/.test(t) || !LANGUAGE_CODES.has(toks[i + 1])) continue;
      const folded = fold(t);
      if (!found.has(folded)) found.set(folded, { raw: t, folded });
    }
  }
  return [...found.values()];
}

/**
 * Could this printed set code belong to this printing? Scryfall files
 * promos, tokens and art cards under the parent set's code with a P / T / A
 * in front (PDSK prints "DSK"), and The List's reprints keep their original
 * set code, which Scryfall puts in the collector number ("DOM-123").
 */
export function printedSetMatches(code: PrintedSetCode, set: string, cn: string): boolean {
  const upper = set.toUpperCase();
  const want = new Set([fold(upper)]);
  if (upper.length === 4 && /^[PTA]/.test(upper)) want.add(fold(upper.slice(1)));
  const dash = cn.indexOf("-");
  if (dash > 1) want.add(fold(cn.slice(0, dash).toUpperCase()));
  return want.has(code.folded);
}

/**
 * Does what was read from the corner agree with this printing's set code and
 * collector number? Only the FIRST number on each line counts as a collector
 * number — on older modern frames the second ("123/280") is the set size.
 */
export function collectorEvidence(lines: TextLine[], set: string, cn: string): OcrEvidence {
  const readable = lines.filter((l) => l.confidence >= 0.3 && l.text.length > 0);
  const stripZeros = (v: string) => v.replace(/^0+(?=\w)/, "");
  const wantNumber = stripZeros(fold(cn));
  const wantSet = fold(set);
  let numberMatch = false;
  let setMatch = false;
  for (const line of readable) {
    const toks = tokens(line.text);
    const firstNumeric = toks.find((t) => /\d/.test(t) && t.length <= 7);
    if (firstNumeric) {
      // "0123R" — the rarity letter often reads as part of the number.
      const read = stripZeros(fold(firstNumeric));
      const withoutRarity = read.replace(/(?<=\d)[CURM5TLP]$/, "");
      if (read === wantNumber || withoutRarity === wantNumber) numberMatch = true;
    }
    if (toks.some((t) => t.length >= 2 && t.length <= 6 && fold(t) === wantSet)) setMatch = true;
  }
  return { setMatch, numberMatch };
}
