import * as React from "react";
import { createHash } from "node:crypto";
import { getSupabaseAdmin } from "./supabaseAdmin.js";
import { HttpError } from "./http.js";
import { ServerEnv } from "./env.js";
import { logoUrl, siteUrl } from "./assets.js";
import { sendTrackedEmail } from "./emailService.js";
import { notifyStaff } from "./staffPush.js";
import { hashInviteToken, isWellFormedToken, newInviteToken } from "./consignments.js";
import { buildPartnerAgreementPdf } from "./partnerAgreementPdf.js";
import { ensurePartnerReferralCode } from "./partners.js";
import { sendPartnerApprovedEmail } from "./partnerEmails.js";
import {
  PartnerAgreementInvite,
  PartnerAgreementSigned,
  partnerAgreementInviteSubject,
  partnerAgreementInviteText,
  partnerAgreementSignedSubject,
  partnerAgreementSignedText,
} from "./emails/PartnerEmails.js";
import {
  PARTNER_AGREEMENT_ACKS,
  PARTNER_AGREEMENT_INVITE_DAYS,
  PARTNER_AGREEMENT_TITLE,
  PARTNER_AGREEMENT_VERSION,
  formatFeePercent,
  renderPartnerAgreement,
} from "../../src/store/lib/partnerAgreement.js";
import type { PartnerKind } from "../../src/store/lib/partnerTypes.js";

// Server side of partner agreements (see the partner_agreements migration):
//
//   sendPartnerAgreement     render the agreement for the partner's kind and
//                            fee, freeze it (voiding any open one) and email the
//                            signing link. The link's secret is stored only as
//                            a hash, so a resend makes a new link.
//   agreementForToken        the open agreement behind a signing link
//   completeSigning          after partner_sign_agreement(): their referral
//                            code and welcome (if they just went live), the
//                            signed PDF (stored privately, emailed to them),
//                            and a heads-up to staff
//   signedAgreementFor       a partner's signed agreement, if any: referral
//                            fees and store leads need one

type Admin = ReturnType<typeof getSupabaseAdmin>;

export const PARTNER_AGREEMENT_BUCKET = "partner-agreements";
const PDF_LINK_SECONDS = 5 * 60;

export const partnerSignUrl = (token: string) => `${siteUrl()}/partner-agreement?t=${encodeURIComponent(token)}`;

/** Database error codes from the partner agreement functions, as HTTP statuses. */
export function partnerAgreementDbError(error: { code?: string; message?: string } | null, fallback: string): HttpError {
  const code = error?.code ?? "";
  if (/^GP0[01][0-9]$/.test(code)) {
    const status = code === "GP010" || code === "GP013" ? 404 : code === "GP017" || code === "GP018" ? 400 : code === "GP015" ? 410 : 409;
    return new HttpError(status, error?.message ?? fallback);
  }
  return new HttpError(500, fallback);
}

function longDate(d: Date): string {
  return d.toLocaleDateString("en-US", { timeZone: "America/Chicago", month: "long", day: "numeric", year: "numeric" });
}

function branding() {
  return { siteUrl: siteUrl(), logoUrl: logoUrl(), supportEmail: ServerEnv.replyTo() };
}

// ---------------------------------------------------------------- sending

export interface SendAgreementResult {
  agreementId: string;
  emailed: boolean;
  /** For staff to copy when the email didn't go out. */
  signUrl: string;
}

