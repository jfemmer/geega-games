import sharp from "sharp";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../../../src/types/database.js";
import { computeImageHash, hashDistance, hashSimilarity, type ImageHash } from "./imageHash.js";
import { cropRegion } from "./imageRegions.js";
import { RECOGNITION_THRESHOLDS } from "./config.js";

// Set-symbol recognition (Part 6.5 / Part 7.1). Crops the symbol region
// from the scanned card, compares it (by SHAPE, not color — see
// imageHash.ts's grayscale conversion) against scryfall_set_symbol_cache, a
// bulk-pre-warmed local mirror of Scryfall's set icon SVGs (see
// scripts/refreshSetSymbolCache.ts). Scryfall colors a printed symbol by
// rarity (black/silver/gold/orange-red) but ships icon_svg_uri as a
// single-tone outline, so shape-only (grayscale) comparison is the right
// signal, exactly per Part 6.5's "should be able to compare shape
// independently of color".
//
// identifySetFromSymbol runs FIRST, independent of OCR — the entry point
// for the "set-first" pipeline: once the set is known, candidate
// generation (pipeline.ts's generateCandidates) can search within that
// ONE set's ~100-400 cards instead of every printing ever made, for every
// signal downstream (collector number, name, or — when OCR finds nothing
// readable at all — visual comparison against the whole set).

type Admin = SupabaseClient<Database>;

/**
 * Rasterize a set-symbol SVG and hash it — the pure computation shared by
 * the per-scan lazy cache fill below AND scripts/refreshSetSymbolCache.ts's
 * bulk pre-warm (so there's exactly one place that decides how a symbol
 * gets turned into a hash, not two implementations that could drift).
 * sharp rasterizes SVG input directly (via librsvg) — render on a white
 * background at a fixed size so the hash is comparable to the scanned crop
 * regardless of the SVG's native viewBox size.
 */
export async function hashSetSymbolSvg(svgBuffer: Buffer): Promise<ImageHash> {
  const raster = await sharp(svgBuffer)
    .resize(64, 64, { fit: "contain", background: { r: 255, g: 255, b: 255, alpha: 1 } })
    .flatten({ background: { r: 255, g: 255, b: 255 } })
    .png()
    .toBuffer();
  return computeImageHash(raster);
}

export interface SetSymbolMatch {
  setCode: string;
  /** 0–1, derived from hash distance. */
  confidence: number;
}

export interface SetSymbolResult {
  best: SetSymbolMatch | null;
  alternates: SetSymbolMatch[];
  /** Base64 PNG of the cropped symbol region, for review-UI debug display. */
  cropDebugPng: string;
}

/**
 * Identify the set from the scanned symbol ALONE, independent of OCR or any
 * other signal — the entry point for the "set-first" pipeline (Part 7.1):
 * scryfall_set_symbol_cache holds every set Scryfall has ever had (~1000
 * rows once scripts/refreshSetSymbolCache.ts has been run; see its own
 * comment for why bulk pre-warming it matters), so comparing the scan
 * against every cached row is still cheap: one small table read plus
 * ~1000 in-memory Hamming-distance comparisons, no network calls on a warm
 * cache. A confident result here lets candidate generation search WITHIN
 * one set's ~100-400 cards (candidatesByName's setCode param, or
 * candidatesBySet for a pure-visual fallback when OCR finds nothing at
 * all) instead of every printing ever made.
 *
 * Deliberately tolerant of a failed/unavailable admin client (catches
 * rather than throws) so a set-symbol lookup problem degrades to "no set
 * identified" and falls through to the existing OCR-driven cascade, the
 * same "never let one signal's failure take down the others" posture
 * every other signal in this pipeline already has.
 */
export async function identifySetFromSymbol(
  admin: Admin,
  normalizedCard: Buffer,
  width: number,
  height: number,
): Promise<SetSymbolResult> {
  const crop = await cropRegion(normalizedCard, width, height, "setSymbol");
  const cropHash = await computeImageHash(crop);
  const cropDebugPng = crop.toString("base64");

  let cachedRows: { set_code: string; hash: string }[] = [];
  try {
    const { data, error } = await admin.from("scryfall_set_symbol_cache").select("set_code, hash");
    if (error || !data) return { best: null, alternates: [], cropDebugPng };
    cachedRows = data;
  } catch {
    return { best: null, alternates: [], cropDebugPng };
  }

  const matches: SetSymbolMatch[] = [];
  for (const row of cachedRows) {
    const distance = hashDistance(cropHash, BigInt(row.hash));
    if (distance > RECOGNITION_THRESHOLDS.setSymbolMaxHashDistance) continue;
    matches.push({ setCode: row.set_code.toUpperCase(), confidence: hashSimilarity(distance) });
  }

  matches.sort((a, b) => b.confidence - a.confidence);
  return {
    best: matches[0] ?? null,
    alternates: matches.slice(1, 4),
    cropDebugPng,
  };
}
