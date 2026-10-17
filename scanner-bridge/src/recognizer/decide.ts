import type { Discrimination } from "./verify.js";
import type { CatalogEntry, Decision } from "./types.js";

// Turns the evidence for each candidate printing into one of three answers:
//
//   sure  — one printing clearly wins: its picture matches, and every
//           look-alike was ruled out by the spots where they differ (or by
//           the collector number). The scan is pre-matched for review.
//   check — the right card is probably in the list but the printing isn't
//           certain (or the picture match is weak). The reviewer picks.
//   none  — nothing in the library looks like this scan.
//
// The goal is to be right whenever it says "sure"; anything doubtful goes to
// "check" instead of being guessed. The numbers below are starting points —
// the self-test and the first reviewed batches are how they get tuned.

export interface Thresholds {
  /** Below this picture-match score nothing is offered as a match. */
  noneBelow: number;
  /** "Sure" needs at least this picture-match score. */
  sureAtLeast: number;
  /** A candidate this far below the best is clearly a different card. */
  clearGap: number;
  /** Look-alikes: the winner must agree this much better on the differing spots. */
  pairMargin: number;
  /** Look-alikes need at least this many differing tiles to be told apart by picture. */
  minDifferingTiles: number;
}

export const DEFAULT_THRESHOLDS: Thresholds = {
  noneBelow: 0.3,
  sureAtLeast: 0.55,
  clearGap: 0.12,
  pairMargin: 0.08,
  minDifferingTiles: 1,
};

export interface OcrEvidence {
  setMatch: boolean;
  numberMatch: boolean;
}

export interface Contender {
  /** Scryfall printing id. */
  key: string;
  /** The face of that printing that matched the scan. */
  entry: CatalogEntry;
  similarity: number;
  visual: number;
  /** Collector-line reading, once the text reader has run. */
  ocr?: OcrEvidence | null;
}

export type PairJudge = (a: Contender, b: Contender) => Discrimination;

export interface RankedContender {
  contender: Contender;
  confidence: number;
  reason: string;
}

export interface DecisionResult {
  decision: Decision;
  ranked: RankedContender[];
  reason: string;
  /** Look-alikes that couldn't be ruled out by picture or collector number. */
  ambiguousWith: Contender[];
  /** True when reading the collector number could settle what's left. */
  needsOcr: boolean;
}

const pct = (v: number) => `${Math.round(v * 100)}%`;
export const describePrinting = (e: CatalogEntry) => `${e.name} (${e.set} #${e.cn})`;

function ocrScore(o: OcrEvidence | null | undefined): number {
  if (!o) return 0;
  return (o.numberMatch ? 2 : 0) + (o.setMatch ? 1 : 0);
}

type Separation = { kind: "gap" | "picture" | "ocr"; strength: number } | null;

export interface DecideOptions {
  /** A warning that keeps the answer from being "sure" (the card looks cut off, …). */
  blockSure?: string | null;
  /**
   * False when `a` may never be picked over `b` on the picture, however much
   * better it matches: The List's copy of a printing over the original,
   * which look the same in a scan (recognizer.ts). `b` is then tried as the
   * winner instead, and kept as a look-alike if it can't win either.
   */
  mayOutrank?: (a: Contender, b: Contender) => boolean;
}

