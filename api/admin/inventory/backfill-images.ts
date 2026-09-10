import type { VercelRequest, VercelResponse } from "@vercel/node";
import {
  HttpError,
  methodNotAllowed,
  readJsonBody,
  sendJson,
} from "../../_lib/http.js";
import { requireStaff } from "../../_lib/adminAuth.js";
import { getSupabaseAdmin } from "../../_lib/supabaseAdmin.js";
import {
  scryfallById,
  scryfallBySetCollector,
} from "../../_lib/scryfall.js";
import {
  normalizeScryfallCard,
  primaryImageUrl,
} from "../../../src/admin/services/scryfall.js";
import type { ScryfallCard } from "../../../src/admin/services/scryfall.types.js";

// POST /api/admin/inventory/backfill-images
//
// One-time (re-runnable) enrichment of inventory rows that lack real Scryfall
// imagery. For each candidate row it resolves the EXACT printing — preferring an
// existing scryfall_id, else set_code + collector_number — upserts the printing
// into card_printings (the on-demand cache), and writes the real image_url +
// scryfall_id back onto the inventory row.
//
// Safe to run repeatedly: rows that already have a real (http) image and a
// scryfall_id are skipped. Processed in bounded batches so a large catalog can
// be walked over several calls. Respects Scryfall rate limits with a small
// delay between lookups.
//
// Body (all optional):
//   { "limit": 50, "dryRun": false }
//
// Returns per-run counts and whether more rows remain.

interface Body {
  limit?: number;
  dryRun?: boolean;
}

interface InventoryRow {
  id: string;
  scryfall_id: string | null;
  set_code: string;
  collector_number: string;
  image_url: string | null;
}

const SCRYFALL_DELAY_MS = 120; // ~8 req/s, within Scryfall's guidance

/** A real image is an http(s) URL. Placeholders/data-URIs/relative paths fail. */
export function hasRealImage(url: string | null): boolean {
  return !!url && /^https?:\/\//i.test(url);
}

/**
 * Whether an inventory row needs image repair. Exported + pure so the exact
 * rule is unit-tested independently of Supabase. A row is a candidate when it
 * lacks a scryfall_id OR lacks a real (http) image — which now includes rows
 * carrying a NON-NULL placeholder/data-URI/malformed image_url that the old
 * DB-only filter used to miss.
 */
export function needsImageRepair(row: {
  scryfall_id: string | null;
  image_url: string | null;
}): boolean {
  return !row.scryfall_id || !hasRealImage(row.image_url);
}

/**
 * The PostgREST `or` filter string used to surface candidate rows at the DB
 * level. Exported so a test can assert the placeholder-catching clause is
 * present (the fix for rows the previous query silently excluded).
 */
export const BACKFILL_CANDIDATE_OR_FILTER =
  "scryfall_id.is.null,image_url.is.null,image_url.not.ilike.http%";

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// The new tables (card_printings, inventory_items, …) are created by the
// scanning migration. Until `src/types/database.ts` is regenerated after that
// migration is applied, the typed client infers `never` for them, so we access
// them through a loosely-typed view. Regenerate types and this cast can go away.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type LooseAdmin = { from: (table: string) => any };

/** Upsert a normalized printing into the card_printings cache. */
async function cachePrinting(
  admin: LooseAdmin,
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
      images: p.images,
      faces: p.faces,
      price_usd_cents: p.prices.usd,
      price_usd_foil_cents: p.prices.usdFoil,
      price_usd_etched_cents: p.prices.usdEtched,
      prices_updated_at: new Date().toISOString(),
    },
    { onConflict: "scryfall_id" },
  );
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    return methodNotAllowed(res, ["POST"]);
  }
  try {
    await requireStaff(req);

    const body = (await readJsonBody(req).catch(() => ({}))) as Body;
    const limit = Math.min(Math.max(Number(body.limit) || 50, 1), 200);
    const dryRun = body.dryRun === true;

    // See LooseAdmin note above: the scanning tables aren't in the generated
    // Database types yet, so use an untyped view for them.
    const admin = getSupabaseAdmin() as unknown as LooseAdmin;

    // Candidates: active rows that lack a scryfall_id OR whose image_url is
    // missing OR is not a real http(s) Scryfall image.
    //
    // IMPORTANT: the previous query used `scryfall_id.is.null,image_url.is.null`
    // only. That could NOT see rows whose image_url is a NON-NULL placeholder
    // (data-URI, blob:, a relative path, etc.) — those rows were excluded by the
    // DB query before the JS hasRealImage() check ever ran, so they could never
    // be repaired. We now also select rows where image_url does NOT start with
    // "http" via a case-insensitive NOT LIKE, so placeholder/malformed images
    // become discoverable. `hasRealImage()` still runs below as a final guard.
    const { data, error } = await admin
      .from("inventory_items")
      .select("id, scryfall_id, set_code, collector_number, image_url")
      .neq("status", "archived")
      .or(BACKFILL_CANDIDATE_OR_FILTER)
      .limit(limit);

    if (error) throw new HttpError(500, `Query failed: ${error.message}`);

    const rows = (data ?? []) as InventoryRow[];
    // Final JS guard. Catches anything the DB filter surfaced, including
    // placeholder/data-URI/relative/malformed image URLs.
    const candidates = rows.filter(needsImageRepair);

    let updated = 0;
    let skipped = 0;
    let failed = 0;
    const failures: { id: string; reason: string }[] = [];

    for (const row of candidates) {
      try {
        let card: ScryfallCard | null = null;
        if (row.scryfall_id) {
          card = await scryfallById(row.scryfall_id);
        } else if (row.set_code && row.collector_number) {
          card = await scryfallBySetCollector(
            row.set_code,
            row.collector_number,
          );
        }
        if (!card) {
          skipped += 1;
          continue;
        }

        if (!dryRun) {
          await cachePrinting(admin, card);
          const { error: upErr } = await admin
            .from("inventory_items")
            .update({
              scryfall_id: card.id,
              image_url: primaryImageUrl(card),
              scryfall_price_cents:
                normalizeScryfallCard(card).scryfallPriceCents,
            })
            .eq("id", row.id);
          if (upErr) throw new Error(upErr.message);
        }
        updated += 1;
        await sleep(SCRYFALL_DELAY_MS);
      } catch (err) {
        failed += 1;
        failures.push({
          id: row.id,
          reason: err instanceof Error ? err.message : "Unknown error",
        });
      }
    }

    return sendJson(res, 200, {
      ok: true,
      dryRun,
      scanned: candidates.length,
      updated,
      skipped,
      failed,
      failures: failures.slice(0, 20),
      // If we filled the batch, more rows likely remain — call again.
      moreRemaining: candidates.length === limit,
    });
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 500;
    const message =
      err instanceof HttpError ? err.message : "Unexpected server error.";
    return sendJson(res, status, { ok: false, message });
  }
}