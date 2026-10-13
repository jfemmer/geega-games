import { priceForFinish } from "../components/cards/PrintingPreview";
import { applyPriceFloor } from "./pricing";
import type { CardCondition, CardFinish, CardPrinting, CardScan, InventoryPriceFloor, ScanReviewPatch } from "../types";

// What a scan needs before it can be approved ("ready" to add to inventory),
// and the defaults filled in when a printing is confirmed — shared by
// picking a match, approving one card (Enter), and "Approve sure matches".
// Nothing here ever overwrites a value staff already set.

type ScanFields = Pick<CardScan, "selectedFinish" | "priceCents" | "confirmedCondition" | "recognitionData">;

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

/** Scans "Approve sure matches" covers: auto-matched by recognition and not yet reviewed. */
export function isSureMatch(scan: Pick<CardScan, "recognitionStatus" | "reviewStatus" | "selectedScryfallId">): boolean {
  return scan.recognitionStatus === "recognized" && scan.reviewStatus === "matched" && !!scan.selectedScryfallId;
}
