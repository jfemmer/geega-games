import type { VercelRequest, VercelResponse } from "@vercel/node";
import type { Json } from "../../src/types/database.js";
import { HttpError, methodNotAllowed, readJsonBody, sendJson } from "../_lib/http.js";
import { requireStaff, type StaffContext } from "../_lib/adminAuth.js";
import { getSupabaseAdmin } from "../_lib/supabaseAdmin.js";
import { logAdminAction } from "../_lib/auditLog.js";
import {
  DISPUTE_BUCKET,
  UUID_RE,
  bundleAvailability,
  loadWantedTraits,
  loadStockedLines,
  type WantedCardTraits,
  cleanText,
  confirmDeadline,
  customerStanding,
  depositDecision,
  disputeFilesOf,
  handoffOf,
  loadTradeBundle,
  loadTradeSettings,
  readTradeId,
  readWantedInputs,
  settingsView,
  shipDeadline,
  staffSummaryView,
  staffTradeView,
  tradeDbError,
  wholeNumber,
  type Admin,
  type CustomerStanding,
  type TradeBundle,
  type TradeSettingsRow,
} from "../_lib/tradeCenter.js";
import { notifyTradeStaff, sendTradeCustomerEmail } from "../_lib/tradeCenterEmails.js";
import { afterFinalized, stopOpenPayment } from "../_lib/tradePayments.js";
import { processDepositRefund, recordDepositPayment, retireDepositIntent } from "../_lib/tradeDeposits.js";
import { trackingConnected } from "../_lib/tradeTracking.js";
import { checkUsAddress, SHIP_TO_COUNTRY } from "../../src/store/lib/usAddress.js";
import {
  CARD_CONDITIONS,
  DEPOSIT_STATUSES,
  RESERVED_STATUSES,
  STAFF_CANCELABLE_STATUSES,
  STAFF_REJECTABLE_STATUSES,
  STAFF_WANTED_STATUSES,
  TRADE_LIMITS,
  TRADE_SETTING_RANGES,
  TRADE_STATUSES,
  cleanTrackingNumber,
  copiesToReturn,
  isOpenTrade,
  isTradeCarrier,
  isTradeStatus,
  type StockedLine,
  type TradeStatus,
} from "../../src/store/lib/tradeCenter.js";
import { addQualifyingHours, excludedDateSet } from "../../src/store/lib/tradeDeadlines.js";
import { readCustomerRecord, privilegesFor, type DepositOverride } from "../../src/store/lib/tradeRules.js";
import { acceptedCardCounts, economicsTotals, tradeEconomics, type TradeEconomics } from "../../src/store/lib/tradeEconomics.js";

// /api/admin/trade-center: admin Trades (online trades from the storefront's
// Trade Cards page). Staff only (requireStaff); settings, keeping a deposit,
// per-customer rules, clearing a customer's fault, recording a payment by
// hand and marking cash paid are for the store owner (role admin).
//
//   GET ?view=list[&filter=…][&deposit=<status>][&q=] → { trades, counts, settings, owner }
//        filter: waiting (needs staff), open, all, deposits, reserved, abandoned, local (local pickup), finished
//        (approved for fulfillment or completed), or a status. The filters' counts and the
//        statuses' share one object, so no filter is named after a status.
//   GET ?id=<trade id>                               → { trade, settings, owner }
//   GET ?view=settings                               → { settings, owner }
//   GET ?view=reserved                               → { lines, settings, owner }   our cards held for trades
//   GET ?view=customers                              → { customers, settings, owner } reliability
//   GET ?view=deposits                               → { totals, trades, settings, owner }
//   GET ?view=economics[&days=30|90|365]             → { totals, trades, days, settings, owner }  finished trades
// (`owner`: the caller is the store owner, so the page shows owner-only controls.)
//   POST { action, … }:
//     saveSettings      { settings }                         owner
//     review            { tradeId, cards: [...] }            per card: approve (how many, value each) or reject
//     requestRevision   { tradeId, message }
//     approve           { tradeId, conditions?, depositOverride? }  → the customer confirms within confirmation_hours
//     reject            { tradeId, reason }                  before the trade is confirmed
//     setDeposit        { tradeId, override }                auto | required | waived, before it's paid
//     extend            { tradeId, kind, hours, customerRequested?, reason? }
//     verifyShipment    { tradeId, acceptedAt, onTime, refund?, note? }
//     markReceived      { tradeId }
//     cardsArrived      { tradeId }                          a package for an expired reservation
//     reinstate         { tradeId, mode, shipDays?, acceptedAt?, clearFault? }
//     expireNow         { tradeId, reason, countAgainst? }   release a reservation that wasn't shipped
//     cancelByStore     { tradeId, reason }                  any deposit refunded, cards returned
//     refundDeposit     { tradeId, note? }
//     forfeitDeposit    { tradeId, note }                    owner, with keeping deposits turned on
//     retryRefund       { tradeId }
//     resolveDispute    { tradeId, disputeId, outcome, note? }
//     clearFault        { tradeId }                          owner
//     setCustomerFlags  { userId, depositRequired, blocked, note? }  owner
//     inspect, confirmAsDescribed, sendFinalOffer, reopenInspection, setWanted,
//     setPostage        { tradeId, postageCents | null }     what shipping our cards cost (finished trades)
//   Local pickup trades (handoff_method local):
//     approve           { …, meetupDetails? }                 no card review and never a deposit
//     setMeetup         { tradeId, details }                  where and when to meet (emailed once approved)
//     completeLocal     { tradeId, cards: [...], paidCents,   at the meetup: the cards we took, what they paid
//                         paymentMethod, paymentNote?,        in person (cash, card or other); finishes the
//                         cashForExcess? }                    trade, our cards handed over on an in-person order
//     saveMeetupDraft   { tradeId, cards: [...] }             at the meetup: save the cards and TCG lows entered so
//                                                             far (a card may be unpriced); staff only, not shown
//                                                             to the customer, finishes nothing
//     markReturned, importCard, recordPayment (owner), markCashPaid (owner), message
//
// Every change and total is the database's (trade_* functions, one
// transaction each, under the trade's row lock); this file checks input,
// works out deadlines (qualifying time) and deposits, writes the audit log,
// starts refunds and sends the emails.

