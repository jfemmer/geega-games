import type Stripe from "stripe";
import { getSupabaseAdmin } from "./supabaseAdmin.js";
import { getStripe } from "./stripe.js";
import { HttpError } from "./http.js";
import {
  customerStanding,
  loadTradeBundle,
  loadTradeRow,
  loadTradeSettings,
  shipDeadline,
  type Admin,
  type TradeRow,
  type TradeSettingsRow,
} from "./tradeCenter.js";
import { notifyTradeStaff, sendTradeCustomerEmail, type DepositRefundReason, type ShortLine } from "./tradeCenterEmails.js";
import { tradeLabel } from "../../src/store/lib/tradeCenter.js";

// The refundable reservation deposit, collected and refunded through Stripe
// (the store's existing payment provider): a PaymentIntent collected with
// Stripe's card element on the trade page, so card details never touch our
// servers or database.
//
//   * Paying it reserves our cards (trade_reserve, all or none). The trade
//     page and the Stripe webhook (payment_intent.succeeded, metadata kind
//     trade_deposit) both report a succeeded payment here; whichever is
//     second finds it already done.
//   * A payment that can't reserve anything (a card sold first, the trade
//     closed meanwhile, a stray second payment) is refunded at once, in full,
//     and staff are told.
//   * Refunds are always the full amount paid: Stripe keeps its processing
//     fee, which we absorb (we note it on the trade for the books). Each
//     refund attempt has its own idempotency key, so a retried request never
//     refunds twice, and Stripe itself refuses to refund more than was paid.
//   * Refund results come back from the API at once for most cards, and
//     otherwise by webhook (refund.updated, refund.failed, charge.refunded)
//     or the worker's reconciliation, whichever is first.

export const DEPOSIT_KIND = "trade_deposit";
export const DEPOSIT_REFUND_KIND = "trade_deposit_refund";

/** Open PaymentIntents that can still be used (or retired). */
const REUSABLE: ReadonlySet<string> = new Set(["requires_payment_method", "requires_confirmation", "requires_action"]);
/** A payment in these states may still succeed. */
const UNDERWAY: ReadonlySet<string> = new Set(["processing", "requires_capture"]);

export function isTradeDepositIntent(intent: Pick<Stripe.PaymentIntent, "metadata">): boolean {
  return intent.metadata?.kind === DEPOSIT_KIND && Boolean(intent.metadata?.trade_request_id);
}

export function stripeConfigured(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY && process.env.STRIPE_SECRET_KEY.trim());
}

// ---------------------------------------------------------------------------
// Collecting it
// ---------------------------------------------------------------------------

export type DepositIntent =
  | { state: "open"; intentId: string; clientSecret: string; created: boolean }
  | { state: "succeeded"; intent: Stripe.PaymentIntent };

/**
 * The PaymentIntent for this trade's deposit: the open one for the same
 * amount when there is one (reloading the page doesn't pile up payments),
 * otherwise a new one. The amount is the trade's deposit as stored by the
 * database, never anything the browser sent.
 */
export async function depositIntentFor(trade: TradeRow): Promise<DepositIntent> {
  const amount = trade.deposit_cents;
  if (amount < 50) throw new HttpError(409, "This trade doesn't need a deposit.");
  const stripe = getStripe();
  if (trade.deposit_payment_intent) {
    const existing = await stripe.paymentIntents.retrieve(trade.deposit_payment_intent);
    if (existing.status === "succeeded") return { state: "succeeded", intent: existing };
    if (UNDERWAY.has(existing.status)) throw new HttpError(409, "Your deposit payment is still going through. Refresh in a minute.");
    if (
      REUSABLE.has(existing.status) &&
      existing.amount === amount &&
      existing.metadata?.trade_request_id === trade.id &&
      existing.client_secret
    ) {
      return { state: "open", intentId: existing.id, clientSecret: existing.client_secret, created: false };
    }
    if (REUSABLE.has(existing.status)) {
      await stripe.paymentIntents.cancel(existing.id).catch((err: unknown) => {
        console.error("[tradeDeposits] couldn't cancel a stale deposit PaymentIntent", existing.id, err);
      });
    }
  }
  const intent = await stripe.paymentIntents.create(
    {
      amount,
      currency: "usd",
      // Cards only, like checkout. Apple Pay and Google Pay still appear.
      payment_method_types: ["card"],
      receipt_email: trade.customer_email ?? undefined,
      description: `Refundable reservation deposit, Geega Games trade ${tradeLabel(trade.trade_number)}`,
      metadata: { kind: DEPOSIT_KIND, trade_request_id: trade.id, trade_number: String(trade.trade_number) },
    },
    // A retried confirm gets the same PaymentIntent; replacing one (a changed
    // amount, a retired payment) gets a new one.
    { idempotencyKey: `trade-deposit-${trade.id}-${amount}-${trade.approved_at ?? ""}-${trade.deposit_payment_intent ?? "first"}` },
  );
  if (!intent.client_secret) throw new HttpError(500, "We couldn't start the deposit payment. Try again.");
  return { state: "open", intentId: intent.id, clientSecret: intent.client_secret, created: true };
}

