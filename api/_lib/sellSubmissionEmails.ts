import * as React from "react";
import { getSupabaseAdmin } from "./supabaseAdmin.js";
import { sendTrackedEmail, type SendEmailResult } from "./emailService.js";
import {
  SellSubmissionConfirmation,
  sellSubmissionConfirmationText,
  type SellSubmissionEmailData,
} from "./emails/SellSubmissionConfirmation.js";
import {
  SellSubmissionAdminNotification,
  sellSubmissionAdminNotificationText,
  type SellSubmissionAdminEmailData,
} from "./emails/SellSubmissionAdminNotification.js";
import {
  SellSubmissionStatusUpdate,
  sellSubmissionStatusUpdateSubject,
  sellSubmissionStatusUpdateText,
  type NotifiableSellStatus,
  type SellSubmissionStatusEmailData,
} from "./emails/SellSubmissionStatusUpdate.js";
import { ServerEnv } from "./env.js";
import { logoUrl, siteUrl } from "./assets.js";

const NOTIFIABLE_SELL_STATUSES: ReadonlySet<string> = new Set([
  "needs_more_photos",
  "needs_in_person_review",
  "contacted",
  "offer_made",
  "accepted",
  "declined",
  "completed",
]);

export function isNotifiableSellStatus(status: string): status is NotifiableSellStatus {
  return NOTIFIABLE_SELL_STATUSES.has(status);
}

// Both functions accept ONLY a submission id and load everything else from
// Supabase server-side — never browser-supplied details — mirroring
// sendOrderConfirmation's trust model exactly. Idempotent via
// sendTrackedEmail's idempotency-key + email_deliveries unique constraint, so
// a retried /api/sell/submit request (or a retried call to these functions)
// can never send either email twice. A failure here is caught by the caller
// and never rolls back or corrupts the already-stored submission.

const COLLECTION_SIZE_LABELS: Record<string, string> = {
  under_100: "Under 100 cards",
  "100_to_500": "100–500 cards",
  "500_to_1000": "500–1,000 cards",
  "1000_to_5000": "1,000–5,000 cards",
  "5000_to_10000": "5,000–10,000 cards",
  "10000_plus": "10,000+ cards",
  not_sure: "Not sure",
};

export async function sendSellSubmissionConfirmation(
  submissionId: string,
): Promise<SendEmailResult | { status: "skipped"; reason: string }> {
  const db = getSupabaseAdmin();

  const { data: submission, error } = await db
    .from("sell_submissions")
    .select("id, first_name, email, reference_number, notes")
    .eq("id", submissionId)
    .single();
  if (error || !submission) {
    return { status: "skipped", reason: "submission-not-found" };
  }

  const [{ count: cardCount }, { count: photoCount }] = await Promise.all([
    db
      .from("sell_submission_cards")
      .select("id", { count: "exact", head: true })
      .eq("submission_id", submissionId),
    db
      .from("sell_submission_photos")
      .select("id", { count: "exact", head: true })
      .eq("submission_id", submissionId),
  ]);

  const data: SellSubmissionEmailData = {
    firstName: submission.first_name,
    referenceNumber: submission.reference_number,
    cardCount: cardCount ?? 0,
    photoCount: photoCount ?? 0,
    hasCollectionDescription: Boolean(submission.notes?.trim()),
    siteUrl: siteUrl(),
    logoUrl: logoUrl(),
    supportEmail: ServerEnv.replyTo(),
  };

  return sendTrackedEmail({
    emailType: "sell_submission_confirmation",
    idempotencyKey: `sell-submission-confirmation-${submission.id}`,
    to: submission.email,
    from: ServerEnv.fromOrders(),
    replyTo: ServerEnv.replyTo(),
    subject: `We received your collection — ${submission.reference_number}`,
    react: React.createElement(SellSubmissionConfirmation, data),
    text: sellSubmissionConfirmationText(data),
  });
}

