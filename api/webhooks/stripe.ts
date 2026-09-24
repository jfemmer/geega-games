import type { VercelRequest, VercelResponse } from "@vercel/node";
import type Stripe from "stripe";
import { getStripe } from "../_lib/stripe.js";
import { getSupabaseAdmin } from "../_lib/supabaseAdmin.js";
import { ServerEnv } from "../_lib/env.js";
import { readRawBody } from "../_lib/http.js";
import { sendOrderConfirmation, sendOrderAdminNotification } from "../_lib/orderConfirmation.js";

// POST /api/webhooks/stripe
//
// The ONLY place a Stripe-paid order becomes "paid". Never trust a browser
// success page. Steps:
//   1. Verify the Stripe signature against STRIPE_WEBHOOK_SECRET (raw body).
//   2. Idempotency: if this event id is already in payment_events, it was
//      fully handled before — ack and stop.
//   3. On payment_intent.succeeded: mark_order_paid(order_id), then the
//      confirmation + staff emails. All of these are idempotent.
//   4. Only AFTER that succeeds, record the event in payment_events.
//
// Recording last matters: if marking the order paid fails we return 500 and
// Stripe's retry actually re-runs it. (Recording first — as this handler
// used to — turned every retry into a "duplicate" no-op, leaving a charged
// customer with an unpaid order.)
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

  const { data: seen, error: seenErr } = await db
    .from("payment_events")
    .select("event_id")
    .eq("event_id", event.id)
    .maybeSingle();
  if (seenErr) {
    console.error("[stripe] payment_events lookup failed", seenErr);
    return res.status(500).json({ ok: false });
  }
  if (seen) return res.status(200).json({ ok: true, deduped: true });

  const orderIdFromEvent = extractOrderId(event);

  try {
    if (event.type === "payment_intent.succeeded") {
      const pi = event.data.object as Stripe.PaymentIntent;
      const orderId = pi.metadata?.order_id;
      if (orderId) {
        // Trusted mark-paid in the DB (idempotent: a no-op if already paid).
        const { error: markErr } = await db.rpc("mark_order_paid", {
          p_order_id: orderId,
          p_provider: "stripe",
          p_reference: pi.id,
        });
        if (markErr) {
          console.error("[stripe] mark_order_paid failed", markErr);
          // Not recorded yet, so Stripe's retry will run this again.
          return res.status(500).json({ ok: false });
        }
        // Both emails self-gate on payment_status='paid' and are idempotent
        // (keyed per order), so a retry can't send duplicates. A failure
        // must not fail the webhook — the order is already paid.
        try {
          await sendOrderConfirmation(orderId);
        } catch (mailErr) {
          console.error("[stripe] confirmation email failed", mailErr);
        }
        try {
          await sendOrderAdminNotification(orderId);
        } catch (mailErr) {
          console.error("[stripe] admin notification email failed", mailErr);
        }
      }
    }
    // Other event types are recorded (for audit) and acked without action.
  } catch (err) {
    console.error("[stripe] handler error", err);
    return res.status(500).json({ ok: false });
  }

  // Serialize to a plain JSON value for the jsonb payload column.
  const payloadJson = JSON.parse(JSON.stringify(event));
  const { error: insertErr } = await db.from("payment_events").insert({
    event_id: event.id,
    event_type: event.type,
    provider: "stripe",
    order_id: orderIdFromEvent,
    payload: payloadJson,
  });
  // 23505 = a concurrent delivery of the same event recorded it first; the
  // work above is idempotent, so that's fine. Anything else: the event was
  // handled, only the audit row failed — don't make Stripe retry.
  if (insertErr && insertErr.code !== "23505") {
    console.error("[stripe] payment_events insert error", insertErr);
  }
  return res.status(200).json({ ok: true });
}

function extractOrderId(event: Stripe.Event): string | null {
  const obj = event.data.object as { metadata?: Record<string, string> };
  return obj?.metadata?.order_id ?? null;
}
