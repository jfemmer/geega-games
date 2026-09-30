import { getSupabaseAdmin } from "./supabaseAdmin.js";
import { sendOrderStatusEmail } from "./orderStatusEmail.js";
import { deliveredAtOf, isEasyPostConnected, loadTracker } from "./easypost.js";
import { PWE_ARRIVAL_MAIL_DAYS, pweArrivalDueAt } from "./mailDays.js";

// Hourly shipping follow-up (api/shipping-updates/process.ts, run by Supabase
// pg_cron). Two jobs:
//
// 1. Tracked orders: ask EasyPost for each shipped order's tracking status.
//    When the carrier says "delivered", the order becomes Delivered and the
//    customer gets the delivered email. Labels bought through the admin
//    already have an EasyPost tracker; a tracking number typed in by hand
//    gets one the first time it's checked (EasyPost bills those per tracker,
//    about a cent or two, so the id is stored and never created twice).
//    Needs EASYPOST_API_KEY; without it this part is skipped.
//
// 2. Plain White Envelope orders have no tracking, so nothing can say they
//    arrived. PWE_ARRIVAL_MAIL_DAYS mail days after shipping, the customer
//    gets a one-time "your order should have arrived" check-in instead,
//    asking them to reply if it hasn't.
//
// Safe to run often and in parallel: each tracked order is claimed before
// it's checked and rechecked at most every RECHECK_AFTER_MS, and every email
// is idempotent per order (sendTrackedEmail).

const DAY_MS = 24 * 60 * 60 * 1000;

/** Stop checking a tracked order this long after it shipped. */
export const TRACKING_WINDOW_DAYS = 45;
/** The same order is checked at most this often. */
export const RECHECK_AFTER_MS = 50 * 60 * 1000;
/** A tracking number EasyPost couldn't look up is retried once a day. */
export const ERROR_RECHECK_AFTER_MS = DAY_MS;
/** A PWE check-in more than this many days late is skipped, not sent. */
export const ARRIVAL_CHECK_WINDOW_DAYS = 7;

const TRACKED_BATCH = 40;
const PWE_BATCH = 100;

export interface ShippingUpdatesSummary {
  /** False when EASYPOST_API_KEY isn't set: tracked orders weren't checked. */
  trackingConnected: boolean;
  checked: number;
  delivered: number;
  trackersCreated: number;
  trackingErrors: number;
  arrivalChecksSent: number;
  /** Already sent, customer opted out, or no email on the order. */
  arrivalChecksSkipped: number;
  emailFailures: number;
  /** Ran out of time; the rest go next run. */
  stoppedEarly: boolean;
}

export async function runShippingUpdates(options: {
  timeBudgetMs: number;
  now?: number;
}): Promise<ShippingUpdatesSummary> {
  const now = options.now ?? Date.now();
  const deadline = Date.now() + options.timeBudgetMs;
  const summary: ShippingUpdatesSummary = {
    trackingConnected: isEasyPostConnected(),
    checked: 0,
    delivered: 0,
    trackersCreated: 0,
    trackingErrors: 0,
    arrivalChecksSent: 0,
    arrivalChecksSkipped: 0,
    emailFailures: 0,
    stoppedEarly: false,
  };

  if (summary.trackingConnected) {
    await checkTrackedOrders(now, deadline, summary);
  }
  if (!summary.stoppedEarly) {
    await sendArrivalChecks(now, deadline, summary);
  }
  return summary;
}

/**
 * PostgREST filter for tracked orders due a check: never checked, or checked
 * more than RECHECK_AFTER_MS ago — or, for a number EasyPost couldn't look
 * up, more than ERROR_RECHECK_AFTER_MS ago. Filtering those out here (not
 * just in the loop) keeps a pile of bad numbers from filling every batch.
 */
export function dueForTrackingCheckFilter(now: number): string {
  const recheckBefore = new Date(now - RECHECK_AFTER_MS).toISOString();
  const errorRecheckBefore = new Date(now - ERROR_RECHECK_AFTER_MS).toISOString();
  return [
    "tracking_checked_at.is.null",
    `tracking_checked_at.lt."${errorRecheckBefore}"`,
    `and(tracking_checked_at.lt."${recheckBefore}",or(tracking_status.is.null,tracking_status.neq.error))`,
  ].join(",");
}

