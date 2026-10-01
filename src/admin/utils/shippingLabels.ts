// What goes on a printed shipping label, and how it's laid out. Pure
// helpers for LabelPrintView and the Orders page.

import type { Order } from "../types";

/**
 * The envelope a Plain White Envelope order is printed straight onto, with
 * a regular (inkjet or laser) printer:
 *   envelope-6-3-4  3⅝ × 6½ in (#6¾), the store's usual one and the default
 *   envelope-10     4⅛ × 9½ in (#10), for the odd bigger order
 *
 * Both print in solid black with the addresses in capitals, as USPS
 * recommends for its sorting machines. (Bought postage labels are separate:
 * 4×6, for the label printer.)
 */
export type PweLabelFormat = "envelope-6-3-4" | "envelope-10";

export const PWE_LABEL_FORMATS: { value: PweLabelFormat; label: string }[] = [
  { value: "envelope-6-3-4", label: "3⅝ × 6½ envelope" },
  { value: "envelope-10", label: "4⅛ × 9½ envelope (#10)" },
];

export const DEFAULT_PWE_LABEL_FORMAT: PweLabelFormat = "envelope-6-3-4";

/** Page size for each printable, in inches, as it reads. */
export const PAGE_SIZE_IN: Record<PweLabelFormat | "postage-4x6", { width: number; height: number }> = {
  "envelope-6-3-4": { width: 6.5, height: 3.625 },
  "envelope-10": { width: 9.5, height: 4.125 },
  "postage-4x6": { width: 4, height: 6 },
};

// Versioned with the choices: a device that picked from the old ones
// (a 4×6 label or #10) starts again on the new default.
const FORMAT_STORAGE_KEY = "gg-admin:pwe-envelope";

function isPweLabelFormat(value: unknown): value is PweLabelFormat {
  return PWE_LABEL_FORMATS.some((f) => f.value === value);
}

/** This device's chosen PWE format (printers are per device). */
export function loadPweLabelFormat(): PweLabelFormat {
  try {
    const saved = window.localStorage.getItem(FORMAT_STORAGE_KEY);
    return isPweLabelFormat(saved) ? saved : DEFAULT_PWE_LABEL_FORMAT;
  } catch {
    return DEFAULT_PWE_LABEL_FORMAT;
  }
}

export function savePweLabelFormat(format: PweLabelFormat): void {
  try {
    window.localStorage.setItem(FORMAT_STORAGE_KEY, format);
  } catch {
    // Private mode or storage blocked: the choice just isn't remembered.
  }
}

const DOMESTIC = new Set(["", "US", "USA", "UNITED STATES", "UNITED STATES OF AMERICA"]);

function clean(value: string | null | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

/**
 * The delivery address as printed lines: name, street (and unit), "City, ST
 * ZIP", and the country only when it isn't the US (USPS wants it last, in
 * capitals, for international mail).
 */
export function recipientLines(
  order: Pick<
    Order,
    | "shipRecipient"
    | "customerName"
    | "shipLine1"
    | "shipLine2"
    | "shipCity"
    | "shipState"
    | "shipPostalCode"
    | "shipCountry"
  >,
): string[] {
  const cityLine = [clean(order.shipCity), [clean(order.shipState), clean(order.shipPostalCode)].filter(Boolean).join(" ")]
    .filter(Boolean)
    .join(", ");
  const country = clean(order.shipCountry).toUpperCase();
  return [
    clean(order.shipRecipient) || clean(order.customerName),
    clean(order.shipLine1),
    clean(order.shipLine2),
    cityLine,
    DOMESTIC.has(country) ? "" : country,
  ].filter(Boolean);
}

/**
 * Where the delivery address goes on each envelope, in inches from its top
 * left corner. Both sit inside USPS's address read area (between ⅝ in and
 * 2¾ in up from the bottom edge, at least ½ in from the sides), below the
 * stamp, and clear of the barcode strip USPS prints along the bottom.
 */
export const ADDRESS_BLOCK: Record<PweLabelFormat, { leftIn: number; topIn: number; widthIn: number; maxPt: number }> = {
  "envelope-6-3-4": { leftIn: 2.2, topIn: 1.3, widthIn: 3.8, maxPt: 13 },
  "envelope-10": { leftIn: 3.6, topIn: 1.65, widthIn: 5.3, maxPt: 14 },
};

/** The smallest address type USPS recommends. */
export const MIN_ADDRESS_PT = 10;

/**
 * Width of an average bold capital (Arial), in ems, with room to spare:
 * real addresses measure 0.53–0.67.
 */
const BOLD_CAPS_EM_PER_CHAR = 0.7;

/**
 * Type size for the delivery address: as large as the layout allows while
 * the longest line still fits on one line (a city/state/ZIP line broken in
 * two is harder for USPS's machines to read). Worked out from the character
 * count, not measured, so it prints the same in every browser.
 */
export function addressFontSizePt(lines: string[], format: PweLabelFormat): number {
  const { widthIn, maxPt } = ADDRESS_BLOCK[format];
  const longest = Math.max(1, ...lines.map((line) => line.length));
  const fitting = (widthIn * 72) / (longest * BOLD_CAPS_EM_PER_CHAR);
  return Math.min(maxPt, Math.max(MIN_ADDRESS_PT, Math.floor(fitting * 2) / 2));
}

/** An order has enough of an address to print. */
export function hasPrintableAddress(order: Pick<Order, "shipLine1" | "shipCity" | "shipState" | "shipPostalCode">): boolean {
  return Boolean(clean(order.shipLine1) && clean(order.shipCity) && clean(order.shipState) && clean(order.shipPostalCode));
}

/**
 * EasyPost labels bought through the admin are PNG images, which print
 * straight from the page. Anything else (an older PDF label) can only be
 * opened in a new tab.
 */
export function isImageLabel(url: string | null | undefined): boolean {
  if (!url) return false;
  try {
    return /\.(png|jpe?g|gif|webp)$/i.test(new URL(url).pathname);
  } catch {
    return false;
  }
}

/** Carrier tracking status from EasyPost, in words. */
export function trackingStatusLabel(status: string | null | undefined): string | null {
  switch (status) {
    case null:
    case undefined:
    case "":
      return null;
    case "pre_transit":
      return "Label created, not scanned yet";
    case "in_transit":
      return "In transit";
    case "out_for_delivery":
      return "Out for delivery";
    case "delivered":
      return "Delivered";
    case "available_for_pickup":
      return "Waiting at the post office for pickup";
    case "return_to_sender":
      return "Returning to sender";
    case "failure":
      return "Delivery problem";
    case "cancelled":
      return "Cancelled by the carrier";
    case "error":
      return "Couldn't be tracked — check the tracking number";
    default:
      return "Tracking not available yet";
  }
}

/** Statuses staff should act on. */
export function isTrackingProblem(status: string | null | undefined): boolean {
  return status === "return_to_sender" || status === "failure" || status === "error" || status === "cancelled";
}