const MAX_BODY_BYTES = 128 * 1024;
const MAX_LISTED = 300;
// completeLocal values every card and records a payment in one step (like recordPayment): the owner's call.
const OWNER_ONLY = new Set(["saveSettings", "recordPayment", "markCashPaid", "forfeitDeposit", "setCustomerFlags", "clearFault", "completeLocal"]);
/** What only makes sense for a trade that ships: refused on a local pickup trade. */
const SHIP_ONLY_ACTIONS = new Set([
  "review",
  "verifyShipment",
  "markReceived",
  "cardsArrived",
  "inspect",
  "confirmAsDescribed",
  "sendFinalOffer",
  "reopenInspection",
  "markReturned",
  "recordPayment",
  "setPostage",
  "resolveDispute",
]);
/** Signed links to proof-of-shipping files last this long. */
const FILE_LINK_SECONDS = 15 * 60;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const staff = await requireStaff(req);
    const admin = getSupabaseAdmin();

    // `owner`: the page shows the owner-only controls (the server checks again).
    const owner = staff.role === "admin";
    if (req.method === "GET") {
      const settings = await settingsForStaff(admin);
      const view = typeof req.query.view === "string" ? req.query.view : null;
      if (typeof req.query.id === "string") {
        const bundle = await loadTradeBundle(admin, readTradeId(req.query.id));
        if (!bundle) throw new HttpError(404, "That trade isn't there.");
        return sendJson(res, 200, { ok: true, trade: await staffView(admin, bundle, settings), settings: settingsView(settings), owner });
      }
      if (view === "settings") return sendJson(res, 200, { ok: true, settings: settingsView(settings), owner });
      if (view === "reserved") return sendJson(res, 200, { ok: true, lines: await reservedLines(admin), settings: settingsView(settings), owner });
      if (view === "customers") return sendJson(res, 200, { ok: true, customers: await customerList(admin, settings), settings: settingsView(settings), owner });
      if (view === "deposits") return sendJson(res, 200, { ok: true, ...(await depositOverview(admin)), settings: settingsView(settings), owner });
      if (view === "economics") {
        return sendJson(res, 200, { ok: true, ...(await economicsReport(admin, settings, req.query.days)), settings: settingsView(settings), owner });
      }
      return sendJson(res, 200, {
        ok: true,
        ...(await listTrades(admin, req.query.filter, req.query.q, req.query.deposit)),
        settings: settingsView(settings),
        owner,
      });
    }
    if (req.method !== "POST") return methodNotAllowed(res, ["GET", "POST"]);

    const body = await readJsonBody(req, MAX_BODY_BYTES);
    const action = typeof body.action === "string" ? body.action : "";
    if (OWNER_ONLY.has(action) && staff.role !== "admin") {
      throw new HttpError(403, "Only the store owner can do that.");
    }
    const settings = await settingsForStaff(admin);

    if (action === "saveSettings") {
      const next = await saveSettings(admin, staff, settings, body.settings);
      return sendJson(res, 200, { ok: true, settings: settingsView(next), owner });
    }
    if (action === "importCard") {
      const tradeId = await importCard(admin, staff, body);
      return await sendFresh(res, admin, tradeId, owner);
    }
    if (action === "setCustomerFlags") {
      const userId = await setCustomerFlags(admin, staff, body);
      return sendJson(res, 200, { ok: true, customers: await customerList(admin, settings), userId, settings: settingsView(settings), owner });
    }

    const tradeId = readTradeId(body.tradeId);
    const bundle = await loadTradeBundle(admin, tradeId);
    if (!bundle) throw new HttpError(404, "That trade isn't there.");
    const t = bundle.trade;
    const status = t.status as TradeStatus;
    const actor = { p_actor_id: staff.userId, p_actor_label: staff.email ?? "staff" };
    // What happened to the email the customer gets for this change (if any), for the page to say.
    let customerEmail: CustomerEmailOutcome | null = null;
    const audit = (what: string, after: Record<string, unknown> = {}) =>
      logAdminAction(admin, staff, {
        action: `trade.${what}`,
        resourceType: "trade_request",
        resourceId: tradeId,
        before: { status, depositStatus: t.deposit_status },
        after: { tradeNumber: t.trade_number, ...after },
      });

    if (handoffOf(t) === "local" && SHIP_ONLY_ACTIONS.has(action)) {
      throw new HttpError(409, "This is a local pickup trade: nothing is shipped. Finish it at the meetup instead.");
    }
    if (handoffOf(t) === "ship" && (action === "setMeetup" || action === "completeLocal")) {
      throw new HttpError(409, "Meetups are for local pickup trades.");
    }

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
        await retireOrRecordDeposit(bundle);
        const { error } = await admin.rpc("trade_request_revision", { p_trade_id: tradeId, p_message: message, ...actor });
        if (error) throw tradeDbError(error, "We couldn't ask for changes. Try again.");
        await audit("request_revision");
        customerEmail = await emailCustomer(admin, settings, tradeId, { kind: "revision_requested", message });
        break;
      }

      case "approve": {
        if (handoffOf(t) === "local") {
          // Approving holds our cards at once, until the trade is finished or
          // canceled: the customer doesn't confirm, and there's no deadline.
          // (The database ignores p_confirm_by for a local trade; it's still
          // sent so this works with the database before that update too.)
          const meetup = cleanText(body.meetupDetails, 2000);
          const conditions = cleanText(body.conditions, 2000);
          const { error } = await admin.rpc("trade_approve", {
            p_trade_id: tradeId,
            p_confirm_by: confirmDeadline(Date.now(), settings),
            p_deposit_cents: 0,
            p_deposit_reason: null,
            p_conditions: conditions,
            ...actor,
          });
          if (error) throw tradeDbError(error, "We couldn't approve the trade. Try again.");
          // Saved once the approval stands, so a refused approval leaves nothing behind; it goes out with the approval email.
          if (meetup) {
            const set = await admin.rpc("trade_set_meetup", { p_trade_id: tradeId, p_details: meetup, ...actor });
            if (set.error) console.error("[admin/trade-center] meetup not saved after approval", tradeId, set.error.message);
          }
          await audit("approve", { handoffMethod: "local", heldUntil: "finished", conditions, meetup });
          customerEmail = await emailCustomer(admin, settings, tradeId, { kind: "approved" });
          break;
        }
        const override = readOverride(body.depositOverride) ?? null;
        if (override && override !== t.deposit_override) {
          const { error } = await admin.from("trade_requests").update({ deposit_override: override }).eq("id", tradeId).eq("status", "pending_review");
          if (error) throw new HttpError(500, "We couldn't save the deposit setting. Try again.");
        }
        const standing = await customerStanding(admin, t.user_id, settings);
        const deposit = depositDecision(t, standing, settings, override ?? undefined);
        const confirmBy = confirmDeadline(Date.now(), settings);
        const conditions = cleanText(body.conditions, 2000);
        const { data, error } = await admin.rpc("trade_approve", {
          p_trade_id: tradeId,
          p_confirm_by: confirmBy,
          p_deposit_cents: deposit.cents,
          p_deposit_reason: deposit.reason,
          p_conditions: conditions,
          ...actor,
        });
        if (error) throw tradeDbError(error, "We couldn't approve the trade. Try again.");
        await audit("approve", { approvedValueCents: data, confirmBy, depositCents: deposit.cents, depositReason: deposit.reason, conditions });
        customerEmail = await emailCustomer(admin, settings, tradeId, { kind: "approved" });
        break;
      }

      case "reject": {
        if (!STAFF_REJECTABLE_STATUSES.includes(status)) {
          throw new HttpError(409, "Once a trade is confirmed, cancel it instead (any deposit is refunded).");
        }
        const reason = cleanText(body.reason, 2000);
        if (!reason) throw new HttpError(400, "Give the customer a reason.");
        await retireOrRecordDeposit(bundle);
        const { data, error } = await admin.rpc("trade_close", {
          p_trade_id: tradeId,
          p_status: "rejected",
          p_from_statuses: [...STAFF_REJECTABLE_STATUSES],
          p_reason: reason,
          p_fault: null,
          p_actor_type: "staff",
          ...actor,
        });
        if (error) throw tradeDbError(error, "We couldn't reject the trade. Try again.");
        if (!Array.isArray(data) || !data[0]?.closed) throw new HttpError(409, "This trade changed. Refresh and try again.");
        await audit("reject", { reason });
        customerEmail = await emailCustomer(admin, settings, tradeId, { kind: "rejected", reason });
        break;
      }

      case "setDeposit": {
        const override = readOverride(body.override);
        if (!override) throw new HttpError(400, "Choose automatic, required or waived.");
        if (handoffOf(t) === "local") throw new HttpError(409, "Local pickup trades don't take a deposit.");
        await retireOrRecordDeposit(bundle);
        const standing = await customerStanding(admin, t.user_id, settings);
        const deposit = depositDecision(t, standing, settings, override);
        const { error } = await admin.rpc("trade_set_deposit", {
          p_trade_id: tradeId,
          p_override: override,
          p_deposit_cents: deposit.cents,
          p_reason: deposit.reason,
          ...actor,
        });
        if (error) throw tradeDbError(error, "We couldn't change the deposit. Try again.");
        await audit("set_deposit", { override, depositCents: deposit.cents, was: t.deposit_cents });
        if ((status === "awaiting_confirmation" || status === "awaiting_deposit") && deposit.cents !== t.deposit_cents) {
          const text =
            deposit.cents > 0
              ? `The refundable deposit for this trade is now ${formatCents(deposit.cents)}. You'll see it when you confirm.`
              : "This trade no longer needs a deposit. You can confirm it without paying anything.";
          customerEmail = await systemMessage(admin, settings, tradeId, text);
        }
        break;
      }

      case "extend": {
        const kind = body.kind === "list" || body.kind === "confirmation" || body.kind === "shipping" || body.kind === "payment" ? body.kind : null;
        if (!kind) throw new HttpError(400, "Which deadline?");
        if (kind === "shipping" && handoffOf(t) === "local") {
          throw new HttpError(409, "A local pickup trade holds our cards until it's finished: there's no deadline to extend.");
        }
        const hours = wholeNumber(body.hours, 1, 720);
        if (hours === null) throw new HttpError(400, "Extend by 1 to 720 hours.");
        const current =
          kind === "list" ? t.list_due_at : kind === "confirmation" ? t.confirm_by : kind === "shipping" ? t.ship_by : t.payment_due_at;
        const from = Math.max(Date.now(), current ? Date.parse(current) : 0);
        // Confirmation and shipping run in qualifying time (Sundays and excluded days don't count).
        const next =
          kind === "confirmation" || kind === "shipping"
            ? addQualifyingHours(from, hours, settings.excluded_dates)
            : from + hours * 3_600_000;
        const customerRequested = body.customerRequested === true;
        const reason = cleanText(body.reason, 1000);
        const { error } = await admin.rpc("trade_extend", {
          p_trade_id: tradeId,
          p_kind: kind,
          p_new_deadline: new Date(next).toISOString(),
          p_hours: hours,
          p_customer_requested: customerRequested,
          p_reason: reason,
          ...actor,
        });
        if (error) throw tradeDbError(error, "We couldn't extend the deadline. Try again.");
        await audit("extend", { kind, hours, customerRequested, to: new Date(next).toISOString() });
        customerEmail = await emailCustomer(admin, settings, tradeId, { kind: "extended", deadline: kind });
        break;
      }

      case "verifyShipment": {
        const acceptedAt = readTime(body.acceptedAt, "When did the carrier accept it?");
        const onTime = body.onTime === true;
        const refund = onTime || body.refund === true;
        const note = cleanText(body.note, 2000);
        const { data, error } = await admin.rpc("trade_verify_shipment", {
          p_trade_id: tradeId,
          p_accepted_at: acceptedAt,
          p_on_time: onTime,
          p_refund: refund,
          p_note: note,
          ...actor,
        });
        if (error) throw tradeDbError(error, "We couldn't verify the shipment. Try again.");
        await audit("verify_shipment", { acceptedAt, onTime, refund, deposit: data, note });
        customerEmail = await emailCustomer(admin, settings, tradeId, { kind: "shipment_verified" });
        if (data === "refund_pending") await processDepositRefund(admin, tradeId, { notifyStarted: false });
        if (data === "forfeiture_review") {
          const fresh = await loadTradeBundle(admin, tradeId);
          if (fresh) await notifyTradeStaff(fresh, settings, { kind: "forfeiture_review", why: "late" });
        }
        break;
      }

      case "markReceived": {
        const { data, error } = await admin.rpc("trade_mark_received", { p_trade_id: tradeId, ...actor });
        if (error) throw tradeDbError(error, "We couldn't mark the package received. Try again.");
        await audit("mark_received", { deposit: data });
        customerEmail = await emailCustomer(admin, settings, tradeId, { kind: "received" });
        if (data === "refund_pending") await processDepositRefund(admin, tradeId, { notifyStarted: false });
        break;
      }

      case "cardsArrived": {
        if (status !== "expired") throw new HttpError(409, "Use Mark received for a trade that's still waiting for its package.");
        const now = new Date().toISOString();
        const { error } = await admin
          .from("trade_requests")
          .update({ received_at: now, inbound_delivered_at: t.inbound_delivered_at ?? now, return_status: t.return_status === "returned" ? "returned" : "pending" })
          .eq("id", tradeId)
          .eq("status", "expired");
        if (error) throw new HttpError(500, "We couldn't save that. Try again.");
        await logEvent(admin, tradeId, staff, "arrived_after_expiry", status, status);
        await audit("cards_arrived");
        break;
      }

      case "reinstate": {
        const mode = body.mode === "awaiting_shipment" || body.mode === "in_transit" || body.mode === "received" ? body.mode : null;
        if (!mode) throw new HttpError(400, "Reinstate how?");
        const local = handoffOf(t) === "local";
        if (local && mode !== "awaiting_shipment") {
          throw new HttpError(400, "A local pickup trade is reinstated by holding our cards again.");
        }
        let shipBy: string | null = null;
        let acceptedAt: string | null = null;
        if (mode === "awaiting_shipment" && local) {
          // A local pickup trade comes back held until it's finished: the
          // database ignores this deadline for it (sent so this works with the
          // database before that update too).
          shipBy = shipDeadline(Date.now(), settings.local_meet_days, settings);
        } else if (mode === "awaiting_shipment") {
          const days = wholeNumber(body.shipDays, 1, 30);
          if (days === null) throw new HttpError(400, "Give them 1 to 30 days to ship.");
          shipBy = shipDeadline(Date.now(), days, settings);
        }
        if (mode === "in_transit") acceptedAt = readTime(body.acceptedAt, "When did the carrier accept it?");
        const { data, error } = await admin.rpc("trade_reinstate", {
          p_trade_id: tradeId,
          p_mode: mode,
          p_ship_by: shipBy,
          p_accepted_at: acceptedAt,
          p_clear_fault: body.clearFault === true,
          ...actor,
        });
        if (error) throw tradeDbError(error, "We couldn't reinstate the trade. Try again.");
        const row = Array.isArray(data) ? data[0] : null;
        if (row?.result === "unavailable") {
          const names = (Array.isArray(row.short_lines) ? row.short_lines : [])
            .map((s) => (s && typeof s === "object" && !Array.isArray(s) ? String((s as Record<string, unknown>).card_name) : ""))
            .filter(Boolean)
            .join(", ");
          throw new HttpError(409, `Can't reinstate: ${names || "a card"} isn't available any more. Mail their cards back, or change our cards first.`);
        }
        await audit("reinstate", { mode, shipBy, acceptedAt, clearFault: body.clearFault === true });
        customerEmail = await emailCustomer(admin, settings, tradeId, { kind: "reinstated" });
        await processDepositRefund(admin, tradeId, { notifyStarted: false });
        break;
      }

      case "expireNow": {
        if (status !== "awaiting_shipment" && status !== "tracking_submitted") {
          throw new HttpError(409, "Only a reservation waiting for its shipment can be released this way.");
        }
        const reason = cleanText(body.reason, 2000);
        if (!reason) throw new HttpError(400, "Say why the reservation is being released.");
        const countAgainst = body.countAgainst !== false;
        const { data, error } = await admin.rpc("trade_close", {
          p_trade_id: tradeId,
          p_status: "expired",
          p_from_statuses: ["awaiting_shipment", "tracking_submitted"],
          p_reason: reason,
          p_fault: countAgainst ? "missed_deadline" : null,
          p_actor_type: "staff",
          ...actor,
          p_stage: "shipping",
        });
        if (error) throw tradeDbError(error, "We couldn't release the reservation. Try again.");
        if (!Array.isArray(data) || !data[0]?.closed) throw new HttpError(409, "This trade changed. Refresh and try again.");
        await audit("expire_now", { reason, countAgainst, deposit: data[0].deposit_after });
        customerEmail = await emailCustomer(admin, settings, tradeId, { kind: "expired" });
        break;
      }

      case "cancelByStore": {
        if (!STAFF_CANCELABLE_STATUSES.includes(status)) {
          throw new HttpError(409, STAFF_REJECTABLE_STATUSES.includes(status) ? "Reject it instead: it isn't confirmed yet." : "This trade can't be canceled now.");
        }
        const reason = cleanText(body.reason, 2000);
        if (!reason) throw new HttpError(400, "Give the customer a reason.");
        if (status === "awaiting_payment") await stopOpenPayment(t);
        const { data, error } = await admin.rpc("trade_close", {
          p_trade_id: tradeId,
          p_status: "canceled_by_store",
          p_from_statuses: [...STAFF_CANCELABLE_STATUSES],
          p_reason: reason,
          p_fault: null,
          p_actor_type: "staff",
          ...actor,
        });
        if (error) throw tradeDbError(error, "We couldn't cancel the trade. Try again.");
        if (!Array.isArray(data) || !data[0]?.closed) throw new HttpError(409, "This trade changed. Refresh and try again.");
        await audit("cancel_by_store", { reason, deposit: data[0].deposit_after });
        customerEmail = await emailCustomer(admin, settings, tradeId, { kind: "canceled_by_store", reason });
        await processDepositRefund(admin, tradeId, { notifyStarted: false });
        break;
      }

      case "refundDeposit": {
        const note = cleanText(body.note, 2000);
        const { error } = await admin.rpc("trade_deposit_update", {
          p_trade_id: tradeId,
          p_to: "refund_pending",
          p_refund_id: null,
          p_failure: null,
          p_note: note,
          p_actor_type: "staff",
          ...actor,
        });
        if (error) throw tradeDbError(error, "We couldn't start the refund. Try again.");
        await audit("refund_deposit", { note, amountCents: t.deposit_paid_cents });
        const why = bundle.disputes.some((d) => d.status === "accepted") ? "dispute" : "staff";
        const outcome = await processDepositRefund(admin, tradeId, { notifyStarted: true, why });
        customerEmail = { status: outcome === "skipped" ? "skipped" : "sent", ...(outcome === "skipped" ? { reason: "stripe-not-configured" } : {}) };
        break;
      }

      case "forfeitDeposit": {
        const note = cleanText(body.note, 2000);
        if (!note) throw new HttpError(400, "Note why the deposit is being kept (the customer sees it).");
        const { error } = await admin.rpc("trade_deposit_update", {
          p_trade_id: tradeId,
          p_to: "forfeited",
          p_refund_id: null,
          p_failure: null,
          p_note: note,
          p_actor_type: "staff",
          ...actor,
        });
        if (error) throw tradeDbError(error, "We couldn't record that. Try again.");
        await audit("forfeit_deposit", { note, amountCents: t.deposit_paid_cents });
        customerEmail = await emailCustomer(admin, settings, tradeId, { kind: "deposit_kept" });
        break;
      }

      case "retryRefund": {
        if (t.deposit_status !== "refund_failed") throw new HttpError(409, "There's no failed refund to try again.");
        const { error } = await admin.rpc("trade_deposit_update", {
          p_trade_id: tradeId,
          p_to: "refund_pending",
          p_refund_id: null,
          p_failure: null,
          p_note: cleanText(body.note, 2000),
          p_actor_type: "staff",
          ...actor,
        });
        if (error) throw tradeDbError(error, "We couldn't retry the refund. Try again.");
        await audit("retry_refund", { attempt: t.deposit_refund_attempts + 1 });
        await processDepositRefund(admin, tradeId, { notifyStarted: false });
        break;
      }

      case "resolveDispute": {
        const disputeId = typeof body.disputeId === "string" && UUID_RE.test(body.disputeId) ? body.disputeId.toLowerCase() : null;
        if (!disputeId || !bundle.disputes.some((d) => d.id === disputeId)) throw new HttpError(400, "Which proof of shipping?");
        const outcome = body.outcome === "accepted" || body.outcome === "rejected" ? body.outcome : null;
        if (!outcome) throw new HttpError(400, "Accept or reject it.");
        const note = cleanText(body.note, 2000);
        const { error } = await admin.rpc("trade_resolve_dispute", { p_dispute_id: disputeId, p_outcome: outcome, p_note: note, ...actor });
        if (error) throw tradeDbError(error, "We couldn't save the decision. Try again.");
        await audit("resolve_dispute", { disputeId, outcome, note });
        break;
      }

      case "clearFault": {
        const { error } = await admin.rpc("trade_clear_fault", { p_trade_id: tradeId, ...actor });
        if (error) throw tradeDbError(error, "We couldn't clear it. Try again.");
        await audit("clear_fault", { fault: t.customer_fault });
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
        customerEmail = await emailCustomer(admin, settings, tradeId, { kind: "final_offer" });
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
        customerEmail = await emailCustomer(admin, settings, tradeId, { kind: "returned" });
        break;
      }

      case "recordPayment": {
        if (status !== "awaiting_payment") throw new HttpError(409, "This trade isn't waiting for a payment.");
        const note = cleanText(body.note, 200);
        if (!note) throw new HttpError(400, "Say how it was paid (for example, cash in store).");
        await stopOpenPayment(t);
        const due = t.amount_due_cents ?? 0;
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
        if (t.excess_handling !== "cash" || !t.cash_payout_cents) {
          throw new HttpError(409, "This trade has no cash payout.");
        }
        if (t.cash_paid_at) throw new HttpError(409, "The cash was already marked paid.");
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
        await logEvent(admin, tradeId, staff, "cash_paid", status, status, { amount_cents: t.cash_payout_cents, note });
        await audit("mark_cash_paid", { amountCents: t.cash_payout_cents, note });
        break;
      }

      case "setPostage": {
        // What shipping our cards actually cost (for the trade economics),
        // when the label wasn't bought through EasyPost. null clears it.
        const raw = body.postageCents;
        const cents = raw === null || raw === "" ? null : wholeNumber(raw, 0, 100_000);
        if (raw !== null && raw !== "" && cents === null) throw new HttpError(400, "Enter what the postage cost, from $0.00 to $1,000.00.");
        const { data, error } = await admin
          .from("trade_requests")
          .update({ outbound_postage_cents: cents })
          .eq("id", tradeId)
          .in("status", ["approved_for_fulfillment", "completed"])
          .select("id");
        if (error) throw new HttpError(500, "We couldn't save the postage. Try again.");
        if (!data || data.length === 0) throw new HttpError(409, "Postage is recorded once the trade is finished.");
        await logEvent(admin, tradeId, staff, "postage_recorded", status, status, { postage_cents: cents, was: t.outbound_postage_cents });
        await audit("set_postage", { postageCents: cents });
        break;
      }

      case "setMeetup": {
        const details = cleanText(body.details, 2000);
        const { error } = await admin.rpc("trade_set_meetup", { p_trade_id: tradeId, p_details: details, ...actor });
        if (error) throw tradeDbError(error, "We couldn't save where to meet. Try again.");
        await audit("set_meetup", { details });
        // Before approval it goes out with the approval email.
        if (details && details !== t.meetup_details && (status === "awaiting_confirmation" || status === "awaiting_shipment")) {
          customerEmail = await emailCustomer(admin, settings, tradeId, { kind: "meetup_set" });
        }
        break;
      }

      case "completeLocal": {
        const cards = readLocalCards(body.cards, settings.max_offered_lines);
        const paidCents = wholeNumber(body.paidCents, 0, 100_000_000);
        if (paidCents === null) throw new HttpError(400, "Enter what they paid, or $0.00.");
        const method = body.paymentMethod === "cash" || body.paymentMethod === "card" || body.paymentMethod === "other" ? body.paymentMethod : null;
        if (paidCents > 0 && !method) throw new HttpError(400, "Say how they paid: cash, card or another way.");
        const note = cleanText(body.paymentNote, 160);
        const cash = body.cashForExcess === true;
        const { data, error } = await admin.rpc("trade_complete_local", {
          p_trade_id: tradeId,
          p_cards: cards as unknown as Json,
          p_paid_cents: paidCents,
          p_payment_method: paidCents > 0 ? method : null,
          p_payment_note: note,
          p_cash_for_excess: cash,
          ...actor,
        });
        if (error) throw tradeDbError(error, "We couldn't finish the trade. Try again.");
        await audit("complete_local", { orderId: data, cards: cards.length, paidCents, paymentMethod: method, cashForExcess: cash });
        customerEmail = await emailCustomer(admin, settings, tradeId, { kind: "completed" });
        break;
      }

      case "saveMeetupDraft": {
        // The cards and TCG lows entered at the meetup, kept until the trade is
        // finished. Changes nothing else about the trade; the customer never sees it.
        if (handoffOf(t) !== "local" || status !== "awaiting_shipment") {
          throw new HttpError(409, "Prices can only be saved on a local pickup trade waiting for the meetup.");
        }
        const cards = readLocalCards(body.cards, settings.max_offered_lines, { draft: true });
        const savedAt = new Date().toISOString();
        const { data, error } = await admin
          .from("trade_requests")
          .update({ meetup_draft: cards as unknown as Json, meetup_draft_saved_at: savedAt, meetup_draft_saved_by: staff.email ?? staff.userId })
          .eq("id", tradeId)
          .eq("status", "awaiting_shipment")
          .eq("handoff_method", "local")
          .select("id");
        if (error) throw new HttpError(500, "We couldn't save the prices. Try again.");
        if (!data || data.length === 0) throw new HttpError(409, "This trade changed. Refresh and try again.");
        await audit("save_meetup_draft", { cards: cards.length, priced: cards.filter((c) => c.unit_cents !== null).length });
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
        if (visible) customerEmail = await emailCustomer(admin, settings, tradeId, { kind: "message", messageId: data.id, body: text });
        break;
      }

      default:
        throw new HttpError(400, "Unknown action.");
    }

    return await sendFresh(res, admin, tradeId, owner, customerEmail);
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 500;
    const message = err instanceof HttpError ? err.message : "Unexpected server error.";
    if (!(err instanceof HttpError)) console.error("[admin/trade-center] error:", err);
    return sendJson(res, status, { ok: false, message });
  }
}

