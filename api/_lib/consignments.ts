import * as React from "react";
import { createHash, randomBytes } from "node:crypto";
import type { VercelRequest } from "@vercel/node";
import { getSupabaseAdmin } from "./supabaseAdmin.js";
import { HttpError } from "./http.js";
import { ServerEnv } from "./env.js";
import { logoUrl, siteUrl } from "./assets.js";
import { sendTrackedEmail } from "./emailService.js";
import { buildSignedAgreementPdf } from "./consignmentPdf.js";
import {
  ConsignmentInvite,
  ConsignmentSigned,
  consignmentInviteText,
  consignmentSignedText,
} from "./emails/ConsignmentEmails.js";
import { consignmentLabel, renderAgreement, type AgreementTerms } from "../../src/store/lib/consignmentAgreement.js";
import { parseEstimatorConfig } from "../../src/store/lib/consignmentConfig.js";
import type { ConsignmentChannel } from "../../src/store/lib/consignmentMath.js";

// Server side of consignment agreements: rendering an invitation from the
// rates in force, the invitation link's secret, the signed PDF (made once,
// stored privately, emailed), and short-lived download links.

type Admin = ReturnType<typeof getSupabaseAdmin>;

export const AGREEMENT_BUCKET = "consignment-agreements";
export const INVITE_DAYS = 14;
const PDF_LINK_SECONDS = 5 * 60;

/** Database error codes from the consignment functions, as HTTP statuses. */
export function consignmentDbError(error: { code?: string; message?: string } | null, fallback: string): HttpError {
  const code = error?.code ?? "";
  const message = error?.message ?? fallback;
  if (/^GC0(3[0-9]|2[0-9])$/.test(code)) {
    const status = code === "GC030" ? 404 : code === "GC036" ? 403 : code === "GC038" || code === "GC039" ? 400 : 409;
    return new HttpError(status, message);
  }
  return new HttpError(500, fallback);
}

// ---------------------------------------------------------------- the link's secret

/** A fresh invitation secret and its hash. Only the hash is stored. */
export function newInviteToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, hash: hashInviteToken(token) };
}

export function hashInviteToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function isWellFormedToken(token: unknown): token is string {
  return typeof token === "string" && /^[A-Za-z0-9_-]{40,60}$/.test(token);
}

export const signUrl = (token: string) => `${siteUrl()}/consign/sign?t=${encodeURIComponent(token)}`;

// ---------------------------------------------------------------- the signed-in customer

export interface Customer {
  userId: string;
  email: string;
}

/** The signed-in customer with a confirmed email, or 401. */
export async function requireConsignmentCustomer(req: VercelRequest, admin: Admin = getSupabaseAdmin()): Promise<Customer> {
  const header = String(req.headers.authorization ?? "");
  const token = header.replace(/^Bearer\s+/i, "").trim();
  if (!token || token === header) throw new HttpError(401, "Sign in to open your consignment agreement.");
  const { data, error } = await admin.auth.getUser(token);
  const user = data?.user;
  if (error || !user) throw new HttpError(401, "Your session ended. Sign in again.");
  if ((user as { is_anonymous?: boolean }).is_anonymous || !user.email) throw new HttpError(401, "Sign in to your account to continue.");
  return { userId: user.id, email: user.email.toLowerCase() };
}

/** "p***@example.com", so a wrong account sees where the invite went without the full address. */
export function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  if (!domain) return "***";
  return `${local.slice(0, 1)}***@${domain}`;
}

// ---------------------------------------------------------------- terms

/** The rates and terms in force now, as recorded with a new agreement. */
export async function currentAgreementTerms(admin: Admin): Promise<AgreementTerms> {
  const { data, error } = await admin.rpc("consignment_estimator_settings");
  if (error) throw new HttpError(500, "Could not load the consignment rates.");
  const config = parseEstimatorConfig(data);
  if (!config || Object.keys(config.channels).length === 0) {
    throw new HttpError(409, "Set up the consignment rates (Admin > Consignments > Settings) before sending an agreement.");
  }
  const raw = data as { channels?: Record<string, { effectiveFrom?: string; sourceNote?: string | null }>; settings?: { payoutMethods?: unknown } };
  const channels: AgreementTerms["channels"] = {};
  for (const [c, s] of Object.entries(config.channels) as [ConsignmentChannel, NonNullable<(typeof config.channels)[ConsignmentChannel]>][]) {
    channels[c] = { ...s, effectiveFrom: raw.channels?.[c]?.effectiveFrom ?? null, sourceNote: raw.channels?.[c]?.sourceNote ?? null };
  }
  const payoutMethods = Array.isArray(raw.settings?.payoutMethods) ? (raw.settings!.payoutMethods as unknown[]).filter((m): m is string => typeof m === "string") : [];
  return {
    capturedAt: new Date().toISOString(),
    channels,
    commissionTiers: [...config.commissionTiers],
    insurance: {
      service: config.insuranceService,
      includedCoverageCents: config.insurance.includedCoverageCents,
      effectiveFrom: config.effectiveFrom.insurance,
    },
    minCardValueCents: (data as { settings?: { minCardValueCents?: number } }).settings?.minCardValueCents ?? 0,
    initialTermDays: config.initialTermDays,
    inspectionDays: config.inspectionDays,
    payoutMethods: payoutMethods.length ? payoutMethods : ["check"],
    supportEmail: ServerEnv.replyTo(),
  };
}

