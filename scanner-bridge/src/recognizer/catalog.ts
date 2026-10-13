import type { SupabaseClient } from "@supabase/supabase-js";
import type { CatalogEntry } from "./types.js";

// The list of printings to fingerprint comes from the shop's own copy of
// Scryfall's card data — public.scryfall_bulk_cards, filled by
// `npm run scryfall:refresh` in the main app — read here with the bridge's
// staff sign-in (that table is staff-readable, never writable from here).
// Reading the same table the server checks results against means every
// printing this PC can suggest is one the server knows.

export interface CatalogRow {
  scryfall_id: string;
  card_name: string;
  set_code: string;
  collector_number: string;
  lang: string | null;
  layout: string | null;
  finishes: string[] | null;
  bulk_updated_at: string | null;
  image_uris: { normal?: string | null } | null;
  card_faces: Array<{ illustration_id?: string | null; image_uris?: { normal?: string | null } | null }> | null;
  games: string[] | null;
  illustration_id: string | null;
  oversized: boolean | null;
}

/** Fingerprintable faces of one printing: paper only, not oversized, with a Scryfall image. */
export function entriesFromRow(row: CatalogRow): CatalogEntry[] {
  if (!row.games || !row.games.includes("paper")) return [];
  if (row.oversized) return [];
  const base = {
    id: row.scryfall_id,
    name: row.card_name,
    set: row.set_code.toUpperCase(),
    cn: row.collector_number,
    lang: row.lang ?? "en",
    finishes: row.finishes ?? [],
    layout: row.layout ?? "normal",
  };
  const top = row.image_uris?.normal;
  if (top) {
    return [{ ...base, face: 0, ill: row.illustration_id ?? row.card_faces?.[0]?.illustration_id ?? null, img: top }];
  }
  const faces = row.card_faces ?? [];
  const out: CatalogEntry[] = [];
  faces.forEach((f, i) => {
    const img = f.image_uris?.normal;
    if (img) out.push({ ...base, face: i, ill: f.illustration_id ?? null, img });
  });
  return out;
}

const PAGE_SIZE = 1000;
const SELECT = [
  "scryfall_id",
  "card_name",
  "set_code",
  "collector_number",
  "lang",
  "layout",
  "finishes",
  "bulk_updated_at",
  "image_uris:raw->image_uris",
  "card_faces:raw->card_faces",
  "games:raw->games",
  "illustration_id:raw->>illustration_id",
  "oversized:raw->oversized",
].join(",");

export interface CatalogSnapshot {
  entries: CatalogEntry[];
  /** When the shop's Scryfall card list was last refreshed. */
  refreshedAt: string | null;
  printings: number;
}

/** Pages through scryfall_bulk_cards in id order (keyset pagination — stable under concurrent refreshes). */
export async function fetchCatalog(
  supabase: SupabaseClient,
  onProgress?: (rowsRead: number) => void,
): Promise<CatalogSnapshot> {
  const entries: CatalogEntry[] = [];
  let refreshedAt: string | null = null;
  let printings = 0;
  let last: string | null = null;
  for (;;) {
    let query = supabase.from("scryfall_bulk_cards").select(SELECT).order("scryfall_id").limit(PAGE_SIZE);
    if (last) query = query.gt("scryfall_id", last);
    let rows: CatalogRow[] | null = null;
    let lastError: string | null = null;
    for (let attempt = 0; attempt < 4 && rows === null; attempt++) {
      const { data, error } = await query;
      if (!error) rows = (data ?? []) as unknown as CatalogRow[];
      else {
        lastError = error.message;
        await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
      }
    }
    if (rows === null) throw new Error(`Couldn't read the card list from the database: ${lastError}`);
    for (const row of rows) {
      printings++;
      if (row.bulk_updated_at && (!refreshedAt || row.bulk_updated_at > refreshedAt)) refreshedAt = row.bulk_updated_at;
      entries.push(...entriesFromRow(row));
    }
    onProgress?.(printings);
    if (rows.length < PAGE_SIZE) break;
    last = rows[rows.length - 1].scryfall_id;
  }
  return { entries, refreshedAt, printings };
}

/** Identity of one library entry; changes when Scryfall updates the image. */
export function entryKey(e: Pick<CatalogEntry, "id" | "face" | "img">): string {
  return `${e.id}:${e.face}:${e.img}`;
}
