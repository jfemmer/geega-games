import { getSupabaseAdmin } from "./supabaseAdmin.js";
import { optionalEnv } from "./env.js";
import { getStripe } from "./stripe.js";
import { sendOrderConfirmation, sendOrderAdminNotification } from "./orderConfirmation.js";
import {
  capturePayPalOrder,
  createPayPalOrder,
  getPayPalOrder,
  payPalValueToCents,
  PayPalApiError,
  type PayPalCapture,
  type PayPalOrder,
} from "./paypal.js";

// Shared PayPal/Venmo checkout logic, used by BOTH the browser-facing
// endpoint (api/checkout/paypal.ts) and the PayPal webhook
// (api/webhooks/paypal.ts), so an order is finalized identically no matter
// which one gets there first.
//
// Same trust model as the Stripe path:
//   - The server is the only pricing authority. A PayPal order is created for
//     EXACTLY orders.amount_due_cents; the browser never supplies an amount.
//   - Before capturing, the PayPal order is re-read from PayPal and checked
//     against our order (custom_id, currency, amount), and our order must
//     still be pending_payment + unpaid. A cancelled, already-paid (e.g. via
//     Stripe) or tampered order is never captured.
//   - The order is marked paid only from a COMPLETED capture that PayPal
//     itself returned to us, via the same idempotent mark_order_paid RPC the
//     Stripe webhook uses.

type OrderRow = {
  id: string;
  user_id: string | null;
  status: string;
  payment_status: string;
  payment_provider: string | null;
  payment_reference: string | null;
  amount_due_cents: number;
};

export type FinalizeResult =
  | { outcome: "paid"; orderId: string; captureId: string }
  | { outcome: "already_paid"; orderId: string }
  | { outcome: "pending"; orderId: string }
  | { outcome: "declined"; orderId: string; retryable: boolean }
  | { outcome: "rejected"; orderId: string | null; reason: string };

export class CheckoutError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function loadOrder(orderId: string): Promise<OrderRow | null> {
  const { data, error } = await getSupabaseAdmin()
    .from("orders")
    .select("id, user_id, status, payment_status, payment_provider, payment_reference, amount_due_cents")
    .eq("id", orderId)
    .maybeSingle();
  if (error) throw new CheckoutError(500, "Could not load order.");
  return (data as OrderRow | null) ?? null;
}

/** Ownership + payability checks shared by create and capture. */
function assertPayable(order: OrderRow | null, userId: string): asserts order is OrderRow {
  // 404 for "not yours" too, so order ids can't be probed.
  if (!order || order.user_id !== userId) throw new CheckoutError(404, "Order not found.");
  if (order.payment_status === "paid") throw new CheckoutError(409, "This order is already paid.");
  if (order.status !== "pending_payment" || order.payment_status !== "unpaid") {
    throw new CheckoutError(409, "This order can no longer be paid. Please contact us.");
  }
  if (order.amount_due_cents <= 0) throw new CheckoutError(409, "Nothing is due on this order.");
}

/** Creates a PayPal order (PayPal or Venmo) for exactly the server-side amount due. */
export async function createPayPalCheckout(orderId: string, userId: string): Promise<string> {
  const order = await loadOrder(orderId);
  assertPayable(order, userId);
  const ppOrder = await createPayPalOrder({
    orderId: order.id,
    amountCents: order.amount_due_cents,
    description: `Geega Games order GG-${order.id.slice(0, 8).toUpperCase()}`,
  });
  return ppOrder.id;
}

function firstUnit(ppOrder: PayPalOrder) {
  return ppOrder.purchase_units?.[0];
}

function latestCapture(ppOrder: PayPalOrder): PayPalCapture | undefined {
  const captures = firstUnit(ppOrder)?.payments?.captures ?? [];
  return captures[captures.length - 1];
}

/**
 * Captures (if still needed) and finalizes a PayPal order.
 *
 * `userId` is set when called on behalf of a signed-in customer (the order
 * must be theirs); it's null when called from the verified webhook.
 * `expectedOrderId`, when given, must match the PayPal order's custom_id.
 */
export async function finalizePayPalCheckout(
  paypalOrderId: string,
  opts: { userId: string | null; expectedOrderId?: string },
): Promise<FinalizeResult> {
  const ppOrder = await getPayPalOrder(paypalOrderId);
  const unit = firstUnit(ppOrder);
  const orderId = unit?.custom_id ?? null;
  if (!orderId) return { outcome: "rejected", orderId: null, reason: "missing custom_id" };
  if (opts.expectedOrderId && opts.expectedOrderId !== orderId) {
    throw new CheckoutError(400, "Payment does not match this order.");
  }

  const order = await loadOrder(orderId);
  if (!order) return { outcome: "rejected", orderId, reason: "order not found" };
  if (opts.userId !== null && order.user_id !== opts.userId) {
    throw new CheckoutError(404, "Order not found.");
  }

  // Amount/currency must match what we charge for this order, always.
  if (
    unit?.amount?.currency_code !== "USD" ||
    payPalValueToCents(unit.amount.value) !== order.amount_due_cents
  ) {
    console.error("[paypal] amount mismatch", { orderId, paypalOrderId, amount: unit?.amount });
    return { outcome: "rejected", orderId, reason: "amount mismatch" };
  }

  let captured: PayPalOrder = ppOrder;
  if (ppOrder.status === "APPROVED") {
    // Only take money for an order that can still be paid. If it was paid
    // another way (Stripe) or cancelled meanwhile, leave the PayPal approval
    // uncaptured — it expires on its own and the buyer is never charged.
    if (order.payment_status === "paid") return { outcome: "already_paid", orderId };
    if (order.status !== "pending_payment" || order.payment_status !== "unpaid") {
      return { outcome: "rejected", orderId, reason: `order ${order.status}/${order.payment_status}` };
    }
    try {
      captured = await capturePayPalOrder(paypalOrderId);
    } catch (err) {
      if (err instanceof PayPalApiError && err.issue === "INSTRUMENT_DECLINED") {
        // The buyer can pick another funding source in the PayPal popup.
        return { outcome: "declined", orderId, retryable: true };
      }
      if (err instanceof PayPalApiError && err.issue === "ORDER_ALREADY_CAPTURED") {
        captured = await getPayPalOrder(paypalOrderId);
      } else {
        throw err;
      }
    }
  } else if (ppOrder.status !== "COMPLETED") {
    // CREATED / PAYER_ACTION_REQUIRED / VOIDED: nothing to capture (yet).
    return { outcome: "rejected", orderId, reason: `paypal order ${ppOrder.status}` };
  }

  const capture = latestCapture(captured);
  if (!capture) return { outcome: "rejected", orderId, reason: "no capture" };
  return applyCapture(orderId, capture);
}

