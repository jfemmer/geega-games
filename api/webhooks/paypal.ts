import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getSupabaseAdmin } from "../_lib/supabaseAdmin.js";
import { readRawBody } from "../_lib/http.js";
import { verifyPayPalWebhook, type PayPalCapture, type PayPalOrder } from "../_lib/paypal.js";
import { applyCapture, finalizePayPalCheckout } from "../_lib/paypalCheckout.js";

// POST /api/webhooks/paypal
//
// The server-to-server backstop for PayPal / Venmo payments. The checkout
// page normally captures and finalizes in-session (api/checkout/paypal.ts);
// this makes the outcome independent of the buyer's browser:
//   - CHECKOUT.ORDER.APPROVED    → capture + mark paid if the tab closed
//                                  right after approval.
//   - PAYMENT.CAPTURE.COMPLETED  → mark paid (incl. PENDING captures that
//                                  clear later, e.g. eCheck).
//   - PAYMENT.CAPTURE.DENIED     → a pending capture failed; flag the order.
// Everything else is recorded in payment_events for audit and acked.
//
// Idempotency: all handlers are idempotent, and the event is recorded in
// payment_events only AFTER it was handled successfully — so a failed attempt
// returns 500 and PayPal's retry actually re-runs it (instead of being
// deduped away), while a successful event is never processed twice.
export const config = { api: { bodyParser: false } };

type WebhookEvent = {
  id: string;
  event_type: string;
  resource?: Record<string, unknown>;
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, message: "Method not allowed." });
  }

  let event: WebhookEvent;
  try {
    event = JSON.parse(await readRawBody(req, 1024 * 1024)) as WebhookEvent;
  } catch {
    return res.status(400).json({ ok: false, message: "Bad body." });
  }
  if (!event?.id || !event.event_type) {
    return res.status(400).json({ ok: false, message: "Bad event." });
  }

  try {
    if (!(await verifyPayPalWebhook(req.headers, event))) {
      return res.status(400).json({ ok: false, message: "Invalid signature." });
    }
  } catch (err) {
    // Couldn't reach PayPal to verify — let PayPal retry later.
    console.error("[paypal-webhook] verification error", err);
    return res.status(500).json({ ok: false });
  }

  const db = getSupabaseAdmin();
  const { data: seen } = await db
    .from("payment_events")
    .select("event_id")
    .eq("event_id", event.id)
    .maybeSingle();
  if (seen) return res.status(200).json({ ok: true, deduped: true });

  let orderId: string | null = null;
  try {
    const resource = event.resource ?? {};
    switch (event.event_type) {
      case "CHECKOUT.ORDER.APPROVED": {
        const order = resource as unknown as PayPalOrder;
        orderId = order.purchase_units?.[0]?.custom_id ?? null;
        if (order.id) {
          const result = await finalizePayPalCheckout(order.id, { buyer: null });
          orderId = result.orderId ?? orderId;
          if (result.outcome === "rejected") {
            console.warn("[paypal-webhook] approved order not captured", { orderId, reason: result.reason });
          }
        }
        break;
      }
      case "PAYMENT.CAPTURE.COMPLETED": {
        const capture = resource as unknown as PayPalCapture;
        orderId = capture.custom_id ?? null;
        if (orderId) {
          const result = await applyCapture(orderId, capture);
          if (result.outcome === "rejected") {
            console.error("[paypal-webhook] completed capture not applied", { orderId, reason: result.reason });
          }
        }
        break;
      }
      case "PAYMENT.CAPTURE.DENIED": {
        const capture = resource as unknown as PayPalCapture;
        orderId = capture.custom_id ?? null;
        if (orderId && capture.id) {
          await db
            .from("orders")
            .update({ payment_status: "failed" })
            .eq("id", orderId)
            .eq("payment_reference", capture.id)
            .eq("payment_status", "processing");
        }
        break;
      }
      default: {
        const r = resource as { custom_id?: string };
        orderId = typeof r.custom_id === "string" ? r.custom_id : null;
      }
    }
  } catch (err) {
    console.error("[paypal-webhook] handler error", { type: event.event_type, id: event.id, err });
    return res.status(500).json({ ok: false });
  }

  const { error: insertErr } = await db.from("payment_events").insert({
    event_id: event.id,
    event_type: event.event_type,
    provider: "paypal",
    order_id: orderId && /^[0-9a-f-]{36}$/i.test(orderId) ? orderId : null,
    payload: JSON.parse(JSON.stringify(event)),
  });
  if (insertErr && insertErr.code !== "23505") {
    // Handled fine; only the audit row failed. Don't make PayPal retry.
    console.error("[paypal-webhook] payment_events insert error", insertErr);
  }
  return res.status(200).json({ ok: true });
}
