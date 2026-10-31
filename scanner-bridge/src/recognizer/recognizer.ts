import { BRIDGE_VERSION } from "../version.js";
import { findCard } from "./cardFinder.js";
import { collectorEvidence, collectorLines, printedSetCodes, printedSetMatches, type TextLine, type TextReader } from "./collectorOcr.js";
import { decide, DEFAULT_THRESHOLDS, type Contender, type DecisionResult, type Thresholds } from "./decide.js";
import type { ImageEmbedder } from "./embedder.js";
import { jsLibrarySearch, type LibrarySearch } from "./fastSearch.js";
import { encodeJpeg, resizeRgb, rotate180Rgb, toGray, type ImageInput } from "./image.js";
import type { Library } from "./indexStore.js";
import type { ReferenceProvider } from "./referenceImages.js";
import type { BatchFinish, CatalogEntry, LocalRecognitionResult, RgbImage } from "./types.js";
import type { SearchHit } from "./vectorIndex.js";
import {
  compareCards,
  differingTiles,
  discriminate,
  makeViews,
  VERIFY_HEIGHT,
  VERIFY_WIDTH,
  type CardComparison,
  type CardViews,
} from "./verify.js";

// One scanned card (front + back image) in, one answer out:
//
//   1. find, crop and straighten the card on each side;
//   2. fingerprint each side both ways up (cards go through the feeder
//      upside down too);
//   3. search the library — the side that matches is the card's face (the
//      other is the Magic card back, or the other face of a double-faced
//      card); the way up that matches is the right way up;
//   4. pixel-check the closest printings and every reprint that shares their
//      art, telling look-alikes apart by the spots where they differ;
//   5. read the collector number if two printings still look identical, and
//      on every sure match, to catch a reprint the library doesn't have yet;
//   6. decide sure / check / none (decide.ts). The List's copy of a printing
//      is never picked over the original on the picture (isListCopyOf).

/** Recorded with every result (recognition_data.scannerPc.version): the bridge build that produced it. */
export const ENGINE_VERSION = BRIDGE_VERSION;

/** "ORI-153": Scryfall numbers The List's copy of a printing after the original (Magic Origins #153). */
const LIST_COPY_NUMBER = /^([A-Za-z0-9]{2,6})-([A-Za-z0-9★†]+)$/;

/**
 * True when `copy` is The List's reprint of `original` (Scryfall set PLST).
 * It copies the original down to its set symbol and collector line; only a
 * small planeswalker symbol in the bottom-left corner differs. In a scan
 * neither the picture nor the collector number can tell them apart, and a
 * newer, sharper Scryfall scan of the copy can match a little better (9 of
 * 10 Magic Origins Lightning Javelins in the shop's first big batch were
 * picked as the List copy), so the copy is never picked over the original on
 * the picture: the original is far more common. Same rule as the website's
 * src/admin/utils/listReprints.ts.
 */
export function isListCopyOf(copy: Pick<CatalogEntry, "cn">, original: Pick<CatalogEntry, "set" | "cn">): boolean {
  const match = LIST_COPY_NUMBER.exec(copy.cn.trim());
  return match !== null && match[1].toUpperCase() === original.set.toUpperCase() && match[2].toLowerCase() === original.cn.toLowerCase();
}

const SEARCH_K = 40;
/** A side whose best match pixel-checks at least this well is the face, the right way up. */
const ORIENTATION_CONFIDENT = 0.6;
const VERIFY_TOP = 10;
const VERIFY_MAX = 18;
const RESULT_CANDIDATES = 6;

export interface RecognizerDeps {
  embedder: ImageEmbedder;
  library: Library;
  /** How the library is searched (fastSearch.ts); the plain JavaScript search when omitted. */
  search?: LibrarySearch;
  references: ReferenceProvider;
  reader: TextReader | null;
  thresholds?: Thresholds;
  fallbackDpi: number | null;
}

export interface PairInput {
  front: ImageInput | null;
  back: ImageInput | null;
  finish: BatchFinish | null;
  /** The resolution this pair was scanned at, when known (a 600 dpi condition
   * scan); used when the file itself doesn't say. Defaults to the bridge's. */
  dpi?: number | null;
}

