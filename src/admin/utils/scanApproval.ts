import { isListReprintOf, listTieAdvice, preferOriginals } from "./listReprints.js";
import { applyPriceFloor, priceForFinish } from "./pricing.js";
import type {
  CardCondition,
  CardFinish,
  CardPrinting,
  CardScan,
  InventoryPriceFloor,
  RecognitionCandidate,
  ScanReviewPatch,
} from "../types/index.js";

// What a scan needs before it can be approved ("ready" to add to inventory),
// and the defaults filled in when a printing is confirmed — shared by
// picking a match, approving one card (Enter), Quick approve in the browser,
// and the server's bulk approval (api/admin/scan-sessions/[id]/approve.ts).
// Nothing here ever overwrites a value staff already set. Plain TypeScript:
// no React, no I/O.

/** The parts of a scan the approval defaults depend on. */
export interface ScanFields {
  selectedFinish: CardFinish | null;
  priceCents: number | null;
  confirmedCondition: CardCondition | null;
  /** The batch's foil / non-foil switch from scanning. */
  recognitionData: { finishGuess?: CardFinish | null } | null;
}

/**
 * The finish a matched scan defaults to: what staff already chose (when the
 * printing comes that way), else the batch's foil / non-foil switch from
 * scanning (recognitionData.finishGuess), else the printing's first finish.
 */
export function defaultFinish(scan: ScanFields, printing: CardPrinting): CardFinish | null {
  const available = printing.availableFinishes;
  if (scan.selectedFinish && available.includes(scan.selectedFinish)) return scan.selectedFinish;
  const batch = scan.recognitionData?.finishGuess ?? null;
  if (batch && available.includes(batch)) return batch;
  if (batch === "foil") {
    const foilLike = available.find((f) => f !== "nonfoil");
    if (foilLike) return foilLike;
  }
  return available[0] ?? null;
}

/** Suggested sell price: the Scryfall price for that finish, raised to the per-rarity floor. */
export function suggestedPrice(printing: CardPrinting, finish: CardFinish | null, floors: InventoryPriceFloor[]): number | null {
  const reference = finish ? priceForFinish(printing, finish) : printing.scryfallPriceCents;
  return applyPriceFloor(reference, printing.rarity, floors);
}

/** Finish and price to fill in when a printing is confirmed for a scan. */
export function matchDefaults(
  scan: ScanFields,
  printing: CardPrinting,
  floors: InventoryPriceFloor[],
): { selectedFinish: CardFinish | null; priceCents: number | null } {
  const selectedFinish = defaultFinish(scan, printing);
  const priceCents = scan.priceCents ?? suggestedPrice(printing, selectedFinish, floors);
  return { selectedFinish, priceCents };
}

export type ApprovalResult = { ok: true; patch: ScanReviewPatch } | { ok: false; reason: string };

/**
 * The update that approves `scan` with `printing` (its confirmed match,
 * freshly looked up), filling a missing finish and price; `fallbackCondition`
 * is used only when staff haven't graded the card (bulk approval asks for
 * one explicitly).
 */
export function approvalPatch(
  scan: ScanFields,
  printing: CardPrinting,
  floors: InventoryPriceFloor[],
  fallbackCondition?: CardCondition | null,
): ApprovalResult {
  const condition = scan.confirmedCondition ?? fallbackCondition ?? null;
  if (!condition) return { ok: false, reason: "Set a condition (keys 1–5) before approving." };
  const { selectedFinish, priceCents } = matchDefaults(scan, printing, floors);
  if (!selectedFinish) return { ok: false, reason: "Choose a finish before approving." };
  if (priceCents == null || priceCents <= 0) {
    return { ok: false, reason: "No Scryfall price for this printing — enter a selling price before approving." };
  }
  const patch: ScanReviewPatch = { reviewStatus: "ready" };
  if (!scan.confirmedCondition) patch.confirmedCondition = condition;
  if (scan.selectedFinish !== selectedFinish) patch.selectedFinish = selectedFinish;
  if (scan.priceCents !== priceCents) patch.priceCents = priceCents;
  return { ok: true, patch };
}

type TieFields = Pick<CardScan, "selectedPrinting" | "recognitionData">;

/**
 * The scan is matched to The List's copy of a printing whose original was
 * also suggested (they look the same in a scan; see listReprints.ts): the
 * original suggestion, or null.
 */
export function listTieOriginal(scan: TieFields): RecognitionCandidate | null {
  const selected = scan.selectedPrinting;
  if (!selected) return null;
  return (scan.recognitionData?.candidatePrintings ?? []).find((c) => isListReprintOf(selected, c)) ?? null;
}

/** Scans "Approve sure matches" covers: auto-matched by recognition and not yet reviewed. */
export function isSureMatch(
  scan: Pick<CardScan, "recognitionStatus" | "reviewStatus" | "selectedScryfallId"> & Partial<TieFields>,
): boolean {
  return (
    scan.recognitionStatus === "recognized" &&
    scan.reviewStatus === "matched" &&
    !!scan.selectedScryfallId &&
    !listTieOriginal({ selectedPrinting: scan.selectedPrinting ?? null, recognitionData: scan.recognitionData ?? null })
  );
}

/* ------------------------------------------------------------------ *
 * Quick approve: every card of a session on one screen, the confident
 * ones pre-ticked, approved and added to inventory in one go.
 * ------------------------------------------------------------------ */

