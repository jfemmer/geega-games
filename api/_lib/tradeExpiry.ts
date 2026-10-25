import type { Json } from "../../src/types/database.js";
import { getSupabaseAdmin } from "./supabaseAdmin.js";
import { getStripe } from "./stripe.js";
import { loadTradeBundle, loadTradeSettings, type Admin, type TradeRow, type TradeSettingsRow } from "./tradeCenter.js";
import { notifyTradeStaff, sendTradeCustomerEmail, type ShortLine, type TradeCustomerEmail } from "./tradeCenterEmails.js";
import { processDepositRefund, recordDepositPayment, retireDepositIntent, stripeConfigured } from "./tradeDeposits.js";
import { checkTradeTracking, followUpScan, trackingConnected } from "./tradeTracking.js";

// The Trade Center's part of the every-five-minutes worker
// (api/checkout/expire-holds.ts). In order:
//   1. Deposits: a payment the webhook never reported is recorded (it
//      reserves the cards, or is refunded); a deposit payment left unpaid
//      past the confirmation deadline is retired and the approval closes;
//      refunds still in progress are created or checked.
//   2. Tracking: the carrier's scans for packages waiting for their first
//      scan (every 30 minutes) and packages in transit (every 3 hours). A
//      scan by the deadline verifies the shipment and refunds the deposit.
//   3. Approved trades whose cards sold before the customer confirmed go
//      back to the customer (nothing was charged).
//   4. Past the shipping deadline with no scan yet: the customer is asked
//      for proof of shipping; a number nothing can check automatically goes
//      to staff to verify by hand.
//   5. Deadlines that ran out (trade_expire_due): drafts, revisions and
//      approvals close; reservations that weren't shipped expire, their
//      cards go back on sale, and a paid deposit goes to staff review
//      (never kept automatically).
//   6. Reminders before each deadline, staff alerts (in transit too long,
//      no carrier update, a payment overdue), and the "trade complete" email.
// Every deadline is the one stored on the trade (worked out once, in
// qualifying time). Each reminder or alert is noted on the trade
// (trade_events), so a later run skips it; every email also has its own
// idempotency key. Safe to run early or often; never throws.

const BATCH = 50;
const TRACK_BATCH = 25;
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
/** A deposit payment the customer may still be finishing is left alone this long. */
const PAYMENT_SETTLE_MS = 2 * MIN;
const WAITING_SCAN_EVERY_MS = 30 * MIN;
const IN_TRANSIT_EVERY_MS = 3 * HOUR;
const LIST_REMINDER_HOURS = 24;
const PAYMENT_REMINDER_HOURS = 24;

export interface TradeWorkerCounts {
  tradesExpired: number;
  tradeReminders: number;
  tradeAlerts: number;
  tradeScansChecked: number;
  tradeDepositsReconciled: number;
}

export async function runTradeWorker(now = Date.now()): Promise<TradeWorkerCounts> {
  const counts: TradeWorkerCounts = { tradesExpired: 0, tradeReminders: 0, tradeAlerts: 0, tradeScansChecked: 0, tradeDepositsReconciled: 0 };
  const admin = getSupabaseAdmin();
  let settings: TradeSettingsRow;
  try {
    settings = await loadTradeSettings(admin);
  } catch {
    return counts; // the Trade Center isn't set up in this database
  }
  const step = async (name: string, fn: () => Promise<void>) => {
    try {
      await fn();
    } catch (err) {
      console.error(`[tradeExpiry] ${name} failed`, err);
    }
  };
  await step("deposits", async () => {
    counts.tradeDepositsReconciled = await reconcileDeposits(admin, settings, now);
  });
  await step("tracking", async () => {
    counts.tradeScansChecked = await checkScans(admin, settings, now);
  });
  await step("availability", async () => {
    counts.tradeAlerts += await watchAvailability(admin, settings);
  });
  await step("missing scans", async () => {
    const sent = await missingScans(admin, settings, now);
    counts.tradeReminders += sent.reminders;
    counts.tradeAlerts += sent.alerts;
  });
  await step("expiry", async () => {
    counts.tradesExpired = await expireDue(admin, settings);
  });
  await step("reminders", async () => {
    const sent = await remindAndAlert(admin, settings, now);
    counts.tradeReminders += sent.reminders;
    counts.tradeAlerts += sent.alerts;
  });
  return counts;
}

