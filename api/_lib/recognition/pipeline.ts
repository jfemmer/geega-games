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
import { identifySetFromSymbol, type SetSymbolResult } from "./setSymbol.js";
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

/**
 * Set-first, era-adaptive candidate generation (Part 7 / Part 7.1).
 * setIdentification comes from identifySetFromSymbol — computed from the
 * scanned set-symbol shape ALONE, independent of OCR — so it's available
 * even on a card where OCR reads nothing usable at all. Tries the
 * strongest, most NARROWED signal first, falling back progressively:
 *
 *   1. OCR read a complete, machine-readable modern collector line.
 *   2. The symbol identified a set AND OCR read a collector NUMBER (even
 *      though the set-code letters themselves didn't parse — common when
 *      the collector-line crop catches noise/damage/an unfamiliar footer
 *      layout but the number portion still reads).
 *   3. The symbol identified a set AND OCR read a usable name: search
 *      WITHIN that set (~100-400 cards) instead of the whole catalog —
 *      faster, and a same-named card from the WRONG set can no longer
 *      outrank the right one on trigram-similarity noise alone.
 *   4. A usable name, set unknown: the original global fuzzy search.
 *   5. The symbol identified a set but OCR found NOTHING usable at all:
 *      fall back to every card in that ONE set and let visual
 *      verification alone do the work, rather than giving up with zero
 *      candidates — this is the case that used to have no path forward.
 *   6. Nothing readable, symbol unidentified either: zero candidates,
 *      needs_manual_match, never a guess.
 *
 * Each step falls through to the next automatically when it finds nothing
 * (candidates.length === 0) — an incorrect symbol-based set guess is
 * self-correcting, not a hazard: it just wastes a cheap, purely-local
 * query before landing on the same result the OCR-only cascade always
 * reached. combineAndDecide's thresholds are unchanged regardless of which
 * step produced the candidates, so none of this loosens precision — it
 * only changes which (and how many) candidates make it to that decision.
 */
async function generateCandidates(
  admin: Admin,
  ocr: Awaited<ReturnType<typeof ocrCardFields>>,
  setIdentification: SetSymbolResult | null,
): Promise<{ candidates: CardPrinting[]; era: RecognitionEra; setCodeGuess: string | null; collectorGuess: string | null }> {
  // The modern collector line is two real stacked lines on the card itself
  // (see imageRegions.ts's REGIONS comment) — OCR'd as two separate crops
  // so each can use its own confidence gate, then concatenated before
  // parseCollectorLine() so a single unmodified parser still handles both
  // ("C 0108" + "HOB * EN ... " -> collectorNumber "108", rarity common,
  // setCode "HOB", language "en"). Either half can be missing/low-confidence
  // (older frames often have neither) without losing the other's signal.
  const collectorLineText = [
    ocr.collectorInfo.confidence >= RECOGNITION_THRESHOLDS.ocrFieldMinUsableConfidence
      ? ocr.collectorInfo.text
      : "",
    ocr.collectorInfoLine2.confidence >= RECOGNITION_THRESHOLDS.ocrFieldMinUsableConfidence
      ? ocr.collectorInfoLine2.text
      : "",
  ]
    .join(" ")
    .trim();
  const collectorLine = collectorLineText
    ? parseCollectorLine(collectorLineText)
    : { collectorNumber: null, rarity: null, setCode: null, language: null };

  const nameText =
    ocr.title.confidence >= RECOGNITION_THRESHOLDS.ocrFieldMinUsableConfidence
      ? ocr.title.text
      : "";

  const symbolSetCode = setIdentification?.best?.setCode ?? null;

  // 1. Modern: a machine-readable collector line was actually found.
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

  // 2. Set known from the symbol + a collector number OCR did read, even
  // without the set-code letters parsing.
  if (symbolSetCode && collectorLine.collectorNumber) {
    const bySymbolCollector = await candidatesBySetAndCollector(
      admin,
      symbolSetCode,
      collectorLine.collectorNumber,
    );
    if (bySymbolCollector.length > 0) {
      return {
        candidates: bySymbolCollector,
        era: "modern",
        setCodeGuess: symbolSetCode,
        collectorGuess: collectorLine.collectorNumber,
      };
    }
  }

  // 3. Set known from the symbol + a usable name: narrowed search.
  if (symbolSetCode && nameText) {
    const bySymbolName = await candidatesByName(admin, nameText, 30, symbolSetCode);
    if (bySymbolName.length > 0) {
      return {
        candidates: bySymbolName,
        era: collectorLine.collectorNumber ? "exodus_to_premodern" : "vintage",
        setCodeGuess: symbolSetCode,
        collectorGuess: collectorLine.collectorNumber,
      };
    }
  }

  // 4. Exodus-to-premodern (existing): set unknown, but a name was read —
  // global search, let visual + set-symbol verification narrow it down.
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

  // 5. Set known from the symbol, but no usable text signal at all (OCR
  // totally failed — foil glare, a font this pipeline reads poorly, an
  // unfamiliar frame layout). Fall back to every card in that ONE set and
  // let visual verification alone do the work, rather than giving up.
  if (symbolSetCode) {
    const wholeSet = await candidatesBySet(admin, symbolSetCode);
    if (wholeSet.length > 0) {
      return {
        candidates: wholeSet,
        era: "unknown",
        setCodeGuess: symbolSetCode,
        collectorGuess: collectorLine.collectorNumber,
      };
    }
  }

  // 6. Vintage/no readable signal at all: nothing to search on. The
  // pipeline returns zero candidates — needs_manual_match, never a guess.
  return { candidates: [], era: "unknown", setCodeGuess: null, collectorGuess: null };
}