export async function sendPartnerAgreement(
  admin: Admin,
  partnerId: string,
  actor: { userId: string | null; email: string | null },
): Promise<SendAgreementResult> {
  const { data: partner, error } = await admin
    .from("partners")
    .select("id, kind, status, business_name, contact_name, email, city, state, fee_percent")
    .eq("id", partnerId)
    .maybeSingle();
  if (error) throw new HttpError(500, "Could not load the partner.");
  if (!partner) throw new HttpError(404, "Partner not found.");
  const kind = partner.kind as PartnerKind;
  const sentAt = new Date();
  const feePercent = Number(partner.fee_percent);

  let rendered: string;
  try {
    rendered = renderPartnerAgreement({
      kind,
      businessName: partner.business_name,
      contactName: partner.contact_name,
      email: partner.email,
      location: [partner.city, partner.state].filter(Boolean).join(", ") || null,
      feePercent,
      sentAt: sentAt.toISOString(),
      supportEmail: ServerEnv.replyTo(),
    });
  } catch (e) {
    throw new HttpError(409, e instanceof Error ? e.message : "The agreement couldn't be filled in.");
  }

  const { token, hash } = newInviteToken();
  const expires = new Date(sentAt.getTime() + PARTNER_AGREEMENT_INVITE_DAYS * 86_400_000);
  const { data: agreementId, error: createErr } = await admin.rpc("partner_create_agreement", {
    p_partner_id: partner.id,
    p_kind: kind,
    p_version_number: PARTNER_AGREEMENT_VERSION[kind],
    p_title: PARTNER_AGREEMENT_TITLE[kind],
    p_rendered_md: rendered,
    p_fee_percent: feePercent,
    p_required_acks: PARTNER_AGREEMENT_ACKS[kind].map((a) => a.key),
    p_invited_email: partner.email,
    p_token_hash: hash,
    p_expires_at: expires.toISOString(),
    p_sent_by: actor.userId,
    p_sent_by_email: actor.email,
  });
  if (createErr || !agreementId) throw partnerAgreementDbError(createErr, "Could not create the agreement.");

  const url = partnerSignUrl(token);
  const data = {
    ...branding(),
    contactName: partner.contact_name,
    businessName: partner.business_name,
    kind,
    agreementTitle: PARTNER_AGREEMENT_TITLE[kind],
    feePercentLabel: formatFeePercent(feePercent),
    signUrl: url,
    expiresOn: longDate(expires),
  };
  let emailed = false;
  try {
    const sent = await sendTrackedEmail({
      emailType: "partner_agreement_invite",
      idempotencyKey: `partner-agreement-invite-${agreementId as string}`,
      to: partner.email,
      from: ServerEnv.fromOrders(),
      replyTo: ServerEnv.replyTo(),
      subject: partnerAgreementInviteSubject(data),
      react: React.createElement(PartnerAgreementInvite, data),
      text: partnerAgreementInviteText(data),
    });
    emailed = sent.status === "sent" || sent.status === "deduped";
  } catch (e) {
    console.error("[partnerAgreements] invite email failed", agreementId, e);
  }
  if (emailed) {
    await admin.from("partner_agreements").update({ last_emailed_at: new Date().toISOString() }).eq("id", agreementId as string);
  }
  return { agreementId: agreementId as string, emailed, signUrl: url };
}

// ---------------------------------------------------------------- the signing link

export async function agreementForToken(admin: Admin, token: unknown) {
  const invalid = "That link isn't valid. Use the newest link in your email from Geega Games.";
  if (!isWellFormedToken(token)) throw new HttpError(404, invalid);
  const { data, error } = await admin
    .from("partner_agreements")
    .select("id, partner_id, kind, version_number, title, rendered_md, rendered_sha256, required_acks, status, invite_expires_at, signed_at, signer_legal_name")
    .eq("invite_token_hash", hashInviteToken(token))
    .maybeSingle();
  if (error) throw new HttpError(500, "Could not open the agreement.");
  if (!data) throw new HttpError(404, invalid);
  return data;
}

// ---------------------------------------------------------------- after signing

export interface CompleteSigningResult {
  pdfReady: boolean;
  emailed: boolean;
}

/**
 * Everything after the signature is recorded. Each step is safe to repeat and
 * none undoes the signature: a failure is logged and staff can resend from
 * the admin.
 */