/**
 * Before the deposit requirement changes, the trade goes back to the
 * customer, or it closes: retires an unused payment so it can't be paid
 * afterwards. Refuses while one may still go through. Returns a payment
 * that already succeeded (the caller records it first).
 */
export async function retireDepositIntent(trade: TradeRow): Promise<Stripe.PaymentIntent | null> {
  const ref = trade.deposit_payment_intent;
  if (!ref || trade.deposit_paid_at || !stripeConfigured()) return null;
  const intent = await getStripe().paymentIntents.retrieve(ref);
  if (intent.status === "succeeded") return intent;
  if (UNDERWAY.has(intent.status)) {
    throw new HttpError(409, "A deposit payment for this trade is going through, so it can't be changed now. Check again in a minute.");
  }
  if (REUSABLE.has(intent.status)) {
    await getStripe()
      .paymentIntents.cancel(intent.id)
      .catch((err: unknown) => console.error("[tradeDeposits] couldn't cancel deposit PaymentIntent", intent.id, err));
  }
  return null;
}

export type DepositPaymentResult =
  | { ok: true; outcome: "reserved" | "already" | "conflict" | "refunded" }
  | { ok: false; retryable: boolean; code: string | null; message: string };

/**
 * A deposit PaymentIntent succeeded: reserve the trade's cards, or refund
 * the payment when it can't. Idempotent. Never throws for a known outcome.
 */
export async function recordDepositPayment(intent: Stripe.PaymentIntent, now = Date.now()): Promise<DepositPaymentResult> {
  const tradeId = intent.metadata?.trade_request_id;
  if (!tradeId || intent.metadata?.kind !== DEPOSIT_KIND) {
    return { ok: false, retryable: false, code: null, message: "Not a trade deposit." };
  }
  if (intent.status !== "succeeded") return { ok: false, retryable: false, code: null, message: `Payment is ${intent.status}.` };
  const admin = getSupabaseAdmin();
  let settings: TradeSettingsRow;
  let trade: TradeRow | null;
  try {
    [settings, trade] = await Promise.all([loadTradeSettings(admin), loadTradeRow(admin, tradeId)]);
  } catch (err) {
    return { ok: false, retryable: true, code: null, message: err instanceof Error ? err.message : String(err) };
  }
  if (!trade) return { ok: false, retryable: false, code: "GT404", message: "No such trade." };

  // The window shown when they confirmed; worked out again if it wasn't kept.
  let shipDays = trade.ship_days;
  if (!shipDays) {
    try {
      shipDays = (await customerStanding(admin, trade.user_id, settings)).privileges.shipDays;
    } catch {
      shipDays = settings.ship_days_new;
    }
  }
  const paid = intent.amount_received || intent.amount;
  const { data, error } = await admin.rpc("trade_reserve", {
    p_trade_id: trade.id,
    p_payment_intent: intent.id,
    p_paid_cents: paid,
    p_ship_days: shipDays,
    p_ship_by: shipDeadline(now, shipDays, settings),
  });
  if (error) {
    const code = error.code ?? null;
    return { ok: false, retryable: code !== "GT404" && code !== "GT010", code, message: error.message };
  }
  const row = Array.isArray(data) ? data[0] : null;
  const result = row?.result ?? "";

  try {
    if (result === "reserved") {
      await recordDepositFee(admin, trade.id, intent.id);
      const bundle = await loadTradeBundle(admin, trade.id);
      if (bundle) {
        await sendTradeCustomerEmail(bundle, settings, { kind: "reserved" });
        await notifyTradeStaff(bundle, settings, { kind: "reserved" });
      }
      return { ok: true, outcome: "reserved" };
    }
    if (result === "already") return { ok: true, outcome: "already" };
    if (result === "conflict") {
      const short = (Array.isArray(row?.short_lines) ? row.short_lines : []) as unknown as ShortLine[];
      const bundle = await loadTradeBundle(admin, trade.id);
      if (bundle) {
        await sendTradeCustomerEmail(bundle, settings, { kind: "cards_unavailable", short, refund: true });
        await notifyTradeStaff(bundle, settings, { kind: "payment_refunded", why: "Our cards sold before the deposit went through", paymentIntentId: intent.id });
      }
      await processDepositRefund(admin, trade.id, { notifyStarted: false });
      return { ok: true, outcome: "conflict" };
    }
    if (result === "refund") {
      const bundle = await loadTradeBundle(admin, trade.id);
      if (bundle) {
        await notifyTradeStaff(bundle, settings, {
          kind: "payment_refunded",
          why: "The trade wasn't waiting for this deposit any more (closed or changed)",
          paymentIntentId: intent.id,
        });
      }
      await processDepositRefund(admin, trade.id, { notifyStarted: true, why: "unusable" });
      return { ok: true, outcome: "refunded" };
    }
    if (result === "other_payment") {
      await refundStrayPayment(admin, settings, trade.id, intent);
      return { ok: true, outcome: "refunded" };
    }
  } catch (err) {
    console.error("[tradeDeposits] after-payment work failed", trade.id, err);
    return { ok: true, outcome: result === "conflict" ? "conflict" : "reserved" };
  }
  return { ok: false, retryable: false, code: null, message: `Unknown result ${result}` };
}

