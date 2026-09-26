import * as React from "react";
import { getSupabaseAdmin } from "./supabaseAdmin.js";
import { notifyStaff, shortName } from "./staffPush.js";
import { sendTrackedEmail, type SendEmailResult } from "./emailService.js";
import { SELL_PHOTOS_BUCKET } from "./sell.js";
import { ServerEnv } from "./env.js";
import { logoUrl, siteUrl } from "./assets.js";
import {
  ReferralLeadAdminNotification,
  referralLeadAdminSubject,
  referralLeadAdminText,
  type ReferralLeadAdminEmailData,
} from "./emails/ReferralLeadAdminNotification.js";
import {
  ReferralLeadConfirmation,
  referralLeadConfirmationSubject,
  referralLeadConfirmationText,
  type ReferralLeadConfirmationData,
} from "./emails/ReferralLeadConfirmation.js";
import {
  REFERRAL_CONTACT_METHODS,
  REFERRAL_HANDOFF_OPTIONS,
  REFERRAL_SIZE_OPTIONS,
  optionLabel,
  referralCategoryLabel,
} from "../../src/store/lib/referralTypes.js";

// Emails for /api/referral-leads. Same trust model as sellSubmissionEmails:
// both functions take only a lead id and load everything from the database
// server-side, and sendTrackedEmail's idempotency key means a retried request
// can never send either email twice. Callers treat failures as best-effort.

/** Photo links in the staff email are signed (the bucket is private) and expire. */
export const REFERRAL_PHOTO_LINK_DAYS = 7;

type Result = SendEmailResult | { status: "skipped"; reason: string };

/** "Pokémon cards and video games & consoles" */
function categoriesLabel(categories: string[]): string {
  const labels = categories.map(referralCategoryLabel);
  if (labels.length <= 1) return labels.join("");
  return `${labels.slice(0, -1).join(", ")} and ${labels[labels.length - 1]}`;
}

async function loadLead(leadId: string) {
  const { data, error } = await getSupabaseAdmin()
    .from("referral_leads")
    .select(
      "id, reference_number, categories, description, collection_size, handoff, first_name, last_name, email, phone, preferred_contact_method, location, photo_paths",
    )
    .eq("id", leadId)
    .single();
  return error ? null : data;
}

export async function sendReferralLeadAdminNotification(leadId: string): Promise<Result> {
  const lead = await loadLead(leadId);
  if (!lead) return { status: "skipped", reason: "lead-not-found" };

  let photoUrls: string[] = [];
  if (lead.photo_paths.length > 0) {
    const { data: signed } = await getSupabaseAdmin()
      .storage.from(SELL_PHOTOS_BUCKET)
      .createSignedUrls(lead.photo_paths, REFERRAL_PHOTO_LINK_DAYS * 24 * 60 * 60);
    photoUrls = (signed ?? []).map((s) => s.signedUrl).filter((u): u is string => Boolean(u));
  }

  const data: ReferralLeadAdminEmailData = {
    referenceNumber: lead.reference_number,
    categoriesLabel: categoriesLabel(lead.categories),
    sellerName: [lead.first_name, lead.last_name].filter(Boolean).join(" "),
    email: lead.email,
    phone: lead.phone,
    preferredContact: optionLabel(REFERRAL_CONTACT_METHODS, lead.preferred_contact_method) ?? "Email",
    location: lead.location,
    sizeLabel: optionLabel(REFERRAL_SIZE_OPTIONS, lead.collection_size),
    handoffLabel: optionLabel(REFERRAL_HANDOFF_OPTIONS, lead.handoff === "not_sure" ? null : lead.handoff),
    description: lead.description,
    photoUrls,
    photoLinkDays: REFERRAL_PHOTO_LINK_DAYS,
    siteUrl: siteUrl(),
    logoUrl: logoUrl(),
    supportEmail: ServerEnv.replyTo(),
  };

  const photoCount = lead.photo_paths.length;
  await notifyStaff({
    key: `partner_lead:${lead.id}`,
    kind: "partner_lead",
    title: `New partner lead · ${data.categoriesLabel}`,
    body: [
      shortName(lead.first_name, lead.last_name),
      data.handoffLabel,
      photoCount ? `${photoCount} photo${photoCount === 1 ? "" : "s"}` : null,
      lead.location,
    ]
      .filter(Boolean)
      .join(" · "),
    url: `/admin_dashboard/partner-leads?lead=${lead.id}`,
    tag: `partner_lead:${lead.id}`,
  });

  return sendTrackedEmail({
    emailType: "referral_lead_admin_notification",
    idempotencyKey: `referral-lead-admin-notification-${lead.id}`,
    to: ServerEnv.sellLeadsNotificationEmail(),
    from: ServerEnv.fromOrders(),
    // Reply goes straight to the seller; forwarding goes to the partner.
    replyTo: lead.email,
    subject: referralLeadAdminSubject(data),
    react: React.createElement(ReferralLeadAdminNotification, data),
    text: referralLeadAdminText(data),
  });
}

export async function sendReferralLeadConfirmation(leadId: string): Promise<Result> {
  const lead = await loadLead(leadId);
  if (!lead) return { status: "skipped", reason: "lead-not-found" };

  const data: ReferralLeadConfirmationData = {
    firstName: lead.first_name,
    referenceNumber: lead.reference_number,
    categoriesLabel: categoriesLabel(lead.categories),
    preferredContact: optionLabel(REFERRAL_CONTACT_METHODS, lead.preferred_contact_method) ?? "Email",
    siteUrl: siteUrl(),
    logoUrl: logoUrl(),
    supportEmail: ServerEnv.replyTo(),
  };

  return sendTrackedEmail({
    emailType: "referral_lead_confirmation",
    idempotencyKey: `referral-lead-confirmation-${lead.id}`,
    to: lead.email,
    from: ServerEnv.fromOrders(),
    replyTo: ServerEnv.replyTo(),
    subject: referralLeadConfirmationSubject(data),
    react: React.createElement(ReferralLeadConfirmation, data),
    text: referralLeadConfirmationText(data),
  });
}