export async function completeSigning(admin: Admin, agreementId: string, activated: boolean): Promise<CompleteSigningResult> {
  const { data: a } = await admin.from("partner_agreements").select("partner_id, kind").eq("id", agreementId).single();
  if (!a) throw new HttpError(404, "That agreement isn't there.");
  if (activated) {
    try {
      if (a.kind === "referrer") await ensurePartnerReferralCode(admin, a.partner_id);
      await sendPartnerApprovedEmail(a.partner_id);
    } catch (e) {
      console.error("[partnerAgreements] activation follow-up failed", agreementId, e);
    }
  }
  let result: CompleteSigningResult = { pdfReady: false, emailed: false };
  try {
    result = await finalizePartnerSignedCopy(admin, agreementId, { activated });
  } catch (e) {
    console.error("[partnerAgreements] signed copy failed", agreementId, e);
  }
  try {
    const { data: p } = await admin.from("partners").select("business_name").eq("id", a.partner_id).single();
    await notifyStaff({
      key: `partner_agreement_signed:${agreementId}`,
      kind: "partner_lead",
      title: "Partner agreement signed",
      body: `${p?.business_name ?? "A partner"}${activated ? " is now active" : ""}`,
      url: `/admin_dashboard/partners?partner=${a.partner_id}`,
      tag: `partner_agreement:${a.partner_id}`,
    });
  } catch (e) {
    console.error("[partnerAgreements] staff notice failed", agreementId, e);
  }
  return result;
}

/**
 * Make (once), store, and email the signed PDF: to the signer, with a copy to
 * the store's leads inbox. Safe to call again: an existing PDF is reused and
 * the email goes once unless resendEmail.
 */
export async function finalizePartnerSignedCopy(
  admin: Admin,
  agreementId: string,
  opts: { resendEmail?: boolean; activated?: boolean } = {},
): Promise<CompleteSigningResult & { pdfSha256: string }> {
  const { data: a, error } = await admin.from("partner_agreements").select("*").eq("id", agreementId).single();
  if (error || !a) throw new HttpError(404, "That agreement isn't there.");
  if (a.status !== "signed" || !a.signed_at || !a.signer_legal_name || !a.typed_signature || !a.record_sha256) {
    throw new HttpError(409, "This agreement hasn't been signed.");
  }
  const { data: partner } = await admin.from("partners").select("business_name").eq("id", a.partner_id).single();
  const businessName = partner?.business_name ?? "Partner";

  let bytes: Uint8Array;
  let pdfSha256 = a.pdf_sha256;
  if (a.pdf_path) {
    const { data: blob, error: dlErr } = await admin.storage.from(PARTNER_AGREEMENT_BUCKET).download(a.pdf_path);
    if (dlErr || !blob) throw new HttpError(500, "Could not load the signed PDF.");
    bytes = new Uint8Array(await blob.arrayBuffer());
  } else {
    bytes = await buildPartnerAgreementPdf({
      kind: a.kind as PartnerKind,
      title: a.title,
      versionNumber: a.version_number,
      businessName,
      renderedMd: a.rendered_md,
      agreementSha256: a.rendered_sha256,
      recordSha256: a.record_sha256,
      legalName: a.signer_legal_name,
      signerTitle: a.signer_title ?? "",
      typedSignature: a.typed_signature,
      email: a.invited_email,
      signedAt: a.signed_at,
      ip: a.signer_ip,
      userAgent: a.signer_user_agent,
      acknowledgments: (a.acknowledgments ?? {}) as Record<string, boolean>,
    });
    pdfSha256 = createHash("sha256").update(bytes).digest("hex");
    const path = `${a.partner_id}/${a.id}.pdf`;
    const { error: upErr } = await admin.storage.from(PARTNER_AGREEMENT_BUCKET).upload(path, Buffer.from(bytes), {
      contentType: "application/pdf",
      upsert: false,
    });
    if (upErr && !/exists/i.test(upErr.message)) throw new HttpError(500, "Could not store the signed PDF.");
    const { error: saveErr } = await admin
      .from("partner_agreements")
      .update({ pdf_path: path, pdf_sha256: pdfSha256, pdf_generated_at: new Date().toISOString() })
      .eq("id", a.id)
      .is("pdf_path", null);
    if (saveErr) throw new HttpError(500, "Could not record the signed PDF.");
  }

  if (a.signed_copy_emailed_at && !opts.resendEmail) return { pdfReady: true, emailed: true, pdfSha256: pdfSha256! };

  const data = {
    ...branding(),
    signerName: a.signer_legal_name,
    businessName,
    agreementTitle: a.title,
    signedAt: new Date(a.signed_at).toLocaleString("en-US", { timeZone: "America/Chicago", dateStyle: "long", timeStyle: "short" }),
    pdfSha256: pdfSha256!,
    activated: Boolean(opts.activated),
    kind: a.kind as PartnerKind,
  };
  const attachment = { filename: pdfFilename(a.title, businessName), content: Buffer.from(bytes), contentType: "application/pdf" };
  const sent = await sendTrackedEmail({
    emailType: "partner_agreement_signed",
    idempotencyKey: opts.resendEmail ? `partner-agreement-signed-${a.id}-${Date.now()}` : `partner-agreement-signed-${a.id}`,
    to: a.invited_email,
    from: ServerEnv.fromOrders(),
    replyTo: ServerEnv.replyTo(),
    subject: partnerAgreementSignedSubject(data),
    react: React.createElement(PartnerAgreementSigned, data),
    text: partnerAgreementSignedText(data),
    attachments: [attachment],
  });
  const emailed = sent.status === "sent" || sent.status === "deduped";
  if (emailed && !a.signed_copy_emailed_at) {
    await admin.from("partner_agreements").update({ signed_copy_emailed_at: new Date().toISOString() }).eq("id", a.id);
  }
  // Your copy, for your own files (first time only).
  if (!opts.resendEmail) {
    try {
      await sendTrackedEmail({
        emailType: "partner_agreement_signed_admin",
        idempotencyKey: `partner-agreement-signed-admin-${a.id}`,
        to: ServerEnv.sellLeadsNotificationEmail(),
        from: ServerEnv.fromOrders(),
        replyTo: a.invited_email,
        subject: `Signed: ${a.title} — ${businessName}`,
        react: React.createElement(PartnerAgreementSigned, { ...data, signerName: "Geega Games" }),
        text: `${a.signer_legal_name} (${a.signer_title ?? ""}) signed the ${a.title} for ${businessName} on ${data.signedAt}. Fee: ${formatFeePercent(Number(a.fee_percent))}. The signed PDF is attached.\n\nPDF SHA-256: ${pdfSha256}`,
        attachments: [attachment],
      });
    } catch (e) {
      console.error("[partnerAgreements] admin copy failed", a.id, e);
    }
  }
  return { pdfReady: true, emailed, pdfSha256: pdfSha256! };
}