async function checkTrackedOrders(now: number, deadline: number, summary: ShippingUpdatesSummary) {
  const db = getSupabaseAdmin();
  const nowIso = new Date(now).toISOString();
  const dueFilter = dueForTrackingCheckFilter(now);

  const { data: orders, error } = await db
    .from("orders")
    .select(
      "id, tracking_number, tracking_carrier, easypost_tracker_id, easypost_shipment_id, tracking_status, tracking_checked_at",
    )
    .eq("status", "shipped")
    .eq("shipping_method", "tracked")
    .not("tracking_number", "is", null)
    .gte("shipped_at", new Date(now - TRACKING_WINDOW_DAYS * DAY_MS).toISOString())
    .or(dueFilter)
    .order("tracking_checked_at", { ascending: true, nullsFirst: true })
    .limit(TRACKED_BATCH);
  if (error) throw new Error(`shipped orders query failed: ${error.message}`);

  for (const order of orders ?? []) {
    if (Date.now() > deadline) {
      summary.stoppedEarly = true;
      return;
    }
    if (!order.tracking_number) continue;

    // Numbers EasyPost couldn't look up get one try a day, not one an hour
    // (the query already leaves them out; this guards the same rule here).
    const lastChecked = order.tracking_checked_at ? Date.parse(order.tracking_checked_at) : null;
    if (order.tracking_status === "error" && lastChecked !== null && now - lastChecked < ERROR_RECHECK_AFTER_MS) {
      continue;
    }

    // Claim it, so an overlapping run can't check (or create a tracker for)
    // the same order twice.
    const { data: claimed, error: claimErr } = await db
      .from("orders")
      .update({ tracking_checked_at: nowIso })
      .eq("id", order.id)
      .eq("status", "shipped")
      .or(dueFilter)
      .select("id");
    if (claimErr) throw new Error(`claim failed: ${claimErr.message}`);
    if (!claimed || claimed.length === 0) continue;

    let tracker;
    try {
      const loaded = await loadTracker({
        trackerId: order.easypost_tracker_id,
        shipmentId: order.easypost_shipment_id,
        trackingNumber: order.tracking_number,
        carrier: order.tracking_carrier,
      });
      tracker = loaded.tracker;
      if (loaded.created) summary.trackersCreated += 1;
    } catch (err) {
      summary.trackingErrors += 1;
      console.error("[shipping-updates] tracking lookup failed for order", order.id, err instanceof Error ? err.message : err);
      await db.from("orders").update({ tracking_status: "error" }).eq("id", order.id);
      continue;
    }
    summary.checked += 1;

    if (tracker.status !== "delivered") {
      const { error: updErr } = await db
        .from("orders")
        .update({ easypost_tracker_id: tracker.id, tracking_status: tracker.status })
        .eq("id", order.id);
      if (updErr) throw new Error(`tracking update failed: ${updErr.message}`);
      continue;
    }

    // Delivered. Only a still-shipped order moves on, so a retry (or an
    // overlapping run) never emails twice.
    const { data: moved, error: delErr } = await db
      .from("orders")
      .update({
        easypost_tracker_id: tracker.id,
        tracking_status: "delivered",
        status: "delivered",
        delivered_at: deliveredAtOf(tracker, now),
      })
      .eq("id", order.id)
      .eq("status", "shipped")
      .select("id");
    if (delErr) throw new Error(`delivered update failed: ${delErr.message}`);
    if (!moved || moved.length === 0) continue;
    summary.delivered += 1;

    try {
      const result = await sendOrderStatusEmail(order.id, "delivered");
      if (result.status === "failed") summary.emailFailures += 1;
    } catch (err) {
      summary.emailFailures += 1;
      console.error("[shipping-updates] delivered email failed for order", order.id, err);
    }
  }
}

async function sendArrivalChecks(now: number, deadline: number, summary: ShippingUpdatesSummary) {
  const db = getSupabaseAdmin();

  // PWE_ARRIVAL_MAIL_DAYS mail days is at least that many calendar days, and
  // with Sundays skipped at most two more. Past the window, skip it.
  const newest = new Date(now - PWE_ARRIVAL_MAIL_DAYS * DAY_MS).toISOString();
  const oldest = new Date(now - (PWE_ARRIVAL_MAIL_DAYS + 2 + ARRIVAL_CHECK_WINDOW_DAYS) * DAY_MS).toISOString();

  const { data: orders, error } = await db
    .from("orders")
    .select("id, shipped_at")
    .eq("channel", "online")
    .eq("shipping_method", "pwe")
    .eq("status", "shipped")
    .not("email", "is", null)
    .lte("shipped_at", newest)
    .gte("shipped_at", oldest)
    .order("shipped_at", { ascending: true })
    .limit(PWE_BATCH);
  if (error) throw new Error(`PWE orders query failed: ${error.message}`);

  const due = (orders ?? []).filter((o) => {
    const shipped = o.shipped_at ? Date.parse(o.shipped_at) : NaN;
    if (!Number.isFinite(shipped)) return false;
    const dueAt = pweArrivalDueAt(shipped);
    return dueAt <= now && now - dueAt <= ARRIVAL_CHECK_WINDOW_DAYS * DAY_MS;
  });
  if (due.length === 0) return;

  // Skip the ones already emailed without another round trip each.
  const keys = due.map((o) => `order-arrival_check-${o.id}`);
  const { data: sentRows, error: sentErr } = await db
    .from("email_deliveries")
    .select("idempotency_key")
    .in("idempotency_key", keys);
  if (sentErr) throw new Error(`email lookup failed: ${sentErr.message}`);
  const alreadySent = new Set((sentRows ?? []).map((r) => r.idempotency_key));

  for (const order of due) {
    if (alreadySent.has(`order-arrival_check-${order.id}`)) continue;
    if (Date.now() > deadline) {
      summary.stoppedEarly = true;
      return;
    }
    try {
      const result = await sendOrderStatusEmail(order.id, "arrival_check");
      if (result.status === "sent") summary.arrivalChecksSent += 1;
      else if (result.status === "failed") summary.emailFailures += 1;
      else summary.arrivalChecksSkipped += 1;
    } catch (err) {
      summary.emailFailures += 1;
      console.error("[shipping-updates] arrival check-in failed for order", order.id, err);
    }
  }
}
