// Sorting on the admin Orders page, for pulling orders quickly:
//
//   - the order list: oldest or newest first, by total, by how many cards,
//     by customer, or envelopes (PWE) first;
//   - the cards in one order (its packing checklist): by color the way
//     binders are sorted, by set, name, price or rarity, with a heading for
//     each color / set / rarity.
//
// Each choice is remembered on this device. Pure functions; OrdersPage.tsx
// renders them.

import { colorGroupOf } from "../../utils/cardColor";
import type { Order, OrderItem, OrderQuery } from "../../types";

const collator = new Intl.Collator("en", { sensitivity: "base", numeric: true });

/* ---------------------------- The order list ---------------------------- */

export type OrderSort = "oldest" | "newest" | "totalHigh" | "totalLow" | "mostCards" | "customer" | "envelopesFirst";

export const ORDER_SORTS: readonly { value: OrderSort; label: string }[] = [
  { value: "oldest", label: "Oldest first" },
  { value: "newest", label: "Newest first" },
  { value: "totalHigh", label: "Total: high to low" },
  { value: "totalLow", label: "Total: low to high" },
  { value: "mostCards", label: "Most cards" },
  { value: "customer", label: "Customer (A–Z)" },
  { value: "envelopesFirst", label: "Envelopes (PWE) first" },
];

export function isOrderSort(value: unknown): value is OrderSort {
  return ORDER_SORTS.some((s) => s.value === value);
}

/** Until staff pick a sort: the queue (packing, shipping) oldest first, history newest first. */
export function defaultOrderSort(tab: string): OrderSort {
  return tab === "needs_packing" || tab === "packing" || tab === "ready_to_ship" ? "oldest" : "newest";
}

/**
 * How the server should order the (at most 500) orders it sends, so the right
 * ones come back for date and total sorts. The rest are sorted here.
 */
export function serverOrderFor(sort: OrderSort): Pick<OrderQuery, "sortBy" | "sortDir"> {
  switch (sort) {
    case "oldest":
      return { sortBy: "created", sortDir: "asc" };
    case "totalHigh":
      return { sortBy: "total", sortDir: "desc" };
    case "totalLow":
      return { sortBy: "total", sortDir: "asc" };
    default:
      return { sortBy: "created", sortDir: "desc" };
  }
}

/** Copies in an order (4 Lightning Bolts count 4). */
export function cardCount(order: Pick<Order, "items">): number {
  return order.items.reduce((sum, it) => sum + it.quantity, 0);
}

/** A new array in the chosen order. Ties go to the order placed first. */
export function sortOrders<T extends Order>(orders: readonly T[], sort: OrderSort): T[] {
  const oldestFirst = (a: T, b: T) => a.createdAt.localeCompare(b.createdAt);
  return [...orders].sort((a, b) => {
    switch (sort) {
      case "newest":
        return b.createdAt.localeCompare(a.createdAt);
      case "totalHigh":
        return b.totalCents - a.totalCents || oldestFirst(a, b);
      case "totalLow":
        return a.totalCents - b.totalCents || oldestFirst(a, b);
      case "mostCards":
        return cardCount(b) - cardCount(a) || oldestFirst(a, b);
      case "customer":
        return collator.compare(a.customerName ?? "", b.customerName ?? "") || oldestFirst(a, b);
      case "envelopesFirst":
        return Number(a.shippingMethod !== "pwe") - Number(b.shippingMethod !== "pwe") || oldestFirst(a, b);
      default:
        return oldestFirst(a, b);
    }
  });
}

/* ------------------------ The cards in one order ------------------------ */

export type PullSort = "color" | "set" | "name" | "priceHigh" | "priceLow" | "rarity";

export const PULL_SORTS: readonly { value: PullSort; label: string }[] = [
  { value: "color", label: "Color" },
  { value: "set", label: "Set" },
  { value: "name", label: "Name (A–Z)" },
  { value: "priceHigh", label: "Price: high to low" },
  { value: "priceLow", label: "Price: low to high" },
  { value: "rarity", label: "Rarity" },
];

export function isPullSort(value: unknown): value is PullSort {
  return PULL_SORTS.some((s) => s.value === value);
}

const RARITY_RANK: Record<string, number> = { mythic: 0, rare: 1, uncommon: 2, common: 3, special: 4, bonus: 5 };
const RARITY_LABEL: Record<string, string> = {
  mythic: "Mythic",
  rare: "Rare",
  uncommon: "Uncommon",
  common: "Common",
  special: "Special",
  bonus: "Bonus",
};

