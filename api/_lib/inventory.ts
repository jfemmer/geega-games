import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../../src/types/database.js";
import { normalizeScryfallCard } from "../../src/admin/services/scryfall.js";
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