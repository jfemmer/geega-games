import { supabase, isSupabaseConfigured } from "../../supabase";

// Helpers for "Can't find it?" (CardRequestPanel) under a shop search that
// found nothing.

export interface RequestableCard {
  oracleId: string;
  cardName: string;
  imageUrl: string | null;
}

/** One entry per card (every printing shares an oracle id), in search order. */
export function distinctCards(printings: { oracleId?: string | null; cardName: string; imageUrl: string | null }[]): RequestableCard[] {
  const seen = new Map<string, RequestableCard>();
  for (const p of printings) {
    if (!p.oracleId || seen.has(p.oracleId)) continue;
    seen.set(p.oracleId, { oracleId: p.oracleId, cardName: p.cardName, imageUrl: p.imageUrl });
  }
  return [...seen.values()];
}

/**
 * Which of these cards we have for sale right now (by oracle id), or null
 * when we couldn't check. The shop search matches the text as typed, so a
 * search like "jace mind sculptor" finds nothing even when "Jace, the Mind
 * Sculptor" is in stock; the card lookup finds it, and this tells the panel
 * to link to it instead of offering to email when it's in.
 */
export async function inStockOracleIds(oracleIds: string[]): Promise<Set<string> | null> {
  if (oracleIds.length === 0) return new Set();
  if (!isSupabaseConfigured) return null;
  try {
    const { data, error } = await supabase.from("inventory_public").select("oracle_id").in("oracle_id", oracleIds).limit(500);
    if (error) return null;
    return new Set((data ?? []).flatMap((r) => (r.oracle_id ? [r.oracle_id] : [])));
  } catch {
    return null;
  }
}
