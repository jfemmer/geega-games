import type { VercelRequest, VercelResponse } from "@vercel/node";
import crypto from "node:crypto";
import type { Json } from "../src/types/database.js";
import { HttpError, methodNotAllowed, readJsonBody, sendJson } from "./_lib/http.js";
import { getSupabaseAdmin } from "./_lib/supabaseAdmin.js";
import { checkRateLimit, getClientIp } from "./_lib/rateLimit.js";
import { getStripe } from "./_lib/stripe.js";
import {
  PAYMENT_UNDERWAY_STATUSES,
  REUSABLE_INTENT_STATUSES,
  afterFinalized,
  recordTradeCardPayment,
  stopOpenPayment,
} from "./_lib/tradePayments.js";
import {
  DEPOSIT_KIND,
  depositIntentFor,
  processDepositRefund,
  recordDepositPayment,
  retireDepositIntent,
  stripeConfigured,
} from "./_lib/tradeDeposits.js";
import { autoTracking, checkTradeTracking, followUpScan, trackingConnected } from "./_lib/tradeTracking.js";
import {
  DISPUTE_BUCKET,
  UUID_RE,
  bundleAvailability,
  cleanText,
  customerStanding,
  customerSummaryView,
  customerTradeView,
  loadCustomerBundle,
  loadTradeSettings,
  priceOffers,
  readOfferInputs,
  readShipTo,
  readTradeId,
  readWantedInputs,
  requireCustomer,
  savedShipTo,
  shipDeadline,
  termsOf,
  tradeDbError,
  type Admin,
  type TradeBundle,
  type TradeCustomer,
  type TradeOfferRow,
  type TradeSettingsRow,
} from "./_lib/tradeCenter.js";
import { notifyTradeStaff, sendTradeCustomerEmail, type ShortLine } from "./_lib/tradeCenterEmails.js";
import {
  CUSTOMER_CANCELABLE_STATUSES,
  CUSTOMER_EDITABLE_STATUSES,
  CUSTOMER_WITHDRAW_STATUSES,
  DISPUTE_FILE_TYPES,
  TRADE_LIMITS,
  isConditionCode,
  isTradeFinish,
  tradeLabel,
  type TradeConfirmation,
  type TradeOfferInput,
  type TradeStatus,
} from "../src/store/lib/tradeCenter.js";
import { checkTrackingNumber } from "../src/store/lib/tradeTracking.js";

// /api/trade-center: the storefront's Trade Cards page and My Trades.
//
//   GET                      → { terms }                  anyone: the terms, and whether trading is open
//   GET ?view=mine           → { terms, trades }          the signed-in customer's trades
//   GET ?id=<trade id>       → { terms, trade }           one of their trades
//   POST { action, … }       → { trade, … }               signed in:
//     start          { items: [{ inventoryItemId, quantity }] }   open a trade (nothing is reserved)
//     setWanted      { tradeId, items }                          change which of our cards
//     saveOffer      { tradeId, cards: [...] }                   save their cards (priced here)
//     submit         { tradeId, note? }                          send it for review
//     confirm        { tradeId, acknowledged, termsVersion }     confirm an approved trade
//                    → { trade, clientSecret?, depositCents? }   (with a deposit: pay it to reserve)
//     confirmDeposit { tradeId, paymentIntentId }                record the deposit once Stripe says it went through
//     tracking       { tradeId, carrier, trackingNumber,          their package (counts once the carrier scans it); a new
//                      packagingConfirmed, shippedOn? }           number needs packagingConfirmed; shippedOn is YYYY-MM-DD
//     proofUploads   { tradeId, draftId, files: [...] }          → { uploads }: signed links to upload proof of shipping
//     proof          { tradeId, draftId, note }                  send proof of shipping (the reservation waits for staff)
//     askForTime     { tradeId, note }                           ask staff for more time
//     cancel         { tradeId, reason?, acceptDepositReview? }  before shipping
//     withdraw       { tradeId, reason? }                        after shipping: no penalty, cards come back
//     accept         { tradeId, address | addressId }            accept the final offer
//     adjust         { tradeId, message }                        ask for a change to the final offer
//     decline        { tradeId, reason? }                        decline it: no penalty, cards come back
//     pay            { tradeId }                                 → { clientSecret, amountDueCents }
//     confirmPayment { tradeId, paymentIntentId }                record it once Stripe says it went through
//     message        { tradeId, body }
//
// Trust: who the customer is comes from their verified session, never the
// body, and a trade that isn't theirs looks the same as one that doesn't
// exist. Prices, deposits and deadlines never come from the browser: our
// cards are priced from inventory, their cards from Scryfall here, the
// deposit is the one stored on the trade, every deadline is worked out here
// in qualifying time, and every change and total is the database's
// (trade_* functions, one transaction each, under the trade's row lock).

