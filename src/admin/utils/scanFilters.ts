import type { CardScan, ScanFilterKey } from "../types";

// Which scans each Scan Review tab shows. The live repository asks the
// database for the same thing (scan.supabase.ts listScans); the mock and the
// review screen (to drop a card from the tab it no longer belongs in, without
// reloading the whole list) use this.

export function matchesScanFilter(
  scan: Pick<CardScan, "reviewStatus" | "selectedScryfallId" | "backImagePath">,
  filter: ScanFilterKey,
): boolean {
  switch (filter) {
    case "unreviewed":
      return scan.reviewStatus === "unreviewed";
    case "pending_match":
      return scan.selectedScryfallId == null && scan.reviewStatus !== "rejected";
    case "matched":
      return scan.selectedScryfallId != null && scan.reviewStatus === "matched";
    case "needs_manual_match":
      return scan.reviewStatus === "needs_manual_match";
    case "ready":
      return scan.reviewStatus === "ready";
    case "added":
      return scan.reviewStatus === "added";
    case "rejected":
      return scan.reviewStatus === "rejected";
    case "missing_back":
      return scan.backImagePath == null;
    case "error":
      return scan.reviewStatus === "error";
    default:
      return true;
  }
}
