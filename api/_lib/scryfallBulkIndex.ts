import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../../src/types/database.js";
import { normalizeScryfallCard } from "../../src/admin/services/scryfall.js";
import type { ScryfallCard } from "../../src/admin/services/scryfall.types.js";
import type { CardPrinting } from "../../src/admin/types/index.js";

// Candidate generation against the LOCAL scryfall_bulk_cards cache (see
// supabase/migrations/20260915203500_scryfall_bulk_cards_index.sql) instead
// of a live Scryfall HTTP call per card — the recognition pipeline needs
// this to stay fast and rate-limit-safe at "hundreds of cards per batch"
// volume. Every candidate is built via the EXISTING normalizeScryfallCard()
// from the row's stored raw Scryfall object, so it's identical to what the
// live API would return, not a second parallel normalizer.

type Admin = SupabaseClient<Database>;
type BulkRow = Database["public"]["Tables"]["scryfall_bulk_cards"]["Row"];

function toCardPrinting(row: BulkRow): CardPrinting {
  return normalizeScryfallCard(row.raw as unknown as ScryfallCard);
}

/** Whether the bulk index has been populated at all (vs. never refreshed). */
export async function bulkIndexIsPopulated(admin: Admin): Promise<boolean> {
  const { count, error } = await admin
    .from("scryfall_bulk_cards")
    .select("scryfall_id", { count: "exact", head: true });
  if (error) return false;
  return (count ?? 0) > 0;
}

/**
 * The strongest single signal for a modern (M15+) card: exact set code +
 * collector number, optionally narrowed by language. Collector numbers on
 * Scryfall sometimes carry a suffix (promo "s", showcase "p", etc.) — try
 * the exact string first, then a prefix match so "138" still finds "138a".
 */
export async function candidatesBySetAndCollector(
  admin: Admin,
  setCode: string,
  collectorNumber: string,
  lang?: string,
): Promise<CardPrinting[]> {
  let q = admin
    .from("scryfall_bulk_cards")
    .select("*")
    .eq("set_code", setCode.toUpperCase())
    .eq("collector_number", collectorNumber);
  if (lang) q = q.eq("lang", lang);
  const { data, error } = await q.limit(10);
  if (error || !data || data.length === 0) {
    // Fall back to a prefix match on collector number within the set.
    let q2 = admin
      .from("scryfall_bulk_cards")
      .select("*")
      .eq("set_code", setCode.toUpperCase())
      .like("collector_number", `${collectorNumber}%`);
    if (lang) q2 = q2.eq("lang", lang);
    const fallback = await q2.limit(10);
    if (fallback.error || !fallback.data) return [];
    return fallback.data.map(toCardPrinting);
  }
  return data.map(toCardPrinting);
}

/** All printings in a given set — used when only the set code is confident. */
export async function candidatesBySet(
  admin: Admin,
  setCode: string,
): Promise<CardPrinting[]> {
  const { data, error } = await admin
    .from("scryfall_bulk_cards")
    .select("*")
    .eq("set_code", setCode.toUpperCase())
    .limit(500);
  if (error || !data) return [];
  return data.map(toCardPrinting);
}

/**
 * Fuzzy name search across every printing — real pg_trgm similarity search
 * (search_scryfall_bulk_by_name_trgm, index-accelerated by the existing
 * card_name trigram index), not a substring match. This is the fallback for
 * pre-M15 cards with no machine-readable set code, or when set/collector
 * candidates don't verify — the path most exposed to OCR noise, so it has
 * to tolerate a misread character (Tesseract's classic 0/O, B/8 mix-ups)
 * rather than require an exact substring.
 */
export async function candidatesByName(
  admin: Admin,
  name: string,
  limit = 30,
): Promise<CardPrinting[]> {
  const cleaned = name.trim();
  if (!cleaned) return [];
  const { data, error } = await admin.rpc("search_scryfall_bulk_by_name_trgm", {
    p_name: cleaned,
    p_limit: limit,
  });
  if (error || !data) return [];
  return (data as BulkRow[]).map(toCardPrinting);
}

/** Exact oracle_id match — every printing of the same card (all sets/eras). */
export async function candidatesByOracleId(
  admin: Admin,
  oracleId: string,
): Promise<CardPrinting[]> {
  const { data, error } = await admin
    .from("scryfall_bulk_cards")
    .select("*")
    .eq("oracle_id", oracleId)
    .limit(200);
  if (error || !data) return [];
  return data.map(toCardPrinting);
}
