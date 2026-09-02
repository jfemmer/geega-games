import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getResend } from "../_lib/resend.js";
import { getSupabaseAdmin } from "../_lib/supabaseAdmin.js";
import { ServerEnv } from "../_lib/env.js";
import { readRawBody } from "../_lib/http.js";

// Vercel must NOT parse the body: signature verification needs the exact raw
// bytes. This config disables the built-in body parser for this function.
export const config = { api: { bodyParser: false } };

// POST /api/webhooks/resend
// Verifies the Svix signature via the official Resend SDK, then updates
// email_deliveries and (for marketing emails) subscriber status. Idempotent:
// repeated deliveries of the same event converge to the same state.
export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, message: "Method not allowed." });
  }

  let payload: string;
  try {
    payload = await readRawBody(req, 256 * 1024);
  } catch {
    return res.status(400).json({ ok: false, message: "Bad body." });
  }

  // Verify signature. Throws on any tampering/invalid signature.
  let event: ResendWebhookEvent;
  try {
    const resend = getResend();
    event = resend.webhooks.verify({
      payload,
      headers: {
        id: header(req, "svix-id"),
        timestamp: header(req, "svix-timestamp"),
        signature: header(req, "svix-signature"),
      },
      webhookSecret: ServerEnv.resendWebhookSecret(),
    }) as ResendWebhookEvent;
  } catch {
    return res.status(400).json({ ok: false, message: "Invalid signature." });
  }

  try {
    await applyEvent(event);
  } catch (err) {
    console.error("[/api/webhooks/resend] apply error:", err);
    // Return 500 so Resend retries; our updates are idempotent.
    return res.status(500).json({ ok: false });
  }

  return res.status(200).json({ ok: true });
}

// ---------------------------------------------------------------------------
type ResendWebhookEvent = {
  type: string;
  data?: {
    email_id?: string;
    to?: string | string[];
    // Some event types include a bounce/complaint sub-object.
    bounce?: { type?: string; message?: string };
    reason?: string;
  };
};

import type { Database } from "../../src/types/database.js";

type DeliveryStatus = Database["public"]["Enums"]["email_delivery_status"];
type SubscriberStatus = Database["public"]["Enums"]["subscriber_status"];

const nowIso = () => new Date().toISOString();

async function applyEvent(event: ResendWebhookEvent): Promise<void> {
  const db = getSupabaseAdmin();
  const emailId = event.data?.email_id;
  if (!emailId) return; // nothing to correlate

  // Map Resend event type -> delivery status + timestamp column.
  const map: Record<
    string,
    {
      status: DeliveryStatus;
      column: string;
      marketingEffect?: "bounce" | "complaint" | "suppress";
    }
  > = {
    "email.delivered": { status: "delivered", column: "delivered_at" },
    "email.bounced": { status: "bounced", column: "bounced_at", marketingEffect: "bounce" },
    "email.complained": { status: "complained", column: "complained_at", marketingEffect: "complaint" },
    "email.delivery_delayed": { status: "delivery_delayed", column: "sent_at" },
    "email.failed": { status: "failed", column: "failed_at" },
    "email.sent": { status: "sent", column: "sent_at" },
  };
  // Some accounts emit "email.suppressed".
  map["email.suppressed"] = { status: "suppressed", column: "suppressed_at", marketingEffect: "suppress" };

  const entry = map[event.type];
  if (!entry) return; // ignore unrelated events

  // Update the delivery row keyed by Resend email id. Idempotent: setting the
  // same status/timestamp again is harmless.
  const patch: Database["public"]["Tables"]["email_deliveries"]["Update"] = {
    status: entry.status,
    error_detail: event.data?.bounce?.message ?? event.data?.reason ?? null,
  };
  // Set the appropriate timestamp column for this event type.
  (patch as Record<string, string>)[entry.column] = nowIso();

  const { data: delivery } = await db
    .from("email_deliveries")
    .update(patch)
    .eq("resend_email_id", emailId)
    .select("id, email_type, subscriber_id")
    .maybeSingle();

  if (!delivery || !entry.marketingEffect) return;

  // Only marketing emails may flip subscriber status. Transactional order
  // emails must never unsubscribe anyone.
  const isMarketing =
    delivery.email_type === "confirm_subscription" ||
    delivery.email_type === "subscription_confirmed";
  if (!isMarketing || !delivery.subscriber_id) return;

  const newStatus: SubscriberStatus =
    entry.marketingEffect === "bounce"
      ? "bounced"
      : entry.marketingEffect === "complaint"
        ? "complained"
        : "suppressed";

  await db
    .from("newsletter_subscribers")
    .update({
      status: newStatus,
      last_bounce_reason:
        event.data?.bounce?.message ?? event.data?.reason ?? null,
    })
    .eq("id", delivery.subscriber_id);
}

function header(req: VercelRequest, name: string): string {
  const v = req.headers[name];
  return Array.isArray(v) ? (v[0] ?? "") : (v ?? "");
}
