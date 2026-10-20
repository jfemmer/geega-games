// Admin → Yard Sale Mode. Turning a sale on or off, and changing its
// discount, minimum price or end time, go through the staff-guarded
// /api/admin/yard-sale endpoint (service role, audit-logged); every answer is
// the same snapshot, so the page just shows what came back.

import { adminFetch } from "./apiClient";
import { supabase } from "../../supabase";
import { mapCatalogRow, type CatalogSearchRow } from "../../store/lib/useCatalog";
import { newerCardsSince, pickYardSaleShowcase } from "../utils/yardSaleSign";
import type { YardSaleShowcaseCard, YardSaleSnapshot } from "../types";

const PATH = "/api/admin/yard-sale";

/** search_inventory's own cap on one page. */
const SEARCH_LIMIT = 100;
/** Newer printings to look through: far more than any recent stock needs. */
const NEWER_PRINTINGS_LIMIT = 1000;
const SHOWCASE_ERROR = "Could not load the cards to feature.";

type SnapshotResponse = YardSaleSnapshot & { ok?: boolean };

function snapshotOf(res: SnapshotResponse): YardSaleSnapshot {
  return {
    sale: res.sale,
    openLists: res.openLists,
    openListsFromEndedSales: res.openListsFromEndedSales,
    completedLists: res.completedLists,
    completedTotalCents: res.completedTotalCents,
  };
}

export interface YardSaleSettingsInput {
  endsAt: string;
  discountPercent: number;
  minPriceCents: number;
}

export const yardSaleRepository = {
  async snapshot(): Promise<YardSaleSnapshot> {
    return snapshotOf(await adminFetch<SnapshotResponse>(PATH, { method: "GET" }));
  },

  async start(input: YardSaleSettingsInput): Promise<YardSaleSnapshot> {
    return snapshotOf(await adminFetch<SnapshotResponse>(PATH, { method: "POST", body: input }));
  },

  async update(saleId: string, input: Partial<YardSaleSettingsInput>): Promise<YardSaleSnapshot> {
    return snapshotOf(await adminFetch<SnapshotResponse>(PATH, { method: "PATCH", body: { saleId, ...input } }));
  },

  async end(saleId: string): Promise<YardSaleSnapshot> {
    return snapshotOf(await adminFetch<SnapshotResponse>(`${PATH}?action=end`, { method: "POST", body: { saleId } }));
  },

  /**
   * The hand of cards on the printed sign: the most valuable newer cards
   * (printings released in the last two years) that the yard sale page shows.
   *
   * card_printings has every printing ever added to inventory, with its
   * release date, so it gives the newer printings and their sets. The yard
   * sale page's own search (search_inventory) narrowed to those sets then
   * gives what's in stock and not held, at or above the minimum, most
   * valuable first; the Scryfall id check drops older printings that share a
   * set with newer ones (The List, Secret Lair).
   */
  async showcase(minPriceCents: number, now: Date = new Date()): Promise<YardSaleShowcaseCard[]> {
    const printings = await supabase
      .from("card_printings")
      .select("scryfall_id, set_code")
      .gte("released_at", newerCardsSince(now))
      .order("released_at", { ascending: false })
      .limit(NEWER_PRINTINGS_LIMIT);
    if (printings.error) throw new Error(SHOWCASE_ERROR);
    const newer = printings.data ?? [];
    const sets = [...new Set(newer.map((p) => p.set_code).filter(Boolean))];
    if (sets.length === 0) return [];

    const { data, error } = await supabase.rpc("search_inventory", {
      p_sets: sets,
      p_sort: "price_desc",
      p_limit: SEARCH_LIMIT,
      p_offset: 0,
      p_min_price_cents: Math.max(minPriceCents, 1),
      p_in_stock_only: true,
    });
    if (error) throw new Error(SHOWCASE_ERROR);
    const rows = (data ?? []) as unknown as CatalogSearchRow[];
    return pickYardSaleShowcase(rows.map(mapCatalogRow), new Set(newer.map((p) => p.scryfall_id)));
  },
};
