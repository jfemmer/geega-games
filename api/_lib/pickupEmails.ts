import * as React from "react";
import { getSupabaseAdmin } from "./supabaseAdmin.js";
import { sendTrackedEmail, type SendEmailResult } from "./emailService.js";
import { PickupReady, pickupReadyText, type PickupReadyEmailData } from "./emails/PickupReady.js";
import { ServerEnv } from "./env.js";
import { logoUrl, siteUrl } from "./assets.js";

// Sends the pickup-ready email for a kiosk pickup request. Email is optional
// on a pickup request (only phone is required at kiosk submission), so this
// silently skips when none was given — same graceful-degradation pattern as
// a POS sale with no email on file.
export async function sendPickupReadyEmail(
  pickupRequestId: string,
): Promise<SendEmailResult | { status: "skipped"; reason: string }> {
  const db = getSupabaseAdmin();

  const { data: request, error } = await db
    .from("pickup_requests")
    .select("id, customer_name, email, status")
    .eq("id", pickupRequestId)
    .single();
  if (error || !request) {
    return { status: "skipped", reason: "request-not-found" };
  }
  if (!request.email) {
    return { status: "skipped", reason: "no-email" };
  }

  const { count: itemCount } = await db
    .from("pickup_request_items")
    .select("id", { count: "exact", head: true })
    .eq("pickup_request_id", pickupRequestId);

  const data: PickupReadyEmailData = {
    customerName: request.customer_name,
    itemCount: itemCount ?? 0,
    siteUrl: siteUrl(),
    logoUrl: logoUrl(),
    supportEmail: ServerEnv.replyTo(),
  };

  return sendTrackedEmail({
    emailType: "pickup_ready",
    idempotencyKey: `pickup-ready-${request.id}`,
    to: request.email,
    from: ServerEnv.fromOrders(),
    replyTo: ServerEnv.replyTo(),
    subject: "Your order is ready for pickup — Geega Games",
    react: React.createElement(PickupReady, data),
    text: pickupReadyText(data),
  });
}
