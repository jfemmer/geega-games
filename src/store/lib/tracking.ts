// Carrier tracking URL resolution for "Track My Order".
//
// The customer's checked shipping method (orders.shipping_method) is the ONLY
// signal that decides whether an order gets tracking UI — never shipping_cents,
// since tracked shipping can be free on qualifying orders. See CheckoutPage /
// AccountPages for the shipping_method === "tracked" | "pwe" branch.
//
// For a recognized carrier we build a direct tracking URL. For anything else we
// show the raw tracking number without inventing a link.

export type KnownCarrier = "usps" | "ups" | "fedex";

function normalizeCarrier(carrier: string | null | undefined): KnownCarrier | null {
  if (!carrier) return null;
  const c = carrier.trim().toLowerCase();
  if (c === "usps" || c.includes("postal")) return "usps";
  if (c === "ups") return "ups";
  if (c === "fedex" || c === "fed ex") return "fedex";
  return null;
}

/** Human-friendly carrier label for display (falls back to the raw value). */
export function carrierLabel(carrier: string | null | undefined): string {
  const known = normalizeCarrier(carrier);
  if (known === "usps") return "USPS";
  if (known === "ups") return "UPS";
  if (known === "fedex") return "FedEx";
  return carrier?.trim() || "Carrier";
}

/**
 * A direct carrier tracking URL for a recognized carrier, or null when the
 * carrier is unrecognized/missing — callers must NOT invent a URL in that
 * case, only display the raw tracking number.
 */
export function trackingUrlFor(
  carrier: string | null | undefined,
  trackingNumber: string | null | undefined,
): string | null {
  if (!trackingNumber?.trim()) return null;
  const known = normalizeCarrier(carrier);
  const num = encodeURIComponent(trackingNumber.trim());
  switch (known) {
    case "usps":
      return `https://tools.usps.com/go/TrackConfirmAction?tLabels=${num}`;
    case "ups":
      return `https://www.ups.com/track?loc=en_US&tracknum=${num}`;
    case "fedex":
      return `https://www.fedex.com/fedextrack/?trknbr=${num}`;
    default:
      return null;
  }
}
