import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../../../src/types/database.js";
import type { CardPrinting } from "../../../src/admin/types/index.js";
import { computeImageHash, hashDistance, hashSimilarity } from "./imageHash.js";
import { getOrComputeReferenceHash } from "./referenceImageCache.js";
import { cropRegion, REGIONS } from "./imageRegions.js";
import { RECOGNITION_THRESHOLDS } from "./config.js";

// Visual verification of candidate printings (Part 6.4). Compares the
// scanned card against each CANDIDATE's Scryfall reference image on TWO
// signals — full-card structure and art-crop — because the same artwork can
// appear on multiple printings (e.g. a normal and a showcase treatment can
// share art, or differ only in border/frame), so art alone can't pick the
// exact printing; conversely the full-card hash is sensitive to frame/
// border differences that the art crop wouldn't catch. Both signals are
// combined, never just one, per Part 6.4's explicit instruction.

export interface VisualVerification {
  printing: CardPrinting;
  fullCardSimilarity: number;
  artSimilarity: number;
  /** Combined score used for ranking — see combine() below. */
  combinedSimilarity: number;
}

function combine(fullCard: number, art: number): number {
  // Weighted toward the full-card signal: it reflects frame/border/
  // treatment, which is what actually DISTINGUISHES printings that share
  // art. Art similarity alone can't tell a borderless printing from a
  // normal one with the same artwork.
  return fullCard * 0.65 + art * 0.35;
}

async function scanArtCrop(
  normalizedCard: Buffer,
  width: number,
  height: number,
): Promise<Buffer> {
  return cropRegion(normalizedCard, width, height, REGIONS.art);
}

/**
 * Rank candidate printings by visual similarity to the scanned front image.
 * Returns every candidate scored (never filters here) — the caller decides
 * what similarity is "good enough" using RECOGNITION_THRESHOLDS.
 */
export async function verifyCandidatesVisually(
  admin: SupabaseClient<Database>,
  normalizedFront: Buffer,
  width: number,
  height: number,
  candidates: CardPrinting[],
): Promise<VisualVerification[]> {
  const [fullCardScanHash, artCropBuffer] = await Promise.all([
    computeImageHash(normalizedFront),
    scanArtCrop(normalizedFront, width, height),
  ]);
  const artScanHash = await computeImageHash(artCropBuffer);

  const results = await Promise.all(
    candidates.map(async (printing): Promise<VisualVerification | null> => {
      const fullImageUrl = printing.images.large ?? printing.images.normal ?? printing.imageUrl;
      if (!fullImageUrl) return null;

      const fullRefHash = await getOrComputeReferenceHash(
        admin,
        printing.scryfallId,
        "full",
        fullImageUrl,
      );
      if (fullRefHash === null) return null;
      const fullCardSimilarity = hashSimilarity(hashDistance(fullCardScanHash, fullRefHash));

      // Art crop reference: Scryfall's own art_crop image is the direct
      // equivalent of our scanned art-region crop.
      const artImageUrl = printing.images.artCrop;
      let artSimilarity = fullCardSimilarity; // fall back to full-card signal if no art_crop
      if (artImageUrl) {
        const artRefHash = await getOrComputeReferenceHash(
          admin,
          printing.scryfallId,
          "art",
          artImageUrl,
        );
        if (artRefHash !== null) {
          artSimilarity = hashSimilarity(hashDistance(artScanHash, artRefHash));
        }
      }

      return {
        printing,
        fullCardSimilarity,
        artSimilarity,
        combinedSimilarity: combine(fullCardSimilarity, artSimilarity),
      };
    }),
  );

  return results
    .filter((r): r is VisualVerification => r !== null)
    .sort((a, b) => b.combinedSimilarity - a.combinedSimilarity);
}

export function isVisuallyVerified(v: VisualVerification): boolean {
  return v.combinedSimilarity >= RECOGNITION_THRESHOLDS.visualMatchMinSimilarity;
}
