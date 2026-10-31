import { supabase } from "../../supabase";
import { CONDITION_LABELS } from "./conditionLabels";

// Copies of a card that a trade is holding (public.trade_held_copies): a
// trade holds our cards from the moment it's sent, so a shopper can find a
// copy they can't buy. Counts only: nothing about the trade or who sent it.
// Shoppers can ask to be emailed if a copy is released (watchHeldCopy).

export type HeldCopy = {
  id: string;
  cardName: string;
  setCode: string | null;
  setName: string | null;
  collectorNumber: string | null;
  condition: string;
  finish: string;
  variantType: string | null;
  imageUrl: string | null;
  priceCents: number | null;
  /** How many copies of this line the trade holds. */
  heldQuantity: number;
  /** How many can still be bought (0: all held). */
  sellableQuantity: number;
};

type Row = {
  id: string;
  card_name: string | null;
  set_code: string | null;
  set_name: string | null;
  collector_number: string | null;
  condition: string | null;
  finish: string | null;
  variant_type: string | null;
  image_url: string | null;
  price_cents: number | null;
  held_quantity: number | null;
  sellable_quantity: number | null;
};

function toHeldCopy(r: Row): HeldCopy {
  return {
    id: r.id,
    cardName: r.card_name ?? "This card",
    setCode: r.set_code,
    setName: r.set_name,
    collectorNumber: r.collector_number,
    condition: r.condition ?? "NM",
    finish: r.finish ?? "nonfoil",
    variantType: r.variant_type || null,
    imageUrl: r.image_url,
    priceCents: r.price_cents,
    heldQuantity: Math.max(0, r.held_quantity ?? 0),
    sellableQuantity: Math.max(0, r.sellable_quantity ?? 0),
  };
}

/**
 * Held copies of a card (by oracle id) or of particular copies (by inventory
 * item id). Best effort: a failed lookup (or a database without the function
 * yet) is "nothing held", so the page around it still works.
 */
export async function fetchHeldCopies(query: { oracleId?: string; ids?: string[] }): Promise<HeldCopy[]> {
  const ids = query.ids ? Array.from(new Set(query.ids)).slice(0, 500) : null;
  if (!query.oracleId && !ids?.length) return [];
  try {
    const { data, error } = await supabase.rpc("trade_held_copies", {
      p_oracle_id: query.oracleId ?? null,
      p_ids: ids,
    });
    if (error) return [];
    return ((data ?? []) as Row[]).map(toHeldCopy);
  } catch {
    return [];
  }
}

/** "Dominaria United #12 · Near Mint · Foil" */
export function heldCopyLabel(c: Pick<HeldCopy, "setName" | "setCode" | "collectorNumber" | "condition" | "finish" | "variantType">): string {
  return [
    [c.setName ?? c.setCode?.toUpperCase(), c.collectorNumber ? `#${c.collectorNumber}` : null].filter(Boolean).join(" "),
    CONDITION_LABELS[c.condition] ?? c.condition,
    c.finish !== "nonfoil" ? (c.finish === "etched" ? "Etched foil" : "Foil") : null,
    c.variantType,
  ]
    .filter(Boolean)
    .join(" · ");
}

export type WatchResult = { status: "watching" | "available" };

/**
 * "Notify me if it's released": one email when this copy can be bought
 * again. A signed-in shopper's account email is used; a guest gives one.
 */
export async function watchHeldCopy(inventoryItemId: string, email: string | null): Promise<WatchResult> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  try {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (token) headers.Authorization = `Bearer ${token}`;
  } catch {
    /* a guest */
  }
  const res = await fetch("/api/stock-alerts/hold-watch", {
    method: "POST",
    headers,
    body: JSON.stringify({ inventoryItemId, email: email ?? "" }),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok || !body?.ok) {
    throw new Error(body?.message || "Could not save your request. Please try again.");
  }
  return { status: body.status === "available" ? "available" : "watching" };
}
