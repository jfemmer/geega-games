import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../../../src/types/database.js";
import type { CardPrinting } from "../../../src/admin/types/index.js";
import type {
  CardRecognitionResult,
  RecognitionCandidate,
  RecognitionEra,
  ScanRecognitionMode,
} from "../../../src/admin/types/index.js";
import { ocrProvider } from "../ocr/index.js";
import { normalizeCardImage } from "./imageRegions.js";
import { ocrCardFields, parseCollectorLine } from "./ocrFields.js";
import {
  candidatesBySet,
  candidatesBySetAndCollector,
  candidatesByName,
} from "../scryfallBulkIndex.js";
import { verifyCandidatesVisually, isVisuallyVerified, type VisualVerification } from "./verification.js";
import { matchSetSymbol, type SetSymbolResult } from "./setSymbol.js";
import { analyzeCondition, type ConditionAnalysis } from "./condition.js";
import { RECOGNITION_THRESHOLDS } from "./config.js";

// The multi-signal recognition orchestrator (Parts 6 & 7). Deliberately NOT
// one giant vision-model prompt: independent signals (OCR'd collector line,
// name OCR, Scryfall candidate generation, visual verification, set-symbol
// shape match) are gathered separately and combined explicitly, so a wrong
// guess in any ONE signal doesn't silently become the answer — see
// combineAndDecide() for exactly how they're weighed and why.

type Admin = SupabaseClient<Database>;

export interface RecognitionPipelineResult {
  recognitionResult: CardRecognitionResult;
  /** Non-null only when confidence clears the auto-match bar. */
  autoMatchedPrinting: CardPrinting | null;
  /** Null when the session's scan mode is "card_matching" — condition
   * analysis never ran, rather than running it and discarding the result. */
  condition: ConditionAnalysis | null;
  /** The normalized (trimmed/oriented) PNG buffer this run already produced
   * from frontImage/backImage — a real browser-viewable image, unlike the
   * scanner-native source file (often TIFF) recognition reads from. Handed
   * back so the caller can upload it as the scan's preview without a second
   * download+normalize pass; null exactly when the corresponding input
   * image was null. */
  frontPreview: Buffer | null;
  backPreview: Buffer | null;
}

export interface ScoredCandidate {
  printing: CardPrinting;
  confidence: number;
  reason: string;
  visual?: VisualVerification;
}

/** Era-adaptive candidate generation (Part 7). Tries the strongest signal
 * for a modern card first; falls back through progressively weaker signals
 * exactly like the mock's/live resolver's own "try id, then set+collector,
 * then name+set, then name" cascade — grounded in WHAT WAS ACTUALLY READ
 * (a modern collector line either parsed or it didn't) rather than a
 * separate, speculative "guess the decade from the frame" classifier. */
async function generateCandidates(
  admin: Admin,
  ocr: Awaited<ReturnType<typeof ocrCardFields>>,
): Promise<{ candidates: CardPrinting[]; era: RecognitionEra; setCodeGuess: string | null; collectorGuess: string | null }> {
  const collectorLine =
    ocr.collectorInfo.confidence >= RECOGNITION_THRESHOLDS.ocrFieldMinUsableConfidence
      ? parseCollectorLine(ocr.collectorInfo.text)
      : { collectorNumber: null, rarity: null, setCode: null, language: null };

  const nameText =
    ocr.title.confidence >= RECOGNITION_THRESHOLDS.ocrFieldMinUsableConfidence
      ? ocr.title.text
      : "";

  // Modern: a machine-readable collector line was actually found.
  if (collectorLine.setCode && collectorLine.collectorNumber) {
    const bySetCollector = await candidatesBySetAndCollector(
      admin,
      collectorLine.setCode,
      collectorLine.collectorNumber,
      collectorLine.language ?? undefined,
    );
    if (bySetCollector.length > 0) {
      return {
        candidates: bySetCollector,
        era: "modern",
        setCodeGuess: collectorLine.setCode,
        collectorGuess: collectorLine.collectorNumber,
      };
    }
  }

  // Exodus-to-premodern: no set-code text, but a collector number and/or
  // name were read. Narrow by name first (broad but usually small per-name
  // result count), let visual + set-symbol verification do the real work.
  if (nameText) {
    const byName = await candidatesByName(admin, nameText);
    if (byName.length > 0) {
      return {
        candidates: byName,
        era: collectorLine.collectorNumber ? "exodus_to_premodern" : "vintage",
        setCodeGuess: collectorLine.setCode,
        collectorGuess: collectorLine.collectorNumber,
      };
    }
  }

  // Vintage/no readable signal at all: nothing to search on. The pipeline
  // returns zero candidates — needs_manual_match, never a guess.
  return { candidates: [], era: "unknown", setCodeGuess: null, collectorGuess: null };
}

