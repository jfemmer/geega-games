// Public browser PayPal config. ONLY the PayPal REST app's client id belongs
// here — it is public by design. The secret lives server-only in
// PAYPAL_CLIENT_SECRET (see api/_lib/paypal.ts).
//
// The PayPal JS SDK loaded with this id renders both the PayPal button and,
// for eligible US buyers, the Venmo button. Stripe doesn't offer Venmo, and
// doesn't offer PayPal to US-based businesses, so both go through PayPal.
export const paypalClientId = (import.meta.env.VITE_PAYPAL_CLIENT_ID as string | undefined) ?? "";

export const isPayPalConfigured = Boolean(paypalClientId);
