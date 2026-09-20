// LIVE OrderRepository — backed by the real Supabase `orders` / `order_items`
// tables (the SAME rows the customer account reads), so a fulfillment action
// taken here is immediately reflected in the customer's "Track My Order" UI.
//
// SECURITY MODEL (matches the established pattern in inventory.supabase.ts):
//   * READS use the browser client with the publishable key. RLS already lets
//     staff read every order directly (`orders_select_own`: user_id = auth.uid()
//     OR is_staff()), so no RPC/service-role hop is needed for list/get/counts.
//   * WRITES (status changes, shipping, notes, packing checklist) are NOT
//     covered by any staff RLS policy on orders/order_items, so they POST to
//     staff-guarded /api/admin?resource=orders&action=* Vercel Functions, which
//     use the service-role key server-side after verifying the caller via
//     requireStaff(). The service-role key never reaches the browser.
//
// Some fields the mock's richer Order shape offers (a full email log on every
// list row, a free-text carrier) don't have a 1:1 real column, so:
//   * `timeline` is SYNTHESIZED from the order's timestamp columns
//     (created_at/paid_at/packed_at/ready_at/shipped_at/delivered_at/
//     cancelled_at) rather than a separate audit-log table.
//   * `emails` is populated from `email_deliveries` (staff-readable) ONLY in
//     get() — list() leaves it empty to avoid an N+1 query per row; the list
//     table never renders it.
//   * `carrier` is normalized to the admin ShippingCarrier union for display;
//     the exact raw carrier string is preserved verbatim in the DB and is what
//     the customer-facing tracking-URL resolver actually uses.

import { supabase } from "../../supabase";
import { adminFetch } from "./apiClient";
import type { Database } from "../../types/database";
import type {
  Order,
  OrderEmailEvent,
  OrderItem,
  OrderQuery,
  OrderStatus,
  OrderTimelineEvent,
  ShippingCarrier,
} from "../types";
import type { OrderRepository } from "./types";

type OrderRowDb = Database["public"]["Tables"]["orders"]["Row"];
type OrderItemRowDb = Database["public"]["Tables"]["order_items"]["Row"];
type OrderRowWithItems = OrderRowDb & { order_items: OrderItemRowDb[] };

const ORDER_SELECT = "*, order_items(*)";

function orderNumberFromId(id: string): string {
  return `#${id.slice(0, 8).toUpperCase()}`;
}

function normalizeCarrier(raw: string | null): ShippingCarrier | null {
  if (!raw) return null;
  const v = raw.trim().toUpperCase();
  if (v === "USPS") return "USPS";
  if (v === "UPS") return "UPS";
  if (v === "FEDEX") return "FedEx";
  return "Other";
}

function mapItem(row: OrderItemRowDb): OrderItem {
  return {
    id: row.id,
    cardName: row.card_name,
    setName: row.set_name,
    setCode: row.set_code,
    collectorNumber: row.collector_number,
    imageUrl: row.image_url,
    condition: row.condition,
    finish: row.finish,
    variantType: row.variant_type || null,
    quantity: row.quantity,
    unitPriceCents: row.unit_price_cents,
    lineTotalCents: row.line_total_cents,
    packed: row.packed,
  };
}

function buildTimeline(o: OrderRowDb): OrderTimelineEvent[] {
  const events: (OrderTimelineEvent | null)[] = [
    { id: `${o.id}-placed`, label: "Order placed", detail: null, actor: "Customer", at: o.created_at },
    o.paid_at
      ? {
          id: `${o.id}-paid`,
          label: "Paid",
          detail: o.payment_provider ? `via ${o.payment_provider}` : null,
          actor: "System",
          at: o.paid_at,
        }
      : null,
    o.packed_at
      ? {
          id: `${o.id}-packing`,
          label: "Packing started",
          detail: null,
          actor: "Staff",
          at: o.packed_at,
        }
      : null,
    o.ready_at
      ? {
          id: `${o.id}-ready`,
          label: "Ready to ship",
          detail: null,
          actor: "Staff",
          at: o.ready_at,
        }
      : null,
    o.shipped_at
      ? {
          id: `${o.id}-shipped`,
          label: "Shipped",
          detail:
            o.shipping_method === "pwe"
              ? "Plain White Envelope (no tracking)"
              : o.tracking_carrier && o.tracking_number
                ? `${o.tracking_carrier} ${o.tracking_number}`
                : null,
          actor: "Staff",
          at: o.shipped_at,
        }
      : null,
    o.delivered_at
      ? {
          id: `${o.id}-delivered`,
          label: "Delivered",
          detail: null,
          actor: "System",
          at: o.delivered_at,
        }
      : null,
    o.cancelled_at
      ? {
          id: `${o.id}-cancelled`,
          label: "Cancelled",
          detail: null,
          actor: "Staff",
          at: o.cancelled_at,
        }
      : null,
  ];
  return events.filter((e): e is OrderTimelineEvent => !!e);
}

