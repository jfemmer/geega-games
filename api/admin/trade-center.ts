import type { VercelRequest, VercelResponse } from "@vercel/node";
import type { Json } from "../../src/types/database.js";
import { HttpError, methodNotAllowed, readJsonBody, sendJson } from "../_lib/http.js";
import { requireStaff, type StaffContext } from "../_lib/adminAuth.js";
import { getSupabaseAdmin } from "../_lib/supabaseAdmin.js";
import { logAdminAction } from "../_lib/auditLog.js";
import {
  UUID_RE,
  cleanText,
  loadTradeBundle,
  loadTradeSettings,
  readTradeId,
  readWantedInputs,
  settingsView,
  staffSummaryView,
  staffTradeView,
  tradeDbError,
  wholeNumber,
  type Admin,
  type TradeBundle,
  type TradeSettingsRow,
} from "../_lib/tradeCenter.js";
import { sendTradeCustomerEmail } from "../_lib/tradeCenterEmails.js";
import { afterFinalized, stopOpenPayment } from "../_lib/tradePayments.js";
import { checkUsAddress, SHIP_TO_COUNTRY } from "../../src/store/lib/usAddress.js";
import {
  CARD_CONDITIONS,
  PRE_SHIPMENT_STATUSES,
  STAFF_REJECTABLE_STATUSES,
  STAFF_WANTED_STATUSES,
  TRADE_LIMITS,
  TRADE_SETTING_RANGES,
  TRADE_STATUSES,
  addBusinessDays,
  cleanTrackingNumber,
  endOfStoreDay,
  isConditionCode,
  isOpenTrade,
  isTradeCarrier,
  isTradeStatus,
  type TradeStatus,
} from "../../src/store/lib/tradeCenter.js";

// /api/admin/trade-center: admin Trades (online trades from the storefront's
// Trade Cards page). Staff only (requireStaff); settings, recording a payment
// by hand and marking cash paid are for the store owner (role admin).
//
//   GET ?view=list[&filter=open|all|<status>][&q=]   → { trades, counts }
//   GET ?id=<trade id>                               → { trade, settings }
//   GET ?view=settings                               → { settings }
//   POST { action, … }:
//     saveSettings      { settings }                       owner
//     review            { tradeId, cards: [...] }          per card: approve (how many, value each) or reject
//     requestRevision   { tradeId, message }
//     approve           { tradeId, conditions?, shipBy? }  preliminary approval: the customer ships
//     reject            { tradeId, reason }                closes it, or sends their cards back
//     extend            { tradeId, hours }                 more time on the current deadline
//     markReceived      { tradeId }
//     inspect           { tradeId, cards: [...] }
//     confirmAsDescribed{ tradeId }                        every approved card arrived as approved
//     sendFinalOffer    { tradeId, cashForExcess? }
//     reopenInspection  { tradeId }                        take the final offer back to revise it
//     setWanted         { tradeId, items }                 our cards on the trade
//     markReturned      { tradeId, carrier?, trackingNumber? }
//     importCard        { offerCardId, priceCents, storageLocation? }
//     recordPayment     { tradeId, note }                  owner: paid another way (in store, cash)
//     markCashPaid      { tradeId, note? }                 owner: the cash for credit left over
//     message           { tradeId, body, visibleToCustomer }
//
// Every total is worked out by the database (trade_* functions, one
// transaction each, under the trade's row lock); this file checks input,
// works out deadlines, writes the audit log and sends the emails.

