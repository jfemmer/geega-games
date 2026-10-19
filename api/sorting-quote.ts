import type { VercelRequest, VercelResponse } from "@vercel/node";
import type Stripe from "stripe";
import { HttpError, methodNotAllowed, readJsonBody, sendJson } from "./_lib/http.js";
import { recordSortingCardPayment } from "./_lib/sortingPayments.js";
import { getSupabaseAdmin } from "./_lib/supabaseAdmin.js";
import { normalizeEmail } from "./_lib/tokens.js";
import { checkRateLimit, getClientIp } from "./_lib/rateLimit.js";
import { optionalUserId } from "./_lib/requestUser.js";
import { getStripe } from "./_lib/stripe.js";
import {
  UUID_RE,
  cleanText,
  customerRequestView,
  loadSortingQuotes,
  sortingDbError,
  stripeConfigured,
  verifySortingQuoteToken,
  type SortingRequestRow,
} from "./_lib/sorting.js";
import { notifySortingStaff, sendSortingQuoteApproved } from "./_lib/sortingEmails.js";
import { SORTING_LIMITS, sortingBalanceDueCents } from "../src/store/lib/sortingService.js";

// POST /api/sorting-quote
//
// PUBLIC: the customer's quote page (/collection-sorting/quote).
//
//   { action: "lookup" }                       → the customer's view of the request
//   { action: "approve", quoteId }             → approve the quote waiting on them
//   { action: "decline", quoteId, reason? }    → turn it down
//   { action: "pay" }                          → a card payment for the balance due
//   { action: "confirm-payment", paymentIntentId } → record it once Stripe says it succeeded
//
// Every call carries referenceNumber + email, matched exactly (a wrong pair
// and no such request look the same, like the sell-offer page). Approving,
// declining and paying also need the token from the quote email's link, or
// the signed-in account the request belongs to.
//
// Amounts never come from the browser: what's charged is the approved
// quote's total minus what's been paid, read fresh from the database, and
// the database itself refuses to change a quote once it's been sent
// (see the collection_sorting_service migration). Approving twice, or a
// payment reported by both this page and the Stripe webhook, counts once.

const RATE_LIMIT_PER_WINDOW = 30;
const RATE_WINDOW_MS = 10 * 60_000;
const ACTIONS = new Set(["lookup", "approve", "decline", "pay", "confirm-payment"]);
/** Stripe won't take a US card charge under 50 cents. */
const MIN_CARD_CHARGE_CENTS = 50;
const REUSABLE_INTENT_STATUSES = new Set(["requires_payment_method", "requires_confirmation", "requires_action"]);