export function scoreAndRank(
  candidates: CardPrinting[],
  visualResults: VisualVerification[],
  nameText: string,
): ScoredCandidate[] {
  const visualByCandidate = new Map(visualResults.map((v) => [v.printing.scryfallId, v]));
  const nameLower = nameText.trim().toLowerCase();

  return candidates
    .map((printing): ScoredCandidate => {
      const visual = visualByCandidate.get(printing.scryfallId);
      const hasNameSignal = !!nameLower;
      const nameMatches = hasNameSignal && printing.cardName.toLowerCase().includes(nameLower);

      // Visual verification (direct pixel comparison against THIS candidate's
      // actual Scryfall images) is the strongest available signal, so it
      // anchors the score once available; text-name agreement is a smaller
      // corroborating/conflicting adjustment on top. Without any visual
      // signal at all, confidence is capped well under the auto-match bar —
      // a candidate reached only via text should never auto-match on its own
      // (Part 6.4).
      let confidence: number;
      if (visual) {
        confidence = visual.combinedSimilarity;
        if (nameMatches) confidence += 0.05;
        else if (hasNameSignal) confidence -= 0.08; // name was read but conflicts — real evidence against this candidate
      } else {
        confidence = 0.3; // base: reached candidate stage at all
        if (nameMatches) confidence += 0.15;
      }
      confidence = Math.max(0, Math.min(0.99, confidence)); // never claim absolute certainty — Part 20

      const reasonParts = [
        nameMatches ? "name agrees" : hasNameSignal ? "name conflicts" : "name unverified",
        visual ? `visual ${visual.combinedSimilarity.toFixed(2)}` : "no visual signal",
      ];
      return { printing, confidence, reason: reasonParts.join(", "), visual };
    })
    .sort((a, b) => b.confidence - a.confidence);
}

/**
 * Decide auto-match vs. manual review (Part 10). Only accepts when the top
 * candidate clears the overall bar AND beats the runner-up by a real
 * margin — an ambiguous top-two (close scores) is exactly the "conflicting
 * signals" case that must go to a human, even if the top score alone looks
 * high.
 */
export function combineAndDecide(ranked: ScoredCandidate[]): {
  autoMatch: ScoredCandidate | null;
  reason: string;
} {
  if (ranked.length === 0) {
    return { autoMatch: null, reason: "No candidates found from any signal." };
  }
  const [top, runnerUp] = ranked;
  if (top.confidence < RECOGNITION_THRESHOLDS.autoMatchOverallConfidence) {
    return {
      autoMatch: null,
      reason: `Top candidate confidence ${top.confidence.toFixed(2)} below the ${RECOGNITION_THRESHOLDS.autoMatchOverallConfidence} auto-match bar (${top.reason}).`,
    };
  }
  if (
    runnerUp &&
    top.confidence - runnerUp.confidence < RECOGNITION_THRESHOLDS.autoMatchMinMarginOverRunnerUp
  ) {
    return {
      autoMatch: null,
      reason: `Ambiguous: top candidate (${top.printing.cardName} ${top.printing.setCode}) only ${(top.confidence - runnerUp.confidence).toFixed(2)} ahead of runner-up (${runnerUp.printing.cardName} ${runnerUp.printing.setCode}).`,
    };
  }
  return {
    autoMatch: top,
    reason: `Auto-matched: ${top.reason}, confidence ${top.confidence.toFixed(2)}.`,
  };
}

