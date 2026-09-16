import { loadStripe, type Stripe } from "@stripe/stripe-js";

// Public browser Stripe client. ONLY the Stripe publishable key belongs here —
// it is safe to expose. The secret key lives server-only in STRIPE_SECRET_KEY
// (see api/_lib/stripe.ts) and is never bundled into the browser.
const publishableKey = import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY as
  | string
  | undefined;

export const isStripeConfigured = Boolean(publishableKey);

if (!isStripeConfigured) {
  console.error(
    "Missing VITE_STRIPE_PUBLISHABLE_KEY. Add it to your .env (local) and to " +
      "Vercel → Settings → Environment Variables to enable card payments.",
  );
}

// Loaded lazily and cached so the Stripe.js script is only fetched once, the
// first time a checkout actually needs it.
let stripePromise: Promise<Stripe | null> | null = null;

export function getStripePromise(): Promise<Stripe | null> {
  if (!isStripeConfigured) return Promise.resolve(null);
  if (!stripePromise) stripePromise = loadStripe(publishableKey!);
  return stripePromise;
}
