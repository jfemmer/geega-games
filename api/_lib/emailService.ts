import * as React from "react";
import { render } from "@react-email/render";
import { getResend } from "./resend.js";
import { getSupabaseAdmin } from "./supabaseAdmin.js";

// A single place that: (1) reserves an idempotency row in email_deliveries,
// (2) renders + sends via Resend with a matching Resend idempotency key,
// (3) records the Resend id and status. Safe to retry: the DB UNIQUE constraint
// on idempotency_key plus Resend's 24h idempotency window prevent duplicates.

export type SendEmailArgs = {
  emailType: string;
  idempotencyKey: string; // also used as the Resend Idempotency-Key
  to: string;
  from: string;
  replyTo?: string;
  subject: string;
  react: React.ReactElement;
  text: string;
  headers?: Record<string, string>;
  subscriberId?: string | null;
  orderId?: string | null;
};

export type SendEmailResult =
  | { status: "sent"; resendEmailId: string | null; deduped: false }
  | { status: "deduped"; deduped: true }
  | { status: "failed"; error: string; deduped: false };

export async function sendTrackedEmail(
  args: SendEmailArgs,
): Promise<SendEmailResult> {
  const db = getSupabaseAdmin();

  // Step 1: try to claim the idempotency key. If it already exists we do not
  // send again — this is the permanent (beyond Resend's 24h) dedup guarantee.
  const { error: insertError } = await db.from("email_deliveries").insert({
    email_type: args.emailType,
    idempotency_key: args.idempotencyKey,
    to_email: args.to,
    subscriber_id: args.subscriberId ?? null,
    order_id: args.orderId ?? null,
    status: "queued",
  });

  if (insertError) {
    // Unique violation => already claimed/sent. Treat as success (deduped).
    if (insertError.code === "23505") {
      return { status: "deduped", deduped: true };
    }
    // Any other DB error: do not send an untracked email.
    return { status: "failed", error: insertError.message, deduped: false };
  }

  // Step 2: render and send.
  const html = await render(args.react);
  const resend = getResend();

  const { data, error } = await resend.emails.send(
    {
      from: args.from,
      to: [args.to],
      replyTo: args.replyTo,
      subject: args.subject,
      html,
      text: args.text,
      headers: args.headers,
    },
    { idempotencyKey: args.idempotencyKey },
  );

  // Step 3: record outcome.
  if (error) {
    await db
      .from("email_deliveries")
      .update({
        status: "failed",
        error_detail: safeError(error),
        failed_at: new Date().toISOString(),
      })
      .eq("idempotency_key", args.idempotencyKey);
    return { status: "failed", error: safeError(error), deduped: false };
  }

  await db
    .from("email_deliveries")
    .update({
      status: "sent",
      resend_email_id: data?.id ?? null,
      sent_at: new Date().toISOString(),
    })
    .eq("idempotency_key", args.idempotencyKey);

  return { status: "sent", resendEmailId: data?.id ?? null, deduped: false };
}

// Only retain a short, non-sensitive description of an error.
function safeError(err: unknown): string {
  if (err && typeof err === "object" && "message" in err) {
    return String((err as { message: unknown }).message).slice(0, 500);
  }
  return String(err).slice(0, 500);
}
