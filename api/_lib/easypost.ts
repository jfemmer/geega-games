import { createRequire } from "node:module";
import { ServerEnv } from "./env.js";
import { SHIP_FROM } from "../../src/store/lib/shipFrom.js";

// The @easypost/api package's shipped .d.ts mixes a default export with a
// UMD `export as namespace` global in a way that TypeScript cannot resolve
// cleanly under our "module: nodenext" setup (it ends up resolving the
// default export's type back to the whole module namespace). Loading the
// real CJS module directly via createRequire and describing only the
// surface this file actually calls sidesteps that — it's still the real,
// installed npm package at runtime, just with a narrower, hand-written type
// in place of the package's own broken-for-us one.
const require = createRequire(import.meta.url);

interface EasyPostRate {
  id: string;
  carrier: string;
  service: string;
  rate: string;
}
interface EasyPostMessage {
  carrier: string;
  message: string;
}
interface EasyPostPostageLabel {
  label_url?: string;
  label_pdf_url?: string;
}
export interface EasyPostTrackingDetail {
  status?: string | null;
  datetime?: string | null;
}
export interface EasyPostTracker {
  id: string;
  /** unknown, pre_transit, in_transit, out_for_delivery, delivered, available_for_pickup, return_to_sender, failure, cancelled, error */
  status: string;
  tracking_code?: string;
  tracking_details?: EasyPostTrackingDetail[] | null;
}
interface EasyPostShipment {
  id: string;
  rates: EasyPostRate[];
  messages: EasyPostMessage[];
  tracking_code: string;
  selected_rate: EasyPostRate | null;
  postage_label: EasyPostPostageLabel | null;
  tracker?: EasyPostTracker | null;
  lowestRate(carriers?: string[], services?: string[]): EasyPostRate;
}
interface EasyPostClient {
  Shipment: {
    create(params: Record<string, unknown>): Promise<EasyPostShipment>;
    buy(id: string, rate: EasyPostRate): Promise<EasyPostShipment>;
    retrieve(id: string): Promise<EasyPostShipment>;
  };
  Tracker: {
    create(params: Record<string, unknown>): Promise<EasyPostTracker>;
    retrieve(id: string): Promise<EasyPostTracker>;
  };
}
type EasyPostConstructor = new (apiKey: string) => EasyPostClient;

let cached: EasyPostClient | null = null;

export function getEasyPostClient(): EasyPostClient | null {
  const key = ServerEnv.easypostApiKey();
  if (!key) return null;
  if (cached) return cached;
  const EasyPost = require("@easypost/api") as EasyPostConstructor;
  cached = new EasyPost(key);
  return cached;
}

/** True once EASYPOST_API_KEY is set: labels can be bought and deliveries tracked. */
export function isEasyPostConnected(): boolean {
  return Boolean(ServerEnv.easypostApiKey());
}

// The business's own return address — printed as the "from" on every label
// (and on the plain PWE labels the admin prints). Lives in
// src/store/lib/shipFrom.ts so the browser and the server share one copy.
export const SHIP_FROM_ADDRESS = {
  name: SHIP_FROM.name,
  street1: SHIP_FROM.street1,
  city: SHIP_FROM.city,
  state: SHIP_FROM.state,
  zip: SHIP_FROM.zip,
  country: SHIP_FROM.country,
} as const;

// A fixed default package size/weight for every tracked order, rather than
// asking staff to weigh each one. Generous enough for a padded envelope
// with toploaders/sleeves for a handful of cards — bump this if the store
// starts regularly shipping noticeably heavier orders (e.g. large lots).
export const DEFAULT_PACKAGE = {
  weightOz: 3,
  lengthIn: 6,
  widthIn: 4,
  heightIn: 0.25,
} as const;

export interface ShipToAddress {
  name: string;
  street1: string;
  street2?: string | null;
  city: string;
  state: string;
  zip: string;
  country?: string | null;
}

export interface PurchasedLabel {
  /** The 4×6 label image (PNG), which the admin prints directly. */
  labelUrl: string;
  trackingCode: string;
  carrier: string;
  service: string;
  rateCents: number;
  shipmentId: string;
  /** EasyPost creates a tracker with every label; used to spot delivery. */
  trackerId: string | null;
  weightOz: number;
}

