import type Stripe from "stripe";
import { getSupabaseAdmin } from "./supabaseAdmin.js";
import { getStripe } from "./stripe.js";
import { HttpError } from "./http.js";
import { sendOrderAdminNotification } from "./orderConfirmation.js";
import { loadTradeBundle, loadTradeSettings, type Admin, type TradeBundle, type TradeSettingsRow } from "./tradeCenter.js";
import { notifyTradeStaff, sendTradeCustomerEmail } from "./tradeCenterEmails.js";

// Card payments for the rest of a trade (the customer's trade credit didn't
// cover our cards). Both the trade page (api/trade-center.ts, right after the
// card form) and the Stripe webhook (api/webhooks/stripe.ts) report a
// succeeded PaymentIntent here. The database finishes a trade once
// (trade_record_payment: the paid order, the credit issued and spent), so
// whichever arrives second just finds the same order; the emails and staff
// alerts are idempotent too.

export type TradeCardPaymentResult =
  | { ok: true; orderId: string }
  | { ok: false; retryable: boolean; code: string | null; message: string };

/** Is this PaymentIntent for a trade (vs. a store order or a sorting quote)? */
export function isTradePaymentIntent(intent: Pick<Stripe.PaymentIntent, "metadata">): boolean {
  return Boolean(intent.metadata?.trade_request_id);
}

export async function recordTradeCardPayment(intent: Stripe.PaymentIntent): Promise<TradeCardPaymentResult> {
  const tradeId = intent.metadata?.trade_request_id;
  if (!tradeId) return { ok: false, retryable: false, code: null, message: "Not a trade payment." };
  const admin = getSupabaseAdmin();
  const { data, error } = await admin.rpc("trade_record_payment", {
    p_trade_id: tradeId,
    p_paid_cents: intent.amount_received || intent.amount,
    p_reference: intent.id,
  });
  if (error || typeof data !== "string") {
    const code = error?.code ?? null;
    // No such trade, one not waiting for a payment, or a payment short of
    // what's due: retrying won't change that, so staff sort it out.
    return {
      ok: false,
      retryable: code !== "GT404" && code !== "GT009" && code !== "GT008",
      code,
      message: error?.message ?? "No order came back.",
    };
  }
  try {
    const [bundle, settings] = await Promise.all([loadTradeBundle(admin, tradeId), loadTradeSettings(admin)]);
    if (bundle) {
      await logPaid(admin, bundle, intent);
      await afterFinalized(bundle, settings);
    }
  } catch (err) {
    console.error("[tradePayments] after-payment notices failed", tradeId, err);
  }
  return { ok: true, orderId: data };
}

/** A trade just finished: tell the customer, and staff there's an order to pack. */
export async function afterFinalized(bundle: TradeBundle, settings: TradeSettingsRow): Promise<void> {
  await sendTradeCustomerEmail(bundle, settings, { kind: "finalized" });
  if (bundle.trade.order_id) {
    try {
      // The usual "new order, ready to pack" email and push (idempotent per order).
      await sendOrderAdminNotification(bundle.trade.order_id);
    } catch (err) {
      console.error("[tradePayments] order notification failed", bundle.trade.id, err);
    }
  }
  // Cash owed for credit left over is the one thing the order doesn't tell staff.
  if (bundle.trade.excess_handling === "cash" && (bundle.trade.cash_payout_cents ?? 0) > 0) {
    await notifyTradeStaff(bundle, settings, { kind: "finalized" });
  }
}

/** The payment in the trade's history, once. */
async function logPaid(admin: Admin, bundle: TradeBundle, intent: Stripe.PaymentIntent): Promise<void> {
  if (bundle.events.some((e) => e.event === "paid")) return;
  const { error } = await admin.from("trade_events").insert({
    trade_request_id: bundle.trade.id,
    actor_type: "customer",
    actor_id: bundle.trade.user_id,
    actor_label: bundle.trade.customer_email,
    event: "paid",
    from_status: "awaiting_payment",
    to_status: bundle.trade.status,
    detail: { amount_cents: intent.amount_received || intent.amount, payment_intent: intent.id },
  });
  if (error) console.error("[tradePayments] couldn't log the payment", bundle.trade.id, error.message);
}

export function stripeConfigured(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY && process.env.STRIPE_SECRET_KEY.trim());
}

/** Open PaymentIntents that can still be used (or retired). */
export const REUSABLE_INTENT_STATUSES: ReadonlySet<string> = new Set([
  "requires_payment_method",
  "requires_confirmation",
  "requires_action",
]);
/** A payment in these states may still succeed. */
export const PAYMENT_UNDERWAY_STATUSES: ReadonlySet<string> = new Set(["processing", "requires_capture", "succeeded"]);

/**
 * Before a trade waiting for payment is declined or rejected: refuses while
 * a card payment may still go through (it would finish the trade), and
 * retires an unused one so it can't be paid afterwards.
 */
export async function stopOpenPayment(trade: TradeBundle["trade"]): Promise<void> {
  const ref = trade.payment_reference;
  if (trade.status !== "awaiting_payment" || !ref || !ref.startsWith("pi_") || !stripeConfigured()) return;
  const intent = await getStripe().paymentIntents.retrieve(ref);
  if (PAYMENT_UNDERWAY_STATUSES.has(intent.status)) {
    throw new HttpError(409, "A card payment for this trade is going through, so it can't be closed now. Check again in a minute.");
  }
  if (REUSABLE_INTENT_STATUSES.has(intent.status)) {
    await getStripe()
      .paymentIntents.cancel(intent.id)
      .catch((err: unknown) => console.error("[tradePayments] couldn't cancel PaymentIntent", intent.id, err));
  }
}
