import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "../../src/types/database.js";
import { ServerEnv } from "../_lib/env.js";
import { getStripe } from "../_lib/stripe.js";
import { sendJson } from "../_lib/http.js";

// GET /api/checkout/payment-intent-status?id=pi_...
//
// Used only on the return trip when a Stripe payment step had to leave the
// page (rare for cards): the browser has a PaymentIntent id from the URL Stripe
// appended, but PaymentIntent metadata (which carries our order_id) is never
// exposed to the client directly — Stripe's client SDK redacts it. This
// endpoint reads it server-side, with the secret key, and returns only what
// the checkout page needs after verifying the caller actually owns it.

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return sendJson(res, 405, { ok: false, message: "Method not allowed." });
  }

  const id = typeof req.query.id === "string" ? req.query.id : "";
  if (!id.startsWith("pi_")) {
    return sendJson(res, 400, { ok: false, message: "Invalid payment intent id." });
  }

  const accessToken = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!accessToken) {
    return sendJson(res, 401, { ok: false, message: "Not authenticated." });
  }

  const userClient = createClient<Database>(
    ServerEnv.supabaseUrl(),
    process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY || "",
    {
      global: { headers: { Authorization: `Bearer ${accessToken}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    },
  );
  const { data: userData, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userData.user) {
    return sendJson(res, 401, { ok: false, message: "Session expired. Please sign in again." });
  }

  try {
    const stripe = getStripe();
    const intent = await stripe.paymentIntents.retrieve(id);
    // Only the customer who owns this PaymentIntent may read its status.
    if (intent.metadata?.user_id !== userData.user.id) {
      return sendJson(res, 403, { ok: false, message: "Not authorized." });
    }
    return sendJson(res, 200, {
      ok: true,
      orderId: intent.metadata?.order_id ?? null,
      status: intent.status,
      amountDueCents: intent.amount,
    });
  } catch (err) {
    console.error("[stripe] paymentIntents.retrieve failed", err);
    return sendJson(res, 502, { ok: false, message: "Could not look up payment status." });
  }
}
