#!/usr/bin/env node
// Bulk pre-warm public.scryfall_set_symbol_cache with every set Scryfall
// has ever had (~1000 rows) — the foundation of the "set-first" recognition
// pipeline (api/_lib/recognition/setSymbol.ts's identifySetFromSymbol):
// identifying a card's set from its scanned symbol, independent of OCR,
// only works entirely offline (no network call during a real scan) once
// this cache is warm. Left to fill lazily instead, the FIRST scan of each
// new set would pay a live Scryfall fetch (set metadata + SVG icon) before
// it could identify anything — fine occasionally, but works against the
// "1000+ cards/hour" throughput goal this pipeline is built for.
//
// Run manually (`npm run scryfall:refresh-symbols`) or on a schedule
// alongside scryfall:refresh — deliberately a standalone script, not a
// Vercel Function, so a network hiccup partway through never eats into a
// real request's time budget. Safe to re-run any time (upsert on
// set_code): Scryfall adds new sets over time, and re-running picks those
// up without redoing work for sets already cached.
//
// Requires SUPABASE_URL and SUPABASE_SECRET_KEY in the environment (the
// same server-only service-role credentials api/_lib uses — .env is loaded
// if present, but nothing here is ever bundled into the browser).

import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "../src/types/database.js";
import { listAllScryfallSets } from "../api/_lib/scryfall.js";
import { hashSetSymbolSvg } from "../api/_lib/recognition/setSymbol.js";

const USER_AGENT = "GeegaGames/1.0 (+https://geega-games.com)";
// Scryfall asks callers to stay within ~10 requests/second; this is well
// under that even accounting for the small jitter of concurrent fetches.
const CONCURRENCY = 5;
const FETCH_TIMEOUT_MS = 10_000;

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value || value.trim() === "") {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

/** Tiny concurrency-limited map — same pattern used throughout api/_lib
 * (uploader.ts, scan.supabase.ts) for exactly this "bounded parallel work"
 * shape, not a new one invented for this script. */
async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

async function fetchSvg(url: string): Promise<Buffer | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { headers: { "User-Agent": USER_AGENT }, signal: controller.signal });
    if (!res.ok) return null;
    return Buffer.from(await res.arrayBuffer());
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function main() {
  const supabaseUrl = requireEnv("SUPABASE_URL");
  const supabaseSecretKey = requireEnv("SUPABASE_SECRET_KEY");
  const admin = createClient<Database>(supabaseUrl, supabaseSecretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  console.log("Fetching the full set list from Scryfall...");
  const sets = await listAllScryfallSets();
  console.log(`Got ${sets.length} sets.`);

  const { data: existing, error: existingErr } = await admin
    .from("scryfall_set_symbol_cache")
    .select("set_code");
  if (existingErr) throw new Error(`Could not read existing cache: ${existingErr.message}`);
  const alreadyCached = new Set((existing ?? []).map((r) => r.set_code.toLowerCase()));

  const withIcon = sets.filter((s) => s.icon_svg_uri);
  const todo = withIcon.filter((s) => !alreadyCached.has(s.code.toLowerCase()));
  console.log(
    `${withIcon.length} sets have an icon; ${alreadyCached.size} already cached, ${todo.length} to do.`,
  );

  let hashed = 0;
  let failed = 0;
  await mapWithConcurrency(todo, CONCURRENCY, async (set) => {
    const svg = await fetchSvg(set.icon_svg_uri);
    if (!svg) {
      failed += 1;
      console.warn(`  Could not fetch icon for ${set.code}: ${set.icon_svg_uri}`);
      return;
    }
    let hash: bigint;
    try {
      hash = await hashSetSymbolSvg(svg);
    } catch (err) {
      failed += 1;
      console.warn(`  Could not hash icon for ${set.code}: ${err instanceof Error ? err.message : err}`);
      return;
    }
    const { error } = await admin
      .from("scryfall_set_symbol_cache")
      .upsert(
        { set_code: set.code.toLowerCase(), icon_svg_uri: set.icon_svg_uri, hash: hash.toString() },
        { onConflict: "set_code" },
      );
    if (error) {
      failed += 1;
      console.warn(`  Could not save hash for ${set.code}: ${error.message}`);
      return;
    }
    hashed += 1;
    if (hashed % 100 === 0) console.log(`  ${hashed} / ${todo.length} hashed...`);
  });

  console.log(`Done. ${hashed} set symbol(s) hashed and cached, ${failed} failed.`);
}

main().catch((err) => {
  console.error("scryfall:refresh-symbols failed:", err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