// ---------------------------------------------------------------------------
// Notes on the trade, so each reminder or alert goes once
// ---------------------------------------------------------------------------

async function doneKeys(admin: Admin, tradeIds: string[]): Promise<Set<string>> {
  if (tradeIds.length === 0) return new Set();
  const { data, error } = await admin
    .from("trade_events")
    .select("trade_request_id, detail")
    .in("trade_request_id", [...new Set(tradeIds)])
    .in("event", ["reminder_sent", "staff_alerted"]);
  if (error) throw new Error(error.message);
  return new Set(
    (data ?? []).map((e) => {
      const d = (e.detail ?? {}) as Record<string, unknown>;
      return `${e.trade_request_id}|${String(d.kind)}|${String(d.deadline)}`;
    }),
  );
}

async function noteDone(admin: Admin, trade: TradeRow, staffAlert: boolean, kind: string, deadline: string): Promise<void> {
  const { error } = await admin.from("trade_events").insert({
    trade_request_id: trade.id,
    actor_type: "system",
    event: staffAlert ? "staff_alerted" : "reminder_sent",
    from_status: trade.status,
    to_status: trade.status,
    detail: { kind, deadline } as Json,
  });
  if (error) console.error("[tradeExpiry] couldn't note it", trade.id, kind, error.message);
}

// ---------------------------------------------------------------------------
// 1. Deposits
// ---------------------------------------------------------------------------

async function reconcileDeposits(admin: Admin, settings: TradeSettingsRow, now: number): Promise<number> {
  if (!stripeConfigured()) return 0;
  let n = 0;
  const [paying, refunding] = await Promise.all([
    admin
      .from("trade_requests")
      .select("*")
      .eq("status", "awaiting_deposit")
      .lt("updated_at", new Date(now - PAYMENT_SETTLE_MS).toISOString())
      .limit(BATCH),
    admin.from("trade_requests").select("id").eq("deposit_status", "refund_pending").order("updated_at").limit(BATCH),
  ]);
  if (paying.error) throw new Error(paying.error.message);
  if (refunding.error) throw new Error(refunding.error.message);

  for (const t of paying.data ?? []) {
    if (!t.deposit_payment_intent) continue;
    try {
      const intent = await getStripe().paymentIntents.retrieve(t.deposit_payment_intent);
      if (intent.status === "succeeded") {
        // The webhook didn't get here first: record it now.
        await recordDepositPayment(intent, now);
        n += 1;
        continue;
      }
      if (intent.status === "processing" || intent.status === "requires_capture") continue;
      if (t.confirm_by && Date.parse(t.confirm_by) < now) {
        const paid = await retireDepositIntent(t);
        if (paid) {
          await recordDepositPayment(paid, now);
          n += 1;
          continue;
        }
        const { data, error } = await admin.rpc("trade_close", {
          p_trade_id: t.id,
          p_status: "offer_expired",
          p_from_statuses: ["awaiting_deposit"],
          p_reason: "The deposit wasn't paid by the confirmation deadline.",
          p_fault: null,
          p_actor_type: "system",
          p_actor_id: null,
          p_actor_label: "expiry",
          p_stage: "deposit",
        });
        if (error) {
          console.error("[tradeExpiry] couldn't close an unpaid deposit", t.id, error.message);
          continue;
        }
        if (Array.isArray(data) && data[0]?.closed) {
          const bundle = await loadTradeBundle(admin, t.id);
          if (bundle) await sendTradeCustomerEmail(bundle, settings, { kind: "offer_expired", stage: "deposit" });
          n += 1;
        }
      }
    } catch (err) {
      console.error("[tradeExpiry] deposit check failed", t.id, err);
    }
  }

  for (const r of refunding.data ?? []) {
    const outcome = await processDepositRefund(admin, r.id, { notifyStarted: false }).catch((err: unknown) => {
      console.error("[tradeExpiry] refund check failed", r.id, err);
      return "pending" as const;
    });
    if (outcome !== "pending" && outcome !== "skipped") n += 1;
  }
  return n;
}

