import { HttpError } from "./http.js";
import { getSupabaseAdmin } from "./supabaseAdmin.js";
import { signGuestToken, verifyGuestToken } from "./guestAccess.js";
import { notifyStaff } from "./staffPush.js";
import {
  yardSalePriceCents,
  yardSaleTotals,
  type YardSaleListLine,
  type YardSaleListStatus,
  type YardSaleListView,
} from "../../src/store/lib/yardSale.js";
import { formatCents } from "../../src/store/lib/money.js";

// Server helpers for Yard Sale Mode (api/yard-sale.ts, api/admin/yard-sale.ts
// and the Pickup Requests actions in api/admin/index.ts). The rules live in
// the database functions (20261019050000_yard_sale_mode.sql); this turns
// their errors into HTTP answers and builds the list a shopper's phone shows.

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Why a yard sale request failed, for the phone to react to (refresh the cards, start a new list). */
export type YardSaleErrorCode =
  | "invalid"
  | "sale_ended"
  | "list_closed"
  | "not_found"
  | "unavailable"
  | "not_allowed"
  | "server";

export class YardSaleError extends HttpError {
  code: YardSaleErrorCode;
  constructor(status: number, message: string, code: YardSaleErrorCode) {
    super(status, message);
    this.code = code;
  }
}

/** The yard sale functions' errors (SQLSTATE GGY01–GGY05) as HTTP errors. */
export function yardSaleDbError(
  error: { code?: string; message?: string } | null | undefined,
  fallback: string,
): YardSaleError {
  const code = error?.code ?? "";
  const message = error?.message ?? fallback;
  switch (code) {
    case "GGY01":
    case "22P02":
      return new YardSaleError(400, code === "GGY01" ? message : "Something didn't look right. Please try again.", "invalid");
    case "GGY02":
      return /ended/i.test(message)
        ? new YardSaleError(410, message, "sale_ended")
        : new YardSaleError(409, message, "list_closed");
    case "GGY03":
      return new YardSaleError(404, message, "not_found");
    case "GGY04":
      return new YardSaleError(409, message, "not_allowed");
    case "GGY05":
      return new YardSaleError(409, message, "unavailable");
    case "23505":
      return new YardSaleError(409, "That changed while you were working. Refresh and try again.", "list_closed");
    default:
      return new YardSaleError(500, fallback, "server");
  }
}

/** The phone's proof that a list is theirs (sent back once, with the pickup number). */
export function yardSaleListToken(requestId: string): string {
  return signGuestToken("yard_sale", requestId);
}

export function verifyYardSaleListToken(requestId: unknown, token: unknown): boolean {
  return verifyGuestToken("yard_sale", requestId, token);
}

type RequestRow = {
  id: string;
  customer_name: string;
  status: "waiting" | "ready" | "completed" | "cancelled";
  yard_sale_id: string | null;
  pickup_number: number | null;
};

type ItemRow = {
  id: string;
  inventory_item_id: string | null;
  card_name: string;
  set_name: string | null;
  set_code: string | null;
  collector_number: string | null;
  condition: string;
  finish: string;
  image_url: string | null;
  quantity: number;
  unit_price_cents: number;
  created_at: string;
};

/**
 * What each card sells for right now: its website price, a storewide sale
 * included (inventory_live_prices, the price the yard sale page shows and
 * yard_sale_complete_list charges before the yard sale discount). Cards with
 * no price, or that are gone, are left out.
 */
export async function loadLivePrices(inventoryIds: string[]): Promise<Map<string, number>> {
  const prices = new Map<string, number>();
  const ids = [...new Set(inventoryIds)];
  if (ids.length === 0) return prices;
  const { data, error } = await getSupabaseAdmin().rpc("inventory_live_prices", { p_inventory_item_ids: ids });
  if (error) throw new HttpError(500, "Could not load card prices.");
  for (const row of (data ?? []) as { inventory_item_id: string; price_cents: number | null }[]) {
    if (row.price_cents != null && row.price_cents > 0) prices.set(row.inventory_item_id, row.price_cents);
  }
  return prices;
}

/**
 * Each card's special printing ("Artist Proof"), by inventory item, for the
 * shopper's list to mark it the way the card is marked on the page. A
 * nice-to-have: if the lookup fails, the list just goes without.
 */
export async function loadVariantTypes(inventoryIds: string[]): Promise<Map<string, string>> {
  const variants = new Map<string, string>();
  const ids = [...new Set(inventoryIds)];
  if (ids.length === 0) return variants;
  try {
    const { data, error } = await getSupabaseAdmin().from("inventory_items").select("id, variant_type").in("id", ids);
    if (error) throw error;
    for (const row of (data ?? []) as { id: string; variant_type: string | null }[]) {
      const variant = row.variant_type?.trim();
      if (variant) variants.set(row.id, variant);
    }
  } catch (err) {
    console.error("[yardSale] card variants unavailable", err);
  }
  return variants;
}

