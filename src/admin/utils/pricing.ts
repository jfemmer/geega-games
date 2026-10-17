import { extractPriceForFinish } from "../services/scryfall.js";
import type { ScryfallCard } from "../services/scryfall.types.js";
import type { CardFinish, CardPrinting, CardRarity, FloorableRarity, InventoryPriceFloor } from "../types/index.js";

/**
 * The reference price for a specific finish, read from the printing's normalized
 * prices (foil→usdFoil, etched→usdEtched, else usd). Falls back to plain usd.
 * Plain TypeScript (no React), so the server's bulk approval uses it too.
 */
export function priceForFinish(printing: CardPrinting, finish: CardFinish): number | null {
  // Reuse the shared extractor by faking the minimal price shape.
  const fake = {
    prices: {
      usd: printing.prices.usd != null ? (printing.prices.usd / 100).toString() : null,
      usd_foil: printing.prices.usdFoil != null ? (printing.prices.usdFoil / 100).toString() : null,
      usd_etched: printing.prices.usdEtched != null ? (printing.prices.usdEtched / 100).toString() : null,
    },
  } as unknown as ScryfallCard;
  return extractPriceForFinish(fake, finish);
}

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

/**
 * True when an existing inventory line should be raised to a newly-set
 * price floor: same rarity, not archived (archived lines aren't sellable),
 * priced below the floor, and the floor is actually set (>0). Shared by
 * the server endpoint's SQL filters (eq/neq/lt mirror this exactly) and
 * the mock repository, so both apply the identical rule.
 */
export function isRepriceable(
  item: { rarity: string | null; status: string; priceCents: number },
  rarity: FloorableRarity,
  floorCents: number,
): boolean {
  return (
    floorCents > 0 &&
    item.rarity === rarity &&
    item.status !== "archived" &&
    item.priceCents < floorCents
  );
}

export type RepriceCounts = Record<FloorableRarity, number> & { total: number };

const FLOORABLE_RARITIES: FloorableRarity[] = ["common", "uncommon", "rare", "mythic"];

/**
 * Counts how many of `items` would be raised by `floors`, per rarity and
 * in total. Pure — used directly by the mock repository, and mirrors the
 * server endpoint's SQL counting query (see api/admin/inventory/
 * price-floors.ts) so both agree on the same rule.
 */
export function countRepriceable(
  items: { rarity: string | null; status: string; priceCents: number }[],
  floors: Record<FloorableRarity, number>,
): RepriceCounts {
  const counts: RepriceCounts = { common: 0, uncommon: 0, rare: 0, mythic: 0, total: 0 };
  for (const rarity of FLOORABLE_RARITIES) {
    const n = items.filter((item) => isRepriceable(item, rarity, floors[rarity])).length;
    counts[rarity] = n;
    counts.total += n;
  }
  return counts;
}