/** trade_settings is missing until the Trade Center database update has run. */
async function settingsForStaff(admin: Admin): Promise<TradeSettingsRow> {
  try {
    return await loadTradeSettings(admin);
  } catch (err) {
    if (err instanceof HttpError && err.status === 503) {
      throw new HttpError(503, "Trade settings aren't set up yet. Run the Trade Center database update first.");
    }
    throw err;
  }
}

function formatCents(cents: number): string {
  return (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
}

function readOverride(raw: unknown): DepositOverride | null {
  return raw === "auto" || raw === "required" || raw === "waived" ? raw : null;
}

/** An ISO time from the page (no later than a few minutes from now). */
function readTime(raw: unknown, message: string): string {
  if (typeof raw !== "string") throw new HttpError(400, message);
  const ms = Date.parse(raw);
  if (!Number.isFinite(ms) || ms > Date.now() + 5 * 60_000 || ms < Date.now() - 120 * 86_400_000) throw new HttpError(400, message);
  return new Date(ms).toISOString();
}

/**
 * Before a trade waiting for its deposit goes back to the customer, closes,
 * or has its deposit changed: an unused payment is retired, and one that
 * already went through is recorded first (the caller then finds the trade
 * reserved and refuses the change).
 */
async function retireOrRecordDeposit(bundle: TradeBundle): Promise<void> {
  if (bundle.trade.status !== "awaiting_deposit") return;
  const paid = await retireDepositIntent(bundle.trade);
  if (paid) {
    await recordDepositPayment(paid);
    throw new HttpError(409, "The customer's deposit just went through, so their cards are reserved. Refresh to see the trade.");
  }
}

async function staffView(admin: Admin, bundle: TradeBundle, settings: TradeSettingsRow) {
  const t = bundle.trade;
  const paths = bundle.disputes.flatMap((d) => disputeFilesOf(d.files).map((f) => f.path));
  const [standing, extensions, consents, availability, links, wantedTraits, stockedLines] = await Promise.all([
    customerStanding(admin, t.user_id, settings).catch((): CustomerStanding | null => null),
    admin.from("trade_extensions").select("*").eq("trade_request_id", t.id).order("created_at"),
    admin.from("trade_consents").select("*").eq("trade_request_id", t.id).order("created_at"),
    bundleAvailability(admin, bundle),
    paths.length > 0 ? admin.storage.from(DISPUTE_BUCKET).createSignedUrls(paths, FILE_LINK_SECONDS) : Promise.resolve({ data: [], error: null }),
    loadWantedTraits(admin, bundle).catch(() => new Map<string, WantedCardTraits>()),
    loadStockedLines(admin, bundle).catch(() => new Map<string, StockedLine[]>()),
  ]);
  const fileUrls = new Map<string, string>();
  for (const l of links.data ?? []) if (l.path && l.signedUrl) fileUrls.set(l.path, l.signedUrl);
  return staffTradeView(bundle, settings, {
    standing,
    extensions: extensions.data ?? [],
    consents: consents.data ?? [],
    availability,
    wantedTraits,
    stockedLines,
    fileUrls,
    autoTracked: trackingConnected(),
  });
}

async function sendFresh(
  res: VercelResponse,
  admin: Admin,
  tradeId: string,
  owner: boolean,
  customerEmail: CustomerEmailOutcome | null = null,
) {
  const [bundle, settings] = await Promise.all([loadTradeBundle(admin, tradeId), loadTradeSettings(admin)]);
  if (!bundle) throw new HttpError(404, "That trade isn't there.");
  return sendJson(res, 200, { ok: true, trade: await staffView(admin, bundle, settings), settings: settingsView(settings), owner, customerEmail });
}

/** sent (or already sent), failed, or skipped with why (customer emails off, no address on file…). */
type CustomerEmailOutcome = { status: "sent" | "failed" | "skipped"; reason?: string };

async function emailCustomer(
  admin: Admin,
  settings: TradeSettingsRow,
  tradeId: string,
  email: Parameters<typeof sendTradeCustomerEmail>[2],
): Promise<CustomerEmailOutcome> {
  const fresh = await loadTradeBundle(admin, tradeId);
  if (!fresh) return { status: "skipped", reason: "no-trade" };
  const result = await sendTradeCustomerEmail(fresh, settings, email);
  if (result.status === "skipped") return { status: "skipped", reason: result.reason };
  return { status: result.status === "failed" ? "failed" : "sent" };
}

/** A note from Geega Games on the trade, emailed to the customer. */
async function systemMessage(admin: Admin, settings: TradeSettingsRow, tradeId: string, text: string): Promise<CustomerEmailOutcome> {
  const { data, error } = await admin
    .from("trade_messages")
    .insert({ trade_request_id: tradeId, author_type: "system", body: text, visible_to_customer: true })
    .select("id")
    .single();
  if (error || !data) return { status: "failed" };
  return emailCustomer(admin, settings, tradeId, { kind: "message", messageId: data.id, body: text });
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
// Lists
// ---------------------------------------------------------------------------

const ABANDONED_FAULTS = ["canceled_while_reserved", "missed_deadline", "late_shipment"];

async function listTrades(admin: Admin, rawFilter: unknown, rawQuery: unknown, rawDeposit: unknown) {
  const filter = typeof rawFilter === "string" ? rawFilter : "open";
  const q = typeof rawQuery === "string" ? rawQuery.trim().slice(0, 80) : "";
  const depositFilter = typeof rawDeposit === "string" && (DEPOSIT_STATUSES as readonly string[]).includes(rawDeposit) ? rawDeposit : null;

  let query = admin.from("trade_requests").select("*").order("updated_at", { ascending: false }).limit(MAX_LISTED);
  if (filter === "open") {
    query = query.not("status", "in", "(completed,rejected,offer_expired,canceled,expired,canceled_after_shipment,declined_after_inspection,canceled_by_store)");
  } else if (filter === "waiting") {
    query = query.eq("needs_staff", true);
  } else if (filter === "deposits") {
    query = query.not("deposit_status", "in", "(not_required,canceled)");
  } else if (filter === "reserved") {
    query = query.in("status", [...RESERVED_STATUSES]);
  } else if (filter === "abandoned") {
    query = query.in("customer_fault", ABANDONED_FAULTS);
  } else if (filter === "finished") {
    query = query.in("status", ["approved_for_fulfillment", "completed"]);
  } else if (filter === "local") {
    query = query.eq("handoff_method", "local");
  } else if (isTradeStatus(filter)) {
    query = query.eq("status", filter);
  }
  if (depositFilter) query = query.eq("deposit_status", depositFilter);
  const number = q.match(/^(?:tr-?)?(\d{1,9})$/i);
  if (number) {
    query = query.eq("trade_number", Number(number[1]));
  } else if (q) {
    // Letters, digits and what's in a name or an email only: nothing that
    // means something to PostgREST's filter syntax.
    const safe = q.replace(/[^\p{L}\p{N}@.\-_' ]/gu, "").trim();
    if (safe) query = query.or(`customer_name.ilike.%${safe}%,customer_email.ilike.%${safe}%`);
  }
  const [{ data, error }, rows] = await Promise.all([
    query,
    admin.from("trade_requests").select("status, needs_staff, deposit_status, customer_fault, handoff_method").limit(10000),
  ]);
  if (error || rows.error) throw new HttpError(500, "We couldn't load trades. Try again.");
  const counts: Record<string, number> = { waiting: 0, open: 0, all: 0, deposits: 0, reserved: 0, abandoned: 0, local: 0, finished: 0 };
  for (const s of TRADE_STATUSES) counts[s] = 0;
  for (const row of rows.data ?? []) {
    counts.all += 1;
    counts[row.status] = (counts[row.status] ?? 0) + 1;
    if (isTradeStatus(row.status) && isOpenTrade(row.status)) counts.open += 1;
    if (row.needs_staff) counts.waiting += 1;
    if (row.deposit_status !== "not_required" && row.deposit_status !== "canceled") counts.deposits += 1;
    if ((RESERVED_STATUSES as readonly string[]).includes(row.status)) counts.reserved += 1;
    if (row.customer_fault && ABANDONED_FAULTS.includes(row.customer_fault)) counts.abandoned += 1;
    if (row.status === "approved_for_fulfillment" || row.status === "completed") counts.finished += 1;
    if (row.handoff_method === "local") counts.local += 1;
  }
  return { trades: (data ?? []).map(staffSummaryView), counts };
}

/** Our cards held for trades right now, with each trade's deadline. */
async function reservedLines(admin: Admin) {
  const { data: trades, error } = await admin
    .from("trade_requests")
    .select("id, trade_number, status, customer_name, customer_email, ship_by, inbound_accepted_at, deposit_status, handoff_method")
    .in("status", [...RESERVED_STATUSES])
    .order("ship_by", { ascending: true, nullsFirst: false })
    .limit(MAX_LISTED);
  if (error) throw new HttpError(500, "We couldn't load reservations. Try again.");
  const ids = (trades ?? []).map((t) => t.id);
  if (ids.length === 0) return [];
  const { data: items, error: itemsErr } = await admin
    .from("trade_request_items")
    .select("id, trade_request_id, inventory_item_id, card_name, set_code, collector_number, condition, finish, quantity, unit_price_cents, image_url")
    .in("trade_request_id", ids)
    .eq("status", "reserved");
  if (itemsErr) throw new HttpError(500, "We couldn't load reservations. Try again.");
  const byTrade = new Map((trades ?? []).map((t) => [t.id, t]));
  return (items ?? []).flatMap((i) => {
    const t = byTrade.get(i.trade_request_id);
    if (!t) return [];
    return [{
      itemId: i.id,
      tradeId: t.id,
      tradeNumber: t.trade_number,
      status: t.status,
      customerName: t.customer_name,
      customerEmail: t.customer_email,
      shipBy: t.ship_by,
      shippedAt: t.inbound_accepted_at,
      depositStatus: t.deposit_status,
      handoffMethod: handoffOf(t),
      inventoryItemId: i.inventory_item_id,
      cardName: i.card_name,
      setCode: i.set_code,
      collectorNumber: i.collector_number,
      condition: i.condition,
      finish: i.finish,
      quantity: i.quantity,
      unitPriceCents: i.unit_price_cents,
      imageUrl: i.image_url,
    }];
  });
}

/** Everyone who has traded, with their record and what it earns them. */
async function customerList(admin: Admin, settings: TradeSettingsRow) {
  const { data, error } = await admin.rpc("trade_customer_list", { p_limit: 300 });
  if (error) throw new HttpError(500, "We couldn't load customers. Try again.");
  const reliability = {
    shipDaysNew: settings.ship_days_new,
    shipDaysTier1: settings.ship_days_tier1,
    shipDaysTier2: settings.ship_days_tier2,
    loyaltyTier1Trades: settings.loyalty_tier1_trades,
    loyaltyTier2Trades: settings.loyalty_tier2_trades,
    abandonLimit: settings.abandon_limit,
    abandonPolicy: settings.abandon_policy === "block" ? ("block" as const) : ("deposit" as const),
  };
  return (data ?? []).map((row) => {
    const record = readCustomerRecord(row.stats);
    return {
      userId: row.customer_user_id,
      name: row.customer_name,
      email: row.customer_email,
      lastTradeAt: row.last_trade_at,
      record,
      privileges: privilegesFor(record, reliability),
    };
  });
}

/** Deposits at a glance: what's held, refunding, refunded, under review, kept, failed. */
async function depositOverview(admin: Admin) {
  const { data, error } = await admin
    .from("trade_requests")
    .select("*")
    .not("deposit_status", "in", "(not_required,canceled)")
    .order("updated_at", { ascending: false })
    .limit(MAX_LISTED);
  if (error) throw new HttpError(500, "We couldn't load deposits. Try again.");
  const totals = { heldCents: 0, refundPendingCents: 0, refundedCents: 0, reviewCents: 0, forfeitedCents: 0, failedCents: 0, feesCents: 0, awaitingPaymentCents: 0 };
  for (const t of data ?? []) {
    const amount = t.deposit_paid_cents ?? t.deposit_cents;
    if (t.deposit_status === "paid") totals.heldCents += amount;
    else if (t.deposit_status === "refund_pending") totals.refundPendingCents += amount;
    else if (t.deposit_status === "refunded") totals.refundedCents += amount;
    else if (t.deposit_status === "forfeiture_review") totals.reviewCents += amount;
    else if (t.deposit_status === "forfeited") totals.forfeitedCents += amount;
    else if (t.deposit_status === "refund_failed") totals.failedCents += amount;
    else if (t.deposit_status === "payment_pending") totals.awaitingPaymentCents += t.deposit_cents;
    totals.feesCents += t.deposit_fee_cents ?? 0;
  }
  return { totals, trades: (data ?? []).map(staffSummaryView) };
}

const ECONOMICS_PERIODS = new Set([30, 90, 365]);
/** Trades counted at most (a safety stop; the report says when it's reached). */
const ECONOMICS_MAX_TRADES = 20_000;
const ECONOMICS_LISTED = 100;
/** Rows per request: PostgREST returns at most 1,000 at a time. */
const PAGE = 1000;
/** Ids per `in` filter, to keep each request's URL short. */
const IN_CHUNK = 100;

type Page<T> = PromiseLike<{ data: T[] | null; error: { message: string } | null }>;

/** Every row a query returns, a page at a time (rows from..to of a stable order). */
async function allPages<T>(load: (from: number, to: number) => Page<T>, max = Number.POSITIVE_INFINITY): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; from < max; from += PAGE) {
    const { data, error } = await load(from, Math.min(from + PAGE, max) - 1);
    if (error) throw new HttpError(500, "We couldn't load the trade numbers. Try again.");
    const rows = data ?? [];
    out.push(...rows);
    if (rows.length < Math.min(PAGE, max - from)) break;
  }
  return out;
}

/** Rows whose key is one of `ids`: a chunk of ids at a time, every page of each. */
async function selectIn<T>(ids: string[], load: (chunk: string[], from: number, to: number) => Page<T>): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < ids.length; i += IN_CHUNK) {
    const chunk = ids.slice(i, i + IN_CHUNK);
    out.push(...(await allPages((from, to) => load(chunk, from, to))));
  }
  return out;
}