export interface PairRecognition {
  result: LocalRecognitionResult;
  /** Straightened JPEG of the card's face (null → upload the original file instead). */
  frontJpeg: Buffer | null;
  /** Straightened JPEG of the other side. */
  backJpeg: Buffer | null;
  /** Which input turned out to be the face — "back" when the card was fed face-down the other way. */
  faceSource: "front" | "back" | null;
}

/** One side of the scan, one way up. */
interface Combo {
  side: number;
  flip: boolean;
  image: RgbImage;
  hits: SearchHit[];
  views: CardViews | null;
  /** Pixel-check score against its own best library match (-1: not checked). */
  check: number;
}

export class CardRecognizer {
  private readonly deps: RecognizerDeps;
  private readonly thresholds: Thresholds;
  private readonly search: LibrarySearch;
  private readonly rowsByIllustration = new Map<string, number[]>();
  /** Printings with a second face in the library (double-faced cards). */
  private readonly multiFaced = new Set<string>();

  constructor(deps: RecognizerDeps) {
    this.deps = deps;
    this.thresholds = deps.thresholds ?? DEFAULT_THRESHOLDS;
    this.search = deps.search ?? jsLibrarySearch(deps.library.index);
    deps.library.entries.forEach((e, row) => {
      if (e.face > 0) this.multiFaced.add(e.id);
      if (!e.ill) return;
      const list = this.rowsByIllustration.get(e.ill);
      if (list) list.push(row);
      else this.rowsByIllustration.set(e.ill, [row]);
    });
  }

  get library(): Library {
    return this.deps.library;
  }