const MAX_BODY_BYTES = 64 * 1024;
const RATE_LIMIT_PER_WINDOW = 90;
const RATE_WINDOW_MS = 10 * 60_000;
/** Messages a customer can send on one trade in a day. */
const MAX_MESSAGES_PER_DAY = 20;
/** A second identical start this soon is a double tap: answer with the first trade. */
const DUPLICATE_START_MS = 60_000;
/** Stripe won't take a US card charge under 50 cents. */
const MIN_CARD_CHARGE_CENTS = 50;
const MAX_TRADES_LISTED = 50;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const ip = getClientIp(req);
    const rl = checkRateLimit("trade-center", ip, RATE_LIMIT_PER_WINDOW, RATE_WINDOW_MS);
    if (!rl.allowed) {
      res.setHeader("Retry-After", String(Math.ceil((rl.retryAfterMs ?? 1000) / 1000)));
      throw new HttpError(429, "Too many requests. Please wait a moment and try again.");
    }
    const admin = getSupabaseAdmin();

    if (req.method === "GET") {
      const settings = await loadTradeSettings(admin);
      const terms = termsOf(settings);
      const id = typeof req.query.id === "string" ? req.query.id : null;
      const view = typeof req.query.view === "string" ? req.query.view : null;
      if (!id && view !== "mine") {
        res.setHeader("Cache-Control", "no-store");
        return sendJson(res, 200, { ok: true, terms });
      }
      const customer = await requireCustomer(req, admin);
      if (id) return await sendFresh(res, admin, settings, readTradeId(id), customer.userId);
      return sendJson(res, 200, { ok: true, terms, trades: await listTrades(admin, customer.userId) });
    }

    if (req.method !== "POST") return methodNotAllowed(res, ["GET", "POST"]);
    const customer = await requireCustomer(req, admin);
    const body = await readJsonBody(req, MAX_BODY_BYTES);
    const settings = await loadTradeSettings(admin);
    const action = typeof body.action === "string" ? body.action : "";

    if (action === "start") {
      const tradeId = await start(admin, customer, settings, body);
      return await sendFresh(res, admin, settings, tradeId, customer.userId);
    }

    const tradeId = readTradeId(body.tradeId);
    const bundle = await loadCustomerBundle(admin, tradeId, customer.userId);
    const status = bundle.trade.status as TradeStatus;

    switch (action) {
      case "setWanted": {
        if (!CUSTOMER_EDITABLE_STATUSES.includes(status)) throw new HttpError(409, "Our cards on this trade can't be changed now.");
        const items = readWantedInputs(body.items, settings.max_wanted_lines);
        const { error } = await admin.rpc("trade_set_wanted", {
          p_trade_id: tradeId,
          p_items: items.map((i) => ({ inventory_item_id: i.inventoryItemId, quantity: i.quantity })),
          p_statuses: [...CUSTOMER_EDITABLE_STATUSES],
          p_actor_type: "customer",
          p_actor_id: customer.userId,
          p_actor_label: customer.email,
        });
        if (error) throw tradeDbError(error, "We couldn't change the cards. Try again.");
        break;
      }

      case "saveOffer": {
        if (!CUSTOMER_EDITABLE_STATUSES.includes(status)) throw new HttpError(409, "Your cards can't be changed now.");
        const inputs = readOfferInputs(body.cards, settings.max_offered_lines);
        const priced = await priceOffers(admin, inputs, bundle.trade, settings);
        const { error } = await admin.rpc("trade_save_offer", {
          p_trade_id: tradeId,
          p_user_id: customer.userId,
          p_cards: priced as unknown as Json,
        });
        if (error) throw tradeDbError(error, "We couldn't save your cards. Try again.");
        break;
      }

      case "submit": {
        if (!CUSTOMER_EDITABLE_STATUSES.includes(status)) throw new HttpError(409, "This trade has already been sent.");
        // Prices are checked again as it's sent, so staff review today's numbers.
        const inputs = offerInputsFromRows(bundle.offers);
        if (inputs.length > 0) {
          const priced = await priceOffers(admin, inputs, bundle.trade, settings);
          const saved = await admin.rpc("trade_save_offer", {
            p_trade_id: tradeId,
            p_user_id: customer.userId,
            p_cards: priced as unknown as Json,
          });
          if (saved.error) throw tradeDbError(saved.error, "We couldn't check your cards. Try again.");
        }
        const { error } = await admin.rpc("trade_submit", {
          p_trade_id: tradeId,
          p_user_id: customer.userId,
          p_note: cleanText(body.note, TRADE_LIMITS.maxTradeNote),
        });
        if (error) throw tradeDbError(error, "We couldn't send your trade. Try again.");
        const fresh = await loadCustomerBundle(admin, tradeId, customer.userId);
        await sendTradeCustomerEmail(fresh, settings, { kind: "submitted" });
        await notifyTradeStaff(fresh, settings, { kind: status === "revision_requested" ? "resubmitted" : "submitted" });
        break;
      }

      case "confirm":
        return await confirm(req, res, admin, customer, settings, bundle, body);

      case "confirmDeposit": {
        if (!stripeConfigured()) throw new HttpError(503, "Paying online isn't available right now.");
        const intentId = readIntentId(body.paymentIntentId);
        const intent = await getStripe().paymentIntents.retrieve(intentId);
        if (intent.metadata?.trade_request_id !== tradeId || intent.metadata?.kind !== DEPOSIT_KIND) {
          throw new HttpError(400, "That payment isn't this trade's deposit.");
        }
        if (intent.status === "succeeded") {
          const result = await recordDepositPayment(intent);
          if (!result.ok) {
            throw new HttpError(
              500,
              "Your deposit went through, but we couldn't reserve your cards yet. There's no need to pay again: we'll confirm by email.",
            );
          }
        }
        return await sendFresh(res, admin, settings, tradeId, customer.userId, { paymentStatus: intent.status });
      }

      case "tracking":
        await addTracking(admin, customer, settings, bundle, body);
        break;

      case "proofUploads":
        return sendJson(res, 200, { ok: true, uploads: await proofUploads(admin, bundle, body) });

      case "proof": {
        await sendProof(admin, customer, settings, bundle, body);
        break;
      }

      case "askForTime": {
        if (!["awaiting_confirmation", "awaiting_deposit", "awaiting_shipment", "tracking_submitted"].includes(status)) {
          throw new HttpError(409, "There's no deadline on this trade to ask about.");
        }
        const note = cleanText(body.note, 1000);
        if (!note) throw new HttpError(400, "Tell us how much more time you need, and why.");
        await checkMessageLimit(admin, tradeId);
        const text = `I'd like more time ${status === "awaiting_confirmation" || status === "awaiting_deposit" ? "to confirm" : "to ship"}: ${note}`;
        const messageId = await addMessage(admin, tradeId, customer, text);
        await logEvent(admin, tradeId, customer, "extension_requested", status, { message_id: messageId, note });
        await notifyTradeStaff(bundle, settings, { kind: "message", messageId, body: text });
        break;
      }

      case "cancel":
        await cancel(admin, customer, settings, bundle, body);
        break;

      case "withdraw": {
        if (!CUSTOMER_WITHDRAW_STATUSES.includes(status)) {
          throw new HttpError(409, "This trade can't be canceled that way now.");
        }
        const reason = cleanText(body.reason, 2000);
        const { data, error } = await admin.rpc("trade_close", {
          p_trade_id: tradeId,
          p_status: "canceled_after_shipment",
          p_from_statuses: [...CUSTOMER_WITHDRAW_STATUSES],
          p_reason: reason,
          p_fault: null,
          p_actor_type: "customer",
          p_actor_id: customer.userId,
          p_actor_label: customer.email,
        });
        if (error) throw tradeDbError(error, "We couldn't cancel the trade. Try again.");
        if (!Array.isArray(data) || !data[0]?.closed) throw new HttpError(409, "This trade changed. Refresh and try again.");
        const fresh = await loadCustomerBundle(admin, tradeId, customer.userId);
        await sendTradeCustomerEmail(fresh, settings, { kind: "withdrawn" });
        await notifyTradeStaff(fresh, settings, { kind: "withdrawn", reason });
        await processDepositRefund(admin, tradeId, { notifyStarted: false });
        break;
      }

      case "accept":
        return await accept(res, admin, customer, settings, bundle, body);

      case "adjust": {
        if (status !== "awaiting_final_approval") throw new HttpError(409, "You can ask for an adjustment while the final offer is waiting on you.");
        const message = cleanText(body.message, TRADE_LIMITS.maxMessage);
        if (!message) throw new HttpError(400, "Tell us what you'd like adjusted.");
        await checkMessageLimit(admin, tradeId);
        const messageId = await addMessage(admin, tradeId, customer, message);
        await logEvent(admin, tradeId, customer, "adjustment_requested", status, { message_id: messageId });
        await notifyTradeStaff(bundle, settings, { kind: "adjustment", message });
        break;
      }

      case "decline": {
        if (status !== "awaiting_final_approval" && status !== "awaiting_payment") {
          throw new HttpError(409, "There's no final offer waiting on you to decline.");
        }
        await stopOpenPayment(bundle.trade);
        const reason = cleanText(body.reason, 2000);
        const { data, error } = await admin.rpc("trade_close", {
          p_trade_id: tradeId,
          p_status: "declined_after_inspection",
          p_from_statuses: ["awaiting_final_approval", "awaiting_payment"],
          p_reason: reason,
          p_fault: null,
          p_actor_type: "customer",
          p_actor_id: customer.userId,
          p_actor_label: customer.email,
        });
        if (error) throw tradeDbError(error, "We couldn't record your answer. Try again.");
        if (!Array.isArray(data) || !data[0]?.closed) throw new HttpError(409, "This offer can't be declined now.");
        const fresh = await loadCustomerBundle(admin, tradeId, customer.userId);
        await sendTradeCustomerEmail(fresh, settings, { kind: "declined" });
        await notifyTradeStaff(fresh, settings, { kind: "declined", reason });
        // Usually refunded when the shipment was verified; if not, now.
        await processDepositRefund(admin, tradeId, { notifyStarted: false });
        break;
      }

      case "pay": {
        if (status !== "awaiting_payment") throw new HttpError(409, "This trade isn't waiting for a payment.");
        if (!stripeConfigured()) {
          throw new HttpError(503, "Paying online isn't available right now. Reply to your trade email and we'll sort out payment.");
        }
        const payment = await startPayment(admin, bundle);
        if (payment.paid) return await sendFresh(res, admin, settings, tradeId, customer.userId, { paid: true });
        return sendJson(res, 200, { ok: true, clientSecret: payment.clientSecret, amountDueCents: payment.amountDueCents });
      }

      case "confirmPayment": {
        if (!stripeConfigured()) throw new HttpError(503, "Paying online isn't available right now.");
        const intentId = readIntentId(body.paymentIntentId);
        const intent = await getStripe().paymentIntents.retrieve(intentId);
        if (intent.metadata?.trade_request_id !== tradeId || intent.metadata?.kind === DEPOSIT_KIND) {
          throw new HttpError(400, "That payment isn't for this trade.");
        }
        if (intent.status === "succeeded") {
          const result = await recordTradeCardPayment(intent);
          if (!result.ok) {
            throw new HttpError(
              500,
              "Your payment went through, but we couldn't finish your trade yet. There's no need to pay again: we'll confirm by email.",
            );
          }
        }
        return await sendFresh(res, admin, settings, tradeId, customer.userId, { paymentStatus: intent.status });
      }

      case "message": {
        const text = cleanText(body.body, TRADE_LIMITS.maxMessage);
        if (!text) throw new HttpError(400, "Write a message first.");
        await checkMessageLimit(admin, tradeId);
        const messageId = await addMessage(admin, tradeId, customer, text);
        await notifyTradeStaff(bundle, settings, { kind: "message", messageId, body: text });
        break;
      }

      default:
        throw new HttpError(400, "Unknown action.");
    }

    return await sendFresh(res, admin, settings, tradeId, customer.userId);
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 500;
    const message = err instanceof HttpError ? err.message : "Unexpected server error.";
    if (!(err instanceof HttpError)) console.error("[/api/trade-center] error:", err);
    return sendJson(res, status, { ok: false, message });
  }
}