function mapOrder(
  o: OrderRowWithItems,
  customerName: string,
  emails: OrderEmailEvent[] = [],
): Order {
  return {
    id: o.id,
    orderNumber: orderNumberFromId(o.id),
    channel: o.channel,
    customerId: o.customer_id,
    customerName,
    customerEmail: o.email,
    shipRecipient: o.ship_recipient ?? "",
    shipLine1: o.ship_line1 ?? "",
    shipLine2: o.ship_line2,
    shipCity: o.ship_city ?? "",
    shipState: o.ship_state ?? "",
    shipPostalCode: o.ship_postal_code ?? "",
    shipCountry: o.ship_country ?? "",
    paymentStatus: o.payment_status,
    paymentProvider: o.payment_provider,
    status: o.status,
    carrier: normalizeCarrier(o.tracking_carrier),
    trackingNumber: o.tracking_number,
    shippingMethod: o.shipping_method,
    labelUrl: o.label_url,
    postageCostCents: o.postage_cost_cents,
    shippingService: o.shipping_service,
    items: (o.order_items ?? []).map(mapItem),
    subtotalCents: o.subtotal_cents,
    discountCents: o.discount_cents,
    shippingCents: o.shipping_cents,
    taxCents: o.tax_cents,
    totalCents: o.total_cents,
    internalNotes: o.internal_notes,
    timeline: buildTimeline(o),
    emails,
    createdAt: o.created_at,
    paidAt: o.paid_at,
    shippedAt: o.shipped_at,
    deliveredAt: o.delivered_at,
    cancelledAt: o.cancelled_at,
  };
}

/**
 * Batch-resolve "First Last" for a set of orders. Online orders are keyed by
 * user_id (profiles); POS orders linked to a walk-in are keyed by
 * customer_id (customers) instead, since a POS sale often has no auth user.
 */
async function resolveCustomerNames(
  orders: OrderRowWithItems[],
): Promise<{ byUser: Map<string, string>; byCustomer: Map<string, string> }> {
  const userIds = Array.from(
    new Set(orders.map((o) => o.user_id).filter((id): id is string => id != null)),
  );
  const customerIds = Array.from(
    new Set(orders.map((o) => o.customer_id).filter((id): id is string => id != null)),
  );
  const byUser = new Map<string, string>();
  const byCustomer = new Map<string, string>();

  if (userIds.length > 0) {
    const { data } = await supabase
      .from("profiles")
      .select("id, first_name, last_name")
      .in("id", userIds);
    for (const p of data ?? []) {
      const full = `${p.first_name ?? ""} ${p.last_name ?? ""}`.trim();
      if (full) byUser.set(p.id, full);
    }
  }
  if (customerIds.length > 0) {
    const { data } = await supabase
      .from("customers")
      .select("id, first_name, last_name")
      .in("id", customerIds);
    for (const c of data ?? []) {
      const full = `${c.first_name ?? ""} ${c.last_name ?? ""}`.trim();
      if (full) byCustomer.set(c.id, full);
    }
  }
  return { byUser, byCustomer };
}

function nameFor(
  names: { byUser: Map<string, string>; byCustomer: Map<string, string> },
  o: OrderRowWithItems,
): string {
  const known =
    (o.user_id ? names.byUser.get(o.user_id) : undefined) ??
    (o.customer_id ? names.byCustomer.get(o.customer_id) : undefined);
  return known ?? o.email ?? "Walk-in customer";
}

