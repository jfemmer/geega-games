import { createRequire } from "node:module";
import { ServerEnv } from "./env.js";

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
interface EasyPostShipment {
  id: string;
  rates: EasyPostRate[];
  messages: EasyPostMessage[];
  tracking_code: string;
  selected_rate: EasyPostRate | null;
  postage_label: EasyPostPostageLabel | null;
  lowestRate(carriers?: string[], services?: string[]): EasyPostRate;
}
interface EasyPostClient {
  Shipment: {
    create(params: Record<string, unknown>): Promise<EasyPostShipment>;
    buy(id: string, rate: EasyPostRate): Promise<EasyPostShipment>;
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

// The business's own return address — printed as the "from" on every label
// and every plain (unpaid) address label. Update here if it ever changes.
export const SHIP_FROM_ADDRESS = {
  name: "Geega Games",
  street1: "390 Newbury Dr.",
  city: "Ballwin",
  state: "MO",
  zip: "63011",
  country: "US",
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
  labelUrl: string;
  trackingCode: string;
  carrier: string;
  service: string;
  rateCents: number;
  shipmentId: string;
  weightOz: number;
}

/**
 * Buys the cheapest available postage label for the given destination using
 * the fixed default package size. Throws a caller-safe Error (message is
 * fine to surface to admin UI) on any failure — no EasyPost/HTTP internals
 * leak through.
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
    options: { label_format: "PDF" },
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

  const labelUrl = bought.postage_label?.label_pdf_url || bought.postage_label?.label_url;
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
    weightOz: DEFAULT_PACKAGE.weightOz,
  };
}