export async function runRecognitionPipeline(
  admin: Admin,
  frontImage: Buffer | null,
  backImage: Buffer | null,
  mode: ScanRecognitionMode = "both",
): Promise<RecognitionPipelineResult> {
  const doIdentity = mode !== "condition";
  const doCondition = mode !== "card_matching";

  const frontNormalized = frontImage ? await normalizeCardImage(frontImage) : null;
  const backNormalized = backImage ? await normalizeCardImage(backImage) : null;

  if (!doIdentity) {
    // Card-matching intentionally skipped for this session — identity stays
    // fully manual (Find Match). Never run OCR/candidate generation/visual
    // verification just to discard the result, and never report "failed" —
    // that would wrongly imply an attempt was made and came up empty.
    const condition = doCondition ? await analyzeCondition(frontNormalized, backNormalized) : null;
    return {
      recognitionResult: {
        detectedName: null,
        detectedSetCode: null,
        detectedCollectorNumber: null,
        detectedLanguage: null,
        finishGuess: null,
        candidatePrintings: [],
        confidence: 0,
        fieldConfidence: {},
        warnings: [],
        era: "unknown",
        decisionReason: "Card matching not run — this session is condition-only. Match this card manually to add it to inventory.",
        setSymbolMatch: null,
        visualSimilarity: null,
        normalizedDimensions: frontNormalized
          ? { width: frontNormalized.width, height: frontNormalized.height }
          : undefined,
      },
      autoMatchedPrinting: null,
      condition,
      frontPreview: frontNormalized?.buffer ?? null,
      backPreview: backNormalized?.buffer ?? null,
    };
  }

  const warnings: string[] = [];
  if (!frontImage) {
    warnings.push("No front scan — identification requires a front image.");
  }

  const ocr = frontNormalized
    ? await ocrCardFields(ocrProvider, frontNormalized.buffer, frontNormalized.width, frontNormalized.height)
    : {
        title: { text: "", confidence: 0, winningVariant: "none" },
        collectorInfo: { text: "", confidence: 0, winningVariant: "none" },
      };

  const { candidates, era, setCodeGuess, collectorGuess } = frontNormalized
    ? await generateCandidates(admin, ocr)
    : { candidates: [], era: "unknown" as RecognitionEra, setCodeGuess: null, collectorGuess: null };

  const visualResults =
    frontNormalized && candidates.length > 0
      ? await verifyCandidatesVisually(
          admin,
          frontNormalized.buffer,
          frontNormalized.width,
          frontNormalized.height,
          candidates.slice(0, 20), // cap: visual verification is the expensive step
        )
      : [];

  const ranked = scoreAndRank(candidates, visualResults, ocr.title.text);
  const { autoMatch, reason } = combineAndDecide(ranked);

  let setSymbol: SetSymbolResult | null = null;
  if (frontNormalized && ranked.length > 0) {
    const candidateSetCodes = Array.from(new Set(ranked.slice(0, 10).map((r) => r.printing.setCode)));
    setSymbol = await matchSetSymbol(
      admin,
      frontNormalized.buffer,
      frontNormalized.width,
      frontNormalized.height,
      candidateSetCodes,
    );
  }

  const condition = doCondition ? await analyzeCondition(frontNormalized, backNormalized) : null;

  if (!autoMatch && ranked.length > 0) {
    warnings.push("Candidates found but not confident enough to auto-match — needs manual review.");
  }
  if (candidates.length === 0 && frontNormalized) {
    warnings.push("No readable identity signal (collector line, name) — needs_manual_match.");
  }

  const candidatePrintings: RecognitionCandidate[] = ranked.slice(0, 5).map((r) => ({
    scryfallId: r.printing.scryfallId,
    cardName: r.printing.cardName,
    setCode: r.printing.setCode,
    collectorNumber: r.printing.collectorNumber,
    confidence: r.confidence,
    reason: r.reason,
  }));

  const overallConfidence = autoMatch?.confidence ?? ranked[0]?.confidence ?? 0;

  const recognitionResult: CardRecognitionResult = {
    detectedName: ocr.title.text || null,
    detectedSetCode: setCodeGuess,
    detectedCollectorNumber: collectorGuess,
    detectedLanguage: null,
    // Never set by this pipeline — foil/finish stays a manual field. Part 5.
    finishGuess: null,
    candidatePrintings,
    confidence: overallConfidence,
    fieldConfidence: {
      name: ocr.title.confidence,
      collectorNumber: ocr.collectorInfo.confidence,
      setCode: ocr.collectorInfo.confidence,
      setSymbol: setSymbol?.best?.confidence ?? 0,
      exactPrinting: overallConfidence,
      overallIdentity: overallConfidence,
    },
    warnings,
    era,
    decisionReason: reason,
    setSymbolMatch: setSymbol?.best ?? null,
    visualSimilarity: autoMatch?.visual?.combinedSimilarity ?? ranked[0]?.visual?.combinedSimilarity ?? null,
    ocrRawText: { title: ocr.title.text, collectorInfo: ocr.collectorInfo.text },
    normalizedDimensions: frontNormalized
      ? { width: frontNormalized.width, height: frontNormalized.height }
      : undefined,
  };

  return {
    recognitionResult,
    autoMatchedPrinting: autoMatch?.printing ?? null,
    condition,
    frontPreview: frontNormalized?.buffer ?? null,
    backPreview: backNormalized?.buffer ?? null,
  };
}

// isVisuallyVerified is re-exported for callers that want to double-check a
// single candidate independently of the full pipeline (e.g. a future manual
// "verify this match" review-UI action).
export { isVisuallyVerified, candidatesBySet };
