// A card's color group, the way staff sort and pull cards from the binder:
// white, blue, black, red, green, then multicolor, colorless and lands.
// Used by the trade drawer's "Our cards" and the order packing checklist.
// Colors come from the inventory line a card came from; a card whose line is
// gone (or never had colors) sorts last, under "Unknown color".

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

export function colorGroupOf(card: { colors?: string[] | null; typeLine?: string | null }): ColorGroup {
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
