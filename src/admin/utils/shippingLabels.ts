// What goes on a printed shipping label, and how it's laid out. Pure
// helpers for LabelPrintView and the Orders page.

import type { Order } from "../types";

/**
 * How a Plain White Envelope is addressed:
 *   label-4x6    a 4×6 thermal label, stuck on a #10 envelope. The address
 *                reads along the label's long side (USPS wants it parallel
 *                to the envelope's long side), so it prints turned a quarter
 *                turn on the label roll.
 *   envelope-10  printed straight onto a #10 envelope (9½ × 4⅛ in) with a
 *                regular printer.
 */
export type PweLabelFormat = "label-4x6" | "envelope-10";

export const PWE_LABEL_FORMATS: { value: PweLabelFormat; label: string }[] = [
  { value: "label-4x6", label: "4×6 label" },
  { value: "envelope-10", label: "#10 envelope" },
];

export const DEFAULT_PWE_LABEL_FORMAT: PweLabelFormat = "label-4x6";

/** Page size for each printable, in inches. */
export const PAGE_SIZE_IN: Record<PweLabelFormat | "postage-4x6", { width: number; height: number }> = {
  // The 4×6 PWE label prints portrait (as the roll feeds) with the address
  // turned, so both 4×6 kinds share a portrait page.
  "label-4x6": { width: 4, height: 6 },
  "envelope-10": { width: 9.5, height: 4.125 },
  "postage-4x6": { width: 4, height: 6 },
};

const FORMAT_STORAGE_KEY = "gg-admin:pwe-label-format";

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
