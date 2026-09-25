import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "../../src/types/database.js";
import { ServerEnv } from "../_lib/env.js";
import { readJsonBody, sendJson } from "../_lib/http.js";
import { isPayPalServerConfigured, PayPalApiError } from "../_lib/paypal.js";
import {
  CheckoutError,
  createPayPalCheckout,
  finalizePayPalCheckout,
  type PayPalBuyer,
} from "../_lib/paypalCheckout.js";
import { verifyGuestToken } from "../_lib/guestAccess.js";

// POST /api/checkout/paypal
//
// Backs the PayPal / Venmo buttons on the checkout payment step. The DB order
// already exists (created by /api/checkout/create-payment-intent or the
// checkout_create_order RPC), so this never prices anything itself:
//
//   { action: "create",  orderId }                 → { ok, paypalOrderId }
//       Creates a PayPal order for exactly orders.amount_due_cents.
//   { action: "capture", orderId, paypalOrderId }  → { ok, outcome }
//       Called after the buyer approves in the PayPal/Venmo popup. Captures
//       and marks the order paid (see api/_lib/paypalCheckout.ts). The
//       PayPal webhook does the same thing independently, so a closed tab
//       after approval still ends with a paid order.
//
// Signed-in buyers send their Supabase access token; guests send the order's
// signed `guestToken` (from create-payment-intent) instead.

const ID_RE = /^[0-9a-f-]{36}$/i;
const PAYPAL_ID_RE = /^[A-Z0-9]{8,36}$/;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return sendJson(res, 405, { ok: false, message: "Method not allowed." });
  }
  if (!isPayPalServerConfigured()) {
    return sendJson(res, 503, { ok: false, message: "PayPal isn’t available right now." });
  }

  let body: Record<string, unknown>;
  try {
    body = await readJsonBody(req);
  } catch {
    return sendJson(res, 400, { ok: false, message: "Bad request body." });
  }

  const action = body.action;
  const orderId = typeof body.orderId === "string" ? body.orderId : "";
  if (!ID_RE.test(orderId)) {
    return sendJson(res, 400, { ok: false, message: "Invalid order." });
  }

  let buyer: PayPalBuyer;
  const accessToken = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (accessToken) {
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
    buyer = { userId: userData.user.id };
  } else if (verifyGuestToken("order", orderId, body.guestToken)) {
    buyer = { guestOrderId: orderId };
  } else {
    return sendJson(res, 401, { ok: false, message: "Not authenticated." });
  }

  try {
    if (action === "create") {
      const paypalOrderId = await createPayPalCheckout(orderId, buyer);
      return sendJson(res, 200, { ok: true, paypalOrderId });
    }

    if (action === "capture") {
      const paypalOrderId = typeof body.paypalOrderId === "string" ? body.paypalOrderId : "";
      if (!PAYPAL_ID_RE.test(paypalOrderId)) {
        return sendJson(res, 400, { ok: false, message: "Invalid PayPal order." });
      }
      const result = await finalizePayPalCheckout(paypalOrderId, {
        buyer,
        expectedOrderId: orderId,
      });
      switch (result.outcome) {
        case "paid":
        case "already_paid":
          return sendJson(res, 200, { ok: true, outcome: "paid" });
        case "pending":
          return sendJson(res, 200, { ok: true, outcome: "pending" });
        case "declined":
          return sendJson(res, 402, {
            ok: false,
            outcome: "declined",
            retryable: result.retryable,
            message: "Your payment was declined. Please choose a different payment method.",
          });
        default:
          console.error("[paypal] capture rejected", { orderId, paypalOrderId, reason: result.reason });
          return sendJson(res, 409, {
            ok: false,
            outcome: "rejected",
            message: "We couldn’t confirm this payment. Please contact us and reference your order.",
          });
      }
    }

    return sendJson(res, 400, { ok: false, message: "Unknown action." });
  } catch (err) {
    if (err instanceof CheckoutError) {
      return sendJson(res, err.status, { ok: false, message: err.message });
    }
    console.error("[paypal] checkout error", err instanceof PayPalApiError ? { status: err.status, issue: err.issue, message: err.message } : err);
    return sendJson(res, 502, { ok: false, message: "PayPal is unavailable right now. Please try again." });
  }
}