function pdfFilename(title: string, businessName: string): string {
  const slug = (s: string) => s.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
  return `${slug(title)}-${slug(businessName) || "Partner"}.pdf`;
}

/** A five-minute download link for a signed agreement's PDF (making it first if needed). */
export async function partnerAgreementPdfLink(admin: Admin, agreementId: string): Promise<string> {
  const { data: a } = await admin.from("partner_agreements").select("id, partner_id, status, title, pdf_path").eq("id", agreementId).maybeSingle();
  if (!a || a.status !== "signed") throw new HttpError(404, "That signed agreement isn't there.");
  let path = a.pdf_path;
  if (!path) {
    await finalizePartnerSignedCopy(admin, a.id);
    const { data: again } = await admin.from("partner_agreements").select("pdf_path").eq("id", a.id).single();
    path = again?.pdf_path ?? null;
  }
  if (!path) throw new HttpError(503, "The signed copy is still being prepared. Try again in a minute.");
  const { data: p } = await admin.from("partners").select("business_name").eq("id", a.partner_id).single();
  const { data, error } = await admin.storage
    .from(PARTNER_AGREEMENT_BUCKET)
    .createSignedUrl(path, PDF_LINK_SECONDS, { download: pdfFilename(a.title, p?.business_name ?? "") });
  if (error || !data?.signedUrl) throw new HttpError(500, "Could not make a download link.");
  return data.signedUrl;
}

// ---------------------------------------------------------------- checks used elsewhere

/** The partner's newest signed agreement, or null. */
export async function signedAgreementFor(admin: Admin, partnerId: string) {
  const { data, error } = await admin
    .from("partner_agreements")
    .select("id, fee_percent, signed_at, version_number")
    .eq("partner_id", partnerId)
    .eq("status", "signed")
    .order("signed_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new HttpError(500, "Could not check the partner's agreement.");
  return data;
}

/** Voids an open agreement (the application was declined). */
export async function voidOpenAgreement(admin: Admin, partnerId: string, reason: string): Promise<void> {
  await admin
    .from("partner_agreements")
    .update({ status: "void", voided_at: new Date().toISOString(), void_reason: reason.slice(0, 500) })
    .eq("partner_id", partnerId)
    .eq("status", "pending");
}
