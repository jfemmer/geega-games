import type { TradeWantedItem } from "../../../store/lib/tradeCenter";

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

const WUBRG = ["W", "U", "B", "R", "G"] as const;
const MONO_LABEL: Record<(typeof WUBRG)[number], string> = {
  W: "White",
  U: "Blue",
  B: "Black",
  R: "Red",
  G: "Green",
};

/** Where a card sorts by color, and the heading it sorts under. */
export interface ColorGroup {
  /** Groups in order: W, U, B, R, G (0–4), multicolor (5), colorless (6), lands (7), unknown (8). */
  rank: number;
  /** Orders cards inside the multicolor group (fewer colors first, then WUBRG). */
  within: string;
  label: string;
}

export function colorGroupOf(card: Pick<TradeWantedItem, "colors" | "typeLine">): ColorGroup {
  if (card.colors == null) return { rank: 8, within: "", label: "Unknown color" };
  // Keep only real color letters, in WUBRG order, once each.
  const colors = WUBRG.filter((c) => card.colors!.some((x) => x.toUpperCase() === c));
  if (colors.length === 0) {
    const isLand = /\bland\b/i.test(card.typeLine ?? "");
    return isLand ? { rank: 7, within: "", label: "Land" } : { rank: 6, within: "", label: "Colorless" };
  }
  if (colors.length === 1) return { rank: WUBRG.indexOf(colors[0]), within: "", label: MONO_LABEL[colors[0]] };
  const within = `${colors.length}${colors.map((c) => WUBRG.indexOf(c)).join("")}`;
  return { rank: 5, within, label: "Multicolor" };
}

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