const MAX_BODY_BYTES = 128 * 1024;
const MAX_LISTED = 300;
const OWNER_ONLY = new Set(["saveSettings", "recordPayment", "markCashPaid"]);

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const staff = await requireStaff(req);
    const admin = getSupabaseAdmin();

    if (req.method === "GET") {
      const settings = await loadTradeSettings(admin);
      if (typeof req.query.id === "string") {
        const bundle = await loadTradeBundle(admin, readTradeId(req.query.id));
        if (!bundle) throw new HttpError(404, "That trade isn't there.");
        return sendJson(res, 200, { ok: true, trade: staffTradeView(bundle, settings), settings: settingsView(settings) });
      }
      if (req.query.view === "settings") return sendJson(res, 200, { ok: true, settings: settingsView(settings) });
      return sendJson(res, 200, { ok: true, ...(await listTrades(admin, req.query.filter, req.query.q)), settings: settingsView(settings) });
    }
    if (req.method !== "POST") return methodNotAllowed(res, ["GET", "POST"]);

    const body = await readJsonBody(req, MAX_BODY_BYTES);
    const action = typeof body.action === "string" ? body.action : "";
    if (OWNER_ONLY.has(action) && staff.role !== "admin") {
      throw new HttpError(403, "Only the store owner can do that.");
    }
    const settings = await loadTradeSettings(admin);

    if (action === "saveSettings") {
      const next = await saveSettings(admin, staff, settings, body.settings);
      return sendJson(res, 200, { ok: true, settings: settingsView(next) });
    }
    if (action === "importCard") {
      const tradeId = await importCard(admin, staff, body);
      return await sendFresh(res, admin, tradeId);
    }

    const tradeId = readTradeId(body.tradeId);
    const bundle = await loadTradeBundle(admin, tradeId);
    if (!bundle) throw new HttpError(404, "That trade isn't there.");
    const status = bundle.trade.status as TradeStatus;
    const actor = { p_actor_id: staff.userId, p_actor_label: staff.email ?? "staff" };
    const audit = (what: string, after: Record<string, unknown> = {}) =>
      logAdminAction(admin, staff, {
        action: `trade.${what}`,
        resourceType: "trade_request",
        resourceId: tradeId,
        before: { status },
        after: { tradeNumber: bundle.trade.trade_number, ...after },
      });

    switch (action) {
      case "review": {
        const cards = readReviewCards(body.cards, bundle);
        const { error } = await admin.rpc("trade_review_cards", { p_trade_id: tradeId, p_cards: cards as unknown as Json, ...actor });
        if (error) throw tradeDbError(error, "We couldn't save the review. Try again.");
        await audit("review", { cards: cards.length });
        break;
      }

      case "requestRevision": {
        const message = cleanText(body.message, TRADE_LIMITS.maxMessage);
        if (!message) throw new HttpError(400, "Tell the customer what to change.");
        const { error } = await admin.rpc("trade_request_revision", { p_trade_id: tradeId, p_message: message, ...actor });
        if (error) throw tradeDbError(error, "We couldn't ask for changes. Try again.");
        await audit("request_revision");
        await emailCustomer(admin, settings, tradeId, { kind: "revision_requested", message });
        break;
      }

      case "approve": {
        const shipBy = readShipBy(body.shipBy, settings);
        const conditions = cleanText(body.conditions, 2000);
        const { data, error } = await admin.rpc("trade_approve", {
          p_trade_id: tradeId,
          p_ship_by: shipBy,
          p_conditions: conditions,
          ...actor,
        });
        if (error) throw tradeDbError(error, "We couldn't approve the trade. Try again.");
        await audit("approve", { approvedValueCents: data, shipBy, conditions });
        await emailCustomer(admin, settings, tradeId, { kind: "approved" });
        break;
      }

      case "reject": {
        if (!STAFF_REJECTABLE_STATUSES.includes(status)) throw new HttpError(409, "This trade can't be rejected now.");
        const reason = cleanText(body.reason, 2000);
        if (!reason) throw new HttpError(400, "Give the customer a reason.");
        const beforeShipping = PRE_SHIPMENT_STATUSES.includes(status);
        if (status === "awaiting_payment") await stopOpenPayment(bundle.trade);
        const { data, error } = await admin.rpc("trade_close", {
          p_trade_id: tradeId,
          p_status: beforeShipping ? "rejected" : "return_pending",
          p_from_statuses: beforeShipping ? [...PRE_SHIPMENT_STATUSES] : STAFF_REJECTABLE_STATUSES.filter((s) => !PRE_SHIPMENT_STATUSES.includes(s)),
          p_reason: reason,
          p_actor_type: "staff",
          ...actor,
        });
        if (error) throw tradeDbError(error, "We couldn't reject the trade. Try again.");
        if (data !== true) throw new HttpError(409, "This trade changed. Refresh and try again.");
        await audit("reject", { reason, cardsGoBack: !beforeShipping });
        await emailCustomer(admin, settings, tradeId, beforeShipping ? { kind: "rejected", reason } : { kind: "return_pending", reason });
        break;
      }

      case "extend": {
        const hours = wholeNumber(body.hours, 1, 336);
        if (hours === null) throw new HttpError(400, "Extend by 1 to 336 hours.");
        await extend(admin, bundle, hours, staff);
        await audit("extend", { hours });
        break;
      }

      case "markReceived": {
        const { data, error } = await admin
          .from("trade_requests")
          .update({ status: "received", received_at: new Date().toISOString(), hold_expires_at: null })
          .eq("id", tradeId)
          .in("status", ["awaiting_shipment", "in_transit"])
          .select("id");
        if (error) throw new HttpError(500, "We couldn't mark the package received. Try again.");
        if (!data || data.length === 0) throw new HttpError(409, "Only a trade waiting for its package can be marked received.");
        await logEvent(admin, tradeId, staff, "received", status, "received");
        await audit("mark_received");
        await emailCustomer(admin, settings, tradeId, { kind: "received" });
        break;
      }

      case "inspect": {
        const cards = readInspectionCards(body.cards, bundle);
        const { error } = await admin.rpc("trade_inspect_cards", { p_trade_id: tradeId, p_cards: cards as unknown as Json, ...actor });
        if (error) throw tradeDbError(error, "We couldn't save the inspection. Try again.");
        await audit("inspect", { cards: cards.length });
        break;
      }

      case "confirmAsDescribed": {
        const cards = bundle.offers
          .filter((c) => c.review_status === "approved" && !c.inspected_at)
          .map((c) => ({
            id: c.id,
            received_quantity: c.approved_quantity ?? 0,
            authenticity: "authentic",
            verified_condition: c.reported_condition,
            final_quantity: c.approved_quantity ?? 0,
            final_unit_cents: c.approved_unit_cents ?? 0,
            flags: [],
          }));
        if (cards.length === 0) throw new HttpError(400, "Every approved card is already inspected.");
        const { error } = await admin.rpc("trade_inspect_cards", { p_trade_id: tradeId, p_cards: cards as unknown as Json, ...actor });
        if (error) throw tradeDbError(error, "We couldn't save the inspection. Try again.");
        await audit("confirm_as_described", { cards: cards.length });
        break;
      }

      case "sendFinalOffer": {
        const cash = body.cashForExcess === true;
        const { data, error } = await admin.rpc("trade_send_final_offer", { p_trade_id: tradeId, p_cash_for_excess: cash, ...actor });
        if (error) throw tradeDbError(error, "We couldn't send the final offer. Try again.");
        await audit("send_final_offer", { finalCreditCents: data, cashForExcess: cash });
        await emailCustomer(admin, settings, tradeId, { kind: "final_offer" });
        break;
      }

      case "reopenInspection": {
        const { data, error } = await admin
          .from("trade_requests")
          .update({ status: "under_inspection", final_offer_at: null })
          .eq("id", tradeId)
          .eq("status", "awaiting_final_approval")
          .select("id");
        if (error) throw new HttpError(500, "We couldn't take the offer back. Try again.");
        if (!data || data.length === 0) throw new HttpError(409, "Only a final offer still waiting on the customer can be taken back.");
        await logEvent(admin, tradeId, staff, "final_offer_withdrawn", status, "under_inspection");
        await audit("reopen_inspection");
        break;
      }

      case "setWanted": {
        if (!STAFF_WANTED_STATUSES.includes(status)) throw new HttpError(409, "Our cards on this trade can't be changed now.");
        const items = readWantedInputs(body.items, settings.max_wanted_lines);
        const { data, error } = await admin.rpc("trade_set_wanted", {
          p_trade_id: tradeId,
          p_items: items.map((i) => ({ inventory_item_id: i.inventoryItemId, quantity: i.quantity })),
          p_statuses: [...STAFF_WANTED_STATUSES],
          p_actor_type: "staff",
          ...actor,
        });
        if (error) throw tradeDbError(error, "We couldn't change our cards on the trade. Try again.");
        await audit("set_wanted", { wantedTotalCents: data });
        break;
      }

      case "markReturned": {
        await markReturned(admin, staff, bundle, body);
        await audit("mark_returned");
        await emailCustomer(admin, settings, tradeId, { kind: "returned" });
        break;
      }

      case "recordPayment": {
        if (status !== "awaiting_payment") throw new HttpError(409, "This trade isn't waiting for a payment.");
        const note = cleanText(body.note, 200);
        if (!note) throw new HttpError(400, "Say how it was paid (for example, cash in store).");
        await stopOpenPayment(bundle.trade);
        const due = bundle.trade.amount_due_cents ?? 0;
        const { error } = await admin.rpc("trade_record_payment", {
          p_trade_id: tradeId,
          p_paid_cents: due,
          p_reference: `manual: ${note}`,
        });
        if (error) throw tradeDbError(error, "We couldn't record the payment. Try again.");
        await logEvent(admin, tradeId, staff, "paid", status, "approved_for_fulfillment", { amount_cents: due, note });
        await audit("record_payment", { amountCents: due, note });
        const fresh = await loadTradeBundle(admin, tradeId);
        if (fresh) await afterFinalized(fresh, settings);
        break;
      }

      case "markCashPaid": {
        if (bundle.trade.excess_handling !== "cash" || !bundle.trade.cash_payout_cents) {
          throw new HttpError(409, "This trade has no cash payout.");
        }
        if (bundle.trade.cash_paid_at) throw new HttpError(409, "The cash was already marked paid.");
        const { data, error } = await admin
          .from("trade_requests")
          .update({ cash_paid_at: new Date().toISOString() })
          .eq("id", tradeId)
          .is("cash_paid_at", null)
          .in("status", ["approved_for_fulfillment", "completed"])
          .select("id");
        if (error) throw new HttpError(500, "We couldn't mark the cash paid. Try again.");
        if (!data || data.length === 0) throw new HttpError(409, "Cash is paid once the trade is finished.");
        const note = cleanText(body.note, 200);
        await logEvent(admin, tradeId, staff, "cash_paid", status, status, { amount_cents: bundle.trade.cash_payout_cents, note });
        await audit("mark_cash_paid", { amountCents: bundle.trade.cash_payout_cents, note });
        break;
      }

      case "message": {
        const text = cleanText(body.body, TRADE_LIMITS.maxMessage);
        if (!text) throw new HttpError(400, "Write a message first.");
        const visible = body.visibleToCustomer === true;
        const { data, error } = await admin
          .from("trade_messages")
          .insert({
            trade_request_id: tradeId,
            author_type: "staff",
            author_id: staff.userId,
            author_label: staff.email,
            body: text,
            visible_to_customer: visible,
          })
          .select("id")
          .single();
        if (error || !data) throw new HttpError(500, "We couldn't save the message. Try again.");
        await audit(visible ? "message" : "note");
        if (visible) await emailCustomer(admin, settings, tradeId, { kind: "message", messageId: data.id, body: text });
        break;
      }

      default:
        throw new HttpError(400, "Unknown action.");
    }

    return await sendFresh(res, admin, tradeId);
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 500;
    const message = err instanceof HttpError ? err.message : "Unexpected server error.";
    if (!(err instanceof HttpError)) console.error("[admin/trade-center] error:", err);
    return sendJson(res, status, { ok: false, message });
  }
}