/**
 * What finished trades did to retail-priced inventory, with shipping (the
 * theoretical inventory-value difference, not profit): over the last `days`
 * days, or all time.
 */
async function economicsReport(admin: Admin, settings: TradeSettingsRow, rawDays: unknown) {
  const asked = typeof rawDays === "string" ? Number(rawDays) : Number.NaN;
  const days = ECONOMICS_PERIODS.has(asked) ? asked : null;
  const since = days !== null ? new Date(Date.now() - days * 86_400_000).toISOString() : null;
  const rows = await allPages((from, to) => {
    let query = admin
      .from("trade_requests")
      .select(
        "id, trade_number, status, customer_name, customer_email, final_value_cents, wanted_total_cents, shipping_cents, outbound_postage_cents, order_id, paid_at, credit_rate_percent, handoff_method",
      )
      .in("status", ["approved_for_fulfillment", "completed"]);
    if (since) query = query.gte("paid_at", since);
    return query.order("paid_at", { ascending: false }).order("id", { ascending: true }).range(from, to);
  }, ECONOMICS_MAX_TRADES);
  const orderIds = rows.map((t) => t.order_id).filter((id): id is string => Boolean(id));
  const [orders, cards] = await Promise.all([
    selectIn(orderIds, (chunk, from, to) =>
      admin.from("orders").select("id, postage_cost_cents").in("id", chunk).order("id", { ascending: true }).range(from, to),
    ),
    selectIn(
      rows.map((t) => t.id),
      (chunk, from, to) =>
        admin
          .from("trade_offer_cards")
          .select("id, trade_request_id, scryfall_id, card_name, finish, verified_condition, reported_condition, final_quantity, final_unit_cents")
          .in("trade_request_id", chunk)
          .gt("final_quantity", 0)
          .order("id", { ascending: true })
          .range(from, to),
    ),
  ]);
  const postage = new Map(orders.map((o) => [o.id, o.postage_cost_cents]));
  const perTrade: { trade: (typeof rows)[number]; economics: TradeEconomics }[] = [];
  for (const t of rows) {
    const economics = tradeEconomics(
      {
        finalValueCents: t.final_value_cents,
        wantedTotalCents: t.wanted_total_cents,
        shippingCents: t.shipping_cents,
        orderPostageCents: t.order_id ? (postage.get(t.order_id) ?? null) : null,
        outboundPostageCents: t.outbound_postage_cents,
        localPickup: t.handoff_method === "local",
      },
      settings.ship_cost_estimate_cents,
    );
    if (economics) perTrade.push({ trade: t, economics });
  }
  const counted = new Set(perTrade.map((r) => r.trade.id));
  const totals = economicsTotals(
    perTrade.map((r) => r.economics),
    acceptedCardCounts(
      cards
        .filter((c) => counted.has(c.trade_request_id))
        .map((c) => ({
          scryfallId: c.scryfall_id,
          cardName: c.card_name,
          finish: c.finish,
          condition: c.verified_condition ?? c.reported_condition,
          quantity: c.final_quantity ?? 0,
          unitCents: c.final_unit_cents ?? 0,
        })),
      settings.min_card_value_cents,
    ),
  );
  return {
    days,
    totals,
    /** The safety stop was reached: older trades aren't counted. */
    truncated: rows.length >= ECONOMICS_MAX_TRADES,
    trades: perTrade.slice(0, ECONOMICS_LISTED).map(({ trade: t, economics }) => ({
      id: t.id,
      tradeNumber: t.trade_number,
      status: t.status,
      customerName: t.customer_name,
      customerEmail: t.customer_email,
      paidAt: t.paid_at,
      creditRatePercent: t.credit_rate_percent,
      economics,
    })),
  };
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

/** One card staff took at a meetup, as trade_complete_local stores it. */
interface LocalCardInput {
  scryfall_id: string | null;
  card_name: string;
  set_code: string | null;
  set_name: string | null;
  collector_number: string | null;
  finish: string;
  image_url: string | null;
  condition: string;
  quantity: number;
  unit_cents: number;
  reference_price_cents: number | null;
  note: string | null;
}

/** The same, saved as a draft at the meetup: a card may not be priced yet. */
type DraftCardInput = Omit<LocalCardInput, "unit_cents"> & { unit_cents: number | null };

/** Finishes a card can have (public.card_finish). */
const CARD_FINISHES = new Set(["nonfoil", "foil", "etched", "glossy", "ripple", "surge", "rainbow", "galaxy", "textured", "mana", "gilded", "halo"]);

/**
 * The cards staff took at a meetup: each with its condition and what each copy
 * is worth (staff set every value). As a draft (`draft: true`), a card's
 * value may be left blank, to be priced later.
 */
function readLocalCards(raw: unknown, maxLines: number): LocalCardInput[];
function readLocalCards(raw: unknown, maxLines: number, options: { draft: true }): DraftCardInput[];
function readLocalCards(raw: unknown, maxLines: number, options: { draft?: boolean } = {}): DraftCardInput[] {
  if (!Array.isArray(raw)) throw new HttpError(400, "Their cards didn't come through. Try again.");
  if (raw.length > maxLines) throw new HttpError(400, `A trade can take up to ${maxLines} different cards.`);
  return raw.map((item, i) => {
    const o = (item ?? {}) as Record<string, unknown>;
    const name = cleanText(o.cardName, 200);
    if (!name) throw new HttpError(400, `Card ${i + 1} has no name.`);
    const quantity = wholeNumber(o.quantity, 1, TRADE_LIMITS.maxQuantity);
    if (quantity === null) throw new HttpError(400, `${name}: take 1 to ${TRADE_LIMITS.maxQuantity}.`);
    const blank = o.unitCents === null || o.unitCents === undefined;
    const unit = blank && options.draft ? null : wholeNumber(o.unitCents, 0, TRADE_LIMITS.maxEstimateCents);
    if (unit === null && !(blank && options.draft)) throw new HttpError(400, `${name}: enter what each copy is worth.`);
    const condition = typeof o.condition === "string" && (CARD_CONDITIONS as readonly string[]).includes(o.condition) ? o.condition : null;
    if (!condition) throw new HttpError(400, `${name}: choose its condition.`);
    const finish = typeof o.finish === "string" && CARD_FINISHES.has(o.finish) ? o.finish : null;
    if (!finish) throw new HttpError(400, `${name}: choose its finish.`);
    const scryfallId = typeof o.scryfallId === "string" && UUID_RE.test(o.scryfallId) ? o.scryfallId.toLowerCase() : null;
    const image = typeof o.imageUrl === "string" && /^https:\/\//.test(o.imageUrl) ? o.imageUrl.slice(0, 1000) : null;
    const reference =
      o.referencePriceCents === null || o.referencePriceCents === undefined ? null : wholeNumber(o.referencePriceCents, 0, 99_999_999);
    return {
      scryfall_id: scryfallId,
      card_name: name,
      set_code: cleanText(o.setCode, 12),
      set_name: cleanText(o.setName, 120),
      collector_number: cleanText(o.collectorNumber, 16),
      finish,
      image_url: image,
      condition,
      quantity,
      unit_cents: unit,
      reference_price_cents: reference,
      note: cleanText(o.note, 2000),
    };
  });
}

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
      verified_condition: CARD_CONDITIONS.includes(o.verifiedCondition as (typeof CARD_CONDITIONS)[number]) ? o.verifiedCondition : null,
      final_quantity: wholeNumber(o.finalQuantity, 0, TRADE_LIMITS.maxQuantity),
      final_unit_cents: wholeNumber(o.finalUnitCents, 0, TRADE_LIMITS.maxEstimateCents),
      flags,
      ...(o.inspectionNote !== undefined ? { inspection_note: cleanText(o.inspectionNote, 1000) } : {}),
      ...(o.inspectionInternalNote !== undefined ? { inspection_internal_note: cleanText(o.inspectionInternalNote, 2000) } : {}),
    };
  });
}

