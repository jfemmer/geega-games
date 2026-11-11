import type { VercelRequest, VercelResponse } from "@vercel/node";
import { HttpError, methodNotAllowed, readJsonBody, sendJson } from "../../_lib/http.js";
import { requireStaff, type StaffContext } from "../../_lib/adminAuth.js";
import { getSupabaseAdmin } from "../../_lib/supabaseAdmin.js";
import { logAdminAction } from "../../_lib/auditLog.js";
import { sendPartnerApprovedEmail, sendPartnerMessageEmail } from "../../_lib/partnerEmails.js";
import {
  countersignAgreement,
  partnerAgreementPdfLink,
  sendPartnerAgreement,
  signedAgreementFor,
  voidOpenAgreement,
} from "../../_lib/partnerAgreements.js";
import { getClientIp } from "../../_lib/rateLimit.js";
import { countersignProblems } from "../../../src/store/lib/partnerAgreement.js";
import {
  ensurePartnerReferralCode,
  partnerFieldsFromInput,
  type PartnerFieldsInput,
  type PartnerUpdate,
} from "../../_lib/partners.js";
import {
  PARTNER_MESSAGE_BODY_MAX,
  PARTNER_MESSAGE_SUBJECT_MAX,
  type PartnerKind,
  type PartnerStatus,
} from "../../../src/store/lib/partnerTypes.js";

// PATCH /api/admin/partners/:id  { action, fields?, sendWelcome? }
//
//   approve   With no signed agreement yet: emails the partner agreement to
//             sign (status stays "applied"; a declined one goes back to
//             "applied"). Signing makes them active, gives a referral partner
//             its code and sends the welcome (api/partner-agreement.ts).
//             With a signed agreement on file: applied/paused/declined →
//             active straight away, as before (sendWelcome defaults to true
//             when approving an application).
//   decline   → declined (no email; reply to their application email if you
//             want to explain). Cancels an unsigned agreement link.
//   send_agreement  (re)send the agreement to sign, at their current fee: a
//             new link, the old one stops working. Not for declined partners.
//   countersign     { agreementId, name, title, typedSignature, authorized }
//             Geega Games countersigns an agreement the partner signed (the
//             Referral Partner Agreement takes effect then): an applicant goes
//             live, gets their code and welcome, and both sides get the PDF.
//   agreement_pdf   { agreementId } → a five-minute link to a signed copy.
//   pause     active → paused: no new leads go to them, their link stops
//             crediting new sellers.
//   activate  paused → active.
//   update    edit fields: contact details, what they buy, where, fee %…
//   message   { subject, body } — email them (any status, e.g. to ask an
//             applicant questions before deciding). Saved to partner_messages;
//             their reply goes to the store's reply-to inbox. Status unchanged.
//
// DELETE /api/admin/partners/:id — only for a partner with no fee records (no
// lead ever sent to them, no referral fee earned). Removes their referral code
// too.
//
// Owner-only (app role "admin"): partners and their fees are business terms.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ACTIONS = new Set(["approve", "decline", "pause", "activate", "update", "message", "send_agreement", "agreement_pdf", "countersign"]);

