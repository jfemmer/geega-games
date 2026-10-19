import { isSupabaseConfigured, supabase } from "../../supabase";
import type { YardSaleListAccess, YardSaleListView } from "./yardSale";

// The /yard-sale page's calls: whether a sale is on (public yard_sale_status
// RPC), and sending, adding to and showing a pickup list (/api/yard-sale).
// The phone remembers its list (id, token, sale) so a reload or a locked
// screen doesn't lose the pickup number.

export interface YardSaleStatus {
  active: boolean;
  saleId: string | null;
  discountPercent: number;
  minPriceCents: number;
  endsAt: string | null;
  taxBps: number;
}

export const NO_YARD_SALE: YardSaleStatus = {
  active: false,
  saleId: null,
  discountPercent: 0,
  minPriceCents: 0,
  endsAt: null,
  taxBps: 0,
};

type StatusRow = {
  active: boolean | null;
  sale_id: string | null;
  discount_percent: number | null;
  min_price_cents: number | null;
  ends_at: string | null;
  sales_tax_bps: number | null;
};

export async function loadYardSaleStatus(): Promise<YardSaleStatus> {
  if (!isSupabaseConfigured) throw new Error("The yard sale isn't set up yet. Please ask us for help.");
  const { data, error } = await supabase.rpc("yard_sale_status");
  if (error) throw new Error("We couldn't load the yard sale. Check your connection and try again.");
  const row = (Array.isArray(data) ? data[0] : data) as StatusRow | null;
  if (!row?.active || !row.sale_id) return { ...NO_YARD_SALE, taxBps: row?.sales_tax_bps ?? 0 };
  return {
    active: true,
    saleId: row.sale_id,
    discountPercent: row.discount_percent ?? 0,
    minPriceCents: row.min_price_cents ?? 0,
    endsAt: row.ends_at,
    taxBps: row.sales_tax_bps ?? 0,
  };
}

/** Why a call failed: sale_ended, list_closed, not_found, unavailable, invalid or server. */
export class YardSaleApiError extends Error {
  status: number;
  code: string;
  constructor(message: string, status: number, code: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

async function post<T>(body: Record<string, unknown>): Promise<T> {
  let res: Response;
  try {
    res = await fetch("/api/yard-sale", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    throw new YardSaleApiError("We couldn't reach the website. Check your connection and try again.", 0, "network");
  }
  const json = (await res.json().catch(() => null)) as ({ ok?: boolean; message?: string; code?: string } & T) | null;
  if (!res.ok || !json?.ok) {
    throw new YardSaleApiError(
      json?.message ?? "Something went wrong. Please ask us for help.",
      res.status,
      json?.code ?? "server",
    );
  }
  return json;
}

export type YardSaleItemInput = { inventoryItemId: string; quantity: number };

export async function sendYardSaleList(
  name: string,
  items: YardSaleItemInput[],
  website = "",
): Promise<{ list: YardSaleListView; token: string }> {
  const res = await post<{ list?: YardSaleListView; token?: string }>({ action: "submit", name, items, website });
  if (!res.list || !res.token) throw new YardSaleApiError("Something went wrong. Please ask us for help.", 500, "server");
  return { list: res.list, token: res.token };
}

export async function addToYardSaleList(access: YardSaleListAccess, items: YardSaleItemInput[]): Promise<YardSaleListView> {
  const res = await post<{ list: YardSaleListView }>({
    action: "add",
    requestId: access.requestId,
    token: access.token,
    items,
  });
  return res.list;
}

export async function getYardSaleList(access: YardSaleListAccess): Promise<YardSaleListView> {
  const res = await post<{ list: YardSaleListView }>({ action: "get", requestId: access.requestId, token: access.token });
  return res.list;
}

// ---------------------------------------------------------------------------
// The list this phone sent (localStorage; the page works without it, it just
// can't find the list again after a reload).
// ---------------------------------------------------------------------------

const STORAGE_KEY = "gg-yard-sale-list";

export function readSavedList(): YardSaleListAccess | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<YardSaleListAccess> | null;
    if (
      parsed &&
      typeof parsed.requestId === "string" &&
      typeof parsed.token === "string" &&
      typeof parsed.saleId === "string"
    ) {
      return { requestId: parsed.requestId, token: parsed.token, saleId: parsed.saleId };
    }
    return null;
  } catch {
    return null;
  }
}

export function saveList(access: YardSaleListAccess): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(access));
  } catch {
    // Private browsing or storage turned off: the list just isn't remembered.
  }
}

export function clearSavedList(): void {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Nothing to clear.
  }
}