export function decide(
  contenders: Contender[],
  judge: PairJudge,
  thresholds: Thresholds = DEFAULT_THRESHOLDS,
  options: DecideOptions = {},
): DecisionResult {
  if (contenders.length === 0) {
    return {
      decision: "none",
      ranked: [],
      reason: "Nothing in the card library looks like this scan. Use Find match.",
      ambiguousWith: [],
      needsOcr: false,
    };
  }
  const sorted = contenders.slice().sort((a, b) => b.visual - a.visual || b.similarity - a.similarity);
  const judged = new Map<string, Discrimination>();
  const judgeCached = (a: Contender, b: Contender): Discrimination => {
    const key = `${a.key}|${b.key}`;
    let d = judged.get(key);
    if (!d) {
      const flipKey = `${b.key}|${a.key}`;
      const flipped = judged.get(flipKey);
      d = flipped ? { differingTiles: flipped.differingTiles, margin: -flipped.margin } : judge(a, b);
      judged.set(key, d);
    }
    return d;
  };

  let best = sorted[0];
  const tried = new Set<string>();
  let separations = new Map<string, Separation>();
  let ambiguous: Contender[] = [];

  for (let round = 0; round < sorted.length; round++) {
    tried.add(best.key);
    separations = new Map();
    ambiguous = [];
    let challenger: Contender | null = null;
    for (const c of sorted) {
      if (c.key === best.key) continue;
      if (options.mayOutrank && !options.mayOutrank(best, c)) {
        if (!tried.has(c.key)) {
          challenger = c;
          break;
        }
        ambiguous.push(c);
        continue;
      }
      const gap = best.visual - c.visual;
      if (gap >= thresholds.clearGap) {
        separations.set(c.key, { kind: "gap", strength: gap });
        continue;
      }
      const d = judgeCached(best, c);
      if (d.differingTiles >= thresholds.minDifferingTiles && d.margin >= thresholds.pairMargin) {
        separations.set(c.key, { kind: "picture", strength: d.margin + Math.max(0, gap) });
        continue;
      }
      if (d.differingTiles >= thresholds.minDifferingTiles && d.margin <= -thresholds.pairMargin) {
        if (!tried.has(c.key)) {
          challenger = c;
          break;
        }
        // Already tried that one as the winner — the two disagree with each
        // other; leave it as a look-alike rather than loop.
        ambiguous.push(c);
        continue;
      }
      const ob = ocrScore(best.ocr);
      const oc = ocrScore(c.ocr);
      if (ob > oc) {
        separations.set(c.key, { kind: "ocr", strength: 0.1 * (ob - oc) });
        continue;
      }
      if (oc > ob && !tried.has(c.key)) {
        challenger = c;
        break;
      }
      ambiguous.push(c);
    }
    if (!challenger) break;
    best = challenger;
  }

  const blockSure = options.blockSure ?? null;
  let decision: Decision;
  if (best.visual < thresholds.noneBelow) decision = "none";
  else if (best.visual >= thresholds.sureAtLeast && ambiguous.length === 0 && !blockSure) decision = "sure";
  else decision = "check";

  const needsOcr =
    decision !== "none" &&
    ambiguous.length > 0 &&
    best.ocr === undefined &&
    ambiguous.some((c) => c.entry.set !== best.entry.set || c.entry.cn !== best.entry.cn);

  // Confidence numbers: "sure" sits in 0.90–0.99 with every other candidate
  // at least 0.15 lower (the server re-checks exactly that), "check" stays
  // under 0.90, "none" under 0.50.
  const strengths = [...separations.values()].filter((s): s is NonNullable<Separation> => !!s).map((s) => s.strength);
  const minStrength = strengths.length > 0 ? Math.min(...strengths) : 0.3;
  let top: number;
  if (decision === "sure") top = Math.min(0.99, 0.9 + 0.09 * Math.min(1, minStrength / 0.3));
  else if (decision === "check") top = Math.min(0.88, Math.max(0.5, 0.45 + 0.45 * best.visual));
  else top = Math.max(0, Math.min(0.45, best.visual));

  const others = sorted.filter((c) => c.key !== best.key);
  const ranked: RankedContender[] = [
    { contender: best, confidence: round2(top), reason: reasonFor(best, decision) },
    ...others.map((c) => {
      const raw = Math.max(0, Math.min(0.85, 0.45 + 0.45 * c.visual));
      const isAmbiguous = ambiguous.some((a) => a.key === c.key);
      const cap = decision === "sure" ? top - 0.15 : isAmbiguous ? top - 0.01 : top - 0.05;
      return {
        contender: c,
        confidence: round2(Math.max(0, Math.min(raw, cap))),
        reason: `Picture match ${pct(c.visual)}`,
      };
    }),
  ];

  return {
    decision,
    ranked,
    reason: overallReason(best, decision, ambiguous, separations, sorted, blockSure, thresholds.sureAtLeast),
    ambiguousWith: ambiguous,
    needsOcr,
  };
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

function reasonFor(best: Contender, decision: Decision): string {
  const parts = [`Picture match ${pct(best.visual)}`];
  if (best.ocr?.numberMatch) parts.push("collector number read");
  if (best.ocr?.setMatch) parts.push("set code read");
  if (decision === "sure") parts.push("look-alikes ruled out");
  return parts.join(", ");
}

function overallReason(
  best: Contender,
  decision: Decision,
  ambiguous: Contender[],
  separations: Map<string, Separation>,
  sorted: Contender[],
  blockSure: string | null,
  sureAtLeast: number,
): string {
  if (decision === "none") {
    return `Nothing in the card library matches this scan closely (best was ${describePrinting(best.entry)} at ${pct(best.visual)}). Use Find match.`;
  }
  if (decision === "sure") {
    const lookAlikes = sorted.filter((c) => {
      const s = separations.get(c.key);
      return c.key !== best.key && s && s.kind !== "gap";
    });
    if (lookAlikes.length === 0) return `Matched ${describePrinting(best.entry)} — picture match ${pct(best.visual)}.`;
    const named = lookAlikes.slice(0, 2).map((c) => `${c.entry.set} #${c.entry.cn}`).join(" and ");
    const more = lookAlikes.length > 2 ? ` and ${lookAlikes.length - 2} more` : "";
    return `Matched ${describePrinting(best.entry)} — picture match ${pct(best.visual)}; told apart from the same art in ${named}${more}.`;
  }
  if (blockSure && ambiguous.length === 0 && best.visual >= sureAtLeast) {
    return `Looks like ${describePrinting(best.entry)}, but: ${blockSure}`;
  }
  if (ambiguous.length > 0) {
    const named = ambiguous.slice(0, 2).map((c) => `${c.entry.set} #${c.entry.cn}`).join(" or ");
    return `Close call: ${describePrinting(best.entry)} looks the same as ${named}. Check the set symbol and collector number.`;
  }
  return `Best match is ${describePrinting(best.entry)} at ${pct(best.visual)} — please confirm.`;
}