interface Body {
  action?: unknown;
  fields?: PartnerFieldsInput;
  sendWelcome?: unknown;
  subject?: unknown;
  message?: unknown;
  agreementId?: unknown;
  name?: unknown;
  title?: unknown;
  typedSignature?: unknown;
  authorized?: unknown;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "PATCH" && req.method !== "DELETE") return methodNotAllowed(res, ["PATCH", "DELETE"]);
  try {
    const staff = await requireStaff(req);
    if (staff.role !== "admin") throw new HttpError(403, "Only the store owner can change partners.");
    const id = String(req.query.id ?? "");
    if (!UUID_RE.test(id)) throw new HttpError(400, "Partner id is required.");

    const admin = getSupabaseAdmin();
    const { data: partner, error: readErr } = await admin
      .from("partners")
      .select("id, kind, status, business_name, email, fee_percent, approved_at")
      .eq("id", id)
      .maybeSingle();
    if (readErr) throw new HttpError(500, readErr.message);
    if (!partner) throw new HttpError(404, "Partner not found.");

    if (req.method === "DELETE") return await deletePartner(res, staff, partner);

    const body = (await readJsonBody(req, 16 * 1024)) as Body;
    const action = typeof body.action === "string" && ACTIONS.has(body.action) ? body.action : null;
    if (!action) throw new HttpError(400, "Invalid action.");

    if (action === "message") return await messagePartner(res, staff, partner, body);
    if (action === "agreement_pdf") {
      const agreementId = typeof body.agreementId === "string" && UUID_RE.test(body.agreementId) ? body.agreementId : null;
      if (!agreementId) throw new HttpError(400, "Choose an agreement.");
      const { data: owns } = await admin.from("partner_agreements").select("id").eq("id", agreementId).eq("partner_id", id).maybeSingle();
      if (!owns) throw new HttpError(404, "That signed agreement isn't there.");
      return sendJson(res, 200, { ok: true, url: await partnerAgreementPdfLink(admin, agreementId) });
    }

    if (action === "countersign") return await countersign(req, res, staff, partner, body);

    const kind = partner.kind as PartnerKind;
    const current = partner.status as PartnerStatus;

    if (action === "approve" && current !== "active") {
      const { data: waiting } = await admin
        .from("partner_agreements")
        .select("id")
        .eq("partner_id", id)
        .eq("status", "awaiting_countersign")
        .limit(1)
        .maybeSingle();
      if (waiting) throw new HttpError(409, "They've already signed. Countersign their agreement to approve them.");
    }

    if (action === "send_agreement" || (action === "approve" && current !== "active" && !(await signedAgreementFor(admin, id)))) {
      if (action === "send_agreement" && current === "declined") {
        throw new HttpError(409, "This application was declined. Approve it to send an agreement.");
      }
      if (current === "declined") {
        const { error: reopenErr } = await admin.from("partners").update({ status: "applied" }).eq("id", id);
        if (reopenErr) throw new HttpError(500, reopenErr.message);
      }
      const sent = await sendPartnerAgreement(admin, id, { userId: staff.userId, email: staff.email });
      await logAdminAction(admin, staff, {
        action: action === "approve" ? "partner.approve" : "partner.send_agreement",
        resourceType: "partner",
        resourceId: id,
        before: { status: current, fee_percent: partner.fee_percent },
        after: { agreement_id: sent.agreementId, emailed: sent.emailed, fee_percent: partner.fee_percent },
      });
      return sendJson(res, 200, {
        ok: true,
        agreement: { id: sent.agreementId, emailed: sent.emailed, signUrl: sent.signUrl },
        referralCode: null,
        welcome: null,
      });
    }

    let update: PartnerUpdate = {};
    let sendWelcome = false;

    switch (action) {
      case "approve":
        if (current === "active") throw new HttpError(409, "This partner is already active.");
        update = { status: "active", approved_at: partner.approved_at ?? new Date().toISOString() };
        sendWelcome = body.sendWelcome === undefined ? current === "applied" : body.sendWelcome === true;
        break;
      case "decline":
        if (current === "declined") throw new HttpError(409, "Already declined.");
        update = { status: "declined" };
        await voidOpenAgreement(admin, id, "The application was declined.");
        break;
      case "pause":
        if (current !== "active") throw new HttpError(409, "Only an active partner can be paused.");
        update = { status: "paused" };
        break;
      case "activate":
        if (current !== "paused") throw new HttpError(409, "Only a paused partner can be reactivated.");
        update = { status: "active" };
        break;
      case "update":
        update = partnerFieldsFromInput(body.fields ?? {}, kind);
        if (Object.keys(update).length === 0) throw new HttpError(400, "Nothing to change.");
        break;
    }

    const { error: updateErr } = await admin.from("partners").update(update).eq("id", id);
    if (updateErr) throw new HttpError(500, updateErr.message);

    let referralCode: string | null = null;
    if (kind === "referrer" && (action === "approve" || action === "activate")) {
      referralCode = await ensurePartnerReferralCode(admin, id);
    }

    let welcome: string | null = null;
    if (sendWelcome) welcome = (await sendPartnerApprovedEmail(id)).status;

    await logAdminAction(admin, staff, {
      action: `partner.${action}`,
      resourceType: "partner",
      resourceId: id,
      before: { status: current, fee_percent: partner.fee_percent },
      after: update as Record<string, unknown>,
    });

    return sendJson(res, 200, { ok: true, referralCode, welcome });
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 500;
    const message = err instanceof HttpError ? err.message : "Unexpected server error.";
    if (!(err instanceof HttpError)) console.error("[/api/admin/partners/:id] error:", err);
    return sendJson(res, status, { ok: false, message });
  }
}

