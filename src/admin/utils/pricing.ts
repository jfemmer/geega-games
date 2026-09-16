import type { CardRarity, InventoryPriceFloor } from "../types";

/**
 * Applies a per-rarity minimum sell price to a reference (e.g. Scryfall
 * market) price. Only ever raises the price — never lowers one, and never
 * touches a price staff typed in by hand (callers only use this when
 * seeding a price FROM the reference, not on every keystroke).
 *
 * Returns `cents` unchanged when there's no rarity, the rarity is
 * "special" (too mixed a bucket for one minimum — see FloorableRarity),
 * there's no floor row for it, or that floor is 0 (no minimum set).
 */
export function applyPriceFloor(
  cents: number | null,
  rarity: CardRarity | null | undefined,
  floors: InventoryPriceFloor[],
): number | null {
  if (cents == null || !rarity || rarity === "special") return cents;
  const floor = floors.find((f) => f.rarity === rarity);
  if (!floor || floor.minPriceCents <= 0) return cents;
  return Math.max(cents, floor.minPriceCents);
}
