// Admin → Yard Sale Mode. Turning a sale on or off, and changing its
// discount, minimum price or end time, go through the staff-guarded
// /api/admin/yard-sale endpoint (service role, audit-logged); every answer is
// the same snapshot, so the page just shows what came back.

import { adminFetch } from "./apiClient";
import { supabase } from "../../supabase";
import { mapCatalogRow, type CatalogSearchRow } from "../../store/lib/useCatalog";
import { pickYardSaleShowcase } from "../utils/yardSaleSign";
import type { YardSaleShowcaseCard, YardSaleSnapshot } from "../types";

const PATH = "/api/admin/yard-sale";

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
   * The cards to feature on the printed sign: the most valuable ones the
   * yard sale page shows (the catalog's own search, so in stock, not held,
   * at the website price, at or above the minimum), at the sale's discount.
   */
  async showcase(minPriceCents: number, discountPercent: number): Promise<YardSaleShowcaseCard[]> {
    const { data, error } = await supabase.rpc("search_inventory", {
      p_sort: "price_desc",
      p_limit: 24,
      p_offset: 0,
      p_min_price_cents: Math.max(minPriceCents, 1),
      p_in_stock_only: true,
    });
    if (error) throw new Error("Could not load the cards to feature.");
    const rows = (data ?? []) as unknown as CatalogSearchRow[];
    return pickYardSaleShowcase(rows.map(mapCatalogRow), discountPercent);
  },
};