export const supabaseOrderRepository: OrderRepository = {
  async list(query: OrderQuery): Promise<Order[]> {
    const { status = "all", sortBy = "created", sortDir = "desc", search } = query;

    let q = supabase.from("orders").select(ORDER_SELECT);
    if (status === "needs_packing") q = q.eq("status", "paid");
    else if (status !== "all") q = q.eq("status", status as OrderStatus);

    const column = sortBy === "total" ? "total_cents" : "created_at";
    q = q.order(column, { ascending: sortDir === "asc" });

    const { data, error } = await q.limit(500);
    if (error) throw new Error(error.message);
    let rows = (data ?? []) as unknown as OrderRowWithItems[];

    const term = search?.trim().toLowerCase();
    if (term) {
      rows = rows.filter(
        (o) =>
          orderNumberFromId(o.id).toLowerCase().includes(term) ||
          (o.email ?? "").toLowerCase().includes(term) ||
          (o.ship_recipient ?? "").toLowerCase().includes(term),
      );
    }

    const names = await resolveCustomerNames(rows);
    return rows.map((o) => mapOrder(o, nameFor(names, o)));
  },

  async get(id: string): Promise<Order | null> {
    const { data, error } = await supabase
      .from("orders")
      .select(ORDER_SELECT)
      .eq("id", id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) return null;
    const row = data as unknown as OrderRowWithItems;

    const [names, emailRows] = await Promise.all([
      resolveCustomerNames([row]),
      supabase
        .from("email_deliveries")
        .select("id, email_type, to_email, status, sent_at, created_at")
        .eq("order_id", id)
        .order("created_at", { ascending: true }),
    ]);

    const emails: OrderEmailEvent[] = (emailRows.data ?? []).map((e) => ({
      id: e.id,
      emailType: e.email_type,
      toEmail: e.to_email,
      status: e.status,
      at: e.sent_at ?? e.created_at,
    }));

    return mapOrder(row, nameFor(names, row), emails);
  },

  async setStatus(id: string, status: Order["status"]): Promise<Order> {
    await adminFetch("/api/admin?resource=orders&action=set-status", {
      method: "POST",
      body: { orderId: id, status },
    });
    const fresh = await supabaseOrderRepository.get(id);
    if (!fresh) throw new Error("Order not found after update.");
    return fresh;
  },

  async toggleItemPacked(orderId: string, itemId: string): Promise<Order> {
    await adminFetch("/api/admin?resource=orders&action=toggle-packed", {
      method: "POST",
      body: { orderId, itemId },
    });
    const fresh = await supabaseOrderRepository.get(orderId);
    if (!fresh) throw new Error("Order not found after update.");
    return fresh;
  },

  async addNote(orderId: string, note: string): Promise<Order> {
    await adminFetch("/api/admin?resource=orders&action=add-note", {
      method: "POST",
      body: { orderId, note },
    });
    const fresh = await supabaseOrderRepository.get(orderId);
    if (!fresh) throw new Error("Order not found after update.");
    return fresh;
  },

  async ship(
    orderId: string,
    carrier: ShippingCarrier | null,
    trackingNumber: string | null,
  ): Promise<Order> {
    await adminFetch("/api/admin?resource=orders&action=ship", {
      method: "POST",
      body: { orderId, carrier, trackingNumber },
    });
    const fresh = await supabaseOrderRepository.get(orderId);
    if (!fresh) throw new Error("Order not found after update.");
    return fresh;
  },

  async buyLabel(orderId: string): Promise<Order> {
    await adminFetch("/api/admin?resource=orders&action=buy-label", {
      method: "POST",
      body: { orderId },
    });
    const fresh = await supabaseOrderRepository.get(orderId);
    if (!fresh) throw new Error("Order not found after update.");
    return fresh;
  },

  async counts(): Promise<Record<string, number>> {
    const countByStatus = async (status: OrderStatus) => {
      const { count, error } = await supabase
        .from("orders")
        .select("id", { count: "exact", head: true })
        .eq("status", status);
      if (error) throw new Error(error.message);
      return count ?? 0;
    };
    const countAll = async () => {
      const { count, error } = await supabase
        .from("orders")
        .select("id", { count: "exact", head: true });
      if (error) throw new Error(error.message);
      return count ?? 0;
    };

    const [paid, packing, readyToShip, shipped, delivered, cancelled, refunded, all] =
      await Promise.all([
        countByStatus("paid"),
        countByStatus("packing"),
        countByStatus("ready_to_ship"),
        countByStatus("shipped"),
        countByStatus("delivered"),
        countByStatus("cancelled"),
        countByStatus("refunded"),
        countAll(),
      ]);

    return {
      needs_packing: paid,
      packing,
      ready_to_ship: readyToShip,
      shipped,
      delivered,
      cancelled: cancelled + refunded,
      all,
    };
  },
};