function readIntentId(raw: unknown): string {
  const id = typeof raw === "string" && /^pi_[A-Za-z0-9_]{1,250}$/.test(raw) ? raw : null;
  if (!id) throw new HttpError(400, "Which payment are you confirming?");
  return id;
}

/** What the confirmation page shows: this customer's shipping window and the deposit, worked out here. */
async function confirmationFor(admin: Admin, bundle: TradeBundle, settings: TradeSettingsRow, now: number): Promise<TradeConfirmation | null> {
  const t = bundle.trade;
  if ((t.status !== "awaiting_confirmation" && t.status !== "awaiting_deposit") || !t.confirm_by) return null;
  const standing = await customerStanding(admin, t.user_id, settings);
  const shipDays = standing.privileges.shipDays;
  return {
    confirmBy: t.confirm_by,
    depositCents: t.deposit_cents,
    depositReason: (t.deposit_reason as TradeConfirmation["depositReason"]) ?? null,
    termsText: settings.deposit_terms,
    termsVersion: settings.deposit_terms_version,
    shipDays,
    shipByIfConfirmedNow: shipDeadline(now, shipDays, settings),
    canPayOnline: stripeConfigured(),
  };
}

async function sendFresh(
  res: VercelResponse,
  admin: Admin,
  settings: TradeSettingsRow,
  tradeId: string,
  userId: string,
  extra: Record<string, unknown> = {},
) {
  const now = Date.now();
  const bundle = await loadCustomerBundle(admin, tradeId, userId);
  const [availability, confirmation] = await Promise.all([
    bundleAvailability(admin, bundle),
    confirmationFor(admin, bundle, settings, now),
  ]);
  const trade = customerTradeView(bundle, settings, { availability, confirmation, autoTracked: trackingConnected(), now });
  return sendJson(res, 200, { ok: true, terms: termsOf(settings), trade, ...extra });
}