/**
 * Applies a capture PayPal reported (from our own capture call or a verified
 * webhook) to our order. Idempotent: re-applying the same capture is a no-op.
 */
export async function applyCapture(orderId: string, capture: PayPalCapture): Promise<FinalizeResult> {
  const order = await loadOrder(orderId);
  if (!order) return { outcome: "rejected", orderId, reason: "order not found" };

  if (capture.status === "DECLINED" || capture.status === "FAILED") {
    return { outcome: "declined", orderId, retryable: false };
  }
  if (capture.status === "PENDING") {
    // e.g. an eCheck or a PayPal risk review. The money isn't ours yet; the
    // PAYMENT.CAPTURE.COMPLETED webhook finishes this. Show it as processing.
    await getSupabaseAdmin()
      .from("orders")
      .update({ payment_status: "processing", payment_provider: "paypal", payment_reference: capture.id })
      .eq("id", orderId)
      .eq("payment_status", "unpaid");
    return { outcome: "pending", orderId };
  }
  if (capture.status !== "COMPLETED") {
    return { outcome: "rejected", orderId, reason: `capture ${capture.status}` };
  }

  if (
    capture.amount?.currency_code !== "USD" ||
    payPalValueToCents(capture.amount.value) !== order.amount_due_cents
  ) {
    console.error("[paypal] captured amount mismatch — needs manual review", {
      orderId,
      captureId: capture.id,
      amount: capture.amount,
    });
    return { outcome: "rejected", orderId, reason: "captured amount mismatch" };
  }

  if (order.payment_status === "paid") {
    if (order.payment_reference !== capture.id) {
      // Paid twice (e.g. Stripe landed first, then this capture). Money was
      // taken by both — it must be refunded by hand in PayPal.
      console.error("[paypal] DUPLICATE PAYMENT: order already paid, refund this capture", {
        orderId,
        captureId: capture.id,
        existing: `${order.payment_provider}:${order.payment_reference}`,
      });
    }
    return { outcome: "already_paid", orderId };
  }
  if (order.status === "cancelled") {
    console.error("[paypal] capture completed for a CANCELLED order — refund this capture", {
      orderId,
      captureId: capture.id,
    });
    return { outcome: "rejected", orderId, reason: "order cancelled" };
  }

  const { error: markErr } = await getSupabaseAdmin().rpc("mark_order_paid", {
    p_order_id: orderId,
    p_provider: "paypal",
    p_reference: capture.id,
  });
  if (markErr) {
    console.error("[paypal] mark_order_paid failed", markErr);
    throw new CheckoutError(500, "Could not record payment.");
  }

  // Same post-payment side effects as the Stripe webhook. Both emails are
  // idempotent (keyed per order), so the capture endpoint and the webhook
  // racing each other can't send duplicates. Failures never undo "paid".
  await Promise.allSettled([
    sendOrderConfirmation(orderId).catch((e) => console.error("[paypal] confirmation email failed", e)),
    sendOrderAdminNotification(orderId).catch((e) =>
      console.error("[paypal] admin notification email failed", e),
    ),
    cancelOpenStripeIntents(orderId),
  ]);

  return { outcome: "paid", orderId, captureId: capture.id };
}

/**
 * The payment step offers Stripe AND PayPal for the same order. Once PayPal
 * pays it, cancel the order's still-open Stripe PaymentIntent so a stale tab
 * can't charge the customer a second time. Best-effort: a failure here is
 * logged, never surfaced (the order is already correctly paid).
 */
async function cancelOpenStripeIntents(orderId: string): Promise<void> {
  if (!optionalEnv("STRIPE_SECRET_KEY")) return;
  try {
    const stripe = getStripe();
    const found = await stripe.paymentIntents.search({
      query: `metadata['order_id']:'${orderId.replace(/'/g, "")}'`,
      limit: 10,
    });
    const cancelable = new Set([
      "requires_payment_method",
      "requires_confirmation",
      "requires_action",
      "requires_capture",
    ]);
    for (const pi of found.data) {
      if (cancelable.has(pi.status)) {
        await stripe.paymentIntents.cancel(pi.id, { cancellation_reason: "duplicate" });
      }
    }
  } catch (err) {
    console.error("[paypal] could not cancel open Stripe PaymentIntent", { orderId, err });
  }
}
