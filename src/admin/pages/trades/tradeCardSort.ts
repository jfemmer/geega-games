import type { TradeWantedItem } from "../../../store/lib/tradeCenter";
import { colorGroupOf } from "../../utils/cardColor";

// Sorting "Our cards" on a trade — the cards a customer wants from our
// inventory — the way staff pull them from the binder: by name, or by color
// in the usual Magic order (white, blue, black, red, green, then multicolor,
// colorless and lands). Colors come from the inventory line each card was
// added from; a card whose line is gone sorts last, under "Unknown color".

export type WantedSort = "added" | "name" | "color";

export const WANTED_SORTS: readonly { value: WantedSort; label: string }[] = [
  { value: "added", label: "Order added" },
  { value: "name", label: "Name (A–Z)" },
  { value: "color", label: "Color" },
];

export function isWantedSort(value: unknown): value is WantedSort {
  return value === "added" || value === "name" || value === "color";
}

// The color grouping is shared with the order packing checklist.
export { colorGroupOf, type ColorGroup } from "../../utils/cardColor";

const collator = new Intl.Collator("en", { sensitivity: "base", numeric: true });

function byName(a: TradeWantedItem, b: TradeWantedItem): number {
  return (
    collator.compare(a.cardName, b.cardName) ||
    collator.compare(a.setCode ?? "", b.setCode ?? "") ||
    collator.compare(a.collectorNumber ?? "", b.collectorNumber ?? "")
  );
}

/** A new array in the chosen order ("added" keeps the trade's own order). Never changes the input. */
export function sortWanted<T extends TradeWantedItem>(cards: readonly T[], sort: WantedSort): T[] {
  if (sort === "added") return [...cards];
  if (sort === "name") return [...cards].sort(byName);
  const keyed = cards.map((card) => ({ card, group: colorGroupOf(card) }));
  keyed.sort((a, b) => a.group.rank - b.group.rank || a.group.within.localeCompare(b.group.within) || byName(a.card, b.card));
  return keyed.map((k) => k.card);
}

const STORAGE_KEY = "gg-trade-wanted-sort";

/** The sort staff last picked on this device ("added" when none, or storage is blocked). */
export function loadWantedSort(): WantedSort {
  try {
    const value = window.localStorage.getItem(STORAGE_KEY);
    if (isWantedSort(value)) return value;
  } catch {
    // Storage blocked: use the default.
  }
  return "added";
}

export function saveWantedSort(sort: WantedSort): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, sort);
  } catch {
    // Not remembered, but still used for this visit.
  }
}