/** Stripe's fee on the deposit, noted for the books (best effort). */
async function recordDepositFee(admin: Admin, tradeId: string, intentId: string): Promise<void> {
  try {
    const pi = await getStripe().paymentIntents.retrieve(intentId, { expand: ["latest_charge.balance_transaction"] });
    const charge = pi.latest_charge;
    const bt = charge && typeof charge === "object" ? charge.balance_transaction : null;
    const fee = bt && typeof bt === "object" ? bt.fee : null;
    if (typeof fee === "number") {
      await admin.from("trade_requests").update({ deposit_fee_cents: fee }).eq("id", tradeId);
    }
  } catch (err) {
    console.error("[tradeDeposits] couldn't read the deposit fee", tradeId, err);
  }
}

/**
 * A second payment that isn't the trade's current deposit (paid in another
 * tab after the first was replaced, say): refunded in full, once.
 */
async function refundStrayPayment(admin: Admin, settings: TradeSettingsRow, tradeId: string, intent: Stripe.PaymentIntent): Promise<void> {
  const refund = await getStripe().refunds.create(
    {
      payment_intent: intent.id,
      reason: "duplicate",
      metadata: { kind: DEPOSIT_REFUND_KIND, trade_request_id: tradeId, stray: "true" },
    },
    { idempotencyKey: `trade-stray-refund-${intent.id}` },
  );
  const { error } = await admin.from("trade_events").insert({
    trade_request_id: tradeId,
    actor_type: "system",
    event: "deposit_duplicate_refunded",
    detail: { payment_intent: intent.id, refund_id: refund.id, amount_cents: intent.amount_received || intent.amount, refund_status: refund.status },
  });
  if (error) console.error("[tradeDeposits] couldn't log the duplicate refund", tradeId, error.message);
  const bundle = await loadTradeBundle(admin, tradeId);
  if (bundle) {
    await notifyTradeStaff(bundle, settings, {
      kind: "payment_refunded",
      why: "A second deposit payment for the same trade",
      paymentIntentId: intent.id,
    });
  }
}

// ---------------------------------------------------------------------------
// Refunding it
// ---------------------------------------------------------------------------

export type RefundOutcome = "refunded" | "pending" | "failed" | "skipped";

/**
 * Refunds a deposit the database has marked refund_pending, in full: creates
 * the refund (once per attempt) or checks the one already created, then
 * records what Stripe says. `notifyStarted`: email the customer that it
 * started (skip when the email that triggered it already says so).
 */
