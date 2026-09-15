import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../../../src/types/database.js";
import { computeImageHash, type ImageHash } from "./imageHash.js";

// Cache layer over imageHash.ts's raw primitives — Part 18's "avoid
// repeatedly downloading the same Scryfall images. Cache candidate/
// reference images sensibly." Reads scryfall_image_hash_cache first; only
// downloads + hashes + writes back on a genuine miss.

type Admin = SupabaseClient<Database>;

export async function getOrComputeReferenceHash(
  admin: Admin,
  scryfallId: string,
  region: "full" | "art",
  imageUrl: string,
): Promise<ImageHash | null> {
  const { data: cached } = await admin
    .from("scryfall_image_hash_cache")
    .select("hash")
    .eq("scryfall_id", scryfallId)
    .eq("region", region)
    .maybeSingle();
  if (cached) return BigInt(cached.hash);

  let res: Response;
  try {
    res = await fetch(imageUrl);
  } catch {
    return null;
  }
  if (!res.ok) return null;
  const buf = Buffer.from(await res.arrayBuffer());
  const hash = await computeImageHash(buf);

  // Best-effort write-back; a failed cache write never blocks recognition.
  await admin
    .from("scryfall_image_hash_cache")
    .upsert(
      { scryfall_id: scryfallId, region, hash: hash.toString() },
      { onConflict: "scryfall_id,region" },
    )
    .then(
      () => {},
      () => {},
    );

  return hash;
}
