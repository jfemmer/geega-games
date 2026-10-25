import type { VercelRequest, VercelResponse } from "@vercel/node";
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
  stripeConfigured,
} from "./_lib/tradePayments.js";
import {
  cleanText,
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
  termsOf,
  tradeDbError,
  type Admin,
  type TradeBundle,
  type TradeCustomer,
  type TradeOfferRow,
  type TradeSettingsRow,
} from "./_lib/tradeCenter.js";
import { notifyTradeStaff, sendTradeCustomerEmail } from "./_lib/tradeCenterEmails.js";
import {
  CUSTOMER_CANCELABLE_STATUSES,
  CUSTOMER_EDITABLE_STATUSES,
  TRADE_LIMITS,
  cleanTrackingNumber,
  isConditionCode,
  isTradeCarrier,
  isTradeFinish,
  tradeLabel,
  type TradeOfferInput,
  type TradeStatus,
} from "../src/store/lib/tradeCenter.js";

// /api/trade-center: the storefront's Trade Cards page and My Trades.
//
//   GET                      → { terms }                  anyone: the terms, and whether trading is open
//   GET ?view=mine           → { terms, trades }          the signed-in customer's trades
//   GET ?id=<trade id>       → { terms, trade }           one of their trades
//   POST { action, … }       → { trade, … }               signed in:
//     start          { items: [{ inventoryItemId, quantity }] }   hold our cards and open a trade
//     setWanted      { tradeId, items }                          change which of our cards
//     saveOffer      { tradeId, cards: [...] }                   save their cards (priced here)
//     submit         { tradeId, note? }                          send the list for review
//     cancel         { tradeId, reason? }                        before anything is mailed to us
//     tracking       { tradeId, carrier, trackingNumber }        they mailed their cards
//     accept         { tradeId, address | addressId }            accept the final offer
//     adjust         { tradeId, message }                        ask for a change to the final offer
//     decline        { tradeId, reason? }                        decline it: their cards come back
//     pay            { tradeId }                                 → { clientSecret, amountDueCents }
//     confirmPayment { tradeId, paymentIntentId }                record it once Stripe says it went through
//     message        { tradeId, body }
//
// Trust: who the customer is comes from their verified session, never the
// body, and a trade that isn't theirs looks the same as one that doesn't
// exist. Prices never come from the browser: our cards are priced from
// inventory when they're held, their cards from Scryfall here (the browser
// sends only which printing, finish, condition and how many), and every
// total is worked out by the database (trade_* functions, one transaction
// each, under the trade's row lock). The amount charged by card is the
// trade's amount due, read fresh.

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
      if (id) {
        const bundle = await loadCustomerBundle(admin, readTradeId(id), customer.userId);
        return sendJson(res, 200, { ok: true, terms, trade: customerTradeView(bundle, settings) });
      }
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
        return sendJson(res, 200, { ok: true, terms: termsOf(settings), trade: customerTradeView(fresh, settings) });
      }

      case "cancel": {
        const reason = cleanText(body.reason, 2000);
        const { data, error } = await admin.rpc("trade_close", {
          p_trade_id: tradeId,
          p_status: "canceled",
          p_from_statuses: [...CUSTOMER_CANCELABLE_STATUSES],
          p_reason: reason,
          p_actor_type: "customer",
          p_actor_id: customer.userId,
          p_actor_label: customer.email,
        });
        if (error) throw tradeDbError(error, "We couldn't cancel the trade. Try again.");
        if (data !== true) {
          throw new HttpError(409, "This trade can't be canceled now: your cards are already on their way. Contact us if you need help.");
        }
        const fresh = await loadCustomerBundle(admin, tradeId, customer.userId);
        await sendTradeCustomerEmail(fresh, settings, { kind: "canceled" });
        if (status !== "awaiting_trade_list") await notifyTradeStaff(fresh, settings, { kind: "canceled", reason });
        return sendJson(res, 200, { ok: true, terms: termsOf(settings), trade: customerTradeView(fresh, settings) });
      }

      case "tracking":
        await addTracking(admin, customer, settings, bundle, body);
        return await sendFresh(res, admin, settings, tradeId, customer.userId);

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
        return await sendFresh(res, admin, settings, tradeId, customer.userId);
      }

      case "decline": {
        if (status !== "awaiting_final_approval" && status !== "awaiting_payment") {
          throw new HttpError(409, "There's no final offer waiting on you to decline.");
        }
        await stopOpenPayment(bundle.trade);
        const reason = cleanText(body.reason, 2000);
        const { data, error } = await admin.rpc("trade_close", {
          p_trade_id: tradeId,
          p_status: "return_pending",
          p_from_statuses: ["awaiting_final_approval", "awaiting_payment"],
          p_reason: reason,
          p_actor_type: "customer",
          p_actor_id: customer.userId,
          p_actor_label: customer.email,
        });
        if (error) throw tradeDbError(error, "We couldn't record your answer. Try again.");
        if (data !== true) throw new HttpError(409, "This offer can't be declined now.");
        const fresh = await loadCustomerBundle(admin, tradeId, customer.userId);
        await sendTradeCustomerEmail(fresh, settings, { kind: "return_pending", reason: null });
        await notifyTradeStaff(fresh, settings, { kind: "declined", reason });
        return sendJson(res, 200, { ok: true, terms: termsOf(settings), trade: customerTradeView(fresh, settings) });
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
        const intentId =
          typeof body.paymentIntentId === "string" && /^pi_[A-Za-z0-9]{1,250}$/.test(body.paymentIntentId) ? body.paymentIntentId : null;
        if (!intentId) throw new HttpError(400, "Which payment are you confirming?");
        const intent = await getStripe().paymentIntents.retrieve(intentId);
        if (intent.metadata?.trade_request_id !== tradeId) throw new HttpError(400, "That payment isn't for this trade.");
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
        return await sendFresh(res, admin, settings, tradeId, customer.userId);
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

async function sendFresh(
  res: VercelResponse,
  admin: Admin,
  settings: TradeSettingsRow,
  tradeId: string,
  userId: string,
  extra: Record<string, unknown> = {},
) {
  const bundle = await loadCustomerBundle(admin, tradeId, userId);
  return sendJson(res, 200, { ok: true, terms: termsOf(settings), trade: customerTradeView(bundle, settings), ...extra });
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
    if (i.status !== "released") wanted.set(i.trade_request_id, (wanted.get(i.trade_request_id) ?? 0) + i.quantity);
  }
  const offered = new Map<string, number>();
  for (const o of offers.data ?? []) offered.set(o.trade_request_id, (offered.get(o.trade_request_id) ?? 0) + o.quantity);
  return trades.map((t) => customerSummaryView(t, wanted.get(t.id) ?? 0, offered.get(t.id) ?? 0));
}