export async function processDepositRefund(
  admin: Admin,
  tradeId: string,
  options: { notifyStarted?: boolean; why?: DepositRefundReason } = {},
): Promise<RefundOutcome> {
  if (!stripeConfigured()) return "skipped";
  const trade = await loadTradeRow(admin, tradeId);
  if (!trade || trade.deposit_status !== "refund_pending") return "skipped";
  if (!trade.deposit_payment_intent || !(trade.deposit_paid_cents && trade.deposit_paid_cents > 0)) {
    console.error("[tradeDeposits] refund_pending without a paid deposit", tradeId);
    return "skipped";
  }
  const stripe = getStripe();
  let refund: Stripe.Refund;
  let created = false;
  try {
    if (trade.deposit_refund_id) {
      refund = await stripe.refunds.retrieve(trade.deposit_refund_id);
    } else {
      refund = await stripe.refunds.create(
        {
          payment_intent: trade.deposit_payment_intent,
          amount: trade.deposit_paid_cents,
          reason: "requested_by_customer",
          metadata: {
            kind: DEPOSIT_REFUND_KIND,
            trade_request_id: trade.id,
            attempt: String(trade.deposit_refund_attempts),
          },
        },
        { idempotencyKey: `trade-deposit-refund-${trade.id}-${trade.deposit_refund_attempts}` },
      );
      created = true;
      const { error } = await admin.rpc("trade_deposit_update", {
        p_trade_id: trade.id,
        p_to: "refund_pending",
        p_refund_id: refund.id,
        p_failure: null,
        p_note: null,
        p_actor_type: "system",
        p_actor_id: null,
        p_actor_label: "stripe",
      });
      if (error) console.error("[tradeDeposits] couldn't save the refund id", trade.id, refund.id, error.message);
    }
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code === "charge_already_refunded") {
      // Refunded some other way (the Stripe dashboard): record it.
      await applyRefundStatus(admin, trade.id, null, "succeeded", null);
      return "refunded";
    }
    console.error("[tradeDeposits] refund failed to start", trade.id, err);
    return "pending"; // retried by the worker
  }

  if (created && options.notifyStarted) {
    const bundle = await loadTradeBundle(admin, trade.id);
    const settings = await loadTradeSettings(admin).catch(() => null);
    if (bundle && settings) await sendTradeCustomerEmail(bundle, settings, { kind: "deposit_refund_started", why: options.why ?? "staff" });
  }
  return applyRefundStatus(admin, trade.id, refund.id, refund.status ?? "pending", refund.failure_reason ?? null);
}

/** What Stripe says about a deposit refund, recorded (and the emails that go with it). */
export async function applyRefundStatus(
  admin: Admin,
  tradeId: string,
  refundId: string | null,
  status: string,
  failureReason: string | null,
): Promise<RefundOutcome> {
  if (status === "succeeded") {
    const { data, error } = await admin.rpc("trade_deposit_update", {
      p_trade_id: tradeId,
      p_to: "refunded",
      p_refund_id: refundId,
      p_failure: null,
      p_note: null,
      p_actor_type: "system",
      p_actor_id: null,
      p_actor_label: "stripe",
    });
    if (error) {
      console.error("[tradeDeposits] couldn't mark the deposit refunded", tradeId, error.message);
      return "pending";
    }
    if (data === true) {
      const [bundle, settings] = await Promise.all([loadTradeBundle(admin, tradeId), loadTradeSettings(admin).catch(() => null)]);
      if (bundle && settings) await sendTradeCustomerEmail(bundle, settings, { kind: "deposit_refunded" });
    }
    return "refunded";
  }
  if (status === "failed" || status === "canceled") {
    const { data, error } = await admin.rpc("trade_deposit_update", {
      p_trade_id: tradeId,
      p_to: "refund_failed",
      p_refund_id: refundId,
      p_failure: failureReason ?? status,
      p_note: null,
      p_actor_type: "system",
      p_actor_id: null,
      p_actor_label: "stripe",
    });
    if (error) {
      console.error("[tradeDeposits] couldn't mark the refund failed", tradeId, error.message);
      return "pending";
    }
    if (data === true) {
      const [bundle, settings] = await Promise.all([loadTradeBundle(admin, tradeId), loadTradeSettings(admin).catch(() => null)]);
      if (bundle && settings) await notifyTradeStaff(bundle, settings, { kind: "refund_failed" });
    }
    return "failed";
  }
  return "pending";
}

