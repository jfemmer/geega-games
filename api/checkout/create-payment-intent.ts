import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "../../src/types/database.js";
import { ServerEnv } from "../_lib/env.js";
import { getStripe } from "../_lib/stripe.js";
import { readJsonBody, sendJson } from "../_lib/http.js";

// POST /api/checkout/create-payment-intent
//
// Flow (server is the ONLY pricing authority):
//   1. Authenticate the caller from their Supabase access token.
//   2. Call checkout_create_order AS THAT USER (anon key + their JWT) so RLS and
//      auth.uid() apply and the DB atomically revalidates SELLABLE stock
//      (physical minus active reservations) and computes canonical totals.
//   3. If amount_due == 0 (store credit covered it), the RPC already marked the
//      order paid; return that — no Stripe needed.
//   4. Otherwise create a Stripe PaymentIntent for EXACTLY amount_due_cents
//      (server value), attach order_id in metadata, return client_secret.
//
// The browser never supplies the amount. A tampered client can at most create
// its own pending order for its own cart; it cannot change the price or buy
// reserved stock.

type CreateBody = {
  accessToken?: string;
  shippingMethod?: "tracked" | "pwe";
  storeCreditRequestedCents?: number;
  ship?: {
    recipient?: string;
    line1?: string;
    line2?: string;
    city?: string;
    state?: string;
    postalCode?: string;
    country?: string;
  };
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return sendJson(res, 405, { ok: false, message: "Method not allowed." });
  }

  let body: CreateBody;
  try {
    body = (await readJsonBody(req)) as CreateBody;
  } catch {
    return sendJson(res, 400, { ok: false, message: "Bad request body." });
  }

  const accessToken =
    body.accessToken ||
    (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!accessToken) {
    return sendJson(res, 401, { ok: false, message: "Not authenticated." });
  }
  if (body.shippingMethod !== "tracked" && body.shippingMethod !== "pwe") {
    return sendJson(res, 400, { ok: false, message: "Invalid shipping method." });
  }

  // A per-request client bound to the caller's JWT: the RPC runs as the user,
  // so auth.uid() and RLS are enforced exactly as in the browser.
  const userClient = createClient<Database>(
    ServerEnv.supabaseUrl(),
    // The publishable/anon key is fine here; the JWT provides the identity.
    process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY || "",
    {
      global: { headers: { Authorization: `Bearer ${accessToken}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    },
  );

  // Verify the token maps to a real user before doing anything.
  const { data: userData, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userData.user) {
    return sendJson(res, 401, { ok: false, message: "Session expired. Please sign in again." });
  }

  // Create the canonical order in the DB (atomic sellable-stock revalidation).
  const { data, error } = await userClient.rpc("checkout_create_order", {
    p_shipping_method: body.shippingMethod,
    p_store_credit_requested_cents: Math.max(
      0,
      Math.floor(body.storeCreditRequestedCents ?? 0),
    ),
    p_ship_recipient: body.ship?.recipient || undefined,
    p_ship_line1: body.ship?.line1 || undefined,
    p_ship_line2: body.ship?.line2 || undefined,
    p_ship_city: body.ship?.city || undefined,
    p_ship_state: body.ship?.state || undefined,
    p_ship_postal_code: body.ship?.postalCode || undefined,
    p_ship_country: body.ship?.country || "US",
  });

  if (error) {
    // Map known RPC errors to safe, useful messages.
    const msg = error.message.toLowerCase();
    if (msg.includes("insufficient stock")) {
      return sendJson(res, 409, {
        ok: false,
        code: "stock_conflict",
        message: "Some items changed availability. Please review your cart.",
      });
    }
    if (msg.includes("no price")) {
      return sendJson(res, 409, { ok: false, message: "An item isn’t priced and can’t be purchased." });
    }
    if (msg.includes("cart is empty")) {
      return sendJson(res, 400, { ok: false, message: "Your cart is empty." });
    }
    return sendJson(res, 400, { ok: false, message: "Could not create order." });
  }

  const order = Array.isArray(data) ? data[0] : data;
  if (!order) {
    return sendJson(res, 500, { ok: false, message: "Order creation returned no result." });
  }

  // Store-credit fully covered it: RPC already marked it paid. No Stripe.
  if (order.amount_due_cents === 0) {
    return sendJson(res, 200, {
      ok: true,
      orderId: order.order_id,
      amountDueCents: 0,
      paid: true,
    });
  }

  // Create a PaymentIntent for EXACTLY the server-computed amount.
  try {
    const stripe = getStripe();
    const intent = await stripe.paymentIntents.create(
      {
        amount: order.amount_due_cents, // server value, never the browser's
        currency: "usd",
        metadata: {
          order_id: order.order_id,
          user_id: userData.user.id,
        },
        // Redirect-free: the client always resolves confirmPayment() on this
        // page (no return_url/page-reload handling to build), and a declined
        // card can be retried in place against the same PaymentIntent.
        automatic_payment_methods: { enabled: true, allow_redirects: "never" },
      },
      // Idempotency: retrying the same order won't create duplicate intents.
      { idempotencyKey: `pi_${order.order_id}` },
    );

    return sendJson(res, 200, {
      ok: true,
      orderId: order.order_id,
      amountDueCents: order.amount_due_cents,
      clientSecret: intent.client_secret,
    });
  } catch (err) {
    // The order exists as pending_payment; a later retry can create the intent.
    console.error("[stripe] paymentIntents.create failed", err);
    return sendJson(res, 502, {
      ok: false,
      orderId: order.order_id,
      message:
        "Your order was created but we couldn’t start payment. It’s saved as pending; please try again shortly.",
    });
  }
}
