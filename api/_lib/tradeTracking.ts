import type { Json } from "../../src/types/database.js";
import { isEasyPostConnected, loadTracker, type EasyPostTracker } from "./easypost.js";
import { loadTradeBundle, type Admin, type TradeRow, type TradeSettingsRow } from "./tradeCenter.js";
import { notifyTradeStaff, sendTradeCustomerEmail } from "./tradeCenterEmails.js";
import { processDepositRefund } from "./tradeDeposits.js";
import {
  deliveredScanAt,
  firstAcceptanceAt,
  lastScanAt,
  type TrackingScan,
} from "../../src/store/lib/tradeTracking.js";

// Checking a trade package with the carrier, through EasyPost (the tracking
// service the store already uses for orders: api/_lib/shippingUpdates.ts).
// A tracker is created once per tracking number (EasyPost bills per tracker
// and returns the same one for the same number) and its id kept on the
// trade; after that it's only read. The scans are saved on the trade, and
// the database decides what they mean (trade_record_scan): the first scan
// where the carrier had the package, by the deadline, verifies the shipment.
//
// Without EASYPOST_API_KEY, or for a carrier EasyPost can't track ("Other"),
// nothing is checked automatically: staff verify by hand, and the worker
// never expires such a trade for a missing scan.

/** Scans are checked automatically for this trade's carrier. */
export function autoTracking(carrier: string | null): boolean {
  return isEasyPostConnected() && carrier !== null && carrier !== "Other";
}

export function trackingConnected(): boolean {
  return isEasyPostConnected();
}

function locationOf(detail: Record<string, unknown>): string | null {
  const loc = detail.tracking_location;
  if (!loc || typeof loc !== "object") return null;
  const o = loc as Record<string, unknown>;
  const parts = [o.city, o.state].filter((p): p is string => typeof p === "string" && p.trim() !== "").map((p) => p.trim());
  return parts.length ? parts.join(", ") : null;
}

/** EasyPost's tracking details as the scans a trade keeps, oldest first. */
export function scansFromTracker(tracker: EasyPostTracker): TrackingScan[] {
  const details = (tracker.tracking_details ?? []) as unknown as Record<string, unknown>[];
  const scans = details.flatMap((d) => {
    const status = typeof d.status === "string" ? d.status : null;
    if (!status) return [];
    const at = typeof d.datetime === "string" && Number.isFinite(Date.parse(d.datetime)) ? new Date(d.datetime).toISOString() : null;
    return [{
      status,
      detail: typeof d.status_detail === "string" ? d.status_detail : null,
      message: typeof d.message === "string" ? d.message.slice(0, 300) : null,
      at,
      location: locationOf(d),
    }];
  });
  // Oldest first (a scan without a time first of all, so the order is always
  // the same), keeping the latest 100.
  const time = (s: TrackingScan) => (s.at ? Date.parse(s.at) : 0);
  return scans.sort((a, b) => time(a) - time(b)).slice(-100);
}

export type TrackingCheck = "verified" | "late" | "early" | "delivered" | "updated" | "stale" | "skipped" | "error";

/** Reads the carrier's scans for a trade and records them (trade_record_scan). */
export async function checkTradeTracking(admin: Admin, trade: TradeRow): Promise<TrackingCheck> {
  if (!trade.inbound_tracking || !autoTracking(trade.inbound_carrier)) return "skipped";
  let tracker: EasyPostTracker;
  try {
    ({ tracker } = await loadTracker({
      trackerId: trade.inbound_tracker_id,
      shipmentId: null,
      trackingNumber: trade.inbound_tracking,
      carrier: trade.inbound_carrier,
    }));
  } catch (err) {
    console.error("[tradeTracking] tracker failed", trade.id, err instanceof Error ? err.message : err);
    return "error";
  }
  const scans = scansFromTracker(tracker);
  const { data, error } = await admin.rpc("trade_record_scan", {
    p_trade_id: trade.id,
    p_tracking: trade.inbound_tracking,
    p_tracker_id: tracker.id,
    p_status: tracker.status ?? null,
    p_events: scans as unknown as Json,
    p_accepted_at: firstAcceptanceAt(scans),
    p_delivered_at: tracker.status === "delivered" ? deliveredScanAt(scans) : null,
    p_last_event_at: lastScanAt(scans),
  });
  if (error) {
    console.error("[tradeTracking] trade_record_scan failed", trade.id, error.message);
    return "error";
  }
  return (typeof data === "string" ? data : "updated") as TrackingCheck;
}

/**
 * After a scan was recorded: a verified shipment emails the customer (with
 * the deposit refund) and starts the refund; a late or early first scan, or
 * a delivery, tells staff (and the customer, for a delivery).
 */
export async function followUpScan(admin: Admin, settings: TradeSettingsRow, tradeId: string, outcome: TrackingCheck): Promise<void> {
  if (outcome !== "verified" && outcome !== "late" && outcome !== "early" && outcome !== "delivered") return;
  const bundle = await loadTradeBundle(admin, tradeId);
  if (!bundle) return;
  if (outcome === "verified") {
    await sendTradeCustomerEmail(bundle, settings, { kind: "shipment_verified" });
    // The shipment email says the refund started; this starts it.
    await processDepositRefund(admin, tradeId, { notifyStarted: false });
    return;
  }
  if (outcome === "delivered") await sendTradeCustomerEmail(bundle, settings, { kind: "delivered" });
  await notifyTradeStaff(bundle, settings, {
    kind: outcome === "late" ? "late_scan" : outcome === "early" ? "early_scan" : "delivered",
  });
}
