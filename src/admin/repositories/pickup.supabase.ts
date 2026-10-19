// LIVE PickupRequestRepository — the staff-facing queue of pickup lists: the
// in-store kiosk's requests and the lists shoppers send from /yard-sale. All
// actions are privileged writes (releasing a hold, decrementing stock,
// creating an order), so everything goes through the staff-guarded
// /api/admin?resource=pickup&action=* router, same pattern as pos.supabase.ts.

import { adminFetch } from "./apiClient";
import type {
  PickupQueue,
  PickupRemoveResult,
  PickupRequest,
  PickupRequestItem,
  PickupYardSale,
  PosSaleResult,
  YardSaleCompleteResult,
} from "../types";
import type { PickupRequestRepository } from "./types";

const BASE = "/api/admin?resource=pickup";

function action(name: string): string {
  return `${BASE}&action=${name}`;
}

type ItemRow = {
  id: string;
  inventory_item_id: string | null;
  card_name: string;
  set_name: string | null;
  set_code: string | null;
  collector_number: string | null;
  condition: PickupRequestItem["condition"];
  finish: PickupRequestItem["finish"];
  image_url: string | null;
  quantity: number;
  unit_price_cents: number;
  pulled: boolean;
  storage_location?: string | null;
  current_price_cents?: number | null;
  available?: boolean;
};

type RequestRow = {
  id: string;
  customer_name: string;
  phone: string | null;
  status: PickupRequest["status"];
  notes: string | null;
  created_at: string;
  yard_sale_id?: string | null;
  pickup_number?: number | null;
  items: ItemRow[];
};

type YardSaleRow = {
  id: string;
  started_at: string;
  ends_at: string;
  ended_at: string | null;
  discount_percent: number;
  min_price_cents: number;
  active: boolean;
};

function mapItem(row: ItemRow): PickupRequestItem {
  return {
    id: row.id,
    inventoryItemId: row.inventory_item_id,
    cardName: row.card_name,
    setName: row.set_name,
    setCode: row.set_code,
    collectorNumber: row.collector_number,
    condition: row.condition,
    finish: row.finish,
    imageUrl: row.image_url,
    quantity: row.quantity,
    unitPriceCents: row.unit_price_cents,
    pulled: row.pulled,
    storageLocation: row.storage_location ?? null,
    currentPriceCents: row.current_price_cents ?? null,
    available: row.available ?? true,
  };
}

function mapRequest(row: RequestRow): PickupRequest {
  return {
    id: row.id,
    customerName: row.customer_name,
    phone: row.phone,
    status: row.status,
    notes: row.notes,
    createdAt: row.created_at,
    items: (row.items ?? []).map(mapItem),
    yardSaleId: row.yard_sale_id ?? null,
    pickupNumber: row.pickup_number ?? null,
  };
}

function mapYardSale(row: YardSaleRow): PickupYardSale {
  return {
    id: row.id,
    startedAt: row.started_at,
    endsAt: row.ends_at,
    endedAt: row.ended_at,
    active: row.active,
    discountPercent: row.discount_percent,
    minPriceCents: row.min_price_cents,
  };
}

export const supabasePickupRequestRepository: PickupRequestRepository = {
  async list(): Promise<PickupQueue> {
    const res = await adminFetch<{ rows: RequestRow[]; yardSales?: YardSaleRow[]; taxBps?: number }>(action("list"), {
      method: "GET",
    });
    return {
      requests: res.rows.map(mapRequest),
      yardSales: (res.yardSales ?? []).map(mapYardSale),
      taxBps: res.taxBps ?? 0,
    };
  },

  async toggleItem(itemId) {
    await adminFetch<{ ok: true }>(action("toggle-item"), { method: "POST", body: { itemId } });
  },

  async markReady(requestId) {
    await adminFetch<{ ok: true }>(action("mark-ready"), { method: "POST", body: { requestId } });
  },

  async cancel(requestId, reason) {
    await adminFetch<{ ok: true }>(action("cancel"), {
      method: "POST",
      body: { requestId, reason: reason ?? undefined },
    });
  },

  async completeSale(requestId, customerId) {
    const res = await adminFetch<{ sale: Record<string, unknown> }>(action("complete-sale"), {
      method: "POST",
      body: { requestId, customerId: customerId ?? undefined },
    });
    const s = res.sale;
    return {
      orderId: String(s.order_id),
      subtotalCents: Number(s.subtotal_cents),
      taxCents: Number(s.tax_cents),
      totalCents: Number(s.total_cents),
      amountDueCents: Number(s.amount_due_cents),
    } satisfies PosSaleResult;
  },

  async removeItem(itemId, quantity) {
    const res = await adminFetch<{ result: PickupRemoveResult }>(action("remove-item"), {
      method: "POST",
      body: { itemId, quantity: quantity ?? undefined },
    });
    return res.result;
  },

  async completeYardSaleList(requestId, paymentMethod) {
    const res = await adminFetch<{ sale: YardSaleCompleteResult }>(action("complete-yard-sale"), {
      method: "POST",
      body: { requestId, paymentMethod },
    });
    return res.sale;
  },
};
