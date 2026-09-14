import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../../src/types/database.js";
import {
  normalizeScryfallCard,
  primaryImageUrl,
} from "../../src/admin/services/scryfall.js";
import type { ScryfallCard } from "../../src/admin/services/scryfall.types.js";

// Server-side inventory helpers shared by the /api/admin/inventory/* functions.
//
// Writes go through the SECURITY DEFINER RPCs (admin_upsert_inventory,
// admin_adjust_inventory_quantity, admin_set_inventory_status) so the quantity
// change and the movement-ledger row are always written in ONE transaction —
// they can never diverge. The service-role client is used, but the RPCs still
// enforce is_staff(), and the calling function has already run requireStaff().

type Admin = SupabaseClient<Database>;

export type InventoryRow = Database["public"]["Tables"]["inventory_items"]["Row"];

/** Upsert a normalized Scryfall printing into the card_printings cache. */
export async function cachePrinting(
  admin: Admin,
  card: ScryfallCard,
): Promise<void> {
  const p = normalizeScryfallCard(card);
  await admin.from("card_printings").upsert(
    {
      scryfall_id: p.scryfallId,
      oracle_id: p.oracleId,
      card_name: p.cardName,
      set_code: p.setCode,
      set_name: p.setName,
      collector_number: p.collectorNumber,
      rarity: p.rarity,
      card_type: p.cardType,
      layout: p.layout,
      artist: p.artist,
      released_at: p.releasedAt,
      language: p.language,
      frame: p.frame,
      frame_effects: p.frameEffects,
      border_color: p.borderColor,
      full_art: p.fullArt,
      textless: p.textless,
      promo: p.promo,
      promo_types: p.promoTypes,
      treatments: p.treatments,
      available_finishes: p.availableFinishes,
      images: p.images as unknown as Database["public"]["Tables"]["card_printings"]["Insert"]["images"],
      faces: p.faces as unknown as Database["public"]["Tables"]["card_printings"]["Insert"]["faces"],
      price_usd_cents: p.prices.usd,
      price_usd_foil_cents: p.prices.usdFoil,
      price_usd_etched_cents: p.prices.usdEtched,
      prices_updated_at: new Date().toISOString(),
    },
    { onConflict: "scryfall_id" },
  );
}

/* ------------------------------------------------------------------ *
 * Historical-safety check for permanent deletion
 * ------------------------------------------------------------------ *
 *
 * inventory_items is referenced by several tables. Permanent deletion is only
 * safe when NO business/history record points at the row:
 *   - order_items.inventory_item_id      (historical orders — must never dangle)
 *   - cart_items.inventory_item_id       (a live cart holds this line)
 *   - scanner_review_queue.created_inventory_item_id (scan provenance)
 * inventory_movements has ON DELETE CASCADE, so its rows are removed WITH the
 * item by design (the ledger for a deleted line has no independent meaning).
 *
 * Returns the list of blocking references (empty when deletion is safe).
 */
export interface DeleteBlocker {
  table: string;
  count: number;
}

export async function inventoryDeleteBlockers(
  admin: Admin,
  id: string,
): Promise<DeleteBlocker[]> {
  const blockers: DeleteBlocker[] = [];

  const orderItems = await admin
    .from("order_items")
    .select("id", { count: "exact", head: true })
    .eq("inventory_item_id", id);
  if (orderItems.error) throw new Error(orderItems.error.message);
  if ((orderItems.count ?? 0) > 0)
    blockers.push({ table: "orders", count: orderItems.count ?? 0 });

  const cartItems = await admin
    .from("cart_items")
    .select("id", { count: "exact", head: true })
    .eq("inventory_item_id", id);
  if (cartItems.error) throw new Error(cartItems.error.message);
  if ((cartItems.count ?? 0) > 0)
    blockers.push({ table: "carts", count: cartItems.count ?? 0 });

  const scanQueue = await admin
    .from("scanner_review_queue")
    .select("id", { count: "exact", head: true })
    .eq("created_inventory_item_id", id);
  if (scanQueue.error) throw new Error(scanQueue.error.message);
  if ((scanQueue.count ?? 0) > 0)
    blockers.push({ table: "scans", count: scanQueue.count ?? 0 });

  return blockers;
}

/* ------------------------------------------------------------------ *
 * Exact-printing metadata derived from a resolved Scryfall card
 * ------------------------------------------------------------------ *
 *
 * The single place that maps a resolved ScryfallCard to the denormalized
 * columns an inventory_items row carries, so an edit that CHANGES the printing
 * updates ALL of them together (never leaving the image from one printing with
 * the id/set/collector of another). Used by the PATCH printing-edit path.
 */
export interface InventoryPrintingColumns {
  scryfall_id: string;
  oracle_id: string | null;
  card_name: string;
  set_code: string;
  set_name: string | null;
  collector_number: string;
  rarity: string | null;
  type_line: string | null;
  image_url: string;
  scryfall_price_cents: number | null;
  language: string;
}

/** Available finishes (Geega-supported) for a resolved Scryfall printing. */
export function availableFinishesForCard(
  card: ScryfallCard,
): Database["public"]["Enums"]["card_finish"][] {
  return normalizeScryfallCard(card).availableFinishes;
}

/** Build the denormalized printing columns from a resolved Scryfall card. */
export function printingColumnsFromCard(
  card: ScryfallCard,
): InventoryPrintingColumns {
  const p = normalizeScryfallCard(card);
  return {
    scryfall_id: p.scryfallId,
    oracle_id: p.oracleId,
    card_name: p.cardName,
    set_code: p.setCode,
    set_name: p.setName,
    collector_number: p.collectorNumber,
    rarity: p.rarity,
    type_line: p.cardType,
    image_url: primaryImageUrl(card),
    scryfall_price_cents: p.prices.usd,
    language: p.language ?? "en",
  };
}