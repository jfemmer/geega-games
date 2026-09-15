import type { VercelRequest, VercelResponse } from "@vercel/node";
import type Stripe from "stripe";
import { getStripe } from "../_lib/stripe.js";
import { getSupabaseAdmin } from "../_lib/supabaseAdmin.js";
import { ServerEnv } from "../_lib/env.js";
import { readRawBody } from "../_lib/http.js";
import { sendOrderConfirmation } from "../_lib/orderConfirmation.js";

// POST /api/webhooks/stripe
//
// The ONLY place an order becomes "paid". Never trust a browser success page.
// Steps:
//   1. Verify the Stripe signature against STRIPE_WEBHOOK_SECRET (raw body).
//   2. Idempotency: insert the event id into payment_events; if it already
//      exists, we've processed it — ack and stop (no duplicate mark-paid, no
//      duplicate email, no duplicate inventory effects).
//   3. On payment_intent.succeeded: mark_order_paid(order_id) then send the
//      existing confirmation email (which itself only sends when paid).
//
// Vercel must not parse the body — signature verification needs exact bytes.
export const config = { api: { bodyParser: false } };

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, message: "Method not allowed." });
  }

  let raw: string;
  try {
    raw = await readRawBody(req, 1024 * 1024);
  } catch {
    return res.status(400).json({ ok: false, message: "Bad body." });
  }

  const sig = req.headers["stripe-signature"];
  if (!sig || typeof sig !== "string") {
    return res.status(400).json({ ok: false, message: "Missing signature." });
  }

  let event: Stripe.Event;
  try {
    const stripe = getStripe();
    event = stripe.webhooks.constructEvent(
      raw,
      sig,
      ServerEnv.stripeWebhookSecret(),
    );
  } catch (err) {
    console.error("[stripe] signature verification failed", err);
    return res.status(400).json({ ok: false, message: "Invalid signature." });
  }

  const db = getSupabaseAdmin();

  // ---- Idempotency guard: record the event first -----------------------------
  // payment_events.event_id is unique; a duplicate insert tells us we've already
  // handled this exact event and can safely no-op.
  const orderIdFromEvent = extractOrderId(event);
  // Serialize to a plain JSON value for the jsonb payload column.
  const payloadJson = JSON.parse(JSON.stringify(event));
  const { error: insertErr } = await db.from("payment_events").insert({
    event_id: event.id,
    event_type: event.type,
    provider: "stripe",
    order_id: orderIdFromEvent,
    payload: payloadJson,
  });

  if (insertErr) {
    // Unique violation => already processed. Any insert error: ack so Stripe
    // doesn't hammer retries, but log it. (Duplicate is the expected case.)
    if (insertErr.code === "23505") {
      return res.status(200).json({ ok: true, deduped: true });
    }
    console.error("[stripe] payment_events insert error", insertErr);
    // Fall through cautiously only for the success handler below would be unsafe
    // without a recorded event, so stop here.
    return res.status(500).json({ ok: false, message: "Event store failed." });
  }

  try {
    if (event.type === "payment_intent.succeeded") {
      const pi = event.data.object as Stripe.PaymentIntent;
      const orderId = pi.metadata?.order_id;
      if (orderId) {
        // Trusted mark-paid in the DB (idempotent: safe if already paid).
        const { error: markErr } = await db.rpc("mark_order_paid", {
          p_order_id: orderId,
          p_provider: "stripe",
          p_reference: pi.id,
        });
        if (markErr) {
          console.error("[stripe] mark_order_paid failed", markErr);
          // Return 500 so Stripe retries; our event row exists but we can make
          // mark_order_paid idempotent-safe on retry.
          return res.status(500).json({ ok: false });
        }
        // Existing Resend confirmation — self-gates on payment_status='paid'
        // and is safe to call once here (dedup guard prevents repeats).
        try {
          await sendOrderConfirmation(orderId);
        } catch (mailErr) {
          // Email failure must not fail the webhook (order is already paid).
          console.error("[stripe] confirmation email failed", mailErr);
        }
      }
    }
    // Other event types are recorded (for audit) and acked without action.
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error("[stripe] handler error", err);
    return res.status(500).json({ ok: false });
  }
}

function extractOrderId(event: Stripe.Event): string | null {
  const obj = event.data.object as { metadata?: Record<string, string> };
  return obj?.metadata?.order_id ?? null;
}