// ---------------------------------------------------------------------------
// 2. Tracking
// ---------------------------------------------------------------------------

async function checkScans(admin: Admin, settings: TradeSettingsRow, now: number): Promise<number> {
  if (!trackingConnected()) return 0;
  const iso = (ms: number) => new Date(ms).toISOString();
  const [waiting, moving] = await Promise.all([
    admin
      .from("trade_requests")
      .select("*")
      .eq("status", "tracking_submitted")
      .neq("inbound_carrier", "Other")
      .or(`inbound_tracking_checked_at.is.null,inbound_tracking_checked_at.lt.${iso(now - WAITING_SCAN_EVERY_MS)}`)
      .order("ship_by")
      .limit(TRACK_BATCH),
    admin
      .from("trade_requests")
      .select("*")
      .eq("status", "in_transit")
      .neq("inbound_carrier", "Other")
      .not("inbound_tracking", "is", null)
      .or(`inbound_tracking_checked_at.is.null,inbound_tracking_checked_at.lt.${iso(now - IN_TRANSIT_EVERY_MS)}`)
      .order("inbound_tracking_checked_at", { ascending: true, nullsFirst: true })
      .limit(TRACK_BATCH),
  ]);
  if (waiting.error) throw new Error(waiting.error.message);
  if (moving.error) throw new Error(moving.error.message);

  let checked = 0;
  for (const t of [...(waiting.data ?? []), ...(moving.data ?? [])]) {
    const outcome = await checkTradeTracking(admin, t);
    if (outcome === "skipped" || outcome === "error") continue;
    checked += 1;
    await followUpScan(admin, settings, t.id, outcome);
  }
  return checked;
}

// ---------------------------------------------------------------------------
// 3. Cards that sold before the customer confirmed
// ---------------------------------------------------------------------------

async function watchAvailability(admin: Admin, settings: TradeSettingsRow): Promise<number> {
  const { data, error } = await admin
    .from("trade_requests")
    .select("*")
    .in("status", ["awaiting_confirmation", "awaiting_deposit"])
    .order("confirm_by")
    .limit(100);
  if (error) throw new Error(error.message);
  let n = 0;
  for (const t of data ?? []) {
    const { data: short, error: shortErr } = await admin.rpc("trade_short_lines", { p_trade_id: t.id });
    if (shortErr || !Array.isArray(short) || short.length === 0) continue;
    if (t.status === "awaiting_deposit") {
      // Retire the open payment first; one that already went through is
      // recorded instead (it reserves the cards, or is refunded).
      try {
        const paid = await retireDepositIntent(t);
        if (paid) {
          await recordDepositPayment(paid);
          continue;
        }
      } catch {
        continue; // a payment is going through: next run
      }
    }
    const { data: marked, error: markErr } = await admin.rpc("trade_mark_unavailable", { p_trade_id: t.id });
    if (markErr || !Array.isArray(marked) || marked.length === 0) continue;
    const bundle = await loadTradeBundle(admin, t.id);
    if (!bundle) continue;
    await sendTradeCustomerEmail(bundle, settings, { kind: "cards_unavailable", short: marked as unknown as ShortLine[], refund: false });
    await notifyTradeStaff(bundle, settings, { kind: "cards_unavailable" });
    n += 1;
  }
  return n;
}

// ---------------------------------------------------------------------------
// 4. Past the shipping deadline with no scan yet
// ---------------------------------------------------------------------------

