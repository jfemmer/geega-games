import * as React from "react";
import { getSupabaseAdmin } from "./supabaseAdmin.js";
import { generateToken, hashToken, safeEqualHex } from "./tokens.js";
import { sendTrackedEmail } from "./emailService.js";
import {
  ConfirmSubscription,
  confirmSubscriptionText,
} from "./emails/ConfirmSubscription.js";
import {
  SubscriptionConfirmed,
  subscriptionConfirmedText,
} from "./emails/SubscriptionConfirmed.js";
import { ServerEnv } from "./env.js";
import { logoUrl, siteUrl } from "./assets.js";

const CONFIRM_TTL_HOURS = 48;
// Do not re-send a confirmation email more than once per this window.
const RESEND_COOLDOWN_MS = 10 * 60 * 1000; // 10 minutes

type SubscribeOutcome =
  | "confirmation_sent" // new pending subscriber, email sent
  | "already_active" // already confirmed; we stay silent about this externally
  | "cooldown"; // pending + recently emailed; skip re-send

// Create or update a subscriber and (if appropriate) send a confirmation email.
// The caller must not leak which branch happened to the client.
export async function subscribe(
  email: string,
  source: string,
): Promise<SubscribeOutcome> {
  const db = getSupabaseAdmin();

  const { data: existing } = await db
    .from("newsletter_subscribers")
    .select("id, status, confirmation_sent_at")
    .eq("email", email)
    .maybeSingle();

  // Already active/confirmed: do nothing (don't re-email, don't reveal).
  if (existing && existing.status === "active") {
    return "already_active";
  }

  const token = generateToken();
  const tokenHash = hashToken(token);
  const now = new Date();
  const expires = new Date(now.getTime() + CONFIRM_TTL_HOURS * 3600 * 1000);

  if (existing) {
    // Cooldown: pending/unsubscribed/etc. but emailed very recently -> skip.
    if (
      existing.confirmation_sent_at &&
      now.getTime() - new Date(existing.confirmation_sent_at).getTime() <
        RESEND_COOLDOWN_MS &&
      existing.status === "pending"
    ) {
      return "cooldown";
    }

    // Re-arm a fresh pending confirmation (covers previously unsubscribed too).
    const { error: updateError } = await db
      .from("newsletter_subscribers")
      .update({
        status: "pending",
        source,
        confirmation_token_hash: tokenHash,
        confirmation_sent_at: now.toISOString(),
        confirmation_expires_at: expires.toISOString(),
        confirmed_at: null,
        unsubscribed_at: null,
      })
      .eq("id", existing.id);
    if (updateError) {
      throw new Error(`subscriber update failed: ${updateError.message}`);
    }
  } else {
    const { error: insertError } = await db
      .from("newsletter_subscribers")
      .insert({
        email,
        status: "pending",
        source,
        confirmation_token_hash: tokenHash,
        confirmation_sent_at: now.toISOString(),
        confirmation_expires_at: expires.toISOString(),
      });
    if (insertError) {
      throw new Error(`subscriber insert failed: ${insertError.message}`);
    }
  }

  // Look up id for delivery linkage.
  const { data: row } = await db
    .from("newsletter_subscribers")
    .select("id")
    .eq("email", email)
    .single();

  const confirmUrl = `${siteUrl()}/api/confirm?token=${encodeURIComponent(token)}`;

  // Idempotency key includes the token hash so each new confirmation attempt is
  // a distinct trackable send, but a double-submit within the same attempt is
  // still deduped.
  await sendTrackedEmail({
    emailType: "confirm_subscription",
    idempotencyKey: `confirm-subscription-${tokenHash.slice(0, 32)}`,
    to: email,
    from: ServerEnv.fromMarketing(),
    replyTo: ServerEnv.replyTo(),
    subject: "Confirm your email — Geega Games",
    react: React.createElement(ConfirmSubscription, {
      confirmUrl,
      siteUrl: siteUrl(),
      logoUrl: logoUrl(),
      supportEmail: ServerEnv.replyTo(),
      expiresInHours: CONFIRM_TTL_HOURS,
    }),
    text: confirmSubscriptionText({
      confirmUrl,
      siteUrl: siteUrl(),
      logoUrl: logoUrl(),
      supportEmail: ServerEnv.replyTo(),
      expiresInHours: CONFIRM_TTL_HOURS,
    }),
    subscriberId: row?.id ?? null,
  });

  return "confirmation_sent";
}

type ConfirmOutcome = "confirmed" | "already_active" | "invalid" | "expired";

// Validate a confirmation token and activate the subscriber.
export async function confirm(token: string): Promise<ConfirmOutcome> {
  if (!token || token.length < 16) return "invalid";
  const db = getSupabaseAdmin();
  const tokenHash = hashToken(token);

  const { data: row } = await db
    .from("newsletter_subscribers")
    .select(
      "id, email, status, confirmation_token_hash, confirmation_expires_at",
    )
    .eq("confirmation_token_hash", tokenHash)
    .maybeSingle();

  if (!row || !row.confirmation_token_hash) return "invalid";
  // Constant-time compare (defensive; the lookup already matched the hash).
  if (!safeEqualHex(row.confirmation_token_hash, tokenHash)) return "invalid";

  if (row.status === "active") return "already_active";

  if (
    row.confirmation_expires_at &&
    new Date(row.confirmation_expires_at).getTime() < Date.now()
  ) {
    return "expired";
  }

  // Activate + mint an unsubscribe token for future marketing emails.
  const unsubToken = generateToken();
  const unsubHash = hashToken(unsubToken);

  await db
    .from("newsletter_subscribers")
    .update({
      status: "active",
      confirmed_at: new Date().toISOString(),
      confirmation_token_hash: null,
      confirmation_expires_at: null,
      unsubscribe_token_hash: unsubHash,
    })
    .eq("id", row.id);

  const unsubscribeUrl = `${siteUrl()}/api/unsubscribe?token=${encodeURIComponent(unsubToken)}`;

  await sendTrackedEmail({
    emailType: "subscription_confirmed",
    idempotencyKey: `subscription-confirmed-${row.id}`,
    to: row.email,
    from: ServerEnv.fromMarketing(),
    replyTo: ServerEnv.replyTo(),
    subject: "You’re on the list — Geega Games",
    react: React.createElement(SubscriptionConfirmed, {
      siteUrl: siteUrl(),
      logoUrl: logoUrl(),
      supportEmail: ServerEnv.replyTo(),
      unsubscribeUrl,
    }),
    text: subscriptionConfirmedText({
      siteUrl: siteUrl(),
      logoUrl: logoUrl(),
      supportEmail: ServerEnv.replyTo(),
      unsubscribeUrl,
    }),
    subscriberId: row.id,
  });

  return "confirmed";
}

type UnsubOutcome = "unsubscribed" | "invalid";

export async function unsubscribe(token: string): Promise<UnsubOutcome> {
  if (!token || token.length < 16) return "invalid";
  const db = getSupabaseAdmin();
  const tokenHash = hashToken(token);

  const { data: row } = await db
    .from("newsletter_subscribers")
    .select("id, unsubscribe_token_hash")
    .eq("unsubscribe_token_hash", tokenHash)
    .maybeSingle();

  if (!row) return "invalid";

  await db
    .from("newsletter_subscribers")
    .update({
      status: "unsubscribed",
      unsubscribed_at: new Date().toISOString(),
    })
    .eq("id", row.id);

  return "unsubscribed";
}