/** Cards per Quick approve request (each is a few database writes and an inventory upsert). */
export const QUICK_APPROVE_BATCH = 25;

export type QuickKind =
  /** Matched — by recognition being sure, by a person, or already approved. */
  | "sure"
  /** The scanner PC was sure; the server asked for a quick confirm. */
  | "confirm"
  /** The original printing, or The List's copy of it. The original is proposed. */
  | "listTie"
  /** Look-alike printings recognition couldn't tell apart. */
  | "closeCall"
  /** A likely match that recognition wasn't sure about. */
  | "check"
  /** Nothing to propose: needs Find match in review. */
  | "noMatch";

export interface QuickProposal {
  kind: QuickKind;
  /** The printing approving confirms (null for noMatch). */
  scryfallId: string | null;
  cardName: string | null;
  setCode: string | null;
  setName: string | null;
  collectorNumber: string | null;
  imageUrl: string | null;
  /** Pre-ticked in Quick approve. */
  preselect: boolean;
  /** Why it isn't a plain sure match (null when it is). */
  note: string | null;
  /** The other suggested printings, to switch to. */
  alternatives: RecognitionCandidate[];
}

/** Cards Quick approve lists: everything not yet added to inventory or rejected. */
export function inQuickApprove(scan: Pick<CardScan, "reviewStatus" | "inventoryItemId">): boolean {
  return scan.reviewStatus !== "added" && scan.reviewStatus !== "rejected" && !scan.inventoryItemId;
}

const CUT_OFF = /cut off/i;

function printingImage(p: CardPrinting): string | null {
  return p.images.normal ?? p.images.small ?? p.images.large ?? p.faces[0]?.images.normal ?? p.faces[0]?.images.small ?? null;
}

function fromCandidate(
  c: RecognitionCandidate,
  kind: QuickKind,
  preselect: boolean,
  note: string | null,
  alternatives: RecognitionCandidate[],
): QuickProposal {
  return {
    kind,
    scryfallId: c.scryfallId,
    cardName: c.cardName,
    setCode: c.setCode,
    setName: null,
    collectorNumber: c.collectorNumber,
    imageUrl: c.imageUrl ?? null,
    preselect,
    note,
    alternatives,
  };
}

/**
 * What Quick approve proposes for a card, and whether it's pre-ticked: sure
 * matches (and the scanner PC's sure picks the server only asked to confirm)
 * are; close calls and unsure matches show their best guess, one tap away.
 * For The List's copy versus its original, the original is proposed (far
 * more common) with a note on how to tell.
 */
export function quickProposal(
  scan: Pick<CardScan, "selectedScryfallId" | "selectedPrinting" | "recognitionData" | "reviewStatus" | "recognitionStatus">,
): QuickProposal {
  const data = scan.recognitionData;
  const suggested = data?.candidatePrintings ?? [];

  // Matched already: the match is the proposal — unless it's The List's copy
  // of a printing that was suggested too.
  if (scan.selectedScryfallId && scan.selectedPrinting) {
    const p = scan.selectedPrinting;
    const original = listTieOriginal(scan);
    const others = suggested.filter((c) => c.scryfallId !== p.scryfallId);
    if (original) {
      const alternatives = [
        { scryfallId: p.scryfallId, cardName: p.cardName, setCode: p.setCode, collectorNumber: p.collectorNumber, confidence: 0, imageUrl: printingImage(p) },
        ...others.filter((c) => c.scryfallId !== original.scryfallId),
      ];
      return fromCandidate(original, "listTie", true, listTieAdvice(original, p), alternatives);
    }
    return {
      kind: "sure",
      scryfallId: p.scryfallId,
      cardName: p.cardName,
      setCode: p.setCode,
      setName: p.setName,
      collectorNumber: p.collectorNumber,
      imageUrl: printingImage(p),
      preselect: true,
      note: null,
      alternatives: others,
    };
  }

  if (suggested.length === 0) {
    return {
      kind: "noMatch",
      scryfallId: null,
      cardName: null,
      setCode: null,
      setName: null,
      collectorNumber: null,
      imageUrl: null,
      preselect: false,
      note: "No suggestion — find the match in review.",
      alternatives: [],
    };
  }

  // Results stored before the server put originals ahead of List copies.
  const { ranked } = preferOriginals(suggested, (c) => c);
  const [top, ...rest] = ranked;
  const listCopy = rest.find((c) => isListReprintOf(c, top));
  const pcDecision = data?.engine === "scanner_pc" ? data.scannerPc?.decision : undefined;
  const othersAreTheListCopy = rest.length > 0 && rest[0] === listCopy;

  if (listCopy && (pcDecision === "sure" || othersAreTheListCopy)) {
    return fromCandidate(top, "listTie", true, listTieAdvice(top, listCopy), rest);
  }
  if (pcDecision === "sure") {
    return fromCandidate(top, "confirm", true, "The scanner PC was sure; the website asked for a quick confirm.", rest);
  }
  const cutOff = data?.warnings.find((w) => CUT_OFF.test(w)) ?? null;
  if (pcDecision === "check" && data?.decisionReason && /^Close call/i.test(data.decisionReason)) {
    return fromCandidate(top, "closeCall", false, data.decisionReason, rest);
  }
  return fromCandidate(top, "check", false, cutOff ?? data?.decisionReason ?? "Recognition wasn't sure — check it.", rest);
}