async function markReturned(admin: Admin, staff: StaffContext, bundle: TradeBundle, body: Record<string, unknown>): Promise<void> {
  const t = bundle.trade;
  if (t.return_status !== "pending") {
    throw new HttpError(409, t.return_status === "returned" ? "These cards were already marked returned." : "Nothing on this trade is waiting to go back to the customer.");
  }
  const carrier = body.carrier === undefined || body.carrier === null || body.carrier === "" ? null : body.carrier;
  if (carrier !== null && !isTradeCarrier(carrier)) throw new HttpError(400, "Choose the carrier.");
  const rawTracking = typeof body.trackingNumber === "string" ? body.trackingNumber.trim() : "";
  const tracking = rawTracking ? cleanTrackingNumber(rawTracking) : null;
  if (rawTracking && !tracking) throw new HttpError(400, "That tracking number doesn't look right.");
  const now = new Date().toISOString();
  const { data, error } = await admin
    .from("trade_requests")
    .update({ return_carrier: carrier, return_tracking: tracking, returned_at: now, return_status: "returned" })
    .eq("id", t.id)
    .eq("return_status", "pending")
    .select("id");
  if (error) throw new HttpError(500, "We couldn't mark the cards returned. Try again.");
  if (!data || data.length === 0) throw new HttpError(409, "These cards were already marked returned.");

  const finished = t.status === "approved_for_fulfillment" || t.status === "completed";
  if (finished) {
    // From a finished trade: copies that arrived but we didn't take. A card
    // we took none of is now returned; one we took some of stays accepted.
    const noneTaken = bundle.offers.filter((c) => copiesToReturn(c) > 0 && (c.final_quantity ?? 0) === 0).map((c) => c.id);
    if (noneTaken.length > 0) {
      const marked = await admin.from("trade_offer_cards").update({ disposition: "returned" }).in("id", noneTaken).eq("disposition", "rejected");
      if (marked.error) console.error("[admin/trade-center] dispositions not updated", t.id, marked.error.message);
    }
  } else {
    const back = await admin.from("trade_offer_cards").update({ disposition: "returned" }).eq("trade_request_id", t.id).eq("disposition", "pending");
    if (back.error) console.error("[admin/trade-center] dispositions not updated", t.id, back.error.message);
  }
  const copies = finished
    ? bundle.offers.reduce((sum, c) => sum + copiesToReturn(c), 0)
    : bundle.offers.reduce((sum, c) => sum + (c.received_quantity ?? c.quantity), 0);
  await logEvent(admin, t.id, staff, "returned", t.status, t.status, { carrier, tracking, copies });
}