interface Body {
  action?: unknown;
  referenceNumber?: unknown;
  email?: unknown;
  token?: unknown;
  quoteId?: unknown;
  reason?: unknown;
  paymentIntentId?: unknown;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return methodNotAllowed(res, ["POST"]);
  try {
    const ip = getClientIp(req);
    const rl = checkRateLimit("sorting-quote", ip, RATE_LIMIT_PER_WINDOW, RATE_WINDOW_MS);
    if (!rl.allowed) {
      res.setHeader("Retry-After", String(Math.ceil((rl.retryAfterMs ?? 1000) / 1000)));
      throw new HttpError(429, "Too many attempts. Please wait a bit and try again.");
    }

    const body = (await readJsonBody(req, 4 * 1024)) as Body;
    const action = typeof body.action === "string" && ACTIONS.has(body.action) ? body.action : null;
    const referenceNumber = cleanText(body.referenceNumber, 40);
    const email = normalizeEmail(body.email);
    if (!action || !referenceNumber || !email) {
      throw new HttpError(400, "Your reference number and email are required.");
    }

    const admin = getSupabaseAdmin();
    const { data, error } = await admin
      .from("sorting_requests")
      .select("*")
      // Reference numbers are stored upper case and emails lower case
      // (normalizeEmail at submit), so plain equality is exact — and, unlike
      // ilike, can't be widened by a "%" in a crafted email.
      .eq("reference_number", referenceNumber.toUpperCase())
      .eq("email", email)
      .maybeSingle();
    if (error) throw new HttpError(500, "We couldn't look up your request. Please try again.");
    const request = (data as SortingRequestRow | null) ?? null;
    if (!request) {
      throw new HttpError(404, "We couldn't find a sorting request with that reference number and email.");
    }

    const canRespond = await mayRespond(req, request, body.token);
    const view = async (extra: Record<string, unknown> = {}) => {
      const fresh = await reload(request.id);
      const quotes = await loadSortingQuotes(request.id);
      return sendJson(res, 200, { ok: true, request: customerRequestView(fresh, quotes, canRespond), ...extra });
    };

    if (action === "lookup") return view();

    if (!canRespond) {
      throw new HttpError(
        403,
        "To approve or pay, open the link in your quote email — or sign in to the account you used for this request.",
      );
    }

    if (action === "approve" || action === "decline") {
      const quoteId = typeof body.quoteId === "string" && UUID_RE.test(body.quoteId) ? body.quoteId : null;
      if (!quoteId) throw new HttpError(400, "Which quote are you responding to?");
      if (action === "approve") {
        const { data: result, error: rpcErr } = await admin.rpc("sorting_accept_quote", {
          p_request_id: request.id,
          p_quote_id: quoteId,
        });
        if (rpcErr) throw sortingDbError(rpcErr, "We couldn't approve your quote. Please try again.");
        if (!(result as { already?: boolean } | null)?.already) {
          try {
            await sendSortingQuoteApproved(quoteId);
          } catch (mailErr) {
            console.error("[/api/sorting-quote] approval email failed:", mailErr);
          }
          await notifySortingStaff(request.id, { kind: "quote_approved", quoteId });
        }
        return view({ approved: true });
      }
      const reason = cleanText(body.reason, SORTING_LIMITS.maxDeclineReason);
      const { data: result, error: rpcErr } = await admin.rpc("sorting_decline_quote", {
        p_request_id: request.id,
        p_quote_id: quoteId,
        p_reason: reason ?? undefined,
      });
      if (rpcErr) throw sortingDbError(rpcErr, "We couldn't record your answer. Please try again.");
      if (!(result as { already?: boolean } | null)?.already) {
        await notifySortingStaff(request.id, { kind: "quote_declined", quoteId, reason });
      }
      return view({ declined: true });
    }

    if (!stripeConfigured()) {
      throw new HttpError(503, "Online payment isn't available right now. Reply to your quote email and we'll sort out payment.");
    }

    if (action === "pay") {
      const payment = await startPayment(request);
      if (payment.paid) return view({ paid: true });
      return sendJson(res, 200, { ok: true, clientSecret: payment.clientSecret, amountDueCents: payment.amountDueCents });
    }

    // confirm-payment
    const intentId = typeof body.paymentIntentId === "string" && /^pi_[A-Za-z0-9]{1,250}$/.test(body.paymentIntentId)
      ? body.paymentIntentId
      : null;
    if (!intentId) throw new HttpError(400, "Which payment are you confirming?");
    const intent = await getStripe().paymentIntents.retrieve(intentId);
    if (intent.metadata?.sorting_request_id !== request.id) {
      throw new HttpError(400, "That payment isn't for this request.");
    }
    if (intent.status === "succeeded") await recordCardPayment(intent);
    return view({ paymentStatus: intent.status });
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 500;
    const message = err instanceof HttpError ? err.message : "Unexpected server error.";
    if (!(err instanceof HttpError)) console.error("[/api/sorting-quote] error:", err);
    return sendJson(res, status, { ok: false, message });
  }
}

/** The quote-link token, or the signed-in owner of the request. */
async function mayRespond(req: VercelRequest, request: SortingRequestRow, token: unknown): Promise<boolean> {
  if (verifySortingQuoteToken(request.id, token)) return true;
  if (!request.user_id) return false;
  const userId = await optionalUserId(req);
  return userId !== null && userId === request.user_id;
}

async function reload(id: string): Promise<SortingRequestRow> {
  const { data, error } = await getSupabaseAdmin().from("sorting_requests").select("*").eq("id", id).single();
  if (error || !data) throw new HttpError(500, "We couldn't load your request. Please try again.");
  return data as SortingRequestRow;
}