export async function sendSellSubmissionAdminNotification(
  submissionId: string,
): Promise<SendEmailResult | { status: "skipped"; reason: string }> {
  const db = getSupabaseAdmin();

  const { data: submission, error } = await db
    .from("sell_submissions")
    .select(
      "id, first_name, last_name, city, state, collection_size, estimated_value_cents, reference_number",
    )
    .eq("id", submissionId)
    .single();
  if (error || !submission) {
    return { status: "skipped", reason: "submission-not-found" };
  }

  const [{ count: cardCount }, { count: photoCount }] = await Promise.all([
    db
      .from("sell_submission_cards")
      .select("id", { count: "exact", head: true })
      .eq("submission_id", submissionId),
    db
      .from("sell_submission_photos")
      .select("id", { count: "exact", head: true })
      .eq("submission_id", submissionId),
  ]);

  const location = [submission.city, submission.state].filter(Boolean).join(", ") || null;

  const data: SellSubmissionAdminEmailData = {
    referenceNumber: submission.reference_number,
    sellerName: `${submission.first_name} ${submission.last_name}`.trim(),
    location,
    collectionSizeLabel: submission.collection_size
      ? (COLLECTION_SIZE_LABELS[submission.collection_size] ?? submission.collection_size)
      : null,
    cardCount: cardCount ?? 0,
    photoCount: photoCount ?? 0,
    estimatedValueCents: submission.estimated_value_cents,
    adminUrl: `${siteUrl()}/admin_dashboard/buying-leads?submission=${submission.id}`,
    siteUrl: siteUrl(),
    logoUrl: logoUrl(),
    supportEmail: ServerEnv.replyTo(),
  };

  return sendTrackedEmail({
    emailType: "sell_submission_admin_notification",
    idempotencyKey: `sell-submission-admin-notification-${submission.id}`,
    to: ServerEnv.sellLeadsNotificationEmail(),
    from: ServerEnv.fromOrders(),
    subject: `New buying lead — ${submission.reference_number}`,
    react: React.createElement(SellSubmissionAdminNotification, data),
    text: sellSubmissionAdminNotificationText(data),
  });
}

// Sends the status-update email to the seller (needs more photos, needs
// in-person review, contacted, offer made, accepted, declined, completed).
// Same trust model and idempotency pattern as the confirmation emails above.
//
// Preference gating: a signed-in seller's profiles.sell_submission_notifications
// (enabled) controls whether this actually sends. Guest submissions (no
// user_id) have no profile to opt out from, so they always receive status
// emails for their own submission — there is no other way for a guest to
// find out.
export async function sendSellSubmissionStatusUpdate(
  submissionId: string,
  status: NotifiableSellStatus,
): Promise<SendEmailResult | { status: "skipped"; reason: string }> {
  const db = getSupabaseAdmin();

  const { data: submission, error } = await db
    .from("sell_submissions")
    .select("id, first_name, email, user_id, reference_number")
    .eq("id", submissionId)
    .single();
  if (error || !submission) {
    return { status: "skipped", reason: "submission-not-found" };
  }

  if (submission.user_id) {
    const { data: profile } = await db
      .from("profiles")
      .select("sell_submission_notifications")
      .eq("id", submission.user_id)
      .maybeSingle();
    const prefs = profile?.sell_submission_notifications as { enabled?: boolean } | null;
    if (profile && prefs?.enabled !== true) {
      return { status: "skipped", reason: "notifications-disabled" };
    }
  }

  const data: SellSubmissionStatusEmailData = {
    status,
    firstName: submission.first_name,
    referenceNumber: submission.reference_number,
    siteUrl: siteUrl(),
    logoUrl: logoUrl(),
    supportEmail: ServerEnv.replyTo(),
  };

  return sendTrackedEmail({
    emailType: `sell_submission_${status}`,
    idempotencyKey: `sell-submission-${status}-${submission.id}`,
    to: submission.email,
    from: ServerEnv.fromOrders(),
    replyTo: ServerEnv.replyTo(),
    subject: sellSubmissionStatusUpdateSubject(data),
    react: React.createElement(SellSubmissionStatusUpdate, data),
    text: sellSubmissionStatusUpdateText(data),
  });
}
