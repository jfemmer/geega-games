import type { BadgeTone } from "../../utils/labels";
import type { SortingStatus } from "../../types";

// Badge colors for collection sorting statuses (admin only). The status
// names themselves are shared: SORTING_STATUS_ADMIN_LABELS in
// src/store/lib/sortingService.ts.

export const SORTING_STATUS_TONE: Record<SortingStatus, BadgeTone> = {
  new: "info",
  awaiting_cards: "neutral",
  received: "purple",
  quoted: "gold",
  approved: "success",
  sorting: "purple",
  ready: "success",
  returned: "neutral",
  cancelled: "danger",
};