type PullItem = Pick<
  OrderItem,
  "cardName" | "setName" | "setCode" | "collectorNumber" | "unitPriceCents" | "colors" | "typeLine" | "rarity"
>;

function byName(a: PullItem, b: PullItem): number {
  return (
    collator.compare(a.cardName, b.cardName) ||
    collator.compare(a.setCode ?? "", b.setCode ?? "") ||
    collator.compare(a.collectorNumber ?? "", b.collectorNumber ?? "")
  );
}

function setLabel(it: PullItem): string {
  return it.setName ?? (it.setCode ? it.setCode.toUpperCase() : "Unknown set");
}

function bySet(a: PullItem, b: PullItem): number {
  // Unknown sets last; then set name, then collector number (numeric: 9 before 10).
  return (
    Number(!a.setName && !a.setCode) - Number(!b.setName && !b.setCode) ||
    collator.compare(setLabel(a), setLabel(b)) ||
    collator.compare(a.collectorNumber ?? "", b.collectorNumber ?? "") ||
    byName(a, b)
  );
}

function rarityRank(it: PullItem): number {
  // Known rarities in order, then any other rarity, then cards without one.
  return it.rarity ? (RARITY_RANK[it.rarity.toLowerCase()] ?? 6) : 7;
}

/** The heading a card sits under for this sort, or null when the sort has none. */
export function pullGroupOf(it: PullItem, sort: PullSort): string | null {
  switch (sort) {
    case "color":
      return colorGroupOf(it).label;
    case "set":
      return setLabel(it);
    case "rarity":
      return it.rarity ? (RARITY_LABEL[it.rarity.toLowerCase()] ?? it.rarity) : "Unknown rarity";
    default:
      return null;
  }
}

/** A new array in the chosen order. Never changes the input. */
export function sortPullItems<T extends PullItem>(items: readonly T[], sort: PullSort): T[] {
  if (sort === "color") {
    const keyed = items.map((item) => ({ item, group: colorGroupOf(item) }));
    keyed.sort(
      (a, b) => a.group.rank - b.group.rank || a.group.within.localeCompare(b.group.within) || byName(a.item, b.item),
    );
    return keyed.map((k) => k.item);
  }
  return [...items].sort((a, b) => {
    switch (sort) {
      case "set":
        return bySet(a, b);
      case "priceHigh":
        return b.unitPriceCents - a.unitPriceCents || byName(a, b);
      case "priceLow":
        return a.unitPriceCents - b.unitPriceCents || byName(a, b);
      case "rarity":
        // The heading breaks ties, so each one appears once.
        return (
          rarityRank(a) - rarityRank(b) ||
          collator.compare(pullGroupOf(a, "rarity") ?? "", pullGroupOf(b, "rarity") ?? "") ||
          byName(a, b)
        );
      default:
        return byName(a, b);
    }
  });
}

/** Sorted cards split under their headings (one untitled group for sorts without headings). */
export function groupPullItems<T extends PullItem>(
  items: readonly T[],
  sort: PullSort,
): { label: string | null; items: T[] }[] {
  const groups: { label: string | null; items: T[] }[] = [];
  for (const item of sortPullItems(items, sort)) {
    const label = pullGroupOf(item, sort);
    const last = groups[groups.length - 1];
    if (last && last.label === label) last.items.push(item);
    else groups.push({ label, items: [item] });
  }
  return groups;
}

/* ------------------------------ Remembering ------------------------------ */

const ORDER_SORT_KEY = "gg-orders-sort";
const PULL_SORT_KEY = "gg-orders-pull-sort";
const HIDE_PACKED_KEY = "gg-orders-hide-packed";

function read(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null; // Storage blocked: defaults apply.
  }
}

function write(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Not remembered, but still used for this visit.
  }
}

/** The list sort staff last picked on this device, or null to use each tab's default. */
export function loadOrderSort(): OrderSort | null {
  const v = read(ORDER_SORT_KEY);
  return isOrderSort(v) ? v : null;
}
export const saveOrderSort = (sort: OrderSort) => write(ORDER_SORT_KEY, sort);

/** The checklist sort staff last picked on this device (color by default). */
export function loadPullSort(): PullSort {
  const v = read(PULL_SORT_KEY);
  return isPullSort(v) ? v : "color";
}
export const savePullSort = (sort: PullSort) => write(PULL_SORT_KEY, sort);

export const loadHidePacked = (): boolean => read(HIDE_PACKED_KEY) === "1";
export const saveHidePacked = (hide: boolean) => write(HIDE_PACKED_KEY, hide ? "1" : "0");