/**
 * Buys the cheapest available postage label for the given destination using
 * the fixed default package size. Throws a caller-safe Error (message is
 * fine to surface to admin UI) on any failure — no EasyPost/HTTP internals
 * leak through.
 *
 * The label comes back as EasyPost's default PNG (4×6), not a PDF: an image
 * can be printed straight from the admin page with one click, where a PDF
 * on another domain can only be opened in a new tab.
 */
export async function buyShippingLabel(to: ShipToAddress): Promise<PurchasedLabel> {
  const client = getEasyPostClient();
  if (!client) {
    throw new Error(
      "EasyPost isn't connected yet — add EASYPOST_API_KEY in Vercel to enable label purchasing.",
    );
  }
  if (!to.street1.trim() || !to.city.trim() || !to.state.trim() || !to.zip.trim()) {
    throw new Error("This order is missing a complete shipping address.");
  }

  const shipment = await client.Shipment.create({
    to_address: {
      name: to.name || undefined,
      street1: to.street1,
      street2: to.street2 || undefined,
      city: to.city,
      state: to.state,
      zip: to.zip,
      country: to.country?.trim() || "US",
    },
    from_address: SHIP_FROM_ADDRESS,
    parcel: {
      weight: DEFAULT_PACKAGE.weightOz,
      length: DEFAULT_PACKAGE.lengthIn,
      width: DEFAULT_PACKAGE.widthIn,
      height: DEFAULT_PACKAGE.heightIn,
    },
  });

  if (!shipment.rates || shipment.rates.length === 0) {
    const carrierMessages = (shipment.messages ?? []).map((m) => m.message).filter(Boolean);
    throw new Error(
      carrierMessages.length > 0
        ? `No shipping rate was available: ${carrierMessages.join("; ")}`
        : "No shipping rate was available for this address. Double-check the address is complete and valid.",
    );
  }

  const rate = shipment.lowestRate();
  const bought = await client.Shipment.buy(shipment.id, rate);

  const labelUrl = bought.postage_label?.label_url || bought.postage_label?.label_pdf_url;
  if (!labelUrl) {
    throw new Error("The label was purchased but EasyPost didn't return a label file — check the EasyPost dashboard.");
  }
  const selected = bought.selected_rate ?? rate;
  const rateCents = Math.round(Number(selected.rate) * 100);

  return {
    labelUrl,
    trackingCode: bought.tracking_code,
    carrier: selected.carrier,
    service: selected.service,
    rateCents: Number.isFinite(rateCents) ? rateCents : 0,
    shipmentId: bought.id,
    trackerId: bought.tracker?.id ?? null,
    weightOz: DEFAULT_PACKAGE.weightOz,
  };
}

// EasyPost's own carrier codes for the carriers staff can pick when they
// type in a tracking number from a label bought elsewhere.
const EASYPOST_CARRIERS: Record<string, string> = { USPS: "USPS", UPS: "UPS", FEDEX: "FedEx" };

/**
 * The tracker for a shipment, whichever way it was shipped: an existing
 * tracker by id, the tracker EasyPost made with a label it sold, or a new
 * tracker for a tracking number typed in by hand (EasyPost bills these per
 * tracker, so callers store the id and never create twice).
 */
export async function loadTracker(order: {
  trackerId: string | null;
  shipmentId: string | null;
  trackingNumber: string;
  carrier: string | null;
}): Promise<{ tracker: EasyPostTracker; created: boolean }> {
  const client = getEasyPostClient();
  if (!client) throw new Error("EasyPost isn't connected.");
  if (order.trackerId) {
    return { tracker: await client.Tracker.retrieve(order.trackerId), created: false };
  }
  if (order.shipmentId) {
    const shipment = await client.Shipment.retrieve(order.shipmentId);
    if (shipment.tracker) return { tracker: shipment.tracker, created: false };
  }
  const carrier = EASYPOST_CARRIERS[(order.carrier ?? "").trim().toUpperCase()];
  const tracker = await client.Tracker.create({
    tracking_code: order.trackingNumber,
    ...(carrier ? { carrier } : {}),
  });
  return { tracker, created: true };
}

/** When the carrier scanned it delivered, falling back to now. */
export function deliveredAtOf(tracker: EasyPostTracker, now: number = Date.now()): string {
  const details = tracker.tracking_details ?? [];
  for (let i = details.length - 1; i >= 0; i -= 1) {
    const detail = details[i];
    if (detail?.status === "delivered" && detail.datetime) {
      const t = Date.parse(detail.datetime);
      if (Number.isFinite(t) && t <= now) return new Date(t).toISOString();
    }
  }
  return new Date(now).toISOString();
}