/**
 * A refund event from Stripe (refund.created, refund.updated, refund.failed,
 * charge.refund.updated): find the trade it belongs to and record its
 * status. Returns false when the refund isn't a trade deposit's.
 */
export async function recordRefundEvent(refund: Stripe.Refund): Promise<boolean> {
  const admin = getSupabaseAdmin();
  let tradeId = refund.metadata?.kind === DEPOSIT_REFUND_KIND ? (refund.metadata?.trade_request_id ?? null) : null;
  if (!tradeId) {
    const { data } = await admin.from("trade_requests").select("id").eq("deposit_refund_id", refund.id).maybeSingle();
    tradeId = data?.id ?? null;
  }
  if (!tradeId || refund.metadata?.stray === "true") return Boolean(tradeId);
  const trade = await loadTradeRow(admin, tradeId);
  if (!trade || trade.deposit_status !== "refund_pending") return true;
  if (trade.deposit_refund_id && trade.deposit_refund_id !== refund.id) return true; // an older attempt
  await applyRefundStatus(admin, tradeId, refund.id, refund.status ?? "pending", refund.failure_reason ?? null);
  return true;
}

/** Deposits we still hold, or kept, that a refund outside the Trade Center can reach. */
const REFUNDABLE_ELSEWHERE: ReadonlySet<string> = new Set(["paid", "forfeiture_review", "refund_failed", "forfeited"]);

/**
 * charge.refunded: the deposit's charge was refunded. A refund we started is
 * checked and recorded. A deposit we still held (or kept) that was refunded
 * in full some other way, from the Stripe dashboard, is recorded as refunded
 * too, so the trade never shows money we no longer have (and nobody keeps or
 * refunds it twice). A partial refund changes nothing here: deposits are
 * refunded in full or not at all, and staff see a partial one in Stripe.
 */
export async function recordChargeRefunded(charge: Stripe.Charge): Promise<boolean> {
  const pi = typeof charge.payment_intent === "string" ? charge.payment_intent : charge.payment_intent?.id;
  if (!pi) return false;
  const admin = getSupabaseAdmin();
  const { data } = await admin.from("trade_requests").select("id, deposit_status").eq("deposit_payment_intent", pi).maybeSingle();
  if (!data) return false;
  if (!charge.refunded) return true;
  if (data.deposit_status === "refund_pending") {
    await processDepositRefund(admin, data.id);
    return true;
  }
  if (!REFUNDABLE_ELSEWHERE.has(data.deposit_status)) return true;
  const { data: moved, error } = await admin.rpc("trade_deposit_update", {
    p_trade_id: data.id,
    p_to: "refund_pending",
    p_refund_id: null,
    p_failure: null,
    p_note: "Refunded in the Stripe dashboard",
    // Undoing a kept deposit is staff's decision, and only a person refunds
    // a charge in the dashboard (the Trade Center refunds through the trade).
    p_actor_type: data.deposit_status === "forfeited" ? "staff" : "system",
    p_actor_id: null,
    p_actor_label: "Stripe dashboard",
  });
  if (error) {
    console.error("[tradeDeposits] couldn't record a refund made in Stripe", data.id, error.message);
    return true;
  }
  if (moved === true) await applyRefundStatus(admin, data.id, null, "succeeded", null);
  return true;
}

/** A deposit payment failed (card declined…): noted on the trade; the customer can try again. */
export async function recordDepositFailure(intent: Stripe.PaymentIntent): Promise<void> {
  const tradeId = intent.metadata?.trade_request_id;
  if (!tradeId) return;
  const admin = getSupabaseAdmin();
  const message = intent.last_payment_error?.message ?? null;
  const { error } = await admin.from("trade_events").insert({
    trade_request_id: tradeId,
    actor_type: "system",
    event: "deposit_payment_failed",
    detail: { payment_intent: intent.id, code: intent.last_payment_error?.code ?? null, message },
  });
  if (error) console.error("[tradeDeposits] couldn't log the failed deposit", tradeId, error.message);
}