async function importCard(admin: Admin, staff: StaffContext, body: Record<string, unknown>): Promise<string> {
  const cardId = typeof body.offerCardId === "string" && UUID_RE.test(body.offerCardId) ? body.offerCardId.toLowerCase() : null;
  if (!cardId) throw new HttpError(400, "Which card?");
  const price = wholeNumber(body.priceCents, 1, TRADE_LIMITS.maxEstimateCents);
  if (price === null) throw new HttpError(400, "Set a selling price.");
  // The condition to stock it as (null: as recorded on the trade), and whether
  // a line we already stock takes this price (false: it keeps its own).
  let condition: string | null = null;
  if (body.condition !== undefined && body.condition !== null) {
    if (typeof body.condition !== "string" || !(CARD_CONDITIONS as readonly string[]).includes(body.condition)) {
      throw new HttpError(400, "Choose a condition: NM, LP, MP, HP or DMG.");
    }
    condition = body.condition;
  }
  const updateLinePrice = body.updateLinePrice === true;
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
    p_condition: condition,
    p_update_line_price: updateLinePrice,
  });
  if (error) throw tradeDbError(error, "We couldn't add the card to inventory. Try again.");
  await logAdminAction(admin, staff, {
    action: "trade.import_card",
    resourceType: "trade_request",
    resourceId: card.trade_request_id,
    after: { offerCardId: cardId, inventoryItemId: data, priceCents: price, condition, updateLinePrice },
  });
  return card.trade_request_id;
}

