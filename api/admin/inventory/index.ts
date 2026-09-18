import type { VercelRequest, VercelResponse } from "@vercel/node";
import {
  HttpError,
  methodNotAllowed,
  readJsonBody,
  sendJson,
} from "../../_lib/http.js";
import { requireStaff, type StaffContext } from "../../_lib/adminAuth.js";
import { getSupabaseAdmin } from "../../_lib/supabaseAdmin.js";
import { scryfallResolveExact } from "../../_lib/scryfall.js";
import { cachePrinting, type InventoryRow } from "../../_lib/inventory.js";
import { primaryImageUrl } from "../../../src/admin/services/scryfall.js";
import type { Database } from "../../../src/types/database.js";

// POST /api/admin/inventory
//
// Create (or increment) a sellable inventory line from an exact Scryfall
// printing. This is the privileged write behind the Admin "Add Inventory"
// drawer. It:
//   1. verifies the caller is staff (requireStaff),
//   2. resolves the EXACT printing from Scryfall (id preferred, else
//      set+collector+name+finish) so the cached printing + stored image are
//      correct — never a guessed match,
//   3. caches the printing in card_printings,
//   4. calls admin_upsert_inventory() which, in ONE transaction, either
//      increments the matching active line (scryfall_id/legacy identity +
//      condition + finish) or inserts a new one, and writes the movement.
//
// The service-role key is used only here on the server; it is never exposed to
// the browser. Returns the resulting inventory_items row.

interface Body {
  scryfallId?: string | null;
  cardName?: string;
  setCode?: string;
  setName?: string | null;
  collectorNumber?: string;
  rarity?: string | null;
  cardType?: string | null;
  imageUrl?: string | null;
  condition?: string;
  finish?: string;
  quantity?: number;
  priceCents?: number;
  costCents?: number | null;
  scryfallPriceCents?: number | null;
  storageLocation?: string | null;
  sku?: string | null;
  notes?: string | null;
  variantType?: string | null;
  language?: string | null;
  storefrontPlacement?: "main" | "deals";
  dealDiscountPercent?: number | null;
  actor?: string | null;
}

const CONDITIONS = new Set(["NM", "LP", "MP", "HP", "DMG"]);

function actorLabel(staff: StaffContext, bodyActor?: string | null): string {
  return (bodyActor && bodyActor.trim()) || staff.email || staff.userId;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return methodNotAllowed(res, ["POST"]);
  try {
    const staff = await requireStaff(req);
    const body = (await readJsonBody(req)) as Body;

    const quantity = Math.floor(Number(body.quantity));
    if (!Number.isFinite(quantity) || quantity < 1) {
      throw new HttpError(400, "Quantity must be a whole number of at least 1.");
    }
    const condition = String(body.condition ?? "").toUpperCase();
    if (!CONDITIONS.has(condition)) {
      throw new HttpError(400, "A valid condition is required.");
    }
    const finish = String(body.finish ?? "nonfoil");
    const priceCents = Math.max(0, Math.round(Number(body.priceCents) || 0));

    const admin = getSupabaseAdmin();

    // Resolve the exact printing so the cache + stored image are accurate. We
    // pass every identity signal; the resolver returns null rather than guess.
    const card = await scryfallResolveExact({
      scryfallId: body.scryfallId ?? null,
      cardName: body.cardName ?? null,
      setCode: body.setCode ?? null,
      collectorNumber: body.collectorNumber ?? null,
      finish,
    });

    if (card) {
      await cachePrinting(admin, card);
    }

    // Prefer resolved Scryfall values; fall back to what the client supplied.
    const scryfallId = card?.id ?? body.scryfallId ?? null;
    const imageUrl = card ? primaryImageUrl(card) : (body.imageUrl ?? null);
    const setCode = (card?.set ?? body.setCode ?? "").toUpperCase();
    const collectorNumber = card?.collector_number ?? body.collectorNumber ?? "";

    if (!body.cardName && !card) {
      throw new HttpError(400, "A card name or resolvable printing is required.");
    }

    // The generated RPC arg types mark params without a SQL default as
    // non-null, but the SQL columns accept null (scryfall_id, oracle_id, etc.).
    // We build the real args (nulls included) and cast to the arg type so the
    // correct values reach Postgres.
    const upsertArgs = {
      p_scryfall_id: scryfallId,
      p_oracle_id: card?.oracle_id ?? null,
      p_card_name: card?.name ?? body.cardName ?? "",
      p_set_code: setCode,
      p_set_name: card?.set_name ?? body.setName ?? null,
      p_collector_number: collectorNumber,
      p_rarity: card?.rarity ?? body.rarity ?? null,
      p_type_line: card?.type_line ?? body.cardType ?? null,
      p_image_url: imageUrl,
      p_condition: condition as InventoryRow["condition"],
      p_finish: finish as InventoryRow["finish"],
      p_quantity: quantity,
      p_price_cents: priceCents,
      p_cost_cents:
        body.costCents == null ? null : Math.max(0, Math.round(body.costCents)),
      p_scryfall_price_cents: body.scryfallPriceCents ?? null,
      p_storage_location: body.storageLocation ?? null,
      p_sku: body.sku ?? null,
      p_notes: body.notes ?? null,
      p_variant_type: body.variantType ?? "",
      p_language: body.language ?? "en",
      p_actor: actorLabel(staff, body.actor),
    } as Database["public"]["Functions"]["admin_upsert_inventory"]["Args"];

    const { data, error } = await admin.rpc("admin_upsert_inventory", upsertArgs);

    if (error) throw new HttpError(500, error.message);

    const row = data as unknown as InventoryRow;
    const placement = body.storefrontPlacement ?? "main";
    if (placement !== "main" && placement !== "deals") {
      throw new HttpError(400, "Invalid storefront placement.");
    }

    const price = row.price_cents ?? priceCents;
    const update: Database["public"]["Tables"]["inventory_items"]["Update"] = {};

    if (placement === "deals") {
      const discount = Math.max(
        1,
        Math.min(90, Math.round(Number(body.dealDiscountPercent ?? 20))),
      );
      const regularPrice =
        row.is_deal && row.original_price_cents != null
          ? row.original_price_cents
          : price;
      update.original_price_cents = regularPrice;
      update.price_cents = Math.max(1, Math.round(regularPrice * (100 - discount) / 100));
      update.is_deal = true;
      update.deal_source = "manual";
      update.deal_discount_percent = discount;
      update.deal_started_at = new Date().toISOString();
    } else if (row.is_deal) {
      update.price_cents = row.original_price_cents ?? price;
      update.is_deal = false;
      update.deal_source = null;
      update.original_price_cents = null;
      update.deal_discount_percent = null;
      update.deal_started_at = null;
    }

    if (Object.keys(update).length > 0) {
      const { data: updated, error: updateErr } = await admin
        .from("inventory_items")
        .update(update)
        .eq("id", row.id)
        .select("*")
        .single();
      if (updateErr) throw new HttpError(500, "Could not apply storefront placement.");
      return sendJson(res, 200, updated as unknown as Record<string, unknown>);
    }

    return sendJson(res, 200, row as unknown as Record<string, unknown>);
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 500;
    const message =
      err instanceof HttpError ? err.message : "Unexpected server error.";
    return sendJson(res, status, { ok: false, message });
  }
}