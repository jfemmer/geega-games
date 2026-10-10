// Pure money + shipping helpers for the storefront.
//
// IMPORTANT: The server (public.checkout_place_order_core, which both the
// signed-in and the guest checkout go through) is the ONLY authority for the
// amount a customer is charged. The constants below MUST mirror it so the UI
// can *preview* totals that match what the server will compute — but the
// server value always wins. If you change shipping rules, change them in a
// migration (checkout_place_order_core) AND here: tests/storefrontMoney.test.ts
// reads the newest migration and fails if the two differ.

export const SHIPPING = {
  /** Tracked shipping in cents (c_tracked_cents). */
  trackedCents: 550,
  /** Plain White Envelope in cents (c_pwe_cents). */
  pweCents: 150,
  /**
   * Card subtotal (cents) at/above which an order ships free, and tracked,
   * automatically (c_free_shipping_threshold).
   */
  freeShippingThresholdCents: 7500,
} as const;

export type ShippingMethod = "tracked" | "pwe";

/**
 * Signed-in customers save this percentage on the cards of every online order,
 * on top of sale and deal prices (c_member_discount_percent in
 * checkout_place_order_core). Not on shipping. It's the reason the site gives
 * for creating an account.
 */
export const MEMBER_DISCOUNT_PERCENT = 5;

/**
 * The member discount on a card subtotal, in cents: MEMBER_DISCOUNT_PERCENT,
 * rounded to the nearest cent with halves going to the customer — the same
 * integer arithmetic as checkout_place_order_core, so the two agree exactly.
 */
export function memberDiscountCents(subtotalCents: number): number {
  if (!Number.isFinite(subtotalCents) || subtotalCents <= 0) return 0;
  return Math.floor((Math.round(subtotalCents) * MEMBER_DISCOUNT_PERCENT + 50) / 100);
}

/** True when an order ships free (and tracked) with nothing to choose. */
export function qualifiesForFreeShipping(subtotalCents: number): boolean {
  return subtotalCents >= SHIPPING.freeShippingThresholdCents;
}

/**
 * The method an order really ships by: a free-shipping order always goes
 * tracked, whatever was picked. Mirrors checkout_place_order_core.
 */
export function effectiveShippingMethod(
  method: ShippingMethod,
  subtotalCents: number,
): ShippingMethod {
  return qualifiesForFreeShipping(subtotalCents) ? "tracked" : method;
}

/** Format a cent amount as USD, e.g. 1234 -> "$12.34". */
export function formatCents(cents: number | null | undefined): string {
  const value = (cents ?? 0) / 100;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(value);
}

/** Format a dollar number as USD, e.g. 12.5 -> "$12.50". */
export function formatUsd(dollars: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(dollars);
}

/** Like formatCents, without ".00" on a whole-dollar amount: "$75", "$5.50". */
export function formatCentsShort(cents: number | null | undefined): string {
  return formatCents(cents).replace(/\.00$/, "");
}

/** A shipping charge as customers see it: "Free", or the amount. */
export function formatShipping(cents: number | null | undefined): string {
  return (cents ?? 0) === 0 ? "Free" : formatCents(cents);
}

/**
 * The shipping line of a placed order: "Free" rather than "$0.00" when it
 * shipped free. An in-person sale has no shipping method, so it keeps the
 * plain amount.
 */
export function orderShippingText(order: {
  shipping_method: string | null;
  shipping_cents: number;
}): string {
  return order.shipping_method ? formatShipping(order.shipping_cents) : formatCents(order.shipping_cents);
}

/**
 * Shipping cost in cents for a given method + card subtotal.
 * Mirrors checkout_place_order_core exactly:
 *   - at/above the free shipping threshold: free, whatever the method
 *   - below it: trackedCents for tracked, pweCents for Plain White Envelope
 */
export function shippingCents(
  method: ShippingMethod,
  subtotalCents: number,
): number {
  if (qualifiesForFreeShipping(subtotalCents)) return 0;
  return method === "tracked" ? SHIPPING.trackedCents : SHIPPING.pweCents;
}

/**
 * Preview the full order math the same way the server will. Returns cents.
 *   * `member`: the customer is signed in, so the cards are MEMBER_DISCOUNT_PERCENT
 *     off. Free shipping is still decided on the cards' full price, so the
 *     discount can never cost an order its free shipping.
 *   * storeCreditRequestedCents is clamped to [0, balance] ∩ [0, total] just
 *     like the RPC, so the preview cannot show a negative amount due.
 */
export function previewOrderTotals(input: {
  subtotalCents: number;
  method: ShippingMethod;
  member?: boolean;
  storeCreditBalanceCents?: number;
  storeCreditRequestedCents?: number;
}): {
  subtotalCents: number;
  discountCents: number;
  shippingCents: number;
  totalCents: number;
  storeCreditUsedCents: number;
  amountDueCents: number;
} {
  const ship = shippingCents(input.method, input.subtotalCents);
  const discount = input.member ? memberDiscountCents(input.subtotalCents) : 0;
  const total = input.subtotalCents - discount + ship;
  const balance = Math.max(0, input.storeCreditBalanceCents ?? 0);
  const requested = Math.max(0, input.storeCreditRequestedCents ?? 0);
  const creditUsed = Math.min(requested, balance, total);
  const amountDue = total - creditUsed;
  return {
    subtotalCents: input.subtotalCents,
    discountCents: discount,
    shippingCents: ship,
    totalCents: total,
    storeCreditUsedCents: creditUsed,
    amountDueCents: amountDue,
  };
}

/** How much more (cents) until the order ships free; 0 when it already does. */
export function amountUntilFreeShipping(subtotalCents: number): number {
  return Math.max(0, SHIPPING.freeShippingThresholdCents - subtotalCents);
}