/** Per-customer rules (owner): a deposit on every trade, or no new trades for now. */
async function setCustomerFlags(admin: Admin, staff: StaffContext, body: Record<string, unknown>): Promise<string> {
  const userId = typeof body.userId === "string" && UUID_RE.test(body.userId) ? body.userId.toLowerCase() : null;
  if (!userId) throw new HttpError(400, "Which customer?");
  const { count, error: countErr } = await admin.from("trade_requests").select("id", { count: "exact", head: true }).eq("user_id", userId);
  if (countErr) throw new HttpError(500, "We couldn't check that customer. Try again.");
  if (!count) throw new HttpError(404, "That customer hasn't traded with us.");
  const row = {
    user_id: userId,
    deposit_required: body.depositRequired === true,
    blocked: body.blocked === true,
    note: cleanText(body.note, 1000),
    updated_by: staff.userId,
    updated_at: new Date().toISOString(),
  };
  const { error } = await admin.from("trade_customer_flags").upsert(row, { onConflict: "user_id" });
  if (error) throw new HttpError(500, "We couldn't save that. Try again.");
  await logAdminAction(admin, staff, {
    action: "trade.customer_flags",
    resourceType: "customer",
    resourceId: userId,
    after: { depositRequired: row.deposit_required, blocked: row.blocked, note: row.note },
  });
  return userId;
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

/** Extra excluded days: real dates ("YYYY-MM-DD"), sorted, without repeats. */
function readExcludedDates(raw: unknown): string[] {
  const list = textList(raw, TRADE_SETTING_RANGES.maxExcludedDates[1], 10, "Excluded days");
  for (const d of list) {
    // An impossible date ("2026-13-01") parses to NaN: refused, not thrown.
    const noon = /^\d{4}-\d{2}-\d{2}$/.test(d) ? Date.parse(`${d}T12:00:00Z`) : Number.NaN;
    const ok = Number.isFinite(noon) && new Date(noon).toISOString().slice(0, 10) === d;
    if (!ok) throw new HttpError(400, `Excluded days: ${d} isn't a date (use YYYY-MM-DD).`);
  }
  return [...excludedDateSet(list)].sort();
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
  const minTrade = num(o, "minTradeValueCents", r.minTradeValueCents, "Minimum trade");
  if (maxTrade !== null && maxTrade < minTrade) throw new HttpError(400, "The largest trade can't be smaller than the minimum.");
  // Shipping our cards: never negative, free shipping no dearer than the
  // standard rate, and a threshold a trade can actually reach.
  const shipFee = num(o, "shipFeeCents", r.shipFeeCents, "Shipping under the free-shipping threshold");
  const freeShipFee = num(o, "freeShipFeeCents", r.shipFeeCents, "Shipping from the threshold up");
  const freeShipThreshold = num(o, "freeShipThresholdCents", r.freeShipThresholdCents, "Free shipping from");
  if (freeShipFee > shipFee) throw new HttpError(400, "Shipping from the free-shipping threshold up can't cost more than below it.");
  if (freeShipThreshold < minTrade) throw new HttpError(400, "Free shipping has to start at or above the minimum trade.");

  const band1Max = num(o, "depositBand1MaxCents", r.depositBandMaxCents, "First deposit band");
  const band2Max = num(o, "depositBand2MaxCents", r.depositBandMaxCents, "Second deposit band");
  const band3Max = num(o, "depositBand3MaxCents", r.depositBandMaxCents, "Third deposit band");
  if (!(band1Max < band2Max && band2Max < band3Max)) throw new HttpError(400, "Deposit bands have to go up: each one starts where the last ends.");
  const tier1 = num(o, "loyaltyTier1Trades", r.loyaltyTrades, "Trades for more time");
  const tier2 = num(o, "loyaltyTier2Trades", r.loyaltyTrades, "Trades for the most time");
  if (tier1 >= tier2) throw new HttpError(400, "The second loyalty step needs more completed trades than the first.");

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
  const terms = typeof o.depositTerms === "string" ? o.depositTerms.replace(/\r\n/g, "\n").trim().slice(0, 6000) : "";
  if (!packing) throw new HttpError(400, "Add packing instructions for customers.");
  // Local pickup: what's left out stays as saved (a page from before local pickup saves the rest as before).
  const localEnabled = typeof o.localPickupEnabled === "boolean" ? o.localPickupEnabled : before.local_pickup_enabled;
  const localArea = o.localPickupArea === undefined ? before.local_pickup_area : cleanText(o.localPickupArea, 120);
  const localDetails = o.localPickupDetails === undefined ? before.local_pickup_details : cleanText(o.localPickupDetails, 2000);
  if (!localArea) throw new HttpError(400, "Say where local pickup is offered (for example, the St. Louis area).");
  if (localEnabled && !localDetails) throw new HttpError(400, "Add how local pickup meetups work, for customers.");
  // The meeting spot: optional (blank clears it); a page that leaves it out keeps it as saved.
  const spotName = o.localMeetSpotName === undefined ? before.local_meet_spot_name : cleanText(o.localMeetSpotName, 120);
  const spotAddress = o.localMeetSpotAddress === undefined ? before.local_meet_spot_address : cleanText(o.localMeetSpotAddress, 200);
  // Local pickup's own terms (a page that leaves them out keeps them as saved).
  const localNum = (key: string, column: keyof TradeSettingsRow, range: Range, label: string): number =>
    o[key] === undefined ? (before[column] as number) : num(o, key, range, label);
  const localMinTrade = localNum("localMinTradeValueCents", "local_min_trade_value_cents", r.minTradeValueCents, "Local pickup minimum trade");
  if (maxTrade !== null && maxTrade < localMinTrade) {
    throw new HttpError(400, "The largest trade can't be smaller than the local pickup minimum.");
  }
  const localTerms = {
    local_credit_rate_percent: localNum("localCreditRatePercent", "local_credit_rate_percent", r.creditRatePercent, "Local pickup trade credit rate"),
    local_min_card_value_cents: localNum("localMinCardValueCents", "local_min_card_value_cents", r.minCardValueCents, "Local pickup minimum card value"),
    local_min_trade_value_cents: localMinTrade,
    local_cash_payout_enabled: typeof o.localCashPayoutEnabled === "boolean" ? o.localCashPayoutEnabled : before.local_cash_payout_enabled,
    local_cash_rate_percent: localNum("localCashRatePercent", "local_cash_rate_percent", r.cashRatePercent, "Local pickup cash rate"),
  };
  if (!returns) throw new HttpError(400, "Add the return policy customers see.");
  if (!terms) throw new HttpError(400, "Add the deposit and cancellation terms customers agree to.");

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
    draft_days: num(o, "draftDays", r.draftDays, "Days to send a draft"),
    revision_hours: num(o, "revisionHours", r.revisionHours, "Hours to send changes"),
    confirmation_hours: num(o, "confirmationHours", r.confirmationHours, "Hours to confirm"),
    ship_days_new: num(o, "shipDaysNew", r.shipDays, "Days to ship (new customers)"),
    ship_days_tier1: num(o, "shipDaysTier1", r.shipDays, "Days to ship (returning)"),
    ship_days_tier2: num(o, "shipDaysTier2", r.shipDays, "Days to ship (trusted)"),
    loyalty_tier1_trades: tier1,
    loyalty_tier2_trades: tier2,
    scan_grace_hours: num(o, "scanGraceHours", r.scanGraceHours, "Grace for a carrier scan"),
    excluded_dates: readExcludedDates(o.excludedDates),
    payment_due_days: num(o, "paymentDueDays", r.paymentDueDays, "Days to pay"),
    max_transit_days: num(o, "maxTransitDays", r.maxTransitDays, "In transit alert"),
    stall_alert_days: num(o, "stallAlertDays", r.stallAlertDays, "No carrier update alert"),
    confirm_reminder_hours: num(o, "confirmReminderHours", r.reminderHours, "Confirmation reminder"),
    ship_reminder_hours: num(o, "shipReminderHours", r.reminderHours, "Shipping reminder"),
    dispute_window_days: num(o, "disputeWindowDays", r.disputeWindowDays, "Days to send proof after an expiry"),
    deposits_enabled: o.depositsEnabled === true,
    deposit_threshold_cents: num(o, "depositThresholdCents", r.depositThresholdCents, "Deposit threshold"),
    deposit_band1_max_cents: band1Max,
    deposit_band2_max_cents: band2Max,
    deposit_band3_max_cents: band3Max,
    deposit_band1_cents: num(o, "depositBand1Cents", r.depositCents, "Deposit (first band)"),
    deposit_band2_cents: num(o, "depositBand2Cents", r.depositCents, "Deposit (second band)"),
    deposit_band3_cents: num(o, "depositBand3Cents", r.depositCents, "Deposit (third band)"),
    deposit_band4_cents: num(o, "depositBand4Cents", r.depositCents, "Deposit (top band)"),
    allow_forfeiture: o.allowForfeiture === true,
    deposit_terms: terms,
    // Customers agree to a version: a change to the text is a new one.
    deposit_terms_version: terms === before.deposit_terms ? before.deposit_terms_version : before.deposit_terms_version + 1,
    abandon_limit: num(o, "abandonLimit", r.abandonLimit, "Abandoned reservations"),
    abandon_window_days: num(o, "abandonWindowDays", r.abandonWindowDays, "Abandonment window"),
    abandon_policy: o.abandonPolicy === "block" ? "block" : "deposit",
    max_active_trades: num(o, "maxActiveTrades", r.maxActiveTrades, "Open trades per customer"),
    max_wanted_lines: num(o, "maxWantedLines", r.maxWantedLines, "Our cards per trade"),
    max_offered_lines: num(o, "maxOfferedLines", r.maxOfferedLines, "Their cards per trade"),
    min_trade_value_cents: minTrade,
    max_trade_value_cents: maxTrade,
    processing_fee_cents: num(o, "processingFeeCents", r.processingFeeCents, "Processing fee"),
    cash_payout_enabled: o.cashPayoutEnabled === true,
    cash_rate_percent: num(o, "cashRatePercent", r.cashRatePercent, "Cash rate"),
    overstock_threshold: num(o, "overstockThreshold", r.overstockThreshold, "Overstock limit"),
    excluded_set_codes: [...new Set(textList(o.excludedSetCodes, 200, 12, "Excluded sets").map((c) => c.toUpperCase()))],
    excluded_card_names: textList(o.excludedCardNames, 500, 200, "Excluded cards"),
    notify_customer: o.notifyCustomer !== false,
    notify_staff: o.notifyStaff !== false,
    shipping_paid_by: o.shippingPaidBy === "store" ? "store" : "customer",
    ship_fee_cents: shipFee,
    free_ship_threshold_cents: freeShipThreshold,
    free_ship_fee_cents: freeShipFee,
    ship_cost_estimate_cents: num(o, "shipCostEstimateCents", r.shipCostEstimateCents, "What shipping costs us"),
    ...address,
    packing_instructions: packing,
    return_policy: returns,
    local_pickup_enabled: localEnabled,
    local_pickup_area: localArea,
    local_meet_days:
      o.localMeetDays === undefined ? before.local_meet_days : num(o, "localMeetDays", r.localMeetDays, "Days to hold our cards for a meetup"),
    local_pickup_details: localDetails ?? "",
    ...localTerms,
    local_meet_spot_name: spotName ?? null,
    local_meet_spot_address: spotAddress ?? null,
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
