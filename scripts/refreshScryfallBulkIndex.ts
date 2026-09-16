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
const UPSERT_BATCH_SIZE = 200;
const MIN_BATCH_SIZE = 10;
const MAX_RETRIES_PER_BATCH = 3;
const RETRY_BASE_DELAY_MS = 500;

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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

type BulkCardRow = Database["public"]["Tables"]["scryfall_bulk_cards"]["Insert"];

/**
 * Upsert one batch, retrying transient failures with backoff. A statement
 * timeout specifically (seen in practice around row ~96,500 of a full
 * refresh — likely index-maintenance cost on the card_name trigram index
 * compounding as the table grows) gets a different response: halve the
 * batch and retry each half, recursively, rather than just retrying the
 * same oversized batch again. Only throws once even a MIN_BATCH_SIZE batch
 * still fails — at that point it's a real error, not a size problem.
 */
async function upsertBatch(
  admin: ReturnType<typeof createClient<Database>>,
  batch: BulkCardRow[],
): Promise<number> {
  for (let attempt = 0; attempt <= MAX_RETRIES_PER_BATCH; attempt++) {
    const { error } = await admin
      .from("scryfall_bulk_cards")
      .upsert(batch, { onConflict: "scryfall_id" });
    if (!error) return batch.length;

    const isTimeout = /timeout/i.test(error.message);
    if (isTimeout && batch.length > MIN_BATCH_SIZE) {
      console.log(`  Batch of ${batch.length} timed out — splitting in half and retrying...`);
      // Sequential, not concurrent — two upserts racing against the same
      // table is exactly the kind of added contention that could make a
      // timeout more likely, not less.
      const mid = Math.ceil(batch.length / 2);
      const first = await upsertBatch(admin, batch.slice(0, mid));
      const second = await upsertBatch(admin, batch.slice(mid));
      return first + second;
    }
    if (attempt < MAX_RETRIES_PER_BATCH) {
      await sleep(RETRY_BASE_DELAY_MS * 2 ** attempt);
      continue;
    }
    throw new Error(
      `Upsert failed after ${MAX_RETRIES_PER_BATCH + 1} attempt(s) on a batch of ${batch.length}: ${error.message}`,
    );
  }
  // Unreachable (the loop above always returns or throws) — satisfies
  // TypeScript's control-flow analysis.
  throw new Error("Upsert failed: exhausted retries without a result.");
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
  // Loaded fully into memory as a Buffer — acceptable for a one-off/CI
  // script. The download itself is a literal gzip file (not HTTP
  // content-encoding), so it needs an explicit gunzip before use. Decompressed,
  // default_cards is 500MB+ of text — well past V8's ~512MB max string
  // length, so each line is converted to a string individually rather than
  // calling .toString() on the whole buffer at once.
  const compressed = Buffer.from(await dataRes.arrayBuffer());
  const decompressed = gunzipSync(compressed);
  const cards: ScryfallCard[] = [];
  for (let start = 0; start < decompressed.length; ) {
    let end = decompressed.indexOf(0x0a, start); // next '\n'
    if (end === -1) end = decompressed.length;
    if (end > start) {
      const line = decompressed.toString("utf8", start, end);
      if (line.trim().length > 0) {
        cards.push(JSON.parse(line) as ScryfallCard);
      }
    }
    start = end + 1;
  }
  console.log(`Downloaded ${cards.length} printings. Upserting...`);

  let upserted = 0;
  let skipped = 0;
  const rows = cards.map(toRow).filter((r) => r !== null);
  skipped = cards.length - rows.length;

  let batchIndex = 0;
  for (let i = 0; i < rows.length; i += UPSERT_BATCH_SIZE) {
    const batch = rows.slice(i, i + UPSERT_BATCH_SIZE);
    try {
      upserted += await upsertBatch(admin, batch);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`Upsert failed at rows ${i}-${i + batch.length}: ${message}`);
    }
    batchIndex += 1;
    const isLastBatch = i + UPSERT_BATCH_SIZE >= rows.length;
    // Roughly every 5000 rows (25 batches of 200), regardless of exactly
    // how "upserted" landed — a mid-batch split can make it skip a round
    // number, so this counts loop iterations instead.
    if (batchIndex % 25 === 0 || isLastBatch) {
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
