import type Stripe from "stripe";
import { getSupabaseAdmin } from "./supabaseAdmin.js";
import { notifySortingStaff, sendSortingPaymentReceipt } from "./sortingEmails.js";

// Card payments for collection sorting quotes. Both the quote page (right
// after the card form, api/sorting-quote.ts) and the Stripe webhook
// (api/webhooks/stripe.ts) report a succeeded PaymentIntent here; the
// database counts each PaymentIntent once (sorting_record_payment), and only
// the call that actually recorded it sends the receipt and tells staff.

export type SortingCardPaymentResult =
  | { ok: true; inserted: boolean; amountPaidCents: number | null }
  | { ok: false; retryable: boolean; code: string | null; message: string };

/** Is this a collection sorting PaymentIntent (vs. a store order)? */
export function isSortingPaymentIntent(intent: Pick<Stripe.PaymentIntent, "metadata">): boolean {
  return Boolean(intent.metadata?.sorting_request_id);
}

export async function recordSortingCardPayment(intent: Stripe.PaymentIntent): Promise<SortingCardPaymentResult> {
  const requestId = intent.metadata?.sorting_request_id;
  if (!requestId) return { ok: false, retryable: false, code: null, message: "Not a sorting payment." };
  const amount = intent.amount_received || intent.amount;
  const { data, error } = await getSupabaseAdmin().rpc("sorting_record_payment", {
    p_request_id: requestId,
    p_amount_cents: amount,
    p_method: "card_online",
    p_reference: intent.id,
  });
  if (error) {
    // GGS03/GGS04: no such request, or nothing approved to pay — retrying
    // won't change that. Anything else (a dropped connection) is worth a retry.
    const code = error.code ?? null;
    return { ok: false, retryable: code !== "GGS03" && code !== "GGS04", code, message: error.message };
  }
  const result = (data ?? {}) as { payment_id?: string; inserted?: boolean; amount_paid_cents?: number };
  if (result.inserted && result.payment_id) {
    try {
      await sendSortingPaymentReceipt(result.payment_id);
    } catch (mailErr) {
      console.error("[sortingPayments] payment receipt failed:", mailErr);
    }
    await notifySortingStaff(requestId, { kind: "payment", paymentId: result.payment_id, amountCents: amount });
  }
  return {
    ok: true,
    inserted: Boolean(result.inserted),
    amountPaidCents: typeof result.amount_paid_cents === "number" ? result.amount_paid_cents : null,
  };
}
