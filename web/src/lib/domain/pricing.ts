/**
 * pricing.ts — Centralized money + shipping rules (single source of truth).
 *
 * These constants MUST stay in sync with the SQL in
 * supabase/migrations/0011_checkout_rpc.sql (checkout_create_order).
 * The database is authoritative at checkout; these client-side values are for
 * DISPLAY ONLY (showing the customer an estimate before they submit).
 *
 * All money is integer CENTS. Never use floats for money.
 */

export const SHIPPING = {
  TRACKED_CENTS: 550, // $5.50
  PWE_CENTS: 150, // $1.50
  FREE_TRACKED_THRESHOLD_CENTS: 8500, // free tracked shipping at $85+
} as const;

export type ShippingMethod = 'tracked' | 'pwe';

/**
 * Compute shipping cost in cents for a given subtotal + method.
 * Mirror of the SQL logic. Display-only; the server recomputes authoritatively.
 */
export function shippingCostCents(
  subtotalCents: number,
  method: ShippingMethod
): number {
  if (method === 'tracked') {
    return subtotalCents >= SHIPPING.FREE_TRACKED_THRESHOLD_CENTS
      ? 0
      : SHIPPING.TRACKED_CENTS;
  }
  // pwe
  return SHIPPING.PWE_CENTS;
}

/**
 * Store credit that can be applied = min(requested, available, total).
 * Mirror of SQL. Display-only.
 */
export function applicableStoreCreditCents(
  requestedCents: number,
  availableCents: number,
  totalCents: number
): number {
  return Math.min(
    Math.max(Math.floor(requestedCents) || 0, 0),
    Math.max(availableCents, 0),
    totalCents
  );
}

/** Format integer cents as a USD string, e.g. 550 -> "$5.50". */
export function formatCents(cents: number | null | undefined): string {
  const n = typeof cents === 'number' && Number.isFinite(cents) ? cents : 0;
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(n / 100);
}

/** Parse a user-entered dollar string to integer cents. Returns null if invalid. */
export function dollarsToCents(input: string): number | null {
  const cleaned = input.replace(/[^0-9.]/g, '');
  if (!cleaned) return null;
  const value = Number.parseFloat(cleaned);
  if (!Number.isFinite(value) || value < 0) return null;
  return Math.round(value * 100);
}
