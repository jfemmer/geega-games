// Cube checklist — sorting and filtering the list (pure; used by
// CubeChecklistView.tsx and unit-tested on its own).
//
// Filters work like a store's facets: each one's counts take every other
// active filter into account, so "Blue 12" means 12 blue cards match what
// else is chosen right now.

import {
  colorRank,
  mainType,
  normalizeName,
  type ChecklistCard,
  type DraftRank,
} from "../../../store/lib/cubeChecklist";

export type View = "remaining" | "all" | "found" | "swapped";

export type SortKey = "color" | "name" | "weakest" | "strongest" | "played" | "priceHigh" | "priceLow";

export const SORT_OPTIONS: { key: SortKey; label: string }[] = [
  { key: "color", label: "Color" },
  { key: "name", label: "Name" },
  { key: "weakest", label: "Lowest rated first" },
  { key: "strongest", label: "Highest rated first" },
  { key: "played", label: "Most played" },
  { key: "priceHigh", label: "Price, high to low" },
  { key: "priceLow", label: "Price, low to high" },
];

export function isSortKey(v: string): v is SortKey {
  return SORT_OPTIONS.some((o) => o.key === v);
}

export interface ChecklistFilters {
  view: View;
  search: string;
  /** A color category ("Blue", "Lands", …), or null for all. */
  color: string | null;
  /** A card type from TYPE_ORDER, or null for all. */
  type: string | null;
  /** Only swap candidates: the lowest-rated cards (see draftRanks). */
  weakOnly: boolean;
}

/** The order card types are offered in. */
export const TYPE_ORDER = ["Creature", "Instant", "Sorcery", "Artifact", "Enchantment", "Planeswalker", "Battle", "Land", "Other"];

export function colorOf(card: Pick<ChecklistCard, "colorCategory">): string {
  return card.colorCategory ?? "Other";
}

/** The type a card is filtered under: its main type (creature wins over artifact), or "Other". */
export function typeOf(card: Pick<ChecklistCard, "typeLine">): string {
  return mainType(card.typeLine) ?? "Other";
}

type Facet = "view" | "color" | "type" | "weak";

/** Does the card pass every filter (except the one being counted, `skip`)? */
export function matchesFilters(
  card: ChecklistCard,
  f: ChecklistFilters,
  ranks: Map<string, DraftRank>,
  skip?: Facet,
): boolean {
  if (skip !== "view") {
    if (f.view === "remaining" && card.foundAt) return false;
    if (f.view === "found" && !card.foundAt) return false;
    if (f.view === "swapped" && !card.originalName) return false;
  }
  if (skip !== "color" && f.color && colorOf(card) !== f.color) return false;
  if (skip !== "type" && f.type && typeOf(card) !== f.type) return false;
  if (skip !== "weak" && f.weakOnly && !ranks.get(card.id)?.weak) return false;
  const q = normalizeName(f.search);
  if (!q) return true;
  return (
    normalizeName(card.name).includes(q) ||
    (card.typeLine != null && normalizeName(card.typeLine).includes(q)) ||
    (card.originalName != null && normalizeName(card.originalName).includes(q)) ||
    (card.foundBy != null && normalizeName(card.foundBy).includes(q))
  );
}

export interface FacetCounts {
  views: Record<View, number>;
  colors: Map<string, number>;
  types: Map<string, number>;
  /** Swap candidates matching the other filters. */
  weak: number;
}

export function facetCounts(cards: ChecklistCard[], f: ChecklistFilters, ranks: Map<string, DraftRank>): FacetCounts {
  const views: Record<View, number> = { remaining: 0, all: 0, found: 0, swapped: 0 };
  const colors = new Map<string, number>();
  const types = new Map<string, number>();
  let weak = 0;
  for (const c of cards) {
    if (matchesFilters(c, f, ranks, "view")) {
      views.all++;
      if (c.foundAt) views.found++;
      else views.remaining++;
      if (c.originalName) views.swapped++;
    }
    if (matchesFilters(c, f, ranks, "color")) colors.set(colorOf(c), (colors.get(colorOf(c)) ?? 0) + 1);
    if (matchesFilters(c, f, ranks, "type")) types.set(typeOf(c), (types.get(typeOf(c)) ?? 0) + 1);
    if (ranks.get(c.id)?.weak && matchesFilters(c, f, ranks, "weak")) weak++;
  }
  return { views, colors, types, weak };
}

/** The color categories on the list, in CubeCobra's order. */
export function colorsOnList(cards: ChecklistCard[]): string[] {
  return [...new Set(cards.map(colorOf))].sort((a, b) => colorRank(a) - colorRank(b) || a.localeCompare(b));
}

/** The card types on the list, in TYPE_ORDER. */
export function typesOnList(cards: ChecklistCard[]): string[] {
  const present = new Set(cards.map(typeOf));
  return TYPE_ORDER.filter((t) => present.has(t));
}

/** Nulls (no rating, no price, not ranked) always sort last, whichever way. */
function nullsLast(a: number | null | undefined, b: number | null | undefined, dir: 1 | -1): number {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  return (a - b) * dir;
}

function ratingOf(card: ChecklistCard, ranks: Map<string, DraftRank>): number | null {
  // Only cards with a usable rating are ranked (see hasDraftRating).
  return ranks.has(card.id) ? card.elo : null;
}

/** A sorted copy. `byRecent` (the Found tab) lists the most recently found first. */
export function sortCards(
  cards: ChecklistCard[],
  sort: SortKey,
  ranks: Map<string, DraftRank>,
  byRecent = false,
): ChecklistCard[] {
  const byName = (a: ChecklistCard, b: ChecklistCard) => a.name.localeCompare(b.name);
  return [...cards].sort((a, b) => {
    if (byRecent) return (b.foundAt ?? "").localeCompare(a.foundAt ?? "") || byName(a, b);
    switch (sort) {
      case "color":
        return colorRank(a.colorCategory) - colorRank(b.colorCategory) || byName(a, b);
      case "weakest":
        return nullsLast(ratingOf(a, ranks), ratingOf(b, ranks), 1) || a.position - b.position;
      case "strongest":
        return nullsLast(ratingOf(a, ranks), ratingOf(b, ranks), -1) || a.position - b.position;
      case "played":
        return nullsLast(a.edhrecRank, b.edhrecRank, 1) || byName(a, b);
      case "priceHigh":
        return nullsLast(a.priceCents, b.priceCents, -1) || byName(a, b);
      case "priceLow":
        return nullsLast(a.priceCents, b.priceCents, 1) || byName(a, b);
      default:
        return byName(a, b);
    }
  });
}

/** "1st", "2nd", "3rd", "11th"… */
export function ordinal(n: number): string {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  return `${n}${["th", "st", "nd", "rd"][n % 10] ?? "th"}`;
}
