// Guest cart: a local, pre-auth cart persisted in localStorage so a visitor can
// build an order before signing in. On sign-in it is merged into the customer's
// server cart (see CartContext.mergeGuestCart), revalidating every line against
// current sellable stock. The merge/clamp logic is pure and unit-tested.

const STORAGE_KEY = "geega.guestCart.v1";

export type GuestCartLine = {
  /** inventory_items UUID */
  inventoryItemId: string;
  quantity: number;
};

/** Read the guest cart from localStorage; tolerant of corruption. */
export function readGuestCart(): GuestCartLine[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (x): x is GuestCartLine =>
          !!x &&
          typeof (x as GuestCartLine).inventoryItemId === "string" &&
          Number.isFinite((x as GuestCartLine).quantity),
      )
      .map((x) => ({
        inventoryItemId: x.inventoryItemId,
        quantity: Math.max(1, Math.floor(x.quantity)),
      }));
  } catch {
    return [];
  }
}

/** Persist the guest cart (no-op on quota/serialization errors). */
export function writeGuestCart(lines: GuestCartLine[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(lines));
  } catch {
    /* ignore storage errors (private mode, quota) */
  }
}

export function clearGuestCart(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

/**
 * Pure: add/increment a line, clamped to maxSellable. Returns a new array.
 * Adding 0 or fewer, or when maxSellable <= 0, leaves the cart unchanged.
 */
export function addLine(
  lines: GuestCartLine[],
  inventoryItemId: string,
  qty: number,
  maxSellable: number,
): GuestCartLine[] {
  if (qty <= 0 || maxSellable <= 0) return lines;
  const existing = lines.find((l) => l.inventoryItemId === inventoryItemId);
  const nextQty = Math.min(maxSellable, (existing?.quantity ?? 0) + qty);
  if (existing) {
    return lines.map((l) =>
      l.inventoryItemId === inventoryItemId ? { ...l, quantity: nextQty } : l,
    );
  }
  return [...lines, { inventoryItemId, quantity: nextQty }];
}

/** Pure: set an explicit quantity (removing the line when <= 0). */
export function setLineQuantity(
  lines: GuestCartLine[],
  inventoryItemId: string,
  qty: number,
  maxSellable: number,
): GuestCartLine[] {
  if (qty <= 0) {
    return lines.filter((l) => l.inventoryItemId !== inventoryItemId);
  }
  const clamped = Math.min(qty, Math.max(0, maxSellable));
  if (clamped <= 0) {
    return lines.filter((l) => l.inventoryItemId !== inventoryItemId);
  }
  const exists = lines.some((l) => l.inventoryItemId === inventoryItemId);
  if (!exists) return [...lines, { inventoryItemId, quantity: clamped }];
  return lines.map((l) =>
    l.inventoryItemId === inventoryItemId ? { ...l, quantity: clamped } : l,
  );
}

export function removeLine(
  lines: GuestCartLine[],
  inventoryItemId: string,
): GuestCartLine[] {
  return lines.filter((l) => l.inventoryItemId !== inventoryItemId);
}

export type MergePlanEntry = {
  inventoryItemId: string;
  /** Final desired quantity after merge, already clamped to sellable. */
  desiredQuantity: number;
  /** True when the guest quantity was reduced to fit sellable stock. */
  clamped: boolean;
  /** True when the whole line was dropped (0 sellable). */
  dropped: boolean;
};

/**
 * Pure merge planner. Given the guest lines, the server cart's current
 * quantities, and a sellable-stock lookup, compute the final desired quantity
 * per item WITHOUT overselling.
 *
 * Rules (matches requirements):
 *   - Never overwrite the server cart blindly: server qty is the baseline and we
 *     ADD the guest qty on top (a customer who had 1 on the server and 1 as a
 *     guest ends with 2), then clamp to sellable.
 *   - Revalidate against current sellable stock: the final qty is capped at
 *     sellable; if that reduces it, clamped=true; if sellable is 0, dropped=true.
 */
export function planCartMerge(
  guestLines: GuestCartLine[],
  serverQuantities: Record<string, number>,
  sellableByItem: Record<string, number>,
): MergePlanEntry[] {
  const ids = new Set<string>([
    ...guestLines.map((l) => l.inventoryItemId),
    ...Object.keys(serverQuantities),
  ]);
  const plan: MergePlanEntry[] = [];
  for (const id of ids) {
    const guestQty =
      guestLines.find((l) => l.inventoryItemId === id)?.quantity ?? 0;
    const serverQty = serverQuantities[id] ?? 0;
    const sellable = Math.max(0, sellableByItem[id] ?? 0);
    const wanted = serverQty + guestQty;
    const finalQty = Math.min(wanted, sellable);
    plan.push({
      inventoryItemId: id,
      desiredQuantity: finalQty,
      clamped: finalQty < wanted && finalQty > 0,
      dropped: finalQty <= 0 && wanted > 0,
    });
  }
  return plan;
}