function listStatus(status: RequestRow["status"]): YardSaleListStatus {
  if (status === "completed") return "completed";
  if (status === "cancelled") return "cancelled";
  return "open";
}

/**
 * A yard sale list as the shopper's phone shows it: each card at its live
 * website price and the sale's current discount, and the totals Complete
 * would charge right now. Null when there's no such yard sale list.
 */
export async function loadYardSaleListView(requestId: string): Promise<YardSaleListView | null> {
  const admin = getSupabaseAdmin();
  const { data: request, error } = await admin
    .from("pickup_requests")
    .select("id, customer_name, status, yard_sale_id, pickup_number")
    .eq("id", requestId)
    .maybeSingle();
  if (error) throw new YardSaleError(500, "Could not load your list.", "server");
  const req = request as RequestRow | null;
  if (!req || !req.yard_sale_id || req.pickup_number == null) return null;

  const [itemsRes, saleRes, posRes] = await Promise.all([
    admin
      .from("pickup_request_items")
      .select("id, inventory_item_id, card_name, set_name, set_code, collector_number, condition, finish, image_url, quantity, unit_price_cents, created_at")
      .eq("pickup_request_id", req.id)
      .order("created_at", { ascending: true }),
    admin
      .from("yard_sales")
      .select("id, discount_percent, ends_at, ended_at")
      .eq("id", req.yard_sale_id)
      .maybeSingle(),
    admin.from("pos_settings").select("sales_tax_bps").order("id").limit(1).maybeSingle(),
  ]);
  if (itemsRes.error || saleRes.error || !saleRes.data) {
    throw new YardSaleError(500, "Could not load your list.", "server");
  }
  const items = (itemsRes.data ?? []) as ItemRow[];
  const sale = saleRes.data as { id: string; discount_percent: number; ends_at: string; ended_at: string | null };
  const taxBps = Number((posRes.data as { sales_tax_bps?: number } | null)?.sales_tax_bps ?? 0) || 0;

  const inventoryIds = items.map((i) => i.inventory_item_id).filter((id): id is string => !!id);
  const [livePrices, variants] = await Promise.all([
    loadLivePrices(inventoryIds).catch((err) => {
      // Show the list at the prices it was sent with (the website's then)
      // rather than fail: a list that was just saved must still reach the
      // phone with its number. Complete works out the final total anyway.
      console.error("[yardSale] live prices unavailable", err);
      return new Map<string, number>();
    }),
    loadVariantTypes(inventoryIds),
  ]);

  const discountPercent = sale.discount_percent;
  const lines: YardSaleListLine[] = items.map((item) => {
    const priceCents = (item.inventory_item_id && livePrices.get(item.inventory_item_id)) || item.unit_price_cents;
    return {
      itemId: item.id,
      inventoryItemId: item.inventory_item_id,
      cardName: item.card_name,
      setName: item.set_name,
      setCode: item.set_code,
      collectorNumber: item.collector_number,
      condition: item.condition,
      finish: item.finish,
      variantType: (item.inventory_item_id && variants.get(item.inventory_item_id)) || null,
      imageUrl: item.image_url,
      quantity: item.quantity,
      priceCents,
      salePriceCents: yardSalePriceCents(priceCents, discountPercent),
    };
  });

  const status = listStatus(req.status);
  const saleOn = sale.ended_at === null && Date.parse(sale.ends_at) > Date.now();
  return {
    requestId: req.id,
    pickupNumber: req.pickup_number,
    customerName: req.customer_name,
    status,
    canAdd: status === "open" && saleOn,
    discountPercent,
    taxBps,
    lines,
    totals: yardSaleTotals(lines, discountPercent, taxBps),
  };
}

/** Buzz staff phones about a new list or added cards. Best-effort: never fails the request. */
export async function notifyYardSaleList(
  view: YardSaleListView,
  event: { kind: "new" } | { kind: "added"; cards: number; key: string },
): Promise<void> {
  const cards = view.lines.reduce((sum, l) => sum + l.quantity, 0);
  const plural = (n: number) => `${n} card${n === 1 ? "" : "s"}`;
  try {
    await notifyStaff(
      event.kind === "new"
        ? {
            key: `yard-sale:${view.requestId}:new`,
            kind: "pickup",
            title: `Yard sale list #${view.pickupNumber}`,
            body: `${view.customerName} · ${plural(cards)} to grab · ${formatCents(view.totals.totalCents)}`,
            url: "/admin_dashboard/pickup",
            tag: `pickup:${view.requestId}`,
          }
        : {
            key: `yard-sale:${view.requestId}:add:${event.key}`,
            kind: "pickup",
            title: `List #${view.pickupNumber}: ${plural(event.cards)} added`,
            body: `${view.customerName} added more · now ${plural(cards)} · ${formatCents(view.totals.totalCents)}`,
            url: "/admin_dashboard/pickup",
            tag: `pickup:${view.requestId}`,
          },
    );
  } catch (err) {
    console.error("[yardSale] staff notification failed", err);
  }
}
