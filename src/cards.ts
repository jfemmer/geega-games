import { supabase, isSupabaseConfigured } from "./supabase";
import { storefrontImageUrl } from "./store/lib/cardImages";
import type { Database } from "./types/database";

// ---------------------------------------------------------------------------
// CANONICAL STOREFRONT INVENTORY SOURCE
//
// The public storefront reads the SAME inventory the Admin Dashboard writes.
// The single source of truth is `public.inventory_items`; the storefront reads
// it through the safe `public.inventory_public` view, which:
//   * exposes ONLY storefront-appropriate columns (no cost, storage location,
//     SKU, private notes, or movement history), and
//   * excludes archived rows (status <> 'active') via the view definition, and
//   * is a security_invoker view, so Row Level Security still applies per
//     caller — anonymous visitors only ever see rows with quantity > 0.
//
// There is NO second inventory table and NO mock fallback in this production
// flow. Adding/updating/adjusting/archiving a card in Admin is immediately
// reflected here on the next fetch because both sides use inventory_items.
// ---------------------------------------------------------------------------

type InventoryPublicRow =
  Database["public"]["Views"]["inventory_public"]["Row"];

/**
 * Storefront card shape. Kept backwards-compatible with the previous legacy
 * `cards` shape (id/name/set/type/quantity/image_url/price_usd/condition/foil)
 * so existing components keep working, while adding richer, exact-printing
 * fields (finish, setName, collectorNumber, rarity, scryfallId) for future UI.
 *
 * `id` is now the inventory_items UUID (string) rather than a legacy integer.
 * It is only used as a stable React key on the storefront.
 */
export type Card = {
  id: string;
  name: string;
  /** Set code (e.g. "MH2"). Named `set` for backwards compatibility. */
  set: string | null;
  setName: string | null;
  collectorNumber: string | null;
  type: string | null;
  rarity: string | null;
  quantity: number;
  image_url: string | null;
  price_usd: number;
  condition: string;
  /** Exact finish from the model (nonfoil/foil/etched/…). */
  finish: string;
  /** Legacy boolean derived from finish, for existing visual foil effects. */
  foil: boolean;
  scryfallId: string | null;
};

export { CONDITION_LABELS } from "./store/lib/conditionLabels";

// The Scryfall image helpers live in a pure module so server code can share
// them (this file creates the browser Supabase client, which a function can't
// load). Re-exported here for the storefront's existing imports.
export { scryfallImageAtSize, scryfallSrcSet, storefrontImageUrl } from "./store/lib/cardImages";

/** Any finish other than plain nonfoil gets the legacy "foil" visual treatment. */
function finishIsFoilLike(finish: string | null): boolean {
  return !!finish && finish !== "nonfoil";
}

/**
 * The SELLABLE quantity of an inventory line: physical on-hand minus the sum of
 * ACTIVE reservation quantities, floored at zero. This mirrors the semantics of
 * the `inventory_public` view (which does the same subtraction in SQL) and is
 * exported so the invariant is unit-testable: reserved copies are NEVER counted
 * as available on the storefront.
 */
export function sellableQuantity(
  onHand: number,
  activeReservedQuantity: number,
): number {
  return Math.max(0, onHand - Math.max(0, activeReservedQuantity));
}

/** Pure transform of an inventory_public row → storefront Card. Exported for tests. */
export function mapInventoryPublicRow(row: InventoryPublicRow): Card {
  const priceCents = row.price_cents ?? 0;
  return {
    id: row.id ?? crypto.randomUUID(),
    name: row.card_name ?? "Unknown card",
    set: row.set_code ?? null,
    setName: row.set_name ?? null,
    collectorNumber: row.collector_number ?? null,
    type: row.type_line ?? null,
    rarity: row.rarity ?? null,
    quantity: row.quantity ?? 0,
    // Upgrade a legacy Scryfall small/normal URL to the crisp `large` variant
    // for high-DPI display (pure string rewrite; no network). Non-Scryfall URLs
    // pass through unchanged.
    image_url: storefrontImageUrl(row.image_url ?? null),
    price_usd: priceCents / 100,
    condition: row.condition ?? "NM",
    finish: row.finish ?? "nonfoil",
    foil: finishIsFoilLike(row.finish),
    scryfallId: row.scryfall_id ?? null,
  };
}

/**
 * Fetch the public catalog from the canonical inventory view.
 *
 * Ordering is done in the database. Archived and reserved rows are excluded by
 * the view (status = 'active'); the view ALSO filters quantity > 0 server-side,
 * and — belt and braces — this query adds an EXPLICIT `quantity > 0` predicate
 * so an out-of-stock line can never reach the storefront even if the view
 * definition drifts. This is defensive at the DATA layer, not merely hidden in
 * React/CSS. Errors are surfaced (never swallowed) so the UI can distinguish a
 * load failure from an empty store.
 */
export async function fetchCards(): Promise<Card[]> {
  if (!isSupabaseConfigured) {
    throw new Error("The catalog isn’t configured yet. Please try again later.");
  }

  const { data, error } = await supabase
    .from("inventory_public")
    .select(
      "id, card_name, set_code, set_name, collector_number, type_line, rarity, quantity, image_url, price_cents, condition, finish, scryfall_id",
    )
    .gt("quantity", 0)
    .order("card_name", { ascending: true });

  if (error) throw new Error(error.message);
  return ((data ?? []) as InventoryPublicRow[]).map(mapInventoryPublicRow);
}