async function sendFresh(res: VercelResponse, admin: Admin, tradeId: string) {
  const [bundle, settings] = await Promise.all([loadTradeBundle(admin, tradeId), loadTradeSettings(admin)]);
  if (!bundle) throw new HttpError(404, "That trade isn't there.");
  return sendJson(res, 200, { ok: true, trade: staffTradeView(bundle, settings), settings: settingsView(settings) });
}

async function emailCustomer(
  admin: Admin,
  settings: TradeSettingsRow,
  tradeId: string,
  email: Parameters<typeof sendTradeCustomerEmail>[2],
): Promise<void> {
  const fresh = await loadTradeBundle(admin, tradeId);
  if (fresh) await sendTradeCustomerEmail(fresh, settings, email);
}

async function logEvent(
  admin: Admin,
  tradeId: string,
  staff: StaffContext,
  event: string,
  fromStatus: string,
  toStatus: string,
  detail: Record<string, unknown> = {},
): Promise<void> {
  const { error } = await admin.from("trade_events").insert({
    trade_request_id: tradeId,
    actor_type: "staff",
    actor_id: staff.userId,
    actor_label: staff.email,
    event,
    from_status: fromStatus,
    to_status: toStatus,
    detail: detail as Json,
  });
  if (error) console.error("[admin/trade-center] couldn't log", event, tradeId, error.message);
}