// ---------------------------------------------------------------- inviting

export interface InvitationResult {
  agreementId: string;
  emailed: boolean;
  /** The link, for staff to copy when the email didn't go out. */
  signUrl: string;
}

/**
 * Send the published agreement to a consignment's consignor: render it with
 * today's rates, freeze it (consignment_create_invitation voids any earlier
 * open invitation) and email the link.
 */
export async function sendInvitation(admin: Admin, consignmentId: string, actor: string | null): Promise<InvitationResult> {
  const { data: c, error: cErr } = await admin
    .from("consignments")
    .select("id, consignment_number, status, consignor_id")
    .eq("id", consignmentId)
    .maybeSingle();
  if (cErr) throw new HttpError(500, "Could not load that consignment.");
  if (!c) throw new HttpError(404, "That consignment isn't there.");
  const { data: p, error: pErr } = await admin.from("consignors").select("legal_name, email").eq("id", c.consignor_id).single();
  if (pErr || !p) throw new HttpError(500, "Could not load the consignor.");
  const { data: v, error: vErr } = await admin
    .from("consignment_agreement_versions")
    .select("id, version_number, body_md")
    .eq("status", "published")
    .maybeSingle();
  if (vErr) throw new HttpError(500, "Could not load the agreement.");
  if (!v) throw new HttpError(409, "Publish the consignment agreement (Admin > Consignments > Agreement) before sending it.");

  const terms = await currentAgreementTerms(admin);
  let rendered: string;
  try {
    rendered = renderAgreement(v.body_md, {
      versionNumber: v.version_number,
      consignmentNumber: c.consignment_number,
      consignorName: p.legal_name,
      terms,
    });
  } catch (e) {
    throw new HttpError(409, e instanceof Error ? e.message : "The agreement couldn't be filled in.");
  }

  const { token, hash } = newInviteToken();
  const expires = new Date(Date.now() + INVITE_DAYS * 86_400_000);
  const { data: agreementId, error } = await admin.rpc("consignment_create_invitation", {
    p_consignment_id: c.id,
    p_version_id: v.id,
    p_rendered_md: rendered,
    p_terms_snapshot: terms as unknown as never,
    p_invited_email: p.email,
    p_token_hash: hash,
    p_expires_at: expires.toISOString(),
    p_actor: actor ?? "staff",
  });
  if (error || !agreementId) throw consignmentDbError(error, "Could not create the invitation.");

  const url = signUrl(token);
  const data = {
    siteUrl: siteUrl(),
    logoUrl: logoUrl(),
    supportEmail: ServerEnv.replyTo(),
    consignorName: p.legal_name,
    consignmentLabel: consignmentLabel(c.consignment_number),
    signUrl: url,
    expiresOn: expires.toLocaleDateString("en-US", { timeZone: "America/Chicago", month: "long", day: "numeric", year: "numeric" }),
  };
  const sent = await sendTrackedEmail({
    emailType: "consignment_invite",
    idempotencyKey: `consignment-invite-${agreementId as string}`,
    to: p.email,
    from: ServerEnv.fromOrders(),
    replyTo: ServerEnv.replyTo(),
    subject: `Your consignment agreement ${data.consignmentLabel} is ready to sign — Geega Games`,
    react: React.createElement(ConsignmentInvite, data),
    text: consignmentInviteText(data),
  });
  const emailed = sent.status === "sent" || sent.status === "deduped";
  if (emailed) await admin.from("consignment_agreements").update({ last_emailed_at: new Date().toISOString() }).eq("id", agreementId as string);
  return { agreementId: agreementId as string, emailed, signUrl: url };
}

// ---------------------------------------------------------------- the signed copy

export interface SignedCopyResult {
  pdfSha256: string;
  emailed: boolean;
}

/**
 * Make (once), store and email the signed PDF for a signature. Safe to call
 * again: an existing PDF is reused, and the email is sent at most once.
 */
