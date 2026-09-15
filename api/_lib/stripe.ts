import Stripe from "stripe";
import { ServerEnv } from "./env.js";

// Server-only Stripe client. Uses STRIPE_SECRET_KEY (never exposed to the
// browser). Created lazily so functions that don't touch Stripe don't require
// the secret at cold start — mirroring getSupabaseAdmin()/getResend().
//
// REQUIRES: `npm i stripe` (added to dependencies). Until installed + the env
// vars are set in Vercel, the two payment functions will fail closed with a
// clear error rather than doing anything unsafe.

let cached: Stripe | null = null;

export function getStripe(): Stripe {
  if (cached) return cached;
  cached = new Stripe(ServerEnv.stripeSecretKey(), {
    // Pin a version so behavior is stable across deploys. Update deliberately.
    apiVersion: "2025-08-27.basil",
    typescript: true,
    appInfo: { name: "geega-games-storefront" },
  });
  return cached;
}