async function listTrades(admin: Admin, userId: string) {
  const { data, error } = await admin
    .from("trade_requests")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(MAX_TRADES_LISTED);
  if (error) throw new HttpError(500, "We couldn't load your trades. Try again.");
  const trades = data ?? [];
  if (trades.length === 0) return [];
  const ids = trades.map((t) => t.id);
  const [items, offers] = await Promise.all([
    admin.from("trade_request_items").select("trade_request_id, quantity, status").in("trade_request_id", ids),
    admin.from("trade_offer_cards").select("trade_request_id, quantity").in("trade_request_id", ids),
  ]);
  if (items.error || offers.error) throw new HttpError(500, "We couldn't load your trades. Try again.");
  const wanted = new Map<string, number>();
  for (const i of items.data ?? []) {
    if (i.status !== "removed") wanted.set(i.trade_request_id, (wanted.get(i.trade_request_id) ?? 0) + i.quantity);
  }
  const offered = new Map<string, number>();
  for (const o of offers.data ?? []) offered.set(o.trade_request_id, (offered.get(o.trade_request_id) ?? 0) + o.quantity);
  return trades.map((t) => customerSummaryView(t, wanted.get(t.id) ?? 0, offered.get(t.id) ?? 0));
}

/** Opens the trade (nothing reserved). A double tap gets the trade the first tap made. */
async function start(admin: Admin, customer: TradeCustomer, settings: TradeSettingsRow, body: Record<string, unknown>): Promise<string> {
  const items = readWantedInputs(body.items, settings.max_wanted_lines);
  if (items.length === 0) throw new HttpError(400, "Add the cards you want first.");
  const signature = items
    .map((i) => `${i.inventoryItemId}:${i.quantity}`)
    .sort()
    .join(",");

  const since = new Date(Date.now() - DUPLICATE_START_MS).toISOString();
  const { data: recent } = await admin
    .from("trade_requests")
    .select("id")
    .eq("user_id", customer.userId)
    .eq("status", "awaiting_trade_list")
    .gte("created_at", since);
  for (const r of recent ?? []) {
    const { data: lines } = await admin
      .from("trade_request_items")
      .select("inventory_item_id, quantity")
      .eq("trade_request_id", r.id)
      .eq("status", "requested");
    const theirs = (lines ?? [])
      .map((l) => `${l.inventory_item_id}:${l.quantity}`)
      .sort()
      .join(",");
    if (theirs === signature) return r.id;
  }

  const { data, error } = await admin.rpc("trade_start", {
    p_user_id: customer.userId,
    p_items: items.map((i) => ({ inventory_item_id: i.inventoryItemId, quantity: i.quantity })),
    p_customer_name: customer.name,
    p_customer_email: customer.email,
  });
  if (error || typeof data !== "string") throw tradeDbError(error, "We couldn't start your trade. Try again.");
  return data;
}