async function missingScans(admin: Admin, settings: TradeSettingsRow, now: number): Promise<{ reminders: number; alerts: number }> {
  const { data, error } = await admin
    .from("trade_requests")
    .select("*")
    .eq("status", "tracking_submitted")
    .is("inbound_accepted_at", null)
    .lt("ship_by", new Date(now).toISOString())
    .limit(BATCH);
  if (error) throw new Error(error.message);
  const trades = data ?? [];
  if (trades.length === 0) return { reminders: 0, alerts: 0 };
  const done = await doneKeys(admin, trades.map((t) => t.id));
  let reminders = 0;
  let alerts = 0;
  for (const t of trades) {
    const deadline = t.ship_by ?? "";
    const automatic = trackingConnected() && t.inbound_carrier !== "Other";
    if (!done.has(`${t.id}|no_scan_yet|${deadline}`)) {
      const bundle = await loadTradeBundle(admin, t.id);
      if (bundle) {
        const result = await sendTradeCustomerEmail(bundle, settings, { kind: "no_scan_yet" });
        if (result.status !== "failed") {
          await noteDone(admin, t, false, "no_scan_yet", deadline);
          reminders += 1;
        }
      }
    }
    if (!automatic && t.review_flag === null) {
      // Nothing can check this number: staff verify it by hand. Until they
      // do, the reservation doesn't expire.
      const { data: flagged } = await admin
        .from("trade_requests")
        .update({ review_flag: "tracking_check", review_flag_at: new Date(now).toISOString() })
        .eq("id", t.id)
        .eq("status", "tracking_submitted")
        .is("review_flag", null)
        .select("id");
      if (flagged && flagged.length > 0) {
        const bundle = await loadTradeBundle(admin, t.id);
        if (bundle) await notifyTradeStaff(bundle, settings, { kind: "tracking_check" });
        alerts += 1;
      }
    }
  }
  return { reminders, alerts };
}

// ---------------------------------------------------------------------------
// 5. Deadlines that ran out
// ---------------------------------------------------------------------------

async function expireDue(admin: Admin, settings: TradeSettingsRow): Promise<number> {
  const { data, error } = await admin.rpc("trade_expire_due", {
    p_limit: BATCH,
    p_scan_grace_hours: settings.scan_grace_hours,
    p_auto_tracking: trackingConnected(),
  });
  if (error) {
    console.error("[tradeExpiry] trade_expire_due failed", error.message);
    return 0;
  }
  const expired = data ?? [];
  for (const row of expired) {
    const bundle = await loadTradeBundle(admin, row.expired_trade_id);
    if (!bundle) continue;
    if (row.expired_stage === "shipping" || row.expired_stage === "scan") {
      await sendTradeCustomerEmail(bundle, settings, { kind: "expired" });
      if (row.expired_deposit_status === "forfeiture_review") {
        await notifyTradeStaff(bundle, settings, { kind: "forfeiture_review", why: "expired" });
      }
    } else {
      await sendTradeCustomerEmail(bundle, settings, { kind: "offer_expired", stage: row.expired_stage });
    }
  }
  return expired.length;
}

// ---------------------------------------------------------------------------
// 6. Reminders and staff alerts
// ---------------------------------------------------------------------------

type Reminder = Extract<TradeCustomerEmail, { kind: "reminder" }>["reminder"];
type Alert = "transit_overdue" | "stalled" | "payment_overdue" | "completed";

interface Due {
  trade: TradeRow;
  kind: Reminder | Alert;
  deadline: string;
}