async function countersign(
  req: VercelRequest,
  res: VercelResponse,
  staff: StaffContext,
  partner: { id: string; business_name: string },
  body: Body,
) {
  const admin = getSupabaseAdmin();
  const agreementId = typeof body.agreementId === "string" && UUID_RE.test(body.agreementId) ? body.agreementId : null;
  if (!agreementId) throw new HttpError(400, "Choose an agreement.");
  const { data: owns } = await admin.from("partner_agreements").select("id").eq("id", agreementId).eq("partner_id", partner.id).maybeSingle();
  if (!owns) throw new HttpError(404, "That agreement isn't there.");
  const str = (v: unknown) => (typeof v === "string" ? v.slice(0, 200) : "");
  const input = { name: str(body.name), title: str(body.title), typedSignature: str(body.typedSignature), authorized: body.authorized === true };
  const problems = countersignProblems(input);
  if (problems.length) throw new HttpError(400, problems[0]);

  const result = await countersignAgreement(admin, agreementId, {
    name: input.name,
    title: input.title,
    typedSignature: input.typedSignature,
    userId: staff.userId,
    email: staff.email,
    ip: getClientIp(req),
    userAgent: String(req.headers["user-agent"] ?? ""),
  });

  let referralCode: string | null = null;
  if (result.kind === "referrer") {
    const { data: code } = await admin.from("referral_codes").select("code").eq("partner_id", partner.id).maybeSingle();
    referralCode = code?.code ?? null;
  }

  await logAdminAction(admin, staff, {
    action: "partner.countersign",
    resourceType: "partner",
    resourceId: partner.id,
    before: { agreement_id: agreementId, status: "awaiting_countersign" },
    after: { agreement_id: agreementId, status: "signed", activated: result.activated, pdf_emailed: result.emailed },
  });

  return sendJson(res, 200, { ok: true, activated: result.activated, pdfEmailed: result.emailed, referralCode });
}

async function deletePartner(
  res: VercelResponse,
  staff: StaffContext,
  partner: { id: string; kind: string; status: string; business_name: string },
) {
  const admin = getSupabaseAdmin();
  // Fee records must keep saying who they're with: leads sent to a store, and
  // referral fees earned by a referral partner (both restrict the delete in
  // the database too; these give a clear message first).
  const [referrals, rewards] = await Promise.all([
    admin.from("partner_referrals").select("id", { count: "exact", head: true }).eq("partner_id", partner.id),
    admin.from("referral_rewards").select("id", { count: "exact", head: true }).eq("partner_id", partner.id),
  ]);
  const agreements = await admin.from("partner_agreements").select("id", { count: "exact", head: true }).eq("partner_id", partner.id);
  const countErr = referrals.error ?? rewards.error ?? agreements.error;
  if (countErr) throw new HttpError(500, countErr.message);
  if ((agreements.count ?? 0) > 0) {
    throw new HttpError(409, "An agreement was sent to this partner, so it's kept for the record. Decline or pause it instead.");
  }
  if ((referrals.count ?? 0) > 0) {
    throw new HttpError(409, "Leads were sent to this partner, so it's kept for the fee records. Pause it instead.");
  }
  if ((rewards.count ?? 0) > 0) {
    throw new HttpError(409, "This partner has earned referral fees, so it's kept for the records. Pause it instead.");
  }

  const { error } = await admin.from("partners").delete().eq("id", partner.id);
  if (error) throw new HttpError(500, "Could not delete the partner.");

  await logAdminAction(admin, staff, {
    action: "partner.delete",
    resourceType: "partner",
    resourceId: partner.id,
    before: { kind: partner.kind, status: partner.status, business_name: partner.business_name },
    after: null,
  });
  res.status(204).end();
}

function cleanText(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  // Normalise line endings, trim trailing spaces per line, cap blank runs.
  const text = v.replace(/\r\n?/g, "\n").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  if (!text) return null;
  if (text.length > max) throw new HttpError(400, `Please keep it under ${max.toLocaleString("en-US")} characters.`);
  return text;
}

async function messagePartner(
  res: VercelResponse,
  staff: StaffContext,
  partner: { id: string; email: string; business_name: string },
  body: Body,
) {
  const subject = cleanText(body.subject, PARTNER_MESSAGE_SUBJECT_MAX)?.replace(/\s+/g, " ") ?? null;
  const text = cleanText(body.message, PARTNER_MESSAGE_BODY_MAX);
  if (!subject) throw new HttpError(400, "Please add a subject.");
  if (!text) throw new HttpError(400, "Please write a message.");

  const admin = getSupabaseAdmin();
  const { data: row, error } = await admin
    .from("partner_messages")
    .insert({
      partner_id: partner.id,
      sent_by: staff.userId,
      sent_by_email: staff.email,
      to_email: partner.email,
      subject,
      body: text,
    })
    .select("id")
    .single();
  if (error || !row) throw new HttpError(500, "Could not save the message.");

  const result = await sendPartnerMessageEmail(row.id);
  const sent = result.status === "sent" || result.status === "deduped";
  if (!sent) {
    await admin.from("partner_messages").update({ email_status: "failed" }).eq("id", row.id);
  }

  await logAdminAction(admin, staff, {
    action: "partner.message",
    resourceType: "partner",
    resourceId: partner.id,
    before: null,
    after: { message_id: row.id, subject, email_status: sent ? "sent" : "failed" },
  });

  return sendJson(res, 200, { ok: true, messageId: row.id, email: sent ? "sent" : "failed" });
}