/**
 * Confirming an approved trade. The customer must tick the box agreeing to
 * the terms shown (the version is checked, so nobody agrees to text they
 * didn't see), and must be within the confirmation deadline. With no
 * deposit their cards are reserved now. With one, a PaymentIntent for
 * exactly the trade's deposit is returned for Stripe's card form; nothing
 * is reserved until it succeeds (confirmDeposit, or the webhook).
 */
async function confirm(
  req: VercelRequest,
  res: VercelResponse,
  admin: Admin,
  customer: TradeCustomer,
  settings: TradeSettingsRow,
  bundle: TradeBundle,
  body: Record<string, unknown>,
) {
  const t = bundle.trade;
  const now = Date.now();
  if (t.status !== "awaiting_confirmation" && t.status !== "awaiting_deposit") {
    throw new HttpError(409, "This trade isn't waiting for your confirmation.");
  }
  if (!t.confirm_by || now > Date.parse(t.confirm_by)) {
    throw new HttpError(409, "The time to confirm this trade ran out. Start a new trade, or message us if you need help.");
  }
  if (body.acknowledged !== true) {
    throw new HttpError(400, "Tick the box to agree to the deposit and cancellation terms.");
  }
  if (body.termsVersion !== settings.deposit_terms_version) {
    throw new HttpError(409, "Our deposit terms were just updated. Review them and confirm again.");
  }
  const standing = await customerStanding(admin, t.user_id, settings);
  const shipDays = standing.privileges.shipDays;
  const consent = {
    p_trade_id: t.id,
    p_user_id: customer.userId,
    p_terms_version: settings.deposit_terms_version,
    p_terms_text: settings.deposit_terms,
    p_ship_days: shipDays,
    p_ship_by: shipDeadline(now, shipDays, settings),
    p_ip: getClientIp(req).slice(0, 100),
    p_user_agent: String(req.headers["user-agent"] ?? "").slice(0, 400) || null,
  };

  if (t.deposit_cents > 0) {
    if (!stripeConfigured()) {
      throw new HttpError(503, "Paying the deposit online isn't available right now. Message us and we'll help you confirm.");
    }
    const intent = await depositIntentFor(t);
    if (intent.state === "succeeded") {
      // Already paid (another tab): record it.
      await recordDepositPayment(intent.intent);
      return await sendFresh(res, admin, settings, t.id, customer.userId);
    }
    const { data, error } = await admin.rpc("trade_confirm", { ...consent, p_payment_intent: intent.intentId });
    if (error) {
      if (intent.created) await getStripe().paymentIntents.cancel(intent.intentId).catch(() => undefined);
      throw tradeDbError(error, "We couldn't confirm your trade. Try again.");
    }
    const row = Array.isArray(data) ? data[0] : null;
    if (row?.result === "unavailable") {
      await getStripe().paymentIntents.cancel(intent.intentId).catch(() => undefined);
      return await afterUnavailable(res, admin, settings, t.id, customer.userId, row.short_lines);
    }
    return await sendFresh(res, admin, settings, t.id, customer.userId, {
      clientSecret: intent.clientSecret,
      depositCents: t.deposit_cents,
    });
  }

  const { data, error } = await admin.rpc("trade_confirm", { ...consent, p_payment_intent: null });
  if (error) throw tradeDbError(error, "We couldn't confirm your trade. Try again.");
  const row = Array.isArray(data) ? data[0] : null;
  if (row?.result === "unavailable") return await afterUnavailable(res, admin, settings, t.id, customer.userId, row.short_lines);
  const fresh = await loadCustomerBundle(admin, t.id, customer.userId);
  await sendTradeCustomerEmail(fresh, settings, { kind: "reserved" });
  await notifyTradeStaff(fresh, settings, { kind: "reserved" });
  return await sendFresh(res, admin, settings, t.id, customer.userId);
}

/** One of our cards sold before they confirmed: the trade went back to them. */
async function afterUnavailable(
  res: VercelResponse,
  admin: Admin,
  settings: TradeSettingsRow,
  tradeId: string,
  userId: string,
  shortLines: unknown,
) {
  const short = (Array.isArray(shortLines) ? shortLines : []) as ShortLine[];
  const fresh = await loadCustomerBundle(admin, tradeId, userId);
  await sendTradeCustomerEmail(fresh, settings, { kind: "cards_unavailable", short, refund: false });
  await notifyTradeStaff(fresh, settings, { kind: "cards_unavailable" });
  return await sendFresh(res, admin, settings, tradeId, userId, {
    notice: "Some of our cards on this trade sold before you confirmed. Nothing was reserved or charged: update your selection and send the trade again.",
  });
}

