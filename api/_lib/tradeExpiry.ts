import type { Json } from "../../src/types/database.js";
import { getSupabaseAdmin } from "./supabaseAdmin.js";
import { loadTradeBundle, loadTradeSettings, type Admin, type TradeRow, type TradeSettingsRow } from "./tradeCenter.js";
import { notifyTradeStaff, sendTradeCustomerEmail, type TradeCustomerEmail } from "./tradeCenterEmails.js";

// The Trade Center's part of the every-five-minutes worker
// (api/checkout/expire-holds.ts):
//   1. expire trades whose hold ran out with nothing shipped to us
//      (trade_expire_due: a list never sent, changes never made, or no
//      tracking number by the ship-by date plus grace), releasing our cards,
//      and email those customers;
//   2. remind customers a deadline is coming (the hold, the ship-by date, a
//      payment), once per deadline;
//   3. tell staff about a package that's been in transit too long, or a
//      payment past due (never acted on automatically: nothing is forfeited).
// Each reminder or alert is noted on the trade (trade_events), so a later
// run skips it. Safe to run early or often; never throws.

const LIST_REMINDER_HOURS = 6;
const SHIP_REMINDER_HOURS = 24;
const PAYMENT_REMINDER_HOURS = 24;
const BATCH = 50;

export interface TradeWorkerCounts {
  tradesExpired: number;
  tradeReminders: number;
  tradeAlerts: number;
}

export async function runTradeWorker(now = Date.now()): Promise<TradeWorkerCounts> {
  const counts: TradeWorkerCounts = { tradesExpired: 0, tradeReminders: 0, tradeAlerts: 0 };
  const admin = getSupabaseAdmin();
  let settings: TradeSettingsRow;
  try {
    settings = await loadTradeSettings(admin);
  } catch {
    return counts; // the Trade Center isn't set up in this database
  }
  try {
    counts.tradesExpired = await expireDue(admin, settings);
  } catch (err) {
    console.error("[tradeExpiry] expiring failed", err);
  }
  try {
    const sent = await remindAndAlert(admin, settings, now);
    counts.tradeReminders = sent.reminders;
    counts.tradeAlerts = sent.alerts;
  } catch (err) {
    console.error("[tradeExpiry] reminders failed", err);
  }
  return counts;
}

async function expireDue(admin: Admin, settings: TradeSettingsRow): Promise<number> {
  const { data, error } = await admin.rpc("trade_expire_due", { p_limit: BATCH });
  if (error) {
    console.error("[tradeExpiry] trade_expire_due failed", error.message);
    return 0;
  }
  const expired = data ?? [];
  for (const row of expired) {
    const bundle = await loadTradeBundle(admin, row.expired_trade_id);
    if (bundle) await sendTradeCustomerEmail(bundle, settings, { kind: "expired", fromStatus: row.expired_from_status });
  }
  return expired.length;
}

type Reminder = Extract<TradeCustomerEmail, { kind: "reminder" }>["reminder"];

interface Due {
  trade: TradeRow;
  kind: Reminder | "transit_overdue" | "payment_overdue";
  deadline: string;
}

async function remindAndAlert(admin: Admin, settings: TradeSettingsRow, now: number): Promise<{ reminders: number; alerts: number }> {
  const iso = (ms: number) => new Date(ms).toISOString();
  const [lists, shipping, paying, transit] = await Promise.all([
    admin
      .from("trade_requests")
      .select("*")
      .in("status", ["awaiting_trade_list", "revision_requested"])
      .gt("hold_expires_at", iso(now))
      .lte("hold_expires_at", iso(now + LIST_REMINDER_HOURS * 3_600_000))
      .limit(BATCH),
    admin
      .from("trade_requests")
      .select("*")
      .eq("status", "awaiting_shipment")
      .is("inbound_tracking", null)
      .gt("ship_by", iso(now))
      .lte("ship_by", iso(now + SHIP_REMINDER_HOURS * 3_600_000))
      .limit(BATCH),
    admin
      .from("trade_requests")
      .select("*")
      .eq("status", "awaiting_payment")
      .lte("payment_due_at", iso(now + PAYMENT_REMINDER_HOURS * 3_600_000))
      .limit(BATCH),
    admin
      .from("trade_requests")
      .select("*")
      .eq("status", "in_transit")
      .lte("inbound_shipped_at", iso(now - settings.transit_alert_days * 86_400_000))
      .limit(BATCH),
  ]);
  for (const r of [lists, shipping, paying, transit]) {
    if (r.error) throw new Error(r.error.message);
  }

  const due: Due[] = [
    ...(lists.data ?? []).map((t) => ({
      trade: t,
      kind: (t.status === "revision_requested" ? "revision_due" : "list_due") as Reminder,
      deadline: t.hold_expires_at as string,
    })),
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
  ];
  if (due.length === 0) return { reminders: 0, alerts: 0 };

  // What earlier runs already sent, by trade, kind and deadline.
  const { data: done, error } = await admin
    .from("trade_events")
    .select("trade_request_id, detail")
    .in("trade_request_id", [...new Set(due.map((d) => d.trade.id))])
    .in("event", ["reminder_sent", "staff_alerted"]);
  if (error) throw new Error(error.message);
  const sentKeys = new Set(
    (done ?? []).map((e) => {
      const d = (e.detail ?? {}) as Record<string, unknown>;
      return `${e.trade_request_id}|${String(d.kind)}|${String(d.deadline)}`;
    }),
  );

  let reminders = 0;
  let alerts = 0;
  for (const item of due) {
    const key = `${item.trade.id}|${item.kind}|${item.deadline}`;
    if (sentKeys.has(key)) continue;
    const bundle = await loadTradeBundle(admin, item.trade.id);
    if (!bundle) continue;
    const staffAlert = item.kind === "transit_overdue" || item.kind === "payment_overdue";
    if (staffAlert) {
      await notifyTradeStaff(bundle, settings, { kind: item.kind as "transit_overdue" | "payment_overdue" });
      alerts += 1;
    } else {
      const result = await sendTradeCustomerEmail(bundle, settings, { kind: "reminder", reminder: item.kind as Reminder });
      if (result.status === "failed") continue; // try again next run
      reminders += 1;
    }
    const { error: logErr } = await admin.from("trade_events").insert({
      trade_request_id: item.trade.id,
      actor_type: "system",
      event: staffAlert ? "staff_alerted" : "reminder_sent",
      from_status: item.trade.status,
      to_status: item.trade.status,
      detail: { kind: item.kind, deadline: item.deadline } as Json,
    });
    if (logErr) console.error("[tradeExpiry] couldn't note the reminder", item.trade.id, logErr.message);
    sentKeys.add(key);
  }
  return { reminders, alerts };
}