/** Holds the cards and opens the trade. A double tap gets the trade the first tap made. */
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
      .eq("status", "reserved");
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

async function addTracking(
  admin: Admin,
  customer: TradeCustomer,
  settings: TradeSettingsRow,
  bundle: TradeBundle,
  body: Record<string, unknown>,
): Promise<void> {
  const t = bundle.trade;
  if (t.status !== "awaiting_shipment" && t.status !== "in_transit") {
    throw new HttpError(409, "Add a tracking number once your trade is approved and before it arrives.");
  }
  if (t.status === "awaiting_shipment" && t.hold_expires_at && Date.parse(t.hold_expires_at) < Date.now()) {
    throw new HttpError(409, "The shipping deadline for this trade has passed. Contact us if your cards are already in the mail.");
  }
  if (!isTradeCarrier(body.carrier)) throw new HttpError(400, "Choose the carrier.");
  const tracking = cleanTrackingNumber(typeof body.trackingNumber === "string" ? body.trackingNumber : "");
  if (!tracking) throw new HttpError(400, "That tracking number doesn't look right. Check it and try again.");
  if (t.status === "in_transit" && t.inbound_tracking === tracking && t.inbound_carrier === body.carrier) return;

  const { data, error } = await admin
    .from("trade_requests")
    .update({
      inbound_carrier: body.carrier,
      inbound_tracking: tracking,
      inbound_shipped_at: t.inbound_shipped_at ?? new Date().toISOString(),
      status: "in_transit",
      hold_expires_at: null,
    })
    .eq("id", t.id)
    .eq("user_id", customer.userId)
    .in("status", ["awaiting_shipment", "in_transit"])
    .select("id");
  if (error) throw new HttpError(500, "We couldn't save the tracking number. Try again.");
  if (!data || data.length === 0) throw new HttpError(409, "This trade changed. Refresh the page and try again.");
  await logEvent(admin, t.id, customer, "tracking_added", t.status, { carrier: body.carrier, tracking }, "in_transit");
  const fresh = await loadCustomerBundle(admin, t.id, customer.userId);
  await sendTradeCustomerEmail(fresh, settings, { kind: "tracking_added" });
  await notifyTradeStaff(fresh, settings, { kind: "tracking" });
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
  return sendJson(res, 200, {
    ok: true,
    terms: termsOf(settings),
    trade: customerTradeView(fresh, settings),
    amountDueCents: result?.due_cents ?? 0,
  });
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
      metadata: { kind: "trade", trade_request_id: t.id, trade_number: String(t.trade_number) },
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
