// Tracking numbers and carrier scans for the customer's trade package
// (Trade Center). Shared by the trade page (to check a number as it's typed)
// and the server (to check it again, and to read the carrier's scans).
//
// What counts as shipped: the carrier's first acceptance scan, the first
// event that means the carrier physically had the package. A label being
// created (or "shipping information received") doesn't count: the carrier
// hasn't seen the package yet.
//
// Pure module: no React, browser, Node or Supabase imports.

export const TRACKED_CARRIERS = ["USPS", "UPS", "FedEx"] as const;
export type TrackedCarrier = (typeof TRACKED_CARRIERS)[number];

/** Letters and digits, uppercased; spaces and dashes dropped. USPS's "420 + ZIP" routing prefix is removed. */
export function normalizeTracking(input: string): string {
  const compact = input.replace(/[\s-]/g, "").toUpperCase();
  // USPS barcodes start with 420 and the destination ZIP (5 or 9 digits)
  // before the tracking number itself, which starts with 9.
  const routed = /^420(?:\d{5}|\d{9})(9\d{19,21})$/.exec(compact);
  return routed ? routed[1] : compact;
}

const FORMATS: Record<TrackedCarrier, RegExp[]> = {
  // IMpb (20 to 22 digits, starting 91–95), and the 13-character S10 format (EA123456789US).
  USPS: [/^9[1-5]\d{18,20}$/, /^[A-Z]{2}\d{9}US$/],
  // 1Z plus 16 letters and digits.
  UPS: [/^1Z[0-9A-Z]{16}$/],
  // Express 12, Ground 15, SmartPost/Ground Economy 20 or 22 (96…).
  FedEx: [/^\d{12}$/, /^\d{15}$/, /^96\d{20}$/, /^(?:61|92)\d{18}$/],
};

/** The carrier a number's format belongs to, when it clearly belongs to one. */
export function detectCarrier(tracking: string): TrackedCarrier | null {
  const n = normalizeTracking(tracking);
  const matches = TRACKED_CARRIERS.filter((c) => FORMATS[c].some((re) => re.test(n)));
  return matches.length === 1 ? matches[0] : null;
}

export function matchesCarrierFormat(carrier: TrackedCarrier, tracking: string): boolean {
  const n = normalizeTracking(tracking);
  return FORMATS[carrier].some((re) => re.test(n));
}

export type TrackingCheck =
  | { ok: true; tracking: string; carrier: TrackedCarrier | "Other"; detected: TrackedCarrier | null }
  | { ok: false; message: string; suggestion?: TrackedCarrier };

/**
 * Checks a tracking number for the carrier chosen. USPS, UPS and FedEx
 * numbers must look like that carrier's; "Other" takes any 8 to 40 letters
 * and digits (it can only be verified by hand).
 */
export function checkTrackingNumber(carrier: string, raw: string): TrackingCheck {
  const tracking = normalizeTracking(raw ?? "");
  if (!/^[A-Z0-9]{8,40}$/.test(tracking)) {
    return { ok: false, message: "That tracking number doesn't look right. Check it and try again." };
  }
  const detected = detectCarrier(tracking);
  if (carrier === "Other") return { ok: true, tracking, carrier: "Other", detected };
  if (!(TRACKED_CARRIERS as readonly string[]).includes(carrier)) return { ok: false, message: "Choose the carrier." };
  const chosen = carrier as TrackedCarrier;
  if (matchesCarrierFormat(chosen, tracking)) return { ok: true, tracking, carrier: chosen, detected };
  if (detected && detected !== chosen) {
    return { ok: false, message: `That looks like a ${detected} tracking number. Choose ${detected}, or check the number.`, suggestion: detected };
  }
  return { ok: false, message: `That doesn't look like a ${chosen} tracking number. Check it and try again.` };
}

// ---------------------------------------------------------------------------
// Carrier scans
// ---------------------------------------------------------------------------

/** One carrier event, as the trade keeps it (trade_requests.inbound_tracking_events). */
export interface TrackingScan {
  /** The tracking service's status: pre_transit, in_transit, out_for_delivery, delivered, … */
  status: string;
  /** Its finer status, when given: label_created, arrived_at_facility, … */
  detail: string | null;
  message: string | null;
  /** ISO time of the scan. */
  at: string | null;
  location: string | null;
}

/** Statuses that mean the carrier physically had the package. */
const CARRIER_HAS_IT = new Set(["in_transit", "out_for_delivery", "delivered", "available_for_pickup", "return_to_sender"]);
/** Never a physical scan, whatever the status says. */
const LABEL_ONLY_DETAIL = new Set(["label_created", "awaiting_information"]);
const LABEL_ONLY_MESSAGE =
  /label (?:was )?created|shipping label|pre-?shipment|awaiting item|shipment information|shipper created|order processed: ready for ups|electronic notification/i;

export function isAcceptanceScan(scan: TrackingScan): boolean {
  if (!CARRIER_HAS_IT.has(scan.status)) return false;
  if (scan.detail && LABEL_ONLY_DETAIL.has(scan.detail)) return false;
  if (scan.message && LABEL_ONLY_MESSAGE.test(scan.message)) return false;
  return scan.at !== null && Number.isFinite(Date.parse(scan.at));
}

/** When the carrier first had the package (the earliest acceptance scan), or null. */
export function firstAcceptanceAt(scans: readonly TrackingScan[]): string | null {
  let best: number | null = null;
  for (const s of scans) {
    if (!isAcceptanceScan(s)) continue;
    const t = Date.parse(s.at as string);
    if (best === null || t < best) best = t;
  }
  return best === null ? null : new Date(best).toISOString();
}

/** When it was delivered (the latest delivered scan), or null. */
export function deliveredScanAt(scans: readonly TrackingScan[]): string | null {
  let best: number | null = null;
  for (const s of scans) {
    if (s.status !== "delivered" || !s.at) continue;
    const t = Date.parse(s.at);
    if (Number.isFinite(t) && (best === null || t > best)) best = t;
  }
  return best === null ? null : new Date(best).toISOString();
}

/** The most recent scan time (for spotting a package that's stopped moving). */
export function lastScanAt(scans: readonly TrackingScan[]): string | null {
  let best: number | null = null;
  for (const s of scans) {
    const t = s.at ? Date.parse(s.at) : NaN;
    if (Number.isFinite(t) && (best === null || t > best)) best = t;
  }
  return best === null ? null : new Date(best).toISOString();
}

/** Scans as stored data, tolerating anything odd in it. */
export function readScans(value: unknown): TrackingScan[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((v) => {
    if (!v || typeof v !== "object") return [];
    const o = v as Record<string, unknown>;
    const str = (x: unknown) => (typeof x === "string" && x.trim() ? x.trim() : null);
    const status = str(o.status);
    if (!status) return [];
    return [{ status, detail: str(o.detail), message: str(o.message), at: str(o.at), location: str(o.location) }];
  });
}

/** What a carrier status means, in plain words. */
export function scanStatusLabel(status: string | null | undefined): string {
  switch (status) {
    case "pre_transit":
      return "Label created: not scanned yet";
    case "in_transit":
      return "In transit";
    case "out_for_delivery":
      return "Out for delivery";
    case "delivered":
      return "Delivered";
    case "available_for_pickup":
      return "Ready for pickup";
    case "return_to_sender":
      return "Returning to sender";
    case "failure":
      return "Delivery problem";
    case "cancelled":
      return "Canceled by the carrier";
    case "error":
      return "Tracking error";
    default:
      return "No carrier scans yet";
  }
}