async function addTracking(
  admin: Admin,
  customer: TradeCustomer,
  settings: TradeSettingsRow,
  bundle: TradeBundle,
  body: Record<string, unknown>,
): Promise<void> {
  const t = bundle.trade;
  if (t.status !== "awaiting_shipment" && t.status !== "tracking_submitted") {
    throw new HttpError(409, "Add a tracking number once our cards are reserved for you, before the carrier scans your package.");
  }
  const check = checkTrackingNumber(
    typeof body.carrier === "string" ? body.carrier : "",
    typeof body.trackingNumber === "string" ? body.trackingNumber : "",
  );
  if (!check.ok) throw new HttpError(400, check.message);
  // A first or replacement shipment needs their confirmation that it's
  // packaged securely and tracked (the database checks this too).
  const packagingConfirmed = body.packagingConfirmed === true;
  if (t.inbound_tracking !== check.tracking && !packagingConfirmed) {
    throw new HttpError(400, "Confirm that your cards are securely packaged and shipped with tracking.");
  }
  const shippedOn = readShipDate(body.shippedOn);
  const { data, error } = await admin.rpc("trade_record_tracking", {
    p_trade_id: t.id,
    p_carrier: check.carrier,
    p_tracking: check.tracking,
    p_packaging_confirmed: packagingConfirmed,
    p_shipped_on: shippedOn,
    p_actor_type: "customer",
    p_actor_id: customer.userId,
    p_actor_label: customer.email,
  });
  if (error) throw tradeDbError(error, "We couldn't save the tracking number. Try again.");
  if (data === "unchanged") return;
  const fresh = await loadCustomerBundle(admin, t.id, customer.userId);
  await sendTradeCustomerEmail(fresh, settings, { kind: "tracking_added" });
  await notifyTradeStaff(fresh, settings, { kind: "tracking" });
  // The carrier may already have scanned it: check now rather than waiting for the worker.
  if (autoTracking(check.carrier)) {
    const outcome = await checkTradeTracking(admin, fresh.trade);
    await followUpScan(admin, settings, t.id, outcome);
  }
}

/** The optional day they shipped: "YYYY-MM-DD" (the database checks it's in range), or null for none. */
function readShipDate(value: unknown): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new HttpError(400, "Enter the date you shipped, or leave it blank.");
  }
  const noon = Date.parse(`${value}T12:00:00Z`);
  if (!Number.isFinite(noon) || new Date(noon).toISOString().slice(0, 10) !== value) {
    throw new HttpError(400, "Enter the date you shipped, or leave it blank.");
  }
  return value;
}

const PROOF_STATUSES: ReadonlySet<string> = new Set(["awaiting_shipment", "tracking_submitted", "expired"]);

function proofPrefix(tradeId: string, draftId: string): string {
  return `${tradeId}/${draftId}`;
}

/** Signed links to upload proof of shipping straight to private storage (no bytes pass through here). */
async function proofUploads(admin: Admin, bundle: TradeBundle, body: Record<string, unknown>) {
  const t = bundle.trade;
  if (!PROOF_STATUSES.has(t.status)) throw new HttpError(409, "Proof of shipping can't be sent for this trade now.");
  const draftId = typeof body.draftId === "string" && UUID_RE.test(body.draftId) ? body.draftId.toLowerCase() : null;
  if (!draftId) throw new HttpError(400, "Your upload didn't start. Try again.");
  const files = Array.isArray(body.files) ? body.files : [];
  if (files.length === 0) throw new HttpError(400, "Choose a file first.");
  const { data: existing, error: listErr } = await admin.storage.from(DISPUTE_BUCKET).list(proofPrefix(t.id, draftId), { limit: 20 });
  if (listErr) throw new HttpError(500, "We couldn't start your upload. Try again.");
  if ((existing ?? []).filter((f) => f.id).length + files.length > TRADE_LIMITS.maxDisputeFiles) {
    throw new HttpError(400, `Attach up to ${TRADE_LIMITS.maxDisputeFiles} files.`);
  }
  return Promise.all(
    files.map(async (raw) => {
      const f = (raw ?? {}) as Record<string, unknown>;
      const name = typeof f.fileName === "string" ? f.fileName.slice(0, 200) : "";
      const type = typeof f.mimeType === "string" ? f.mimeType : "";
      const size = typeof f.sizeBytes === "number" && Number.isFinite(f.sizeBytes) ? f.sizeBytes : 0;
      if (!name) throw new HttpError(400, "One of the files has no name.");
      if (!(DISPUTE_FILE_TYPES as readonly string[]).includes(type)) {
        throw new HttpError(400, `${name}: send a photo (JPEG, PNG, WebP, HEIC) or a PDF.`);
      }
      if (size <= 0 || size > TRADE_LIMITS.maxDisputeFileBytes) throw new HttpError(400, `${name}: files can be up to 10 MB.`);
      const safe = name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-80);
      const path = `${proofPrefix(t.id, draftId)}/${crypto.randomUUID()}-${safe}`;
      const { data, error } = await admin.storage.from(DISPUTE_BUCKET).createSignedUploadUrl(path);
      if (error || !data) throw new HttpError(500, "We couldn't start your upload. Try again.");
      return { fileName: name, path: data.path, token: data.token, signedUrl: data.signedUrl };
    }),
  );
}

