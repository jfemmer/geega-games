import type { VercelRequest, VercelResponse } from "@vercel/node";
import {
  HttpError,
  methodNotAllowed,
  readJsonBody,
  sendJson,
} from "../../_lib/http.js";
import { requireStaff } from "../../_lib/adminAuth.js";
import { getSupabaseAdmin } from "../../_lib/supabaseAdmin.js";
import { scryfallResolveExact } from "../../_lib/scryfall.js";
import { cachePrinting } from "../../_lib/inventory.js";
import {
  normalizeScryfallCard,
  primaryImageUrl,
} from "../../../src/admin/services/scryfall.js";
import type { ScryfallCard } from "../../../src/admin/services/scryfall.types.js";

// POST /api/admin/inventory/backfill-images
//
// Re-runnable enrichment of inventory rows that lack real Scryfall imagery OR
// carry a LOW-RESOLUTION Scryfall image. For each candidate it resolves the
// EXACT printing (existing scryfall_id preferred, else set_code +
// collector_number + name + finish), caches the printing in card_printings, and
// writes the high-quality image_url (large) + scryfall_id + reference price back
// onto the inventory row. Resolution always uses the exact scryfall_id/printing,
// never a name-only lookup, so artwork can't drift to a different printing.
//
// Now runs against the LIVE schema with the generated Database types (no loose
// casts): both inventory_items and card_printings exist and are typed.
//
// Safe to run repeatedly: rows that already have a real, HIGH-QUALITY (large or
// png) Scryfall image AND a scryfall_id are skipped. Processed in bounded
// batches. Respects Scryfall rate limits with a small delay between lookups.
//
// Body (all optional): { "limit": 50, "dryRun": false }

interface Body {
  limit?: number;
  dryRun?: boolean;
}

const SCRYFALL_DELAY_MS = 120; // ~8 req/s, within Scryfall's guidance

/** A real image is an http(s) URL. Placeholders/data-URIs/relative paths fail. */
export function hasRealImage(url: string | null): boolean {
  return !!url && /^https?:\/\//i.test(url);
}

/**
 * Hosts Scryfall serves card images from (size is a path segment). Kept in sync
 * with the storefront upgrade helper in src/cards.ts.
 */
const SCRYFALL_IMAGE_HOSTS = new Set([
  "cards.scryfall.io",
  "c1.scryfall.com",
  "c2.scryfall.com",
  "c3.scryfall.com",
  "img.scryfall.com",
]);

/**
 * True when a URL is a Scryfall image at a LOW-resolution tier (small/normal)
 * that should be upgraded to `large`. Pure + exported for unit tests. A `large`
 * or `png` Scryfall URL, or any non-Scryfall http image, is NOT low-res.
 */
export function isLowResScryfallImage(url: string | null): boolean {
  if (!hasRealImage(url)) return false;
  try {
    const u = new URL(url as string);
    if (!SCRYFALL_IMAGE_HOSTS.has(u.hostname)) return false;
    const parts = u.pathname.split("/");
    return parts.includes("small") || parts.includes("normal");
  } catch {
    return false;
  }
}

/**
 * Whether an inventory row needs image repair OR a resolution upgrade. Exported
 * + pure so the exact rule is unit-tested independently of Supabase. A row is a
 * candidate when it lacks a scryfall_id, lacks a real (http) image, OR carries a
 * low-resolution Scryfall image that can be upgraded to `large`.
 */
export function needsImageRepair(row: {
  scryfall_id: string | null;
  image_url: string | null;
}): boolean {
  return (
    !row.scryfall_id ||
    !hasRealImage(row.image_url) ||
    isLowResScryfallImage(row.image_url)
  );
}

/**
 * The PostgREST `or` filter string used to surface candidate rows at the DB
 * level. Exported so a test can assert the clauses are present. Includes the
 * low-res upgrade clauses (small/normal Scryfall URLs) alongside the
 * missing/placeholder clauses so an existing `/normal/` image is discoverable.
 */
export const BACKFILL_CANDIDATE_OR_FILTER =
  "scryfall_id.is.null,image_url.is.null,image_url.not.ilike.http%,image_url.ilike.%/small/%,image_url.ilike.%/normal/%";

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
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

    const admin = getSupabaseAdmin();

    // Candidates: non-archived rows that lack a scryfall_id OR whose image_url
    // is missing / not a real http(s) Scryfall image.
    const { data, error } = await admin
      .from("inventory_items")
      .select(
        "id, scryfall_id, card_name, set_code, collector_number, finish, image_url",
      )
      .neq("status", "archived")
      .or(BACKFILL_CANDIDATE_OR_FILTER)
      .limit(limit);

    if (error) throw new HttpError(500, `Query failed: ${error.message}`);

    const rows = data ?? [];
    const candidates = rows.filter(needsImageRepair);

    let updated = 0;
    let skipped = 0;
    let failed = 0;
    const failures: { id: string; reason: string }[] = [];

    for (const row of candidates) {
      try {
        const card: ScryfallCard | null = await scryfallResolveExact({
          scryfallId: row.scryfall_id,
          cardName: row.card_name,
          setCode: row.set_code,
          collectorNumber: row.collector_number,
          finish: row.finish,
        });
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
              scryfall_price_cents: normalizeScryfallCard(card).scryfallPriceCents,
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
      moreRemaining: candidates.length === limit,
    });
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 500;
    const message =
      err instanceof HttpError ? err.message : "Unexpected server error.";
    return sendJson(res, status, { ok: false, message });
  }
}