/**
 * A PaymentIntent for exactly the balance due on the approved quote. Reuses
 * the one already open for the same quote and amount (so reloading the page
 * doesn't pile up intents), and records one that already went through.
 */
async function startPayment(
  request: SortingRequestRow,
): Promise<{ paid: true } | { paid: false; clientSecret: string; amountDueCents: number }> {
  const admin = getSupabaseAdmin();
  if (!request.accepted_quote_id) throw new HttpError(409, "Approve your quote before paying.");
  const { data: quote, error } = await admin
    .from("sorting_quotes")
    .select("id, total_cents, status")
    .eq("id", request.accepted_quote_id)
    .maybeSingle();
  if (error || !quote) throw new HttpError(500, "We couldn't load your approved quote. Please try again.");

  const stripe = getStripe();
  let paidCents = request.amount_paid_cents;

  if (request.stripe_payment_intent_id) {
    const existing = await stripe.paymentIntents.retrieve(request.stripe_payment_intent_id);
    if (existing.status === "succeeded") {
      paidCents = (await recordCardPayment(existing)) ?? paidCents;
    } else {
      const due = sortingBalanceDueCents(quote.total_cents, paidCents);
      if (
        REUSABLE_INTENT_STATUSES.has(existing.status) &&
        existing.amount === due &&
        existing.metadata?.sorting_quote_id === quote.id &&
        existing.client_secret
      ) {
        return { paid: false, clientSecret: existing.client_secret, amountDueCents: due };
      }
      if (REUSABLE_INTENT_STATUSES.has(existing.status)) {
        // Stale (the approved total or what's paid changed): retire it so it can't be used.
        await stripe.paymentIntents.cancel(existing.id).catch((cancelErr: unknown) => {
          console.error("[/api/sorting-quote] couldn't cancel stale PaymentIntent", existing.id, cancelErr);
        });
      }
    }
  }

  const due = sortingBalanceDueCents(quote.total_cents, paidCents);
  if (due <= 0) return { paid: true };
  if (due < MIN_CARD_CHARGE_CENTS) {
    throw new HttpError(409, "Your balance is too small to pay by card online. We'll settle it with you directly.");
  }

  const intent = await stripe.paymentIntents.create(
    {
      amount: due,
      currency: "usd",
      // Cards only, like checkout (api/checkout/create-payment-intent.ts):
      // never whatever else is switched on in the Stripe Dashboard. Apple Pay
      // and Google Pay still appear — Stripe treats them as cards.
      payment_method_types: ["card"],
      receipt_email: request.email,
      description: `Geega Games collection sorting ${request.reference_number}`,
      metadata: {
        kind: "sorting",
        sorting_request_id: request.id,
        sorting_quote_id: quote.id,
        reference_number: request.reference_number,
      },
    },
    // Same request, quote and amount paid so far → the same intent.
    { idempotencyKey: `sorting-pi-${request.id}-${quote.id}-${paidCents}` },
  );
  const { error: saveErr } = await admin
    .from("sorting_requests")
    .update({ stripe_payment_intent_id: intent.id })
    .eq("id", request.id);
  if (saveErr) console.error("[/api/sorting-quote] couldn't save the PaymentIntent id", request.id, saveErr);
  if (!intent.client_secret) throw new HttpError(500, "We couldn't start the payment. Please try again.");
  return { paid: false, clientSecret: intent.client_secret, amountDueCents: due };
}

/** Record a succeeded card payment (once per PaymentIntent); returns the new amount paid. */
async function recordCardPayment(intent: Stripe.PaymentIntent): Promise<number | null> {
  const result = await recordSortingCardPayment(intent);
  if (!result.ok) {
    console.error("[/api/sorting-quote] couldn't record payment", intent.id, result.code, result.message);
    throw new HttpError(
      500,
      "Your payment went through, but we couldn't update your quote yet. There's no need to pay again — we'll confirm by email.",
    );
  }
  return result.amountPaidCents;
}