/** Proof of shipping: their note, and the files that actually landed in storage for this upload. */
async function sendProof(
  admin: Admin,
  customer: TradeCustomer,
  settings: TradeSettingsRow,
  bundle: TradeBundle,
  body: Record<string, unknown>,
): Promise<void> {
  const t = bundle.trade;
  const note = cleanText(body.note, 4000);
  if (!note) throw new HttpError(400, "Tell us when and where you shipped your cards.");
  const draftId = typeof body.draftId === "string" && UUID_RE.test(body.draftId) ? body.draftId.toLowerCase() : null;
  let files: { path: string; name: string; size: number; type: string }[] = [];
  if (draftId) {
    const prefix = proofPrefix(t.id, draftId);
    const { data, error } = await admin.storage.from(DISPUTE_BUCKET).list(prefix, { limit: 20 });
    if (error) throw new HttpError(500, "We couldn't check your files. Try again.");
    files = (data ?? [])
      .filter((f) => f.id && f.name)
      .slice(0, TRADE_LIMITS.maxDisputeFiles)
      .map((f) => {
        const meta = (f.metadata ?? {}) as { size?: number; mimetype?: string };
        return {
          path: `${prefix}/${f.name}`,
          name: f.name.replace(/^[0-9a-f-]{36}-/, ""),
          size: typeof meta.size === "number" ? meta.size : 0,
          type: typeof meta.mimetype === "string" ? meta.mimetype : "",
        };
      });
  }
  const { error } = await admin.rpc("trade_open_dispute", {
    p_trade_id: t.id,
    p_user_id: customer.userId,
    p_note: note,
    p_files: files as unknown as Json,
  });
  if (error) throw tradeDbError(error, "We couldn't send your proof of shipping. Try again.");
  const fresh = await loadCustomerBundle(admin, t.id, customer.userId);
  await sendTradeCustomerEmail(fresh, settings, { kind: "dispute_received" });
  await notifyTradeStaff(fresh, settings, { kind: "dispute" });
}

/**
 * Canceling before anything was shipped. Before the cards are reserved it
 * costs nothing. Once reserved, a paid deposit goes to staff review under
 * the cancellation terms (never kept automatically), so the customer must
 * say they understand first.
 */
async function cancel(
  admin: Admin,
  customer: TradeCustomer,
  settings: TradeSettingsRow,
  bundle: TradeBundle,
  body: Record<string, unknown>,
): Promise<void> {
  const t = bundle.trade;
  const status = t.status as TradeStatus;
  if (!CUSTOMER_CANCELABLE_STATUSES.includes(status)) {
    throw new HttpError(
      409,
      status === "tracking_submitted"
        ? "Your tracking number is on file, so your cards may already be on their way. Message us and we'll sort it out."
        : "This trade can't be canceled now.",
    );
  }
  if (status === "awaiting_deposit") {
    const paid = await retireDepositIntent(t);
    if (paid) {
      await recordDepositPayment(paid);
      throw new HttpError(409, "Your deposit just went through, so your cards are reserved. Refresh to see your trade.");
    }
  }
  const reserved = status === "awaiting_shipment";
  if (reserved && t.deposit_status === "paid" && body.acceptDepositReview !== true) {
    throw new HttpError(400, "Canceling now may cost your deposit under the cancellation terms. Confirm that you understand to cancel.");
  }
  const reason = cleanText(body.reason, 2000);
  const { data, error } = await admin.rpc("trade_close", {
    p_trade_id: t.id,
    p_status: "canceled",
    p_from_statuses: [...CUSTOMER_CANCELABLE_STATUSES],
    p_reason: reason,
    p_fault: reserved ? "canceled_while_reserved" : null,
    p_actor_type: "customer",
    p_actor_id: customer.userId,
    p_actor_label: customer.email,
  });
  if (error) throw tradeDbError(error, "We couldn't cancel the trade. Try again.");
  if (!Array.isArray(data) || !data[0]?.closed) {
    throw new HttpError(409, "This trade changed and can't be canceled now. Refresh to see it.");
  }
  const fresh = await loadCustomerBundle(admin, t.id, customer.userId);
  await sendTradeCustomerEmail(fresh, settings, { kind: "canceled" });
  if (status !== "awaiting_trade_list") await notifyTradeStaff(fresh, settings, { kind: "canceled", reason });
  if (data[0].deposit_after === "forfeiture_review") {
    await notifyTradeStaff(fresh, settings, { kind: "forfeiture_review", why: "canceled" });
  }
}

async function accept(
  res: VercelResponse,
  admin: Admin,
  customer: TradeCustomer,
  settings: TradeSettingsRow,
  bundle: TradeBundle,
  body: Record<string, unknown>,
) {
  const t = bundle.trade;
  if (t.status !== "awaiting_final_approval") throw new HttpError(409, "This offer can't be accepted now.");
  const shipTo =
    body.addressId !== undefined && body.addressId !== null && body.addressId !== ""
      ? await savedShipTo(admin, customer.userId, body.addressId, customer.name)
      : readShipTo(body.address, customer.name);
  const { data, error } = await admin.rpc("trade_accept_final", {
    p_trade_id: t.id,
    p_user_id: customer.userId,
    p_ship_name: shipTo.name || null,
    p_ship_line1: shipTo.line1,
    p_ship_line2: shipTo.line2 ?? null,
    p_ship_city: shipTo.city,
    p_ship_state: shipTo.state,
    p_ship_postal_code: shipTo.postalCode,
  });
  if (error) throw tradeDbError(error, "We couldn't accept the offer. Try again.");
  const result = Array.isArray(data) ? data[0] : null;
  const fresh = await loadCustomerBundle(admin, t.id, customer.userId);
  if (result?.new_status === "approved_for_fulfillment" && result.new_order_id) {
    await afterFinalized(fresh, settings);
  } else {
    await sendTradeCustomerEmail(fresh, settings, { kind: "awaiting_payment" });
    await notifyTradeStaff(fresh, settings, { kind: "accepted" });
  }
  return await sendFresh(res, admin, settings, t.id, customer.userId, { amountDueCents: result?.due_cents ?? 0 });
}