// ---------------------------------------------------------------------------
// The list
// ---------------------------------------------------------------------------

async function listTrades(admin: Admin, rawFilter: unknown, rawQuery: unknown) {
  const filter = typeof rawFilter === "string" ? rawFilter : "open";
  const q = typeof rawQuery === "string" ? rawQuery.trim().slice(0, 80) : "";

  let query = admin.from("trade_requests").select("*").order("updated_at", { ascending: false }).limit(MAX_LISTED);
  if (filter === "open") {
    query = query.not("status", "in", "(completed,rejected,canceled,expired,returned)");
  } else if (isTradeStatus(filter)) {
    query = query.eq("status", filter);
  }
  const number = q.match(/^(?:tr-?)?(\d{1,9})$/i);
  if (number) {
    query = query.eq("trade_number", Number(number[1]));
  } else if (q) {
    // Letters, digits and what's in a name or an email only: nothing that
    // means something to PostgREST's filter syntax.
    const safe = q.replace(/[^\p{L}\p{N}@.\-_' ]/gu, "").trim();
    if (safe) query = query.or(`customer_name.ilike.%${safe}%,customer_email.ilike.%${safe}%`);
  }
  const [{ data, error }, statuses] = await Promise.all([query, admin.from("trade_requests").select("status").limit(10000)]);
  if (error || statuses.error) throw new HttpError(500, "We couldn't load trades. Try again.");
  const counts: Record<string, number> = { open: 0, all: 0 };
  for (const s of TRADE_STATUSES) counts[s] = 0;
  for (const row of statuses.data ?? []) {
    counts.all += 1;
    counts[row.status] = (counts[row.status] ?? 0) + 1;
    if (isTradeStatus(row.status) && isOpenTrade(row.status)) counts.open += 1;
  }
  return { trades: (data ?? []).map(staffSummaryView), counts };
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

function cardIdsOf(bundle: TradeBundle): Set<string> {
  return new Set(bundle.offers.map((c) => c.id));
}

function readReviewCards(raw: unknown, bundle: TradeBundle) {
  if (!Array.isArray(raw) || raw.length === 0) throw new HttpError(400, "Nothing to save.");
  const ids = cardIdsOf(bundle);
  return raw.map((item) => {
    const o = (item ?? {}) as Record<string, unknown>;
    const id = typeof o.id === "string" && UUID_RE.test(o.id) && ids.has(o.id.toLowerCase()) ? o.id.toLowerCase() : null;
    if (!id) throw new HttpError(400, "A card isn't on this trade. Refresh and try again.");
    const reviewStatus = o.reviewStatus === "approved" || o.reviewStatus === "rejected" ? o.reviewStatus : "pending";
    return {
      id,
      review_status: reviewStatus,
      approved_quantity: wholeNumber(o.approvedQuantity, 0, TRADE_LIMITS.maxQuantity),
      approved_unit_cents: wholeNumber(o.approvedUnitCents, 0, TRADE_LIMITS.maxEstimateCents),
      ...(o.reviewNote !== undefined ? { review_note: cleanText(o.reviewNote, 1000) } : {}),
      ...(o.internalNote !== undefined ? { internal_note: cleanText(o.internalNote, 2000) } : {}),
    };
  });
}

const FLAGS = new Set(["damaged", "counterfeit", "incorrect", "missing"]);
const AUTHENTICITY = new Set(["unchecked", "authentic", "counterfeit", "unsure"]);

function readInspectionCards(raw: unknown, bundle: TradeBundle) {
  if (!Array.isArray(raw) || raw.length === 0) throw new HttpError(400, "Nothing to save.");
  const ids = cardIdsOf(bundle);
  return raw.map((item) => {
    const o = (item ?? {}) as Record<string, unknown>;
    const id = typeof o.id === "string" && UUID_RE.test(o.id) && ids.has(o.id.toLowerCase()) ? o.id.toLowerCase() : null;
    if (!id) throw new HttpError(400, "A card isn't on this trade. Refresh and try again.");
    const flags = Array.isArray(o.flags) ? [...new Set(o.flags.filter((f): f is string => typeof f === "string" && FLAGS.has(f)))] : [];
    return {
      id,
      received_quantity: wholeNumber(o.receivedQuantity, 0, TRADE_LIMITS.maxQuantity),
      authenticity: typeof o.authenticity === "string" && AUTHENTICITY.has(o.authenticity) ? o.authenticity : "unchecked",
      verified_condition: isConditionCode(o.verifiedCondition) ? o.verifiedCondition : null,
      final_quantity: wholeNumber(o.finalQuantity, 0, TRADE_LIMITS.maxQuantity),
      final_unit_cents: wholeNumber(o.finalUnitCents, 0, TRADE_LIMITS.maxEstimateCents),
      flags,
      ...(o.inspectionNote !== undefined ? { inspection_note: cleanText(o.inspectionNote, 1000) } : {}),
      ...(o.inspectionInternalNote !== undefined ? { inspection_internal_note: cleanText(o.inspectionInternalNote, 2000) } : {}),
    };
  });
}

/**
 * The ship-by deadline: the end of the day ship_business_days business days
 * from now (St. Louis time), or a date staff picked (end of that day).
 */
function readShipBy(raw: unknown, settings: TradeSettingsRow): string {
  if (raw === undefined || raw === null || raw === "") {
    return new Date(addBusinessDays(Date.now(), settings.ship_business_days)).toISOString();
  }
  if (typeof raw !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) throw new HttpError(400, "Pick a ship-by date.");
  // Noon UTC is the same calendar day in St. Louis; the deadline is that day's end there.
  const noon = Date.parse(`${raw}T12:00:00Z`);
  if (!Number.isFinite(noon)) throw new HttpError(400, "Pick a ship-by date.");
  const end = endOfStoreDay(noon);
  if (end <= Date.now() || end > Date.now() + 60 * 24 * 60 * 60_000) {
    throw new HttpError(400, "Pick a ship-by date in the next 60 days.");
  }
  return new Date(end).toISOString();
}

async function extend(admin: Admin, bundle: TradeBundle, hours: number, staff: StaffContext): Promise<void> {
  const t = bundle.trade;
  const ms = hours * 3_600_000;
  const later = (iso: string | null) => new Date(Math.max(Date.now(), iso ? Date.parse(iso) : 0) + ms).toISOString();
  let patch: { hold_expires_at?: string; ship_by?: string; payment_due_at?: string };
  let statuses: TradeStatus[];
  if (t.status === "awaiting_trade_list" || t.status === "revision_requested") {
    patch = { hold_expires_at: later(t.hold_expires_at) };
    statuses = ["awaiting_trade_list", "revision_requested"];
  } else if (t.status === "awaiting_shipment") {
    patch = { hold_expires_at: later(t.hold_expires_at), ship_by: later(t.ship_by) };
    statuses = ["awaiting_shipment"];
  } else if (t.status === "awaiting_payment") {
    patch = { payment_due_at: later(t.payment_due_at) };
    statuses = ["awaiting_payment"];
  } else {
    throw new HttpError(409, "This trade has no deadline to extend.");
  }
  const { data, error } = await admin.from("trade_requests").update(patch).eq("id", t.id).in("status", statuses).select("id");
  if (error) throw new HttpError(500, "We couldn't extend the deadline. Try again.");
  if (!data || data.length === 0) throw new HttpError(409, "This trade changed. Refresh and try again.");
  await logEvent(admin, t.id, staff, "hold_extended", t.status, t.status, { hours, ...patch });
}

async function markReturned(admin: Admin, staff: StaffContext, bundle: TradeBundle, body: Record<string, unknown>): Promise<void> {
  const t = bundle.trade;
  const carrier = body.carrier === undefined || body.carrier === null || body.carrier === "" ? null : body.carrier;
  if (carrier !== null && !isTradeCarrier(carrier)) throw new HttpError(400, "Choose the carrier.");
  const rawTracking = typeof body.trackingNumber === "string" ? body.trackingNumber.trim() : "";
  const tracking = rawTracking ? cleanTrackingNumber(rawTracking) : null;
  if (rawTracking && !tracking) throw new HttpError(400, "That tracking number doesn't look right.");
  const now = new Date().toISOString();
  const returnInfo = { return_carrier: carrier, return_tracking: tracking, returned_at: now };

  if (t.status === "return_pending") {
    const { data, error } = await admin
      .from("trade_requests")
      .update({ ...returnInfo, status: "returned", closed_at: now })
      .eq("id", t.id)
      .eq("status", "return_pending")
      .select("id");
    if (error) throw new HttpError(500, "We couldn't mark the cards returned. Try again.");
    if (!data || data.length === 0) throw new HttpError(409, "This trade changed. Refresh and try again.");
    const back = await admin
      .from("trade_offer_cards")
      .update({ disposition: "returned" })
      .eq("trade_request_id", t.id)
      .eq("disposition", "pending");
    if (back.error) console.error("[admin/trade-center] dispositions not updated", t.id, back.error.message);
    await logEvent(admin, t.id, staff, "returned", t.status, "returned", { carrier, tracking });
    return;
  }
  if (t.status === "approved_for_fulfillment" || t.status === "completed") {
    // Cards we didn't take from a finished trade.
    const rejected = bundle.offers.filter((c) => c.disposition === "rejected");
    if (rejected.length === 0) throw new HttpError(409, "There are no rejected cards to return on this trade.");
    const { error } = await admin.from("trade_requests").update(returnInfo).eq("id", t.id);
    if (error) throw new HttpError(500, "We couldn't save the return. Try again.");
    const back = await admin
      .from("trade_offer_cards")
      .update({ disposition: "returned" })
      .eq("trade_request_id", t.id)
      .eq("disposition", "rejected");
    if (back.error) console.error("[admin/trade-center] dispositions not updated", t.id, back.error.message);
    await logEvent(admin, t.id, staff, "returned", t.status, t.status, { carrier, tracking, cards: rejected.length });
    return;
  }
  throw new HttpError(409, "Mark cards returned once the trade is waiting for its return, or for rejected cards from a finished trade.");
}

async function importCard(admin: Admin, staff: StaffContext, body: Record<string, unknown>): Promise<string> {
  const cardId = typeof body.offerCardId === "string" && UUID_RE.test(body.offerCardId) ? body.offerCardId.toLowerCase() : null;
  if (!cardId) throw new HttpError(400, "Which card?");
  const price = wholeNumber(body.priceCents, 1, TRADE_LIMITS.maxEstimateCents);
  if (price === null) throw new HttpError(400, "Set a selling price.");
  const { data: card, error: cardErr } = await admin
    .from("trade_offer_cards")
    .select("trade_request_id")
    .eq("id", cardId)
    .maybeSingle();
  if (cardErr) throw new HttpError(500, "We couldn't load that card. Try again.");
  if (!card) throw new HttpError(404, "That card isn't on a trade.");
  const { data, error } = await admin.rpc("trade_import_card", {
    p_offer_card_id: cardId,
    p_price_cents: price,
    p_storage_location: cleanText(body.storageLocation, 120),
    p_actor: staff.email ?? "staff",
  });
  if (error) throw tradeDbError(error, "We couldn't add the card to inventory. Try again.");
  await logAdminAction(admin, staff, {
    action: "trade.import_card",
    resourceType: "trade_request",
    resourceId: card.trade_request_id,
    after: { offerCardId: cardId, inventoryItemId: data, priceCents: price },
  });
  return card.trade_request_id;
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

type Range = readonly [number, number];

function num(o: Record<string, unknown>, key: string, range: Range, label: string): number {
  const value = wholeNumber(o[key], range[0], range[1]);
  if (value === null) throw new HttpError(400, `${label}: enter a whole number from ${range[0]} to ${range[1]}.`);
  return value;
}

function textList(raw: unknown, maxItems: number, maxLength: number, label: string): string[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) throw new HttpError(400, `${label} didn't come through.`);
  const out = [...new Set(raw.map((v) => cleanText(v, maxLength)).filter((v): v is string => Boolean(v)))];
  if (out.length > maxItems) throw new HttpError(400, `${label}: up to ${maxItems}.`);
  return out;
}

async function saveSettings(admin: Admin, staff: StaffContext, before: TradeSettingsRow, raw: unknown): Promise<TradeSettingsRow> {
  const o = (raw ?? {}) as Record<string, unknown>;
  const r = TRADE_SETTING_RANGES;
  const percents = (o.conditionPercents ?? {}) as Record<string, unknown>;
  for (const code of CARD_CONDITIONS) {
    if (wholeNumber(percents[code], r.conditionPercent[0], r.conditionPercent[1]) === null) {
      throw new HttpError(400, `${code} condition: enter a percentage from 0 to 100.`);
    }
  }
  const maxTrade = o.maxTradeValueCents === null || o.maxTradeValueCents === undefined || o.maxTradeValueCents === ""
    ? null
    : num(o, "maxTradeValueCents", r.maxTradeValueCents, "Largest trade");
  const minTrade = num(o, "minTradeValueCents", r.minTradeValueCents, "Smallest trade");
  if (maxTrade !== null && maxTrade < minTrade) throw new HttpError(400, "The largest trade can't be smaller than the smallest.");

  const ship = (o.shipTo ?? null) as Record<string, unknown> | null;
  let address: Pick<TradeSettingsRow, "ship_to_name" | "ship_to_line1" | "ship_to_line2" | "ship_to_city" | "ship_to_state" | "ship_to_postal_code">;
  const anyAddress = ship && ["line1", "city", "state", "postalCode"].some((k) => cleanText(ship[k], 200));
  if (anyAddress && ship) {
    const line1 = cleanText(ship.line1, 200);
    const city = cleanText(ship.city, 100);
    if (!line1 || !city) throw new HttpError(400, "Shipping address: add the street and city.");
    const check = checkUsAddress({ state: ship.state, postalCode: ship.postalCode, country: SHIP_TO_COUNTRY });
    if (!check.ok) throw new HttpError(400, `Shipping address: ${check.message}`);
    address = {
      ship_to_name: cleanText(ship.name, 120),
      ship_to_line1: line1,
      ship_to_line2: cleanText(ship.line2, 200),
      ship_to_city: city,
      ship_to_state: check.state,
      ship_to_postal_code: check.postalCode,
    };
  } else {
    address = { ship_to_name: null, ship_to_line1: null, ship_to_line2: null, ship_to_city: null, ship_to_state: null, ship_to_postal_code: null };
  }

  const enabled = o.enabled === true;
  if (enabled && !address.ship_to_line1) {
    throw new HttpError(400, "Add the address customers mail their cards to before turning trading on.");
  }
  const packing = cleanText(o.packingInstructions, 4000);
  const returns = cleanText(o.returnPolicy, 4000);
  if (!packing) throw new HttpError(400, "Add packing instructions for customers.");
  if (!returns) throw new HttpError(400, "Add the return policy customers see.");

  const update = {
    enabled,
    paused: o.paused === true,
    pause_message: cleanText(o.pauseMessage, 500) ?? before.pause_message,
    credit_rate_percent: num(o, "creditRatePercent", r.creditRatePercent, "Trade credit rate"),
    min_card_value_cents: num(o, "minCardValueCents", r.minCardValueCents, "Minimum card value"),
    condition_nm_percent: percents.NM as number,
    condition_lp_percent: percents.LP as number,
    condition_mp_percent: percents.MP as number,
    condition_hp_percent: percents.HP as number,
    condition_dmg_percent: percents.DMG as number,
    reservation_hours: num(o, "reservationHours", r.reservationHours, "Hold for building a list"),
    revision_hours: num(o, "revisionHours", r.revisionHours, "Hold for changes"),
    ship_business_days: num(o, "shipBusinessDays", r.shipBusinessDays, "Business days to ship"),
    ship_grace_hours: num(o, "shipGraceHours", r.shipGraceHours, "Grace after the ship-by date"),
    transit_alert_days: num(o, "transitAlertDays", r.transitAlertDays, "In transit alert"),
    payment_due_days: num(o, "paymentDueDays", r.paymentDueDays, "Days to pay"),
    max_active_trades: num(o, "maxActiveTrades", r.maxActiveTrades, "Open trades per customer"),
    max_wanted_lines: num(o, "maxWantedLines", r.maxWantedLines, "Our cards per trade"),
    max_offered_lines: num(o, "maxOfferedLines", r.maxOfferedLines, "Their cards per trade"),
    min_trade_value_cents: minTrade,
    max_trade_value_cents: maxTrade,
    max_expired_trades_30d: num(o, "maxExpiredTrades30d", r.maxExpiredTrades30d, "Expired trades before a pause"),
    processing_fee_cents: num(o, "processingFeeCents", r.processingFeeCents, "Processing fee"),
    cash_payout_enabled: o.cashPayoutEnabled === true,
    cash_rate_percent: num(o, "cashRatePercent", r.cashRatePercent, "Cash rate"),
    overstock_threshold: num(o, "overstockThreshold", r.overstockThreshold, "Overstock limit"),
    excluded_set_codes: textList(o.excludedSetCodes, 200, 12, "Excluded sets").map((c) => c.toUpperCase()),
    excluded_card_names: textList(o.excludedCardNames, 500, 200, "Excluded cards"),
    notify_customer: o.notifyCustomer !== false,
    notify_staff: o.notifyStaff !== false,
    shipping_paid_by: o.shippingPaidBy === "store" ? "store" : "customer",
    ...address,
    packing_instructions: packing,
    return_policy: returns,
    updated_at: new Date().toISOString(),
    updated_by: staff.userId,
  };
  const { data, error } = await admin.from("trade_settings").update(update).eq("id", true).select("*").single();
  if (error || !data) {
    if (error) console.error("[admin/trade-center] settings save failed", error.message);
    throw new HttpError(500, "We couldn't save the settings. Try again.");
  }
  await logAdminAction(admin, staff, {
    action: "trade.settings",
    resourceType: "trade_settings",
    resourceId: "trade_settings",
    before: settingsView(before) as unknown as Record<string, unknown>,
    after: settingsView(data) as unknown as Record<string, unknown>,
  });
  return data;
}
