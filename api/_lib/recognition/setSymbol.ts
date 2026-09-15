import sharp from "sharp";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../../../src/types/database.js";
import { scryfallSet } from "../scryfall.js";
import { computeImageHash, hashDistance, hashSimilarity, type ImageHash } from "./imageHash.js";
import { cropRegion } from "./imageRegions.js";
import { RECOGNITION_THRESHOLDS } from "./config.js";

// Set-symbol recognition (Part 6.5). Crops the symbol region from the
// scanned card, compares it (by SHAPE, not color — see imageHash.ts's
// grayscale conversion) against a cached library of Scryfall's set icon
// SVGs. Scryfall colors a printed symbol by rarity (black/silver/gold/
// orange-red) but ships icon_svg_uri as a single-tone outline, so shape-only
// (grayscale) comparison is the right signal, exactly per Part 6.5's "should
// be able to compare shape independently of color".
//
// This is a CROSS-CHECK, not the primary identifier for modern cards (set
// code + collector number is stronger there) — but for pre-Exodus/vintage
// cards with no printed set code at all, it becomes one of the few
// machine-readable signals available (Part 7).

type Admin = SupabaseClient<Database>;

async function getOrComputeSetSymbolHash(
  admin: Admin,
  setCode: string,
): Promise<ImageHash | null> {
  const code = setCode.toLowerCase();
  const { data: cached } = await admin
    .from("scryfall_set_symbol_cache")
    .select("hash")
    .eq("set_code", code)
    .maybeSingle();
  if (cached) return BigInt(cached.hash);

  let set: { icon_svg_uri: string };
  try {
    set = await scryfallSet(code);
  } catch {
    return null;
  }
  if (!set.icon_svg_uri) return null;

  let svgRes: Response;
  try {
    svgRes = await fetch(set.icon_svg_uri);
  } catch {
    return null;
  }
  if (!svgRes.ok) return null;
  const svgBuffer = Buffer.from(await svgRes.arrayBuffer());

  // sharp rasterizes SVG input directly (via librsvg) — render on a white
  // background at a fixed size so the hash is comparable to the scanned
  // crop regardless of the SVG's native viewBox size.
  const raster = await sharp(svgBuffer)
    .resize(64, 64, { fit: "contain", background: { r: 255, g: 255, b: 255, alpha: 1 } })
    .flatten({ background: { r: 255, g: 255, b: 255 } })
    .png()
    .toBuffer();
  const hash = await computeImageHash(raster);

  await admin
    .from("scryfall_set_symbol_cache")
    .upsert(
      { set_code: code, icon_svg_uri: set.icon_svg_uri, hash: hash.toString() },
      { onConflict: "set_code" },
    )
    .then(
      () => {},
      () => {},
    );

  return hash;
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
 * Crop the set-symbol region from a normalized card and match it (by shape)
 * against a set of CANDIDATE set codes (typically the sets already in play
 * from OCR/collector-number candidate generation — matching against EVERY
 * Magic set ever printed for every scan would be needlessly slow, and the
 * candidate list from other signals already narrows this considerably).
 */
export async function matchSetSymbol(
  admin: Admin,
  normalizedCard: Buffer,
  width: number,
  height: number,
  candidateSetCodes: string[],
): Promise<SetSymbolResult> {
  const crop = await cropRegion(normalizedCard, width, height, "setSymbol");
  const cropHash = await computeImageHash(crop);
  const cropDebugPng = crop.toString("base64");

  const uniqueCodes = Array.from(new Set(candidateSetCodes.map((c) => c.toUpperCase())));
  const matches: SetSymbolMatch[] = [];

  for (const code of uniqueCodes) {
    const refHash = await getOrComputeSetSymbolHash(admin, code);
    if (refHash === null) continue;
    const distance = hashDistance(cropHash, refHash);
    if (distance > RECOGNITION_THRESHOLDS.setSymbolMaxHashDistance) continue;
    matches.push({ setCode: code, confidence: hashSimilarity(distance) });
  }

  matches.sort((a, b) => b.confidence - a.confidence);
  return {
    best: matches[0] ?? null,
    alternates: matches.slice(1, 4),
    cropDebugPng,
  };
}
