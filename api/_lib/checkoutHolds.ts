import type Stripe from "stripe";
import { getSupabaseAdmin } from "./supabaseAdmin.js";
import { optionalEnv } from "./env.js";
import { getStripe } from "./stripe.js";

// Checkout holds. Clicking "Continue to payment" creates a pending_payment
// order that holds its cards (checkout_create_order decrements stock so two
// customers can't pay for the same last copy). A hold that isn't paid must
// give the cards back — see migration 20260924050000 for the DB side.
//
// Holds are released:
//   * after HOLD_MINUTES, by the api/checkout/expire-holds worker, and
//   * as soon as the same customer starts checkout again
//     (api/checkout/create-payment-intent.ts), so they never block
//     themselves out of their own cart.
//
// Releasing is done here rather than purely in SQL because an open Stripe
// PaymentIntent must be cancelled FIRST — otherwise a stale payment tab could
// still charge for an order whose cards are already back on sale. A hold
// whose payment is already processing/succeeded is left alone; its webhook
// will mark it paid. (A PayPal approval needs nothing here: the server
// refuses to capture a cancelled order.)

export const HOLD_MINUTES = 30;

type HoldRow = { id: string; payment_reference: string | null };

export type ReleaseOutcome = "released" | "payment_in_flight" | "failed";

const CANCELABLE: ReadonlySet<Stripe.PaymentIntent.Status> = new Set([
  "requires_payment_method",
  "requires_confirmation",
  "requires_action",
  "requires_capture",
]);

async function findStripeIntents(hold: HoldRow): Promise<Stripe.PaymentIntent[]> {
  const stripe = getStripe();
  // New orders store their PaymentIntent id when it's created; older ones
  // (and any where that write failed) fall back to a metadata search.
  if (hold.payment_reference?.startsWith("pi_")) {
    try {
      return [await stripe.paymentIntents.retrieve(hold.payment_reference)];
    } catch (err) {
      // "No such payment_intent": it belongs to the other Stripe mode (e.g. a
      // test-mode checkout still open when the site switched to live keys),
      // so it can't take money under the current key. Nothing to cancel.
      if ((err as { code?: string }).code === "resource_missing") return [];
      throw err;
    }
  }
  const found = await stripe.paymentIntents.search({
    query: `metadata['order_id']:'${hold.id.replace(/'/g, "")}'`,
    limit: 10,
  });
  return found.data;
}

/** Cancels a hold's Stripe payment (if any) and returns its cards to stock. */
export async function releaseHold(hold: HoldRow, reason: string): Promise<ReleaseOutcome> {
  if (optionalEnv("STRIPE_SECRET_KEY")) {
    try {
      const stripe = getStripe();
      for (const pi of await findStripeIntents(hold)) {
        if (pi.status === "processing" || pi.status === "succeeded") return "payment_in_flight";
        if (CANCELABLE.has(pi.status)) {
          try {
            await stripe.paymentIntents.cancel(pi.id, { cancellation_reason: "abandoned" });
          } catch (err) {
            // Most likely the customer confirmed it at this very moment.
            const now = await stripe.paymentIntents.retrieve(pi.id);
            if (now.status !== "canceled") return "payment_in_flight";
            void err;
          }
        }
      }
    } catch (err) {
      // Can't prove there's no live payment — don't release; retry next run.
      console.error("[checkout-holds] Stripe check failed", { orderId: hold.id, err });
      return "failed";
    }
  }

  const { error } = await getSupabaseAdmin().rpc("cancel_unpaid_order", {
    p_order_id: hold.id,
    p_reason: reason,
  });
  if (error) {
    // e.g. it was paid or moved to processing a moment ago — that's fine.
    console.warn("[checkout-holds] cancel_unpaid_order refused", { orderId: hold.id, message: error.message });
    return "failed";
  }
  return "released";
}

function openHolds() {
  return getSupabaseAdmin()
    .from("orders")
    .select("id, payment_reference")
    .eq("channel", "online")
    .eq("status", "pending_payment")
    .eq("payment_status", "unpaid");
}

/** Releases every open hold the customer has (called before a new checkout). */
export async function releaseUserHolds(userId: string): Promise<void> {
  const { data, error } = await openHolds().eq("user_id", userId);
  if (error) {
    console.error("[checkout-holds] could not list user holds", error);
    return;
  }
  for (const hold of (data ?? []) as HoldRow[]) {
    await releaseHold(hold, "Replaced by a new checkout");
  }
}

/** Releases holds older than HOLD_MINUTES. Returns counts for the worker log. */
export async function expireStaleHolds(limit = 50): Promise<Record<ReleaseOutcome, number>> {
  const cutoff = new Date(Date.now() - HOLD_MINUTES * 60_000).toISOString();
  const { data, error } = await openHolds()
    .lt("created_at", cutoff)
    .order("created_at", { ascending: true })
    .limit(limit);
  if (error) throw new Error(`could not list stale holds: ${error.message}`);

  const counts: Record<ReleaseOutcome, number> = { released: 0, payment_in_flight: 0, failed: 0 };
  for (const hold of (data ?? []) as HoldRow[]) {
    counts[await releaseHold(hold, "Checkout expired")] += 1;
  }
  return counts;
}
