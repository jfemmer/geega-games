import * as React from "react";
import { getSupabaseAdmin } from "./supabaseAdmin.js";
import { sendTrackedEmail, type SendEmailResult } from "./emailService.js";
import {
  OrderStatusUpdate,
  orderStatusUpdateSubject,
  orderStatusUpdateText,
  type OrderEmailKind,
  type OrderStatusEmailData,
} from "./emails/OrderStatusUpdate.js";
import { ServerEnv } from "./env.js";
import { logoUrl, siteUrl } from "./assets.js";

// Sends an order update email (packed / shipped / delivered / arrival check /
// cancelled / refunded) for a given order. Mirrors sendOrderConfirmation's
// trust model: accepts only an order ID and loads everything else
// server-side.
//
// Who sends what:
//   packed         api/admin (orders set-status → ready_to_ship)
//   shipped        api/admin (orders ship / buy-label)
//   delivered      api/_lib/shippingUpdates.ts, when the carrier says so
//   arrival_check  api/_lib/shippingUpdates.ts, Plain White Envelope only
//   cancelled      api/admin (orders set-status → cancelled)
//
// Preference gating: a signed-in customer's profiles.shipping_notifications
// (enabled) controls whether this actually sends. Guest orders (no user_id)
// have no profile to opt out from, so they always receive status emails for
// their own order — there is no other way for a guest to track it.
//
// Idempotent per (order, kind): a retried call for the same kind never
// double-sends, but a later update on the same order (e.g. delivered after
// shipped) gets its own email as expected.

const ORDER_EMAIL_KINDS: ReadonlySet<string> = new Set<OrderEmailKind>([
  "packed",
  "shipped",
  "delivered",
  "arrival_check",
  "cancelled",
  "refunded",
]);

export function isNotifiableOrderStatus(status: string): status is OrderEmailKind {
  return ORDER_EMAIL_KINDS.has(status);
}

/** "Monday, October 5", in the store's time zone. */
export function formatShipDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    timeZone: "America/Chicago",
  });
}

export async function sendOrderStatusEmail(
  orderId: string,
  status: OrderEmailKind,
): Promise<SendEmailResult | { status: "skipped"; reason: string }> {
  const db = getSupabaseAdmin();

  const { data: order, error: orderErr } = await db
    .from("orders")
    .select("id, email, user_id, shipping_method, tracking_carrier, tracking_number, shipped_at")
    .eq("id", orderId)
    .single();
  if (orderErr || !order) {
    return { status: "skipped", reason: "order-not-found" };
  }
  if (!order.email) {
    return { status: "skipped", reason: "no-email" };
  }
  // The check-in only makes sense for mail we can't track.
  if (status === "arrival_check" && order.shipping_method !== "pwe") {
    return { status: "skipped", reason: "not-pwe" };
  }

  let firstName: string | null = null;
  if (order.user_id) {
    const { data: profile } = await db
      .from("profiles")
      .select("first_name, shipping_notifications")
      .eq("id", order.user_id)
      .maybeSingle();
    firstName = profile?.first_name ?? null;
    const prefs = profile?.shipping_notifications as { enabled?: boolean } | null;
    if (profile && prefs?.enabled !== true) {
      return { status: "skipped", reason: "notifications-disabled" };
    }
  }

  const orderNumber = `GG-${String(order.id).slice(0, 8).toUpperCase()}`;
  // Guests have no account page to open, so they get the order lookup page
  // filled in (same link as their order confirmation).
  const orderUrl = order.user_id
    ? `${siteUrl()}/account/orders/${order.id}`
    : `${siteUrl()}/track-order?order=${encodeURIComponent(orderNumber)}&email=${encodeURIComponent(order.email)}`;

  const data: OrderStatusEmailData = {
    status,
    orderNumber,
    firstName,
    isPwe: order.shipping_method === "pwe",
    trackingCarrier: order.tracking_carrier,
    trackingNumber: order.tracking_number,
    shippedOn: formatShipDate(order.shipped_at),
    orderUrl,
    siteUrl: siteUrl(),
    logoUrl: logoUrl(),
    supportEmail: ServerEnv.replyTo(),
  };

  return sendTrackedEmail({
    emailType: `order_${status}`,
    idempotencyKey: `order-${status}-${order.id}`,
    to: order.email,
    from: ServerEnv.fromOrders(),
    replyTo: ServerEnv.replyTo(),
    subject: orderStatusUpdateSubject(data),
    react: React.createElement(OrderStatusUpdate, data),
    text: orderStatusUpdateText(data),
    orderId: order.id,
  });
}