/**
 * Whether text OCR'd from the collector-info region looks like it's
 * naming this candidate's artist — the region's PRIMARY job is the modern
 * collector line (parseCollectorLine), but on cards without one (older
 * frames — see imageRegions.ts's REGIONS comment), that same crop often
 * catches the artist credit instead of finding nothing, per the real
 * "MIKLOS LIGETI" read that motivated this: text that doesn't parse as a
 * collector line was being discarded entirely even when it was a perfectly
 * real, usable signal. Matches on the artist's SURNAME (last word) at
 * minimum, since OCR noise around a full name (initials, a small credit
 * icon before/after) is common but the surname alone is still specific —
 * "Ligeti" isn't going to coincidentally appear in OCR noise the way a
 * single short word might.
 */
function artistCreditMatches(possibleArtistText: string | undefined, artist: string | null): boolean {
  if (!possibleArtistText || !artist) return false;
  const cleaned = possibleArtistText
    .toLowerCase()
    .replace(/[^a-z\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (cleaned.length < 3) return false;
  const surname = artist.toLowerCase().trim().split(/\s+/).pop() ?? "";
  return surname.length >= 3 && cleaned.includes(surname);
}

export function scoreAndRank(
  candidates: CardPrinting[],
  visualResults: VisualVerification[],
  nameText: string,
  possibleArtistText?: string,
): ScoredCandidate[] {
  const visualByCandidate = new Map(visualResults.map((v) => [v.printing.scryfallId, v]));
  const nameLower = nameText.trim().toLowerCase();

  return candidates
    .map((printing): ScoredCandidate => {
      const visual = visualByCandidate.get(printing.scryfallId);
      const hasNameSignal = !!nameLower;
      const nameMatches = hasNameSignal && printing.cardName.toLowerCase().includes(nameLower);
      const artistMatches = artistCreditMatches(possibleArtistText, printing.artist);

      // Visual verification (direct pixel comparison against THIS candidate's
      // actual Scryfall images) is the strongest available signal, so it
      // anchors the score once available; text-name agreement is a smaller
      // corroborating/conflicting adjustment on top. Without any visual
      // signal at all, confidence is capped well under the auto-match bar —
      // a candidate reached only via text should never auto-match on its own
      // (Part 6.4). Artist-credit agreement is a smaller bonus still, and
      // NEVER a penalty on its own for not matching: the same OCR text
      // usually already had its primary shot at being a collector line, so
      // "doesn't look like the artist either" isn't real evidence against a
      // candidate the way a genuine name conflict is.
      let confidence: number;
      if (visual) {
        confidence = visual.combinedSimilarity;
        if (nameMatches) confidence += 0.05;
        else if (hasNameSignal) confidence -= 0.08; // name was read but conflicts — real evidence against this candidate
        if (artistMatches) confidence += 0.03;
      } else {
        confidence = 0.3; // base: reached candidate stage at all
        if (nameMatches) confidence += 0.15;
        if (artistMatches) confidence += 0.05;
      }
      confidence = Math.max(0, Math.min(0.99, confidence)); // never claim absolute certainty — Part 20

      const reasonParts = [
        nameMatches ? "name agrees" : hasNameSignal ? "name conflicts" : "name unverified",
        visual ? `visual ${visual.combinedSimilarity.toFixed(2)}` : "no visual signal",
        ...(artistMatches ? ["artist credit agrees"] : []),
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

  // OCR and set-symbol identification are fully independent of each other
  // (both only need the normalized front image) — run them together rather
  // than paying their latency serially. identifySetFromSymbol is what lets
  // candidate generation below narrow to ONE set even on a card where OCR
  // finds nothing usable at all (see generateCandidates' own comment).
  const [ocr, setIdentification] = frontNormalized
    ? await Promise.all([
        ocrCardFields(ocrProvider, frontNormalized.buffer, frontNormalized.width, frontNormalized.height),
        identifySetFromSymbol(admin, frontNormalized.buffer, frontNormalized.width, frontNormalized.height),
      ])
    : ([
        {
          title: { text: "", confidence: 0, winningVariant: "none" },
          collectorInfo: { text: "", confidence: 0, winningVariant: "none" },
          collectorInfoLine2: { text: "", confidence: 0, winningVariant: "none" },
        },
        null,
      ] as const);

  const { candidates, era, setCodeGuess, collectorGuess } = frontNormalized
    ? await generateCandidates(admin, ocr, setIdentification)
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

  // collectorInfoLine2 (set code / language / artist credit — see
  // imageRegions.ts's REGIONS comment) is the primary artist-credit read:
  // unlike collectorInfo, it carries no uppercase-only whitelist, so a real
  // name's lowercase/accented letters survive. Falls back to collectorInfo
  // on cards with no modern collector line at all, where that crop's own
  // position sometimes catches the artist credit instead of finding
  // nothing (see artistCreditMatches' own comment) — a small corroborating
  // signal either way, never a name-conflict-style penalty.
  const possibleArtistText =
    ocr.collectorInfoLine2.confidence >= RECOGNITION_THRESHOLDS.ocrFieldMinUsableConfidence
      ? ocr.collectorInfoLine2.text
      : ocr.collectorInfo.confidence >= RECOGNITION_THRESHOLDS.ocrFieldMinUsableConfidence
        ? ocr.collectorInfo.text
        : undefined;

  const ranked = scoreAndRank(candidates, visualResults, ocr.title.text, possibleArtistText);
  const { autoMatch, reason } = combineAndDecide(ranked);

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
      setCode: ocr.collectorInfoLine2.confidence,
      setSymbol: setIdentification?.best?.confidence ?? 0,
      exactPrinting: overallConfidence,
      overallIdentity: overallConfidence,
    },
    warnings,
    era,
    decisionReason: reason,
    setSymbolMatch: setIdentification?.best ?? null,
    visualSimilarity: autoMatch?.visual?.combinedSimilarity ?? ranked[0]?.visual?.combinedSimilarity ?? null,
    ocrRawText: {
      title: ocr.title.text,
      collectorInfo: ocr.collectorInfo.text,
      collectorInfoLine2: ocr.collectorInfoLine2.text,
    },
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
