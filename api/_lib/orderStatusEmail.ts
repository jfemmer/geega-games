import * as React from "react";
import { getSupabaseAdmin } from "./supabaseAdmin.js";
import { sendTrackedEmail, type SendEmailResult } from "./emailService.js";
import {
  OrderStatusUpdate,
  orderStatusUpdateSubject,
  orderStatusUpdateText,
  type NotifiableOrderStatus,
  type OrderStatusEmailData,
} from "./emails/OrderStatusUpdate.js";
import { ServerEnv } from "./env.js";
import { logoUrl, siteUrl } from "./assets.js";

// Sends the order-status-update email (shipped/delivered/cancelled/refunded)
// for a given order. Mirrors sendOrderConfirmation's trust model: accepts
// only an order ID and loads everything else server-side.
//
// Preference gating: a signed-in customer's profiles.shipping_notifications
// (enabled) controls whether this actually sends. Guest orders (no user_id)
// have no profile to opt out from, so they always receive status emails for
// their own order — there is no other way for a guest to track it.
//
// Idempotent per (order, status): a retried call for the same status never
// double-sends, but a later status on the same order (e.g. delivered after
// shipped) gets its own email as expected.

const NOTIFIABLE_STATUSES: ReadonlySet<string> = new Set([
  "shipped",
  "delivered",
  "cancelled",
  "refunded",
]);

export function isNotifiableOrderStatus(status: string): status is NotifiableOrderStatus {
  return NOTIFIABLE_STATUSES.has(status);
}

export async function sendOrderStatusEmail(
  orderId: string,
  status: NotifiableOrderStatus,
): Promise<SendEmailResult | { status: "skipped"; reason: string }> {
  const db = getSupabaseAdmin();

  const { data: order, error: orderErr } = await db
    .from("orders")
    .select("id, email, user_id, shipping_method, tracking_carrier, tracking_number")
    .eq("id", orderId)
    .single();
  if (orderErr || !order) {
    return { status: "skipped", reason: "order-not-found" };
  }
  if (!order.email) {
    return { status: "skipped", reason: "no-email" };
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

  const data: OrderStatusEmailData = {
    status,
    orderNumber,
    firstName,
    isPwe: order.shipping_method === "pwe",
    trackingCarrier: order.tracking_carrier,
    trackingNumber: order.tracking_number,
    orderUrl: `${siteUrl()}/account/orders/${order.id}`,
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
