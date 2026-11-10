// Cube checklist — shared types and pure helpers.
//
// Used by the browser (admin Cube Checklist page and the public share page,
// both rendering src/admin/components/cube/CubeChecklistView.tsx) and by the
// API (api/_lib/cubeChecklist.ts). No React, no I/O.

export type RarityRule = "common" | "common_uncommon";

export const RARITY_RULE_LABELS: Record<RarityRule, string> = {
  common: "Commons only",
  common_uncommon: "Commons and uncommons",
};

export interface ChecklistCard {
  id: string;
  position: number;
  name: string;
  typeLine: string | null;
  colorCategory: string | null;
  /** The cube's card this slot replaced, when it was swapped. */
  originalName: string | null;
  swappedBy: string | null;
  swappedAt: string | null;
  foundBy: string | null;
  foundAt: string | null;
  updatedAt: string;
}

export interface ChecklistSummary {
  id: string;
  name: string;
  cubeId: string;
  rarityRule: RarityRule;
}

export interface ChecklistView extends ChecklistSummary {
  cards: ChecklistCard[];
  /** Pass back as `since` to get only cards changed after this moment. */
  syncedAt: string;
}

/** Admin-only extras (never sent to the share page). */
export interface ChecklistAdminSummary extends ChecklistSummary {
  shareToken: string;
  shareEnabled: boolean;
  createdAt: string;
  cardCount: number;
  foundCount: number;
}

/** A card offered as a swap: a similar, popular card, or a search result. */
export interface SwapOption {
  name: string;
  typeLine: string | null;
  manaCost: string | null;
  imageSmall: string | null;
  imageNormal: string | null;
  /** EDHREC popularity rank (lower = more played), when Scryfall has one. */
  edhrecRank: number | null;
}

export const CUBE_CHECKLIST_PATH = "/cube-checklist";

export const CHECKLIST_LIMITS = {
  personName: 40,
  cardName: 200,
  search: 80,
} as const;

/** Pauper cubes may only swap in commons; other cubes allow uncommons too. */
export function defaultRarityRule(cubeId: string): RarityRule {
  return /pauper/i.test(cubeId) ? "common" : "common_uncommon";
}

/** The Scryfall clause for a rarity rule. */
export function rarityClause(rule: RarityRule): string {
  return rule === "common" ? "r:common" : "(r:common or r:uncommon)";
}

/** Case- and accent-insensitive key for matching card names. */
export function normalizeName(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

/**
 * The key that decides "is this the same card?" — one of each card per list.
 * Front face only, case- and accent-insensitive, because CubeCobra and
 * Scryfall name two-part cards differently: the list has "Ardenvale
 * Tactician", Scryfall says "Ardenvale Tactician // Dizzying Swoop".
 * (Front-face names are unique across Magic.) The database enforces the same
 * rule with its (checklist_id, lower(front face)) unique index.
 */
export function cardKey(name: string): string {
  return normalizeName(name.split("//")[0]);
}

/** A card name as a Scryfall exact-name term: !"Fire // Ice". */
export function exactNameTerm(name: string): string {
  return `!"${name.replace(/["\\]/g, "")}"`;
}

const COLOR_NAMES: Record<string, string> = {
  W: "White",
  U: "Blue",
  B: "Black",
  R: "Red",
  G: "Green",
};

/** CubeCobra's color category for a card: Lands, Colorless, Multicolored, or one color. */
export function colorCategoryFor(typeLine: string | null, colors: string[] | null | undefined): string {
  const front = (typeLine ?? "").split("//")[0];
  if (/\bLand\b/.test(front)) return "Lands";
  const list = (colors ?? []).filter((c) => c in COLOR_NAMES);
  if (list.length === 0) return "Colorless";
  if (list.length > 1) return "Multicolored";
  return COLOR_NAMES[list[0]];
}

/** CubeCobra's own color-category order, so the list reads like the cube page. */
export const COLOR_ORDER = [
  "White",
  "Blue",
  "Black",
  "Red",
  "Green",
  "Colorless",
  "Multicolored",
  "Hybrid",
  "Lands",
];

export function colorRank(category: string | null): number {
  const i = category ? COLOR_ORDER.indexOf(category) : -1;
  return i < 0 ? COLOR_ORDER.length : i;
}

const MAIN_TYPES = [
  "Creature",
  "Planeswalker",
  "Battle",
  "Instant",
  "Sorcery",
  "Artifact",
  "Enchantment",
  "Land",
];

/** The card type to match for "similar cards" (creature wins over artifact etc.). */
export function mainType(typeLine: string | null): string | null {
  const front = (typeLine ?? "").split("//")[0];
  return MAIN_TYPES.find((t) => new RegExp(`\\b${t}\\b`).test(front)) ?? null;
}

/** Merge a refresh (only changed cards) into the list, by id. */
export function mergeCards(current: ChecklistCard[], changed: ChecklistCard[]): ChecklistCard[] {
  if (changed.length === 0) return current;
  const byId = new Map(changed.map((c) => [c.id, c]));
  const merged = current.map((c) => {
    const next = byId.get(c.id);
    if (!next) return c;
    byId.delete(c.id);
    // Never let an older copy overwrite a newer one.
    return next.updatedAt >= c.updatedAt ? next : c;
  });
  return byId.size > 0 ? [...merged, ...byId.values()].sort((a, b) => a.position - b.position) : merged;
}
