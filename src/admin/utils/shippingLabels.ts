// What goes on a printed shipping label, and how it's laid out. Pure
// helpers for LabelPrintView and the Orders page.

import type { Order } from "../types";

/**
 * Every label prints on a standard 4×6 label printer label. A Plain White
 * Envelope label is stuck on one of the store's two envelopes, and the
 * envelope decides where the delivery address sits on the label
 * (ADDRESS_BLOCK):
 *   envelope-6-3-4  3⅝ × 6½ in (#6¾), the usual one and the default
 *   envelope-10     4⅛ × 9½ in (#10), for the odd bigger order
 *
 * Labels print in solid black (a thermal printer turns gray into faint
 * speckles) with the addresses in capitals, as USPS recommends for its
 * sorting machines.
 */
export type PweLabelFormat = "envelope-6-3-4" | "envelope-10";

export const PWE_LABEL_FORMATS: { value: PweLabelFormat; label: string }[] = [
  { value: "envelope-6-3-4", label: "3⅝ × 6½" },
  { value: "envelope-10", label: "4⅛ × 9½ (#10)" },
];

export const DEFAULT_PWE_LABEL_FORMAT: PweLabelFormat = "envelope-6-3-4";

export type LabelPage = "pwe-4x6" | "postage-4x6";

/** Page size, in inches, as the label feeds through the printer (portrait). */
export const PAGE_SIZE_IN: Record<LabelPage, { width: number; height: number }> = {
  // The envelope label is laid out the way it reads on the envelope (6 wide
  // × 4 tall) and printed turned a quarter turn onto the portrait label, so
  // the address runs along the envelope's long side, as USPS wants.
  "pwe-4x6": { width: 4, height: 6 },
  "postage-4x6": { width: 4, height: 6 },
};

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

export interface AddressPlacement {
  /** The area the address goes in, in inches from the label's top left as it reads (6 wide × 4 tall). */
  leftIn: number;
  topIn: number;
  widthIn: number;
  /** The area's height, for an address centered in it. */
  heightIn?: number;
  /**
   * start   the address starts at the area's top left.
   * center  the address is centered in the area; one too wide for it lines
   *         up with the area's right edge and extends left, so it never
   *         runs off the label.
   */
  align: "start" | "center";
  maxPt: number;
}

/**
 * Where the delivery address goes on the 4×6 label for each envelope.
 *
 *   envelope-6-3-4  The label nearly covers the envelope (it's ⅜ in taller,
 *                   so its bottom folds under). Everything prints in the
 *                   top 2½ in, the top right corner stays blank for the
 *                   stamp, and the address lands in USPS's read area.
 *   envelope-10     The label lines up with the envelope's left edge, so
 *                   the envelope's middle (4¾ in across) is 4¾ in into the
 *                   label. The area is centered there, both ways, and ends
 *                   0.1 in from the label's right edge, which is why the
 *                   type is smaller. The stamp goes on the envelope, right
 *                   of the label.
 */
export const ADDRESS_BLOCK: Record<PweLabelFormat, AddressPlacement> = {
  "envelope-6-3-4": { leftIn: 1.2, topIn: 1.4, widthIn: 4.5, align: "start", maxPt: 16 },
  "envelope-10": { leftIn: 3.6, topIn: 1.35, widthIn: 2.3, heightIn: 1.4, align: "center", maxPt: 16 },
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