/**
 * A PaymentIntent for exactly the amount due. Reuses the open one for the
 * same amount (reloading the page doesn't pile up intents) and records one
 * that already went through.
 */
async function startPayment(
  admin: Admin,
  bundle: TradeBundle,
): Promise<{ paid: true } | { paid: false; clientSecret: string; amountDueCents: number }> {
  const t = bundle.trade;
  const due = t.amount_due_cents ?? 0;
  if (due <= 0) throw new HttpError(409, "There's nothing to pay on this trade.");
  if (due < MIN_CARD_CHARGE_CENTS) {
    throw new HttpError(409, "The amount due is too small to pay by card online. Reply to your trade email and we'll settle it with you.");
  }
  const stripe = getStripe();
  if (t.payment_reference?.startsWith("pi_")) {
    const existing = await stripe.paymentIntents.retrieve(t.payment_reference);
    if (existing.status === "succeeded") {
      const result = await recordTradeCardPayment(existing);
      if (!result.ok) {
        throw new HttpError(500, "Your payment went through, but we couldn't finish your trade yet. There's no need to pay again.");
      }
      return { paid: true };
    }
    if (
      REUSABLE_INTENT_STATUSES.has(existing.status) &&
      existing.amount === due &&
      existing.metadata?.trade_request_id === t.id &&
      existing.client_secret
    ) {
      return { paid: false, clientSecret: existing.client_secret, amountDueCents: due };
    }
    if (REUSABLE_INTENT_STATUSES.has(existing.status)) {
      await stripe.paymentIntents.cancel(existing.id).catch((err: unknown) => {
        console.error("[/api/trade-center] couldn't cancel stale PaymentIntent", existing.id, err);
      });
    }
    if (PAYMENT_UNDERWAY_STATUSES.has(existing.status)) {
      throw new HttpError(409, "Your payment is still going through. Refresh in a minute.");
    }
  }
  const intent = await stripe.paymentIntents.create(
    {
      amount: due,
      currency: "usd",
      // Cards only, like checkout. Apple Pay and Google Pay still appear.
      payment_method_types: ["card"],
      receipt_email: t.customer_email ?? undefined,
      description: `Geega Games trade ${tradeLabel(t.trade_number)}`,
      // What the payment is for, kept apart: our cards the credit didn't cover, and shipping them.
      metadata: {
        kind: "trade",
        trade_request_id: t.id,
        trade_number: String(t.trade_number),
        shipping_cents: String(Math.min(t.shipping_cents ?? 0, due)),
        cards_cents: String(due - Math.min(t.shipping_cents ?? 0, due)),
      },
    },
    { idempotencyKey: `trade-pi-${t.id}-${due}-${t.accepted_at ?? ""}` },
  );
  const { error } = await admin
    .from("trade_requests")
    .update({ payment_reference: intent.id })
    .eq("id", t.id)
    .eq("status", "awaiting_payment");
  if (error) console.error("[/api/trade-center] couldn't save the PaymentIntent id", t.id, error);
  if (!intent.client_secret) throw new HttpError(500, "We couldn't start the payment. Try again.");
  return { paid: false, clientSecret: intent.client_secret, amountDueCents: due };
}

/** The saved list as the browser would send it, to price it again. */
function offerInputsFromRows(rows: TradeOfferRow[]): TradeOfferInput[] {
  return rows.flatMap((c) =>
    c.scryfall_id && isTradeFinish(c.finish) && isConditionCode(c.reported_condition)
      ? [
          {
            id: c.id,
            scryfallId: c.scryfall_id,
            finish: c.finish,
            condition: c.reported_condition,
            quantity: c.quantity,
            customerEstimateCents: c.customer_estimate_cents,
            note: c.customer_note,
          },
        ]
      : [],
  );
}

async function checkMessageLimit(admin: Admin, tradeId: string): Promise<void> {
  const since = new Date(Date.now() - 24 * 60 * 60_000).toISOString();
  const { count, error } = await admin
    .from("trade_messages")
    .select("id", { count: "exact", head: true })
    .eq("trade_request_id", tradeId)
    .eq("author_type", "customer")
    .gte("created_at", since);
  if (error) throw new HttpError(500, "We couldn't send your message. Try again.");
  if ((count ?? 0) >= MAX_MESSAGES_PER_DAY) {
    throw new HttpError(429, "You've sent a lot of messages on this trade today. We'll reply to those first.");
  }
}

async function addMessage(admin: Admin, tradeId: string, customer: TradeCustomer, body: string): Promise<string> {
  const { data, error } = await admin
    .from("trade_messages")
    .insert({
      trade_request_id: tradeId,
      author_type: "customer",
      author_id: customer.userId,
      author_label: customer.email,
      body,
      visible_to_customer: true,
    })
    .select("id")
    .single();
  if (error || !data) throw new HttpError(500, "We couldn't send your message. Try again.");
  return data.id;
}

async function logEvent(
  admin: Admin,
  tradeId: string,
  customer: TradeCustomer,
  event: string,
  fromStatus: string,
  detail: Record<string, unknown>,
  toStatus?: string,
): Promise<void> {
  const { error } = await admin.from("trade_events").insert({
    trade_request_id: tradeId,
    actor_type: "customer",
    actor_id: customer.userId,
    actor_label: customer.email,
    event,
    from_status: fromStatus,
    to_status: toStatus ?? fromStatus,
    detail: detail as Json,
  });
  if (error) console.error("[/api/trade-center] couldn't log", event, tradeId, error.message);
}
