// Pure money + shipping helpers for the storefront.
//
// IMPORTANT: The server (public.checkout_create_order) is the ONLY authority for
// the amount a customer is charged. The constants below MUST mirror the RPC so
// the UI can *preview* totals that match what the server will compute — but the
// server value always wins. If you change shipping rules, change them in the
// migration (checkout_create_order) AND here, and keep the test in
// tests/storefrontMoney.test.ts green so the two cannot silently drift.

export const SHIPPING = {
  /** Tracked shipping in cents (matches checkout_create_order c_tracked_cents). */
  trackedCents: 550,
  /** Plain White Envelope in cents (matches c_pwe_cents). */
  pweCents: 150,
  /** Subtotal (cents) at/above which tracked shipping is free (c_free_tracked_threshold). */
  freeTrackedThresholdCents: 8500,
} as const;

export type ShippingMethod = "tracked" | "pwe";

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

/**
 * Shipping cost in cents for a given method + merchandise subtotal.
 * Mirrors checkout_create_order exactly:
 *   - tracked: free at/above threshold, else trackedCents
 *   - pwe: always pweCents
 */
export function shippingCents(
  method: ShippingMethod,
  subtotalCents: number,
): number {
  if (method === "tracked") {
    return subtotalCents >= SHIPPING.freeTrackedThresholdCents
      ? 0
      : SHIPPING.trackedCents;
  }
  return SHIPPING.pweCents;
}

/**
 * Preview the full order math the same way the server will. Returns cents.
 * storeCreditRequestedCents is clamped to [0, balance] ∩ [0, total] just like
 * the RPC, so the preview cannot show a nonsensical negative amount due.
 */
export function previewOrderTotals(input: {
  subtotalCents: number;
  method: ShippingMethod;
  storeCreditBalanceCents?: number;
  storeCreditRequestedCents?: number;
}): {
  subtotalCents: number;
  shippingCents: number;
  totalCents: number;
  storeCreditUsedCents: number;
  amountDueCents: number;
} {
  const ship = shippingCents(input.method, input.subtotalCents);
  const total = input.subtotalCents + ship;
  const balance = Math.max(0, input.storeCreditBalanceCents ?? 0);
  const requested = Math.max(0, input.storeCreditRequestedCents ?? 0);
  const creditUsed = Math.min(requested, balance, total);
  const amountDue = total - creditUsed;
  return {
    subtotalCents: input.subtotalCents,
    shippingCents: ship,
    totalCents: total,
    storeCreditUsedCents: creditUsed,
    amountDueCents: amountDue,
  };
}

/** How much more (cents) until tracked shipping is free; 0 when already free. */
export function amountUntilFreeShipping(subtotalCents: number): number {
  return Math.max(0, SHIPPING.freeTrackedThresholdCents - subtotalCents);
}