export async function finalizeSignedCopy(admin: Admin, signatureId: string, opts: { resendEmail?: boolean } = {}): Promise<SignedCopyResult> {
  const { data: s, error } = await admin.from("consignment_signatures").select("*").eq("id", signatureId).single();
  if (error || !s) throw new HttpError(404, "That signature isn't there.");
  const { data: a } = await admin.from("consignment_agreements").select("id, rendered_md, version_id").eq("id", s.agreement_id).single();
  const { data: v } = await admin.from("consignment_agreement_versions").select("version_number, title").eq("id", a!.version_id).single();
  const { data: c } = await admin.from("consignments").select("consignment_number").eq("id", s.consignment_id).single();
  if (!a || !v || !c) throw new HttpError(500, "Could not load the signed agreement.");

  let bytes: Uint8Array;
  let pdfSha256 = s.pdf_sha256 as string | null;
  if (s.pdf_path) {
    const { data: blob, error: dlErr } = await admin.storage.from(AGREEMENT_BUCKET).download(s.pdf_path);
    if (dlErr || !blob) throw new HttpError(500, "Could not load the signed PDF.");
    bytes = new Uint8Array(await blob.arrayBuffer());
  } else {
    bytes = await buildSignedAgreementPdf({
      consignmentNumber: c.consignment_number,
      versionNumber: v.version_number,
      title: v.title,
      renderedMd: a.rendered_md,
      agreementSha256: s.agreement_sha256,
      recordSha256: s.record_sha256,
      legalName: s.legal_name,
      typedSignature: s.typed_signature,
      email: s.signer_email,
      userId: s.user_id,
      signedAt: s.signed_at,
      ip: s.ip,
      userAgent: s.user_agent,
      channels: s.channels as Record<ConsignmentChannel, boolean>,
      additionalInsurance: s.additional_insurance,
    });
    pdfSha256 = createHash("sha256").update(bytes).digest("hex");
    const path = `${s.consignment_id}/${s.agreement_id}.pdf`;
    const { error: upErr } = await admin.storage.from(AGREEMENT_BUCKET).upload(path, Buffer.from(bytes), {
      contentType: "application/pdf",
      upsert: false,
    });
    if (upErr && !/exists/i.test(upErr.message)) throw new HttpError(500, "Could not store the signed PDF.");
    const { error: saveErr } = await admin
      .from("consignment_signatures")
      .update({ pdf_path: path, pdf_sha256: pdfSha256, pdf_generated_at: new Date().toISOString() })
      .eq("id", s.id)
      .is("pdf_path", null);
    if (saveErr) throw new HttpError(500, "Could not record the signed PDF.");
  }

  if (s.emailed_at && !opts.resendEmail) return { pdfSha256: pdfSha256!, emailed: true };
  const label = consignmentLabel(c.consignment_number);
  const data = {
    siteUrl: siteUrl(),
    logoUrl: logoUrl(),
    supportEmail: ServerEnv.replyTo(),
    consignorName: s.legal_name,
    consignmentLabel: label,
    signedAt: new Date(s.signed_at).toLocaleString("en-US", { timeZone: "America/Chicago", dateStyle: "long", timeStyle: "short" }),
    accountUrl: `${siteUrl()}/account/consignments`,
    pdfSha256: pdfSha256!,
  };
  const sent = await sendTrackedEmail({
    emailType: "consignment_signed",
    idempotencyKey: opts.resendEmail ? `consignment-signed-${s.id}-${Date.now()}` : `consignment-signed-${s.id}`,
    to: s.signer_email,
    from: ServerEnv.fromOrders(),
    replyTo: ServerEnv.replyTo(),
    subject: `Your signed consignment agreement ${label} — Geega Games`,
    react: React.createElement(ConsignmentSigned, data),
    text: consignmentSignedText(data),
    attachments: [{ filename: `Geega-Games-Consignment-Agreement-${label}.pdf`, content: Buffer.from(bytes), contentType: "application/pdf" }],
  });
  const emailed = sent.status === "sent" || sent.status === "deduped";
  if (emailed && !s.emailed_at) await admin.from("consignment_signatures").update({ emailed_at: new Date().toISOString() }).eq("id", s.id);
  return { pdfSha256: pdfSha256!, emailed };
}

/** A five-minute download link for a signed PDF. */
export async function signedPdfLink(admin: Admin, pdfPath: string, label: string): Promise<string> {
  const { data, error } = await admin.storage
    .from(AGREEMENT_BUCKET)
    .createSignedUrl(pdfPath, PDF_LINK_SECONDS, { download: `Geega-Games-Consignment-Agreement-${label}.pdf` });
  if (error || !data?.signedUrl) throw new HttpError(500, "Could not make a download link.");
  return data.signedUrl;
}
