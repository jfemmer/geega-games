import * as React from "react";
import { getSupabaseAdmin } from "./supabaseAdmin.js";
import { sendTrackedEmail, type SendEmailResult } from "./emailService.js";
import {
  OrderConfirmation,
  orderConfirmationText,
  type OrderEmailData,
  type OrderItemSnapshot,
} from "./emails/OrderConfirmation.js";
import { ServerEnv } from "./env.js";
import { logoUrl, siteUrl } from "./assets.js";

// Sends the order-confirmation email for a given order ID.
//
// Trust model:
//   * Accepts ONLY an order ID. It never accepts browser-supplied order details.
//   * Loads the canonical order + items from Supabase on the server.
//   * Refuses to send unless orders.payment_status = 'paid' (a trusted state
//     set by a verified server-side payment event, never by a success page).
//   * Idempotent: DB unique key `order-confirmation-<order-id>` + Resend key.
//
// This function has NO public HTTP endpoint. It is only ever called from a
// trusted server context (e.g. the future payment webhook handler).

export async function sendOrderConfirmation(
  orderId: string,
): Promise<SendEmailResult | { status: "skipped"; reason: string }> {
  const db = getSupabaseAdmin();

  const { data: order, error: orderErr } = await db
    .from("orders")
    .select(
      "id, email, payment_status, created_at, subtotal_cents, shipping_cents, discount_cents, total_cents, ship_recipient, ship_line1, ship_line2, ship_city, ship_state, ship_postal_code, ship_country, user_id",
    )
    .eq("id", orderId)
    .single();

  if (orderErr || !order) {
    return { status: "skipped", reason: "order-not-found" };
  }

  // Trusted-state gate. Do not email until a verified payment event flips this.
  if (order.payment_status !== "paid") {
    return { status: "skipped", reason: `payment_status=${order.payment_status}` };
  }

  const { data: items, error: itemsErr } = await db
    .from("order_items")
    .select(
      "card_name, set_name, condition, finish, quantity, unit_price_cents, line_total_cents",
    )
    .eq("order_id", orderId);

  if (itemsErr || !items || items.length === 0) {
    return { status: "skipped", reason: "no-items" };
  }

  // Best-effort first name from the linked profile (optional).
  let firstName: string | null = null;
  if (order.user_id) {
    const { data: profile } = await db
      .from("profiles")
      .select("first_name")
      .eq("id", order.user_id)
      .maybeSingle();
    firstName = profile?.first_name ?? null;
  }

  // An order number is not a column in the current schema; derive a stable,
  // human-readable one from the order id until a dedicated column exists.
  const orderNumber = `GG-${String(order.id).slice(0, 8).toUpperCase()}`;

  const data: OrderEmailData = {
    orderNumber,
    firstName,
    createdAtISO: order.created_at,
    paymentStatus: order.payment_status,
    items: items as OrderItemSnapshot[],
    subtotalCents: order.subtotal_cents,
    shippingCents: order.shipping_cents,
    discountCents: order.discount_cents ?? 0,
    // Tax is not currently a column; default to 0 until one exists.
    taxCents: 0,
    totalCents: order.total_cents,
    ship: {
      recipient: order.ship_recipient,
      line1: order.ship_line1,
      line2: order.ship_line2,
      city: order.ship_city,
      state: order.ship_state,
      postalCode: order.ship_postal_code,
      country: order.ship_country,
    },
    siteUrl: siteUrl(),
    logoUrl: logoUrl(),
    supportEmail: ServerEnv.replyTo(),
  };

  return sendTrackedEmail({
    emailType: "order_confirmation",
    idempotencyKey: `order-confirmation-${order.id}`,
    to: order.email,
    from: ServerEnv.fromOrders(),
    replyTo: ServerEnv.replyTo(),
    subject: `Your Geega Games order ${orderNumber} is confirmed`,
    react: React.createElement(OrderConfirmation, data),
    text: orderConfirmationText(data),
    orderId: order.id,
  });
}
