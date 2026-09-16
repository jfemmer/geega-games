#!/usr/bin/env node
// Refresh public.scryfall_bulk_cards from Scryfall's bulk "default_cards"
// dataset — every printing (all sets, promos, languages), not just what's in
// inventory. This is what lets the recognition pipeline generate candidate
// printings from OCR'd set code / collector number / name WITHOUT a live
// Scryfall HTTP call per card.
//
// Run manually (`npm run scryfall:refresh`) or on a schedule via CI — this is
// deliberately a standalone script, not a Vercel Function: the bulk-data file
// is 100+ MB / ~100k+ rows, well beyond a serverless function's practical
// execution budget, and re-running it is always safe (upsert on scryfall_id).
//
// Requires SUPABASE_URL and SUPABASE_SECRET_KEY in the environment (the same
// server-only service-role credentials api/_lib uses — .env is loaded if
// present, but nothing here is ever bundled into the browser).

import "dotenv/config";
import { gunzipSync } from "node:zlib";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "../src/types/database.js";
import type { ScryfallCard } from "../src/admin/services/scryfall.types.js";

const BULK_DATA_INDEX_URL = "https://api.scryfall.com/bulk-data";
const USER_AGENT = "GeegaGames/1.0 (+https://geega-games.com)";
const UPSERT_BATCH_SIZE = 500;

// Scryfall's bulk-data files are now gzip-compressed JSON Lines (one card
// object per line), served from jsonl_download_uri — not the plain JSON
// array at download_uri this script originally targeted. Confirmed live
// against api.scryfall.com on 2026-09-16; update this shape again if
// Scryfall changes it further.
interface BulkDataEntry {
  type: string;
  jsonl_download_uri: string;
  updated_at: string;
  compressed_size: number;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value || value.trim() === "") {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function toRow(
  card: ScryfallCard,
): Database["public"]["Tables"]["scryfall_bulk_cards"]["Insert"] | null {
  // Tokens, art series, and other non-card objects don't carry the fields we
  // index on — skip rather than insert a garbage row.
  if (!card.id || !card.set || !card.collector_number || !card.name) return null;
  return {
    scryfall_id: card.id,
    oracle_id: card.oracle_id ?? null,
    card_name: card.name,
    printed_name: card.printed_name ?? null,
    set_code: card.set.toUpperCase(),
    set_name: card.set_name,
    collector_number: card.collector_number,
    lang: card.lang ?? "en",
    layout: card.layout ?? null,
    rarity: card.rarity ?? null,
    released_at: card.released_at ?? null,
    frame: card.frame ?? null,
    frame_effects: card.frame_effects ?? [],
    border_color: card.border_color ?? null,
    full_art: card.full_art ?? false,
    textless: card.textless ?? false,
    promo: card.promo ?? false,
    promo_types: card.promo_types ?? [],
    variation: card.variation ?? false,
    finishes: card.finishes ?? [],
    raw: card as unknown as Database["public"]["Tables"]["scryfall_bulk_cards"]["Insert"]["raw"],
    bulk_updated_at: new Date().toISOString(),
  };
}

async function main() {
  const supabaseUrl = requireEnv("SUPABASE_URL");
  const supabaseSecretKey = requireEnv("SUPABASE_SECRET_KEY");
  const admin = createClient<Database>(supabaseUrl, supabaseSecretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  console.log("Looking up the current default_cards bulk data file...");
  const indexRes = await fetch(BULK_DATA_INDEX_URL, {
    headers: { Accept: "application/json", "User-Agent": USER_AGENT },
  });
  if (!indexRes.ok) {
    throw new Error(`Scryfall bulk-data index request failed: ${indexRes.status}`);
  }
  const index = (await indexRes.json()) as { data: BulkDataEntry[] };
  const entry = index.data.find((e) => e.type === "default_cards");
  if (!entry) throw new Error("Scryfall bulk-data index has no default_cards entry.");

  console.log(
    `Downloading default_cards (${(entry.compressed_size / 1024 / 1024).toFixed(0)} MB compressed, ` +
      `Scryfall-side updated ${entry.updated_at})...`,
  );
  const dataRes = await fetch(entry.jsonl_download_uri, {
    headers: { "User-Agent": USER_AGENT },
  });
  if (!dataRes.ok) {
    throw new Error(`Scryfall bulk data download failed: ${dataRes.status}`);
  }
  // Loaded fully into memory — acceptable for a one-off/CI script (not a
  // request-scoped serverless function), simpler and more robust than a
  // hand-rolled streaming gunzip/JSONL parser for a file this size. The
  // download itself is a literal gzip file (not HTTP content-encoding), so
  // it needs an explicit gunzip before it's usable text.
  const compressed = Buffer.from(await dataRes.arrayBuffer());
  const decompressed = gunzipSync(compressed).toString("utf8");
  const cards = decompressed
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as ScryfallCard);
  console.log(`Downloaded ${cards.length} printings. Upserting...`);

  let upserted = 0;
  let skipped = 0;
  const rows = cards.map(toRow).filter((r) => r !== null);
  skipped = cards.length - rows.length;

  for (let i = 0; i < rows.length; i += UPSERT_BATCH_SIZE) {
    const batch = rows.slice(i, i + UPSERT_BATCH_SIZE);
    const { error } = await admin
      .from("scryfall_bulk_cards")
      .upsert(batch, { onConflict: "scryfall_id" });
    if (error) {
      throw new Error(
        `Upsert failed at rows ${i}-${i + batch.length}: ${error.message}`,
      );
    }
    upserted += batch.length;
    if (upserted % 5000 === 0 || i + UPSERT_BATCH_SIZE >= rows.length) {
      console.log(`  ${upserted} / ${rows.length} upserted...`);
    }
  }

  console.log(
    `Done. ${upserted} printings upserted, ${skipped} skipped (missing required fields).`,
  );
}

main().catch((err) => {
  console.error("scryfall:refresh failed:", err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
