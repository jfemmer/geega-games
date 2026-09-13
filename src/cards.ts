import { supabase, isSupabaseConfigured } from "./supabase";
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

export const CONDITION_LABELS: Record<string, string> = {
  NM: "Near Mint",
  LP: "Lightly Played",
  MP: "Moderately Played",
  HP: "Heavily Played",
  DMG: "Damaged",
};

/** Any finish other than plain nonfoil gets the legacy "foil" visual treatment. */
function finishIsFoilLike(finish: string | null): boolean {
  return !!finish && finish !== "nonfoil";
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
    image_url: row.image_url ?? null,
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
 * Ordering is done in the database. Archived items are excluded by the view;
 * out-of-stock items are excluded by RLS for anonymous visitors. Errors are
 * surfaced (never swallowed) so the UI can distinguish a load failure from an
 * empty store.
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
    .order("card_name", { ascending: true });

  if (error) throw new Error(error.message);
  return ((data ?? []) as InventoryPublicRow[]).map(mapInventoryPublicRow);
}