  async recognizePair(input: PairInput): Promise<PairRecognition> {
    const started = performance.now();
    const timings: Record<string, number> = {};
    const lap = (name: string, since: number) => {
      timings[name] = Math.round(performance.now() - since);
      return performance.now();
    };
    let t = performance.now();

    const sources: { source: "front" | "back"; input: ImageInput }[] = [];
    if (input.front) sources.push({ source: "front", input: input.front });
    if (input.back) sources.push({ source: "back", input: input.back });
    if (sources.length === 0) throw new Error("No scan image to recognize.");

    const found = await Promise.all(sources.map((s) => findCard(s.input, { fallbackDpi: input.dpi ?? this.deps.fallbackDpi })));
    t = lap("find", t);

    // Which side is the face, and which way up? Each (side, way-up)
    // combination is fingerprinted, searched, and pixel-checked against its
    // best library match: the face, the right way up, matches its printing
    // far better than the card back or an upside-down copy does. Both sides
    // the right way up go first; the upside-down ones are only tried when
    // neither matched convincingly (or a double-faced card's other face may
    // be upside down) — half the fingerprinting for cards fed upright.
    const combos: Combo[] = [];
    const tryCombos = async (wanted: { side: number; flip: boolean }[]): Promise<void> => {
      if (wanted.length === 0) return;
      const images = wanted.map((w) => (w.flip ? rotate180Rgb(found[w.side].image) : found[w.side].image));
      const tf = performance.now();
      const vectors = await this.deps.embedder.embed(images);
      timings.fingerprint = (timings.fingerprint ?? 0) + Math.round(performance.now() - tf);
      const ts = performance.now();
      const hits = await this.search.search(vectors, SEARCH_K);
      timings.search = (timings.search ?? 0) + Math.round(performance.now() - ts);
      const added = wanted.map((w, i) => ({ side: w.side, flip: w.flip, image: images[i], hits: hits[i], views: null, check: -1 }) as Combo);
      await Promise.all(
        added.map(async (c) => {
          const top = this.entryAt(c.hits[0]?.row);
          if (!top) return;
          const ref = await this.deps.references.views(top.img);
          c.views = makeViews(toGray(await resizeRgb(c.image, VERIFY_WIDTH, VERIFY_HEIGHT)));
          c.check = ref ? compareCards(c.views, ref).score : -1;
        }),
      );
      combos.push(...added);
    };
    const orientStart = performance.now();
    await tryCombos(found.map((_, side) => ({ side, flip: false })));
    const convincing = combos.filter((c) => c.check >= ORIENTATION_CONFIDENT);
    if (convincing.length === 0) {
      await tryCombos(found.map((_, side) => ({ side, flip: true })));
    } else if (found.length > 1) {
      // Upright face found. If it's a double-faced printing, its other face
      // may have come through upside down on the other side — check that way too.
      const face = convincing.reduce((a, b) => (b.check > a.check ? b : a));
      const faceTop = this.entryAt(face.hits[0]?.row);
      const other = combos.find((c) => c.side !== face.side);
      const otherTop = other ? this.entryAt(other.hits[0]?.row) : null;
      const otherMatchesSamePrinting = !!other && !!otherTop && otherTop.id === faceTop?.id && other.check >= ORIENTATION_CONFIDENT;
      if (faceTop && this.multiFaced.has(faceTop.id) && other && !otherMatchesSamePrinting) {
        await tryCombos([{ side: other.side, flip: true }]);
      }
    }

    const anyChecked = combos.some((c) => c.check >= 0);
    const rank = (c: Combo) => (anyChecked ? c.check : (c.hits[0]?.score ?? -1));
    const best = combos.reduce((a, b) => (rank(b) > rank(a) ? b : a));
    let faceCombo = best;
    let otherCombo: Combo | null = null;
    if (found.length > 1) {
      const otherSide = combos.filter((c) => c.side !== best.side);
      otherCombo = otherSide.reduce((a, b) => (rank(b) > rank(a) ? b : a));
    }

    // A double-faced card shows a face on both sides: same printing, other
    // face. Prefer its front face (face 0) as "the" face.
    let doubleFaced = false;
    if (otherCombo) {
      const faceTop = this.entryAt(faceCombo.hits[0]?.row);
      const otherTop = this.entryAt(otherCombo.hits[0]?.row);
      if (
        faceTop &&
        otherTop &&
        faceTop.id === otherTop.id &&
        faceTop.face !== otherTop.face &&
        rank(otherCombo) >= this.thresholds.sureAtLeast
      ) {
        doubleFaced = true;
        if (otherTop.face === 0) [faceCombo, otherCombo] = [otherCombo, faceCombo];
      }
    }
    timings.orient = Math.max(0, Math.round(performance.now() - orientStart) - (timings.fingerprint ?? 0) - (timings.search ?? 0));
    t = performance.now();

    const faceFound = found[faceCombo.side];
    const faceSource = sources[faceCombo.side].source;
    let faceImage = faceCombo.image;
    const faceHits = faceCombo.hits;

    // Contenders: best hit per printing, plus every printing that shares art
    // with the top few (reprints are exactly what the pixel check is for).
    const bestByPrinting = new Map<string, { row: number; score: number }>();
    for (const h of faceHits) {
      const e = this.deps.library.entries[h.row];
      const prev = bestByPrinting.get(e.id);
      if (!prev || h.score > prev.score) bestByPrinting.set(e.id, { row: h.row, score: h.score });
    }
    const ranked = [...bestByPrinting.values()].sort((a, b) => b.score - a.score);
    const selected = new Map<string, { row: number; score: number }>();
    for (const r of ranked.slice(0, VERIFY_TOP)) selected.set(this.deps.library.entries[r.row].id, r);
    for (const r of ranked.slice(0, 3)) {
      const ill = this.deps.library.entries[r.row].ill;
      if (!ill) continue;
      for (const row of this.rowsByIllustration.get(ill) ?? []) {
        if (selected.size >= VERIFY_MAX) break;
        const e = this.deps.library.entries[row];
        if (!selected.has(e.id)) selected.set(e.id, { row, score: r.score });
      }
    }

    // Pixel check.
    const scanViews = faceCombo.views ?? makeViews(toGray(await resizeRgb(faceImage, VERIFY_WIDTH, VERIFY_HEIGHT)));
    const checks = await Promise.all(
      [...selected.values()].map(async (s) => {
        const entry = this.deps.library.entries[s.row];
        const views = await this.deps.references.views(entry.img);
        if (!views) return { entry, similarity: s.score, views: null, comparison: null };
        return { entry, similarity: s.score, views, comparison: compareCards(scanViews, views) };
      }),
    );
    t = lap("verify", t);

    const verified = checks.filter((c): c is typeof c & { views: CardViews; comparison: CardComparison } => !!c.views);
    const warnings = [...faceFound.warnings];
    const referencesMissing = verified.length === 0 && checks.length > 0;
    if (referencesMissing) {
      warnings.push("Couldn't download Scryfall's reference images to double-check this card — is the internet connection down?");
    }

    const contenders: Contender[] = referencesMissing
      ? // Without reference images all we have is the fingerprint: offer the
        // closest printings, never "sure".
        checks.map((c) => ({ key: c.entry.id, entry: c.entry, similarity: c.similarity, visual: Math.max(0, c.similarity) * 0.5 }))
      : verified.map((c) => ({ key: c.entry.id, entry: c.entry, similarity: c.similarity, visual: c.comparison.score }));
    const byKey = new Map(verified.map((c) => [c.entry.id, c]));
    const pairTiles = new Map<string, number[]>();
    const judge = (a: Contender, b: Contender) => {
      const ca = byKey.get(a.key);
      const cb = byKey.get(b.key);
      if (!ca || !cb) return { differingTiles: 0, margin: 0 };
      const key = a.key < b.key ? `${a.key}|${b.key}` : `${b.key}|${a.key}`;
      let tiles = pairTiles.get(key);
      if (!tiles) {
        tiles = differingTiles(ca.views, cb.views);
        pairTiles.set(key, tiles);
      }
      const d = discriminate(scanViews, ca, cb, tiles);
      // Never in favour of The List's copy over its original (isListCopyOf).
      if (isListCopyOf(a.entry, b.entry)) return { ...d, margin: Math.min(0, d.margin) };
      if (isListCopyOf(b.entry, a.entry)) return { ...d, margin: Math.max(0, d.margin) };
      return d;
    };

    const blockSure =
      warnings.find((w) => /two cards|cut off|edges|part of a card|card-shaped|one flat card|blank|reference images/i.test(w)) ?? null;
    const mayOutrank = (a: Contender, b: Contender) => !isListCopyOf(a.entry, b.entry);
    let decision: DecisionResult = decide(contenders, judge, this.thresholds, { blockSure, mayOutrank });
    t = lap("decide", t);

    // Register the card exactly against its best match: the pixel check
    // already measured how far the crop sits from Scryfall's framing (a few
    // pixels when the card's edge was hard to see, e.g. black border on a
    // black background). Re-cropping by that much gives a perfectly framed
    // upload and puts the collector number exactly where the reader looks.
    const bestComparison = decision.ranked[0] ? byKey.get(decision.ranked[0].contender.key)?.comparison : undefined;
    // The shift applied, in the source card's own frame (what recrop/renderFull take).
    const faceShift = { dx: 0, dy: 0 };
    if (decision.decision !== "none" && bestComparison && faceFound.recrop) {
      const dx = (bestComparison.dx * faceImage.width) / VERIFY_WIDTH;
      const dy = (bestComparison.dy * faceImage.height) / VERIFY_HEIGHT;
      if (Math.hypot(dx, dy) >= 4) {
        const sign = faceCombo.flip ? 1 : -1;
        faceShift.dx = sign * dx;
        faceShift.dy = sign * dy;
        const recropped = await faceFound.recrop(faceShift.dx, faceShift.dy);
        faceImage = faceCombo.flip ? rotate180Rgb(recropped) : recropped;
      }
    }

    let ocrText: string | null = null;
    let cornerLines: TextLine[] | null = null;
    if (decision.needsOcr && this.deps.reader) {
      cornerLines = await this.deps.reader.readLines(collectorLines(faceImage));
      for (const c of contenders) c.ocr = collectorEvidence(cornerLines, c.entry.set, c.entry.cn);
      // The List's copy prints the original's collector line, so what's read can't tell them apart.
      for (const copy of contenders) {
        const original = contenders.find((o) => isListCopyOf(copy.entry, o.entry));
        if (original) copy.ocr = original.ocr;
      }
      decision = decide(contenders, judge, this.thresholds, { blockSure, mayOutrank });
    }
    // A "sure" match is cross-checked against the set code printed in the
    // corner of modern cards. If the corner names a different set, the
    // card's exact printing is probably missing from the library (a reprint
    // with the same art from a set newer than the shop's Scryfall card
    // list) — the closest printing would otherwise look like a sure match.
    if (decision.decision === "sure" && this.deps.reader) {
      cornerLines ??= await this.deps.reader.readLines(collectorLines(faceImage));
      const chosen = decision.ranked[0].contender.entry;
      const codes = printedSetCodes(cornerLines);
      if (codes.length > 0 && !codes.some((code) => printedSetMatches(code, chosen.set, chosen.cn))) {
        const read = codes[0].raw;
        warnings.push(
          `The card's corner reads "${read}", but the closest printing in the card library is ${chosen.set} #${chosen.cn}. ` +
            "If that set is newer than the shop's Scryfall card list, refresh the list, update the card library, and re-run this card.",
        );
        decision = decide(contenders, judge, this.thresholds, {
          blockSure: `its corner reads "${read}" — that printing may be missing from the card list.`,
          mayOutrank,
        });
      }
    }
    if (cornerLines) {
      ocrText = cornerLines.map((l) => l.text).filter(Boolean).join(" / ") || null;
      t = lap("read", t);
    }

    // Left with the original and its List copy: say what tells them apart.
    const winner = decision.ranked[0]?.contender;
    if (
      winner &&
      decision.decision === "check" &&
      decision.ambiguousWith.length > 0 &&
      decision.ambiguousWith.every((c) => isListCopyOf(c.entry, winner.entry))
    ) {
      const original = `${winner.entry.set} #${winner.entry.cn}`;
      const copy = decision.ambiguousWith[0].entry;
      decision = {
        ...decision,
        reason:
          `${winner.entry.name}: ${original} or The List's copy of it (${copy.set} #${copy.cn}): they look the same in a scan. ` +
          `The List copy has a small planeswalker symbol in the bottom-left corner; without one, it's ${original}.`,
      };
    }

    if (decision.decision === "none" && sources.length === 1) {
      warnings.push("If this is the back of the card, scan it again face up.");
    }

    const result: LocalRecognitionResult = {
      engine: "scanner_pc",
      engineVersion: ENGINE_VERSION,
      decision: decision.decision,
      candidates: decision.ranked.slice(0, RESULT_CANDIDATES).map((r) => ({
        scryfallId: r.contender.key,
        confidence: r.confidence,
        reason: r.reason,
        visual: referencesMissing ? null : round3(r.contender.visual),
        similarity: round3(r.contender.similarity),
        face: r.contender.entry.face,
      })),
      decisionReason: decision.reason,
      warnings: dedupe(warnings),
      visualSimilarity: referencesMissing || !decision.ranked[0] ? null : round3(decision.ranked[0].contender.visual),
      finish: input.finish,
      orientation: faceCombo.flip ? 180 : 0,
      sidesSwapped: faceSource === "back",
      straightened: { front: false, back: false },
      ocrText,
      timingsMs: timings,
      library: {
        builtAt: this.deps.library.manifest.builtAt,
        entries: this.deps.library.entries.length,
        model: this.deps.library.manifest.model.id,
      },
    };

    // Upload images: the straightened face (right way up) and the other side,
    // turned the same way unless it's the other face of a double-faced card —
    // at the scan's own resolution when that's finer than 300 dpi (renderFull).
    let frontJpeg: Buffer | null = null;
    if (faceFound.found) {
      let upload = faceImage;
      if (faceFound.renderFull) {
        const full = await faceFound.renderFull(faceShift.dx, faceShift.dy);
        upload = faceCombo.flip ? rotate180Rgb(full) : full;
      }
      frontJpeg = await encodeJpeg(upload, 90);
    }
    let backJpeg: Buffer | null = null;
    if (otherCombo && found[otherCombo.side].found) {
      const otherFound = found[otherCombo.side];
      const flipOther = doubleFaced ? otherCombo.flip : faceCombo.flip;
      const otherImage = otherFound.renderFull ? await otherFound.renderFull() : otherFound.image;
      backJpeg = await encodeJpeg(flipOther ? rotate180Rgb(otherImage) : otherImage, 88);
    }
    result.straightened = { front: frontJpeg !== null, back: backJpeg !== null };
    timings.total = Math.round(performance.now() - started);

    return { result, frontJpeg, backJpeg, faceSource };
  }

  private entryAt(row: number | undefined): CatalogEntry | null {
    return row === undefined ? null : (this.deps.library.entries[row] ?? null);
  }
}

function round3(v: number): number {
  return Math.round(v * 1000) / 1000;
}

function dedupe(list: string[]): string[] {
  return [...new Set(list)];
}
