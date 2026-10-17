import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../../../src/types/database.js";
import type { CardFinish, CardPrinting, CardRecognitionResult, RecognitionCandidate } from "../../../src/admin/types/index.js";
import { HttpError } from "../http.js";
import { printingsByScryfallIds } from "../scryfallBulkIndex.js";
import { combineAndDecide, type ScoredCandidate } from "./pipeline.js";
import { listTieAdvice, preferOriginals } from "../../../src/admin/utils/listReprints.js";
// (pipeline.ts never imports this module — recognize.ts passes the identity
// built here into the pipeline — so there's no import cycle.)

// Results computed on the scanner PC (scanner-bridge/src/recognizer) arrive
// as POST /api/admin/scans/:id/recognize { local: {...} } from the bridge's
// staff sign-in. Nothing in them is taken on trust:
//
//   * every field is type-checked and size-limited (400 on anything malformed);
//   * every suggested printing is re-loaded from this server's own Scryfall
//     index — ids it doesn't know are dropped;
//   * "sure" still has to clear the same auto-match bar as the cloud
//     pipeline (combineAndDecide: 0.90 overall, 0.15 ahead of the runner-up)
//     before a printing is pre-selected; otherwise the scan goes to review
//     with the candidates listed.
//   * The List's copy of a printing is never put ahead of the original (the
//     two look the same in a scan; see src/admin/utils/listReprints.ts), so
//     it's never pre-selected over it either.
//
// So a buggy or tampered result can at worst suggest a real printing for a
// human to look at — which any staff member can already do by hand.

export type LocalDecision = "sure" | "check" | "none";

export interface LocalCandidateInput {
  scryfallId: string;
  confidence: number;
  reason: string;
  visual: number | null;
  similarity: number | null;
  face: number;
}