async function remindAndAlert(admin: Admin, settings: TradeSettingsRow, now: number): Promise<{ reminders: number; alerts: number }> {
  const iso = (ms: number) => new Date(ms).toISOString();
  const confirmHours = settings.confirm_reminder_hours;
  const shipHours = settings.ship_reminder_hours;
  const none = Promise.resolve({ data: [] as TradeRow[], error: null });
  const [lists, confirming, shipping, paying, transit, stalled, completed] = await Promise.all([
    admin
      .from("trade_requests")
      .select("*")
      .in("status", ["awaiting_trade_list", "revision_requested"])
      .gt("list_due_at", iso(now))
      .lte("list_due_at", iso(now + LIST_REMINDER_HOURS * HOUR))
      .limit(BATCH),
    confirmHours > 0
      ? admin
          .from("trade_requests")
          .select("*")
          .in("status", ["awaiting_confirmation", "awaiting_deposit"])
          .gt("confirm_by", iso(now))
          .lte("confirm_by", iso(now + confirmHours * HOUR))
          .limit(BATCH)
      : none,
    shipHours > 0
      ? admin
          .from("trade_requests")
          .select("*")
          .eq("status", "awaiting_shipment")
          .gt("ship_by", iso(now))
          .lte("ship_by", iso(now + shipHours * HOUR))
          .limit(BATCH)
      : none,
    admin
      .from("trade_requests")
      .select("*")
      .eq("status", "awaiting_payment")
      .lte("payment_due_at", iso(now + PAYMENT_REMINDER_HOURS * HOUR))
      .limit(BATCH),
    admin
      .from("trade_requests")
      .select("*")
      .eq("status", "in_transit")
      .lte("inbound_accepted_at", iso(now - settings.max_transit_days * DAY))
      .limit(BATCH),
    admin
      .from("trade_requests")
      .select("*")
      .eq("status", "in_transit")
      .lte("inbound_last_event_at", iso(now - settings.stall_alert_days * DAY))
      .limit(BATCH),
    admin
      .from("trade_requests")
      .select("*")
      .eq("status", "completed")
      .gte("completed_at", iso(now - 7 * DAY))
      .limit(BATCH),
  ]);
  for (const r of [lists, confirming, shipping, paying, transit, stalled, completed]) {
    if (r.error) throw new Error(r.error.message);
  }

  const due: Due[] = [
    ...(lists.data ?? []).map((t) => ({
      trade: t,
      kind: (t.status === "revision_requested" ? "revision_due" : "list_due") as Reminder,
      deadline: t.list_due_at as string,
    })),
    ...(confirming.data ?? []).map((t) => ({ trade: t, kind: "confirm_by" as const, deadline: t.confirm_by as string })),
    ...(shipping.data ?? []).map((t) => ({ trade: t, kind: "ship_by" as const, deadline: t.ship_by as string })),
    ...(paying.data ?? []).flatMap((t) =>
      t.payment_due_at
        ? [
            Date.parse(t.payment_due_at) > now
              ? { trade: t, kind: "payment_due" as const, deadline: t.payment_due_at }
              : { trade: t, kind: "payment_overdue" as const, deadline: t.payment_due_at },
          ]
        : [],
    ),
    ...(transit.data ?? []).map((t) => ({ trade: t, kind: "transit_overdue" as const, deadline: t.inbound_tracking ?? "" })),
    ...(stalled.data ?? []).map((t) => ({ trade: t, kind: "stalled" as const, deadline: t.inbound_last_event_at ?? "" })),
    ...(completed.data ?? []).map((t) => ({ trade: t, kind: "completed" as const, deadline: t.order_id ?? "" })),
  ];
  if (due.length === 0) return { reminders: 0, alerts: 0 };
  const done = await doneKeys(admin, due.map((d) => d.trade.id));

  let reminders = 0;
  let alerts = 0;
  for (const item of due) {
    const key = `${item.trade.id}|${item.kind}|${item.deadline}`;
    if (done.has(key)) continue;
    const bundle = await loadTradeBundle(admin, item.trade.id);
    if (!bundle) continue;
    const staffAlert = item.kind === "transit_overdue" || item.kind === "stalled" || item.kind === "payment_overdue";
    if (staffAlert) {
      await notifyTradeStaff(bundle, settings, { kind: item.kind as "transit_overdue" | "stalled" | "payment_overdue" });
      alerts += 1;
    } else {
      const email: TradeCustomerEmail =
        item.kind === "completed" ? { kind: "completed" } : { kind: "reminder", reminder: item.kind as Reminder };
      const result = await sendTradeCustomerEmail(bundle, settings, email);
      if (result.status === "failed") continue; // try again next run
      reminders += 1;
    }
    await noteDone(admin, item.trade, staffAlert, item.kind, item.deadline);
    done.add(key);
  }
  return { reminders, alerts };
}
