// Admin → Yard Sale Mode. Turning a sale on or off, and changing its
// discount, minimum price or end time, go through the staff-guarded
// /api/admin/yard-sale endpoint (service role, audit-logged); every answer is
// the same snapshot, so the page just shows what came back.

import { adminFetch } from "./apiClient";
import type { YardSaleSnapshot } from "../types";

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
};