export interface LocalRecognitionInput {
  engineVersion: string;
  decision: LocalDecision;
  candidates: LocalCandidateInput[];
  decisionReason: string;
  warnings: string[];
  visualSimilarity: number | null;
  finish: "foil" | "nonfoil" | null;
  orientation: 0 | 180;
  sidesSwapped: boolean;
  straightened: { front: boolean; back: boolean };
  ocrText: string | null;
  timingsMs: Record<string, number>;
  library: { builtAt: string | null; entries: number; model: string };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_CANDIDATES = 10;

function bad(message: string): never {
  throw new HttpError(400, `Invalid scanner result: ${message}`);
}

function record(v: unknown, what: string): Record<string, unknown> {
  if (!v || typeof v !== "object" || Array.isArray(v)) bad(`${what} must be an object.`);
  return v as Record<string, unknown>;
}

function text(v: unknown, what: string, max: number, nullable = false): string | null {
  if (v === null || v === undefined) {
    if (nullable) return null;
    bad(`${what} is required.`);
  }
  if (typeof v !== "string") bad(`${what} must be text.`);
  return v.slice(0, max);
}

function num(v: unknown, what: string, min: number, max: number, nullable = false): number | null {
  if (v === null || v === undefined) {
    if (nullable) return null;
    bad(`${what} is required.`);
  }
  if (typeof v !== "number" || !Number.isFinite(v)) bad(`${what} must be a number.`);
  return Math.min(max, Math.max(min, v));
}

function bool(v: unknown, what: string): boolean {
  if (typeof v !== "boolean") bad(`${what} must be true or false.`);
  return v;
}

/** Validates the `local` body field. Throws HttpError(400) on anything malformed. */
export function parseLocalRecognition(value: unknown): LocalRecognitionInput {
  const v = record(value, "local");
  if (v.engine !== "scanner_pc") bad('engine must be "scanner_pc".');
  if (v.decision !== "sure" && v.decision !== "check" && v.decision !== "none") bad("decision must be sure, check or none.");
  if (!Array.isArray(v.candidates)) bad("candidates must be a list.");
  if (v.candidates.length > MAX_CANDIDATES) bad(`at most ${MAX_CANDIDATES} candidates.`);
  const candidates = v.candidates.map((c, i) => {
    const r = record(c, `candidates[${i}]`);
    const scryfallId = text(r.scryfallId, `candidates[${i}].scryfallId`, 36)!;
    if (!UUID.test(scryfallId)) bad(`candidates[${i}].scryfallId must be a Scryfall id.`);
    return {
      scryfallId: scryfallId.toLowerCase(),
      confidence: num(r.confidence, `candidates[${i}].confidence`, 0, 1)!,
      reason: text(r.reason, `candidates[${i}].reason`, 300)!,
      visual: num(r.visual, `candidates[${i}].visual`, 0, 1, true),
      similarity: num(r.similarity, `candidates[${i}].similarity`, -1, 1, true),
      face: Math.round(num(r.face, `candidates[${i}].face`, 0, 3)!),
    };
  });
  const warnings = v.warnings === undefined ? [] : v.warnings;
  if (!Array.isArray(warnings) || warnings.length > 12) bad("warnings must be a short list.");
  const straightened = record(v.straightened, "straightened");
  const library = record(v.library, "library");
  const timings: Record<string, number> = {};
  if (v.timingsMs !== undefined) {
    const t = record(v.timingsMs, "timingsMs");
    for (const [k, val] of Object.entries(t).slice(0, 20)) {
      if (typeof val === "number" && Number.isFinite(val) && /^[a-z]{1,20}$/i.test(k)) timings[k] = Math.max(0, Math.round(val));
    }
  }
  if (v.finish !== null && v.finish !== undefined && v.finish !== "foil" && v.finish !== "nonfoil") bad("finish must be foil, nonfoil or null.");
  if (v.orientation !== 0 && v.orientation !== 180) bad("orientation must be 0 or 180.");
  return {
    engineVersion: text(v.engineVersion, "engineVersion", 20)!,
    decision: v.decision,
    candidates,
    decisionReason: text(v.decisionReason, "decisionReason", 600)!,
    warnings: warnings.map((w, i) => text(w, `warnings[${i}]`, 300)!),
    visualSimilarity: num(v.visualSimilarity, "visualSimilarity", 0, 1, true),
    finish: (v.finish as "foil" | "nonfoil" | null | undefined) ?? null,
    orientation: v.orientation,
    sidesSwapped: bool(v.sidesSwapped, "sidesSwapped"),
    straightened: { front: bool(straightened.front, "straightened.front"), back: bool(straightened.back, "straightened.back") },
    ocrText: text(v.ocrText, "ocrText", 200, true),
    timingsMs: timings,
    library: {
      builtAt: text(library.builtAt, "library.builtAt", 40, true),
      entries: Math.round(num(library.entries, "library.entries", 0, 10_000_000)!),
      model: text(library.model, "library.model", 80)!,
    },
  };
}

/**
 * The finish to pre-select for a printing given the batch's foil / non-foil
 * switch: the batch setting when the printing comes that way, the only
 * finish when there's just one, otherwise the closest (a foil batch takes
 * any foil-type finish, e.g. etched) — with a note when it had to differ.
 */
export function chooseFinish(
  batch: "foil" | "nonfoil" | null,
  available: CardFinish[],
): { finish: CardFinish | null; warning: string | null } {
  if (available.length === 0) return { finish: null, warning: null };
  if (available.length === 1) {
    const only = available[0];
    const differs = batch !== null && (batch === "nonfoil" ? only !== "nonfoil" : only === "nonfoil");
    return {
      finish: only,
      warning: differs ? `This printing only comes as ${only === "nonfoil" ? "non-foil" : only} — the finish was set to that.` : null,
    };
  }
  if (batch === null) return { finish: null, warning: null };
  if (available.includes(batch)) return { finish: batch, warning: null };
  if (batch === "foil") {
    const foilLike = available.find((f) => f !== "nonfoil");
    if (foilLike) return { finish: foilLike, warning: null };
  }
  return { finish: available[0], warning: "This printing doesn't come in the batch's finish — check the finish." };
}

export interface LocalIdentity {
  recognitionResult: CardRecognitionResult;
  /** Pre-selected only when the PC was sure AND the server's own bar agrees. */
  autoMatchedPrinting: CardPrinting | null;
}

function imageOf(p: CardPrinting): string | null {
  return p.images.normal ?? p.images.small ?? p.faces[0]?.images.normal ?? p.faces[0]?.images.small ?? null;
}

export async function buildLocalIdentity(
  admin: SupabaseClient<Database>,
  local: LocalRecognitionInput,
): Promise<LocalIdentity> {
  const printings = await printingsByScryfallIds(admin, local.candidates.map((c) => c.scryfallId));
  const warnings = [...local.warnings];
  const known = local.candidates.filter((c) => printings.has(c.scryfallId));
  const dropped = local.candidates.length - known.length;
  if (dropped > 0) {
    warnings.push(
      `${dropped} suggestion${dropped === 1 ? " isn't" : "s aren't"} in this server's card list — refresh the Scryfall card list (npm run scryfall:refresh).`,
    );
  }

  const { ranked: scored, ties } = preferOriginals<ScoredCandidate>(
    known.map((c) => ({ printing: printings.get(c.scryfallId)!, confidence: c.confidence, reason: c.reason })),
    (c) => c.printing,
  );
  // The PC's own top pick was a List copy, now behind its original.
  const pcTopTie = ties.find((t) => t.reprint.printing.scryfallId === known[0]?.scryfallId) ?? null;
  for (const tie of ties) {
    tie.original.reason = `Same picture as The List's copy (${tie.reprint.printing.setCode} #${tie.reprint.printing.collectorNumber}), and far more common`;
    tie.reprint.reason = "The List's copy: a small planeswalker symbol in the bottom-left corner";
    // The PC's own pick gets this as the decision reason instead (below).
    if (tie !== pcTopTie) warnings.push(listTieAdvice(tie.original.printing, tie.reprint.printing));
  }
  const serverDecision = combineAndDecide(scored);
  const top = scored[0] ?? null;
  const autoMatch =
    local.decision === "sure" && top && serverDecision.autoMatch?.printing.scryfallId === top.printing.scryfallId
      ? serverDecision.autoMatch.printing
      : null;
  if (local.decision === "sure" && !autoMatch && !pcTopTie) {
    warnings.push("The scanner PC was sure, but the result didn't clear the server's auto-match bar — please confirm.");
  }

  const candidatePrintings: RecognitionCandidate[] = scored.slice(0, 6).map((c) => ({
    scryfallId: c.printing.scryfallId,
    cardName: c.printing.cardName,
    setCode: c.printing.setCode,
    collectorNumber: c.printing.collectorNumber,
    confidence: c.confidence,
    reason: c.reason,
    imageUrl: imageOf(c.printing),
  }));

  const topPrinting = top ? top.printing : null;
  const confidence = top ? top.confidence : 0;
  const decisionReason = pcTopTie
    ? `${pcTopTie.original.printing.cardName}: ${listTieAdvice(pcTopTie.original.printing, pcTopTie.reprint.printing)}`
    : autoMatch || local.decision !== "sure"
      ? local.decisionReason
      : `${local.decisionReason} (needs a quick confirm)`;
  return {
    autoMatchedPrinting: autoMatch,
    recognitionResult: {
      detectedName: topPrinting?.cardName ?? null,
      detectedSetCode: topPrinting?.setCode ?? null,
      detectedCollectorNumber: topPrinting?.collectorNumber ?? null,
      detectedLanguage: topPrinting?.language ?? null,
      // The batch's foil switch — a person's choice, not a guess from the image.
      finishGuess: local.finish,
      candidatePrintings,
      confidence,
      fieldConfidence: {
        exactPrinting: confidence,
        overallIdentity: confidence,
        ...(local.visualSimilarity !== null ? { visual: local.visualSimilarity } : {}),
      },
      warnings,
      decisionReason,
      setSymbolMatch: null,
      visualSimilarity: local.visualSimilarity,
      engine: "scanner_pc",
      scannerPc: {
        version: local.engineVersion,
        decision: local.decision,
        orientation: local.orientation,
        sidesSwapped: local.sidesSwapped,
        ocrText: local.ocrText,
        timingsMs: local.timingsMs,
        library: local.library,
        straightened: local.straightened,
      },
    },
  };
}
