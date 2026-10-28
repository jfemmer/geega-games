import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getSupabaseAdmin } from "./_lib/supabaseAdmin.js";
import { HttpError, methodNotAllowed, readJsonBody, sendJson } from "./_lib/http.js";
import { checkRateLimit, getClientIp } from "./_lib/rateLimit.js";
import {
  consignmentDbError,
  finalizeSignedCopy,
  hashInviteToken,
  isWellFormedToken,
  maskEmail,
  requireConsignmentCustomer,
  signedPdfLink,
} from "./_lib/consignments.js";
import { ACKNOWLEDGMENTS, consignmentLabel } from "../src/store/lib/consignmentAgreement.js";
import { CONSIGNMENT_CHANNELS } from "../src/store/lib/consignmentMath.js";

// Consignors' side of consignment agreements. Every call needs a signed-in
// account.
//
//   GET  ?view=invite&t=<secret>      the agreement behind an invitation link,
//                                     for the invited email's account only
//   POST { action: "sign", t, ... }   sign it (consignment_sign_agreement),
//                                     then make, store and email the PDF
//   GET  ?view=pdf&agreement=<id>     a five-minute link to the consignor's
//                                     own signed PDF
//
// The consignor's list of consignments comes straight from my_consignments()
// in the browser (it only ever returns their own).

const MAX_BODY = 16 * 1024;

type Admin = ReturnType<typeof getSupabaseAdmin>;

async function agreementForToken(admin: Admin, token: unknown) {
  if (!isWellFormedToken(token)) throw new HttpError(404, "That link isn't valid. Use the newest link in your email from Geega Games.");
  const { data, error } = await admin
    .from("consignment_agreements")
    .select("id, consignment_id, version_id, status, rendered_md, rendered_sha256, terms_snapshot, invited_email, invite_expires_at, signed_at")
    .eq("invite_token_hash", hashInviteToken(token))
    .maybeSingle();
  if (error) throw new HttpError(500, "Could not open the agreement.");
  if (!data) throw new HttpError(404, "That link isn't valid. Use the newest link in your email from Geega Games.");
  return data;
}

async function viewInvite(admin: Admin, req: VercelRequest) {
  const customer = await requireConsignmentCustomer(req, admin);
  const a = await agreementForToken(admin, req.query.t);
  if (a.invited_email !== customer.email) {
    throw new HttpError(
      403,
      `This agreement was sent to ${maskEmail(a.invited_email)}. Sign in with that email address to open it.`,
    );
  }
  const { data: c } = await admin.from("consignments").select("consignment_number, consignor_id").eq("id", a.consignment_id).single();
  const { data: p } = await admin.from("consignors").select("legal_name, user_id").eq("id", c!.consignor_id).single();
  if (p?.user_id && p.user_id !== customer.userId) throw new HttpError(403, "This consignment belongs to a different account.");
  const { data: v } = await admin.from("consignment_agreement_versions").select("version_number, title").eq("id", a.version_id).single();
  const label = consignmentLabel(c!.consignment_number);

  if (a.status === "void") throw new HttpError(410, "This invitation was replaced or cancelled. Use the newest link Geega Games sent you.");
  if (a.status === "signed") {
    return { status: "signed", consignmentLabel: label, signedAt: a.signed_at, agreementId: a.id };
  }
  if (new Date(a.invite_expires_at).getTime() <= Date.now()) {
    throw new HttpError(410, "This invitation has expired. Ask Geega Games to send you a new one.");
  }
  return {
    status: "pending",
    agreementId: a.id,
    consignmentLabel: label,
    consignorName: p?.legal_name ?? "",
    versionNumber: v?.version_number ?? null,
    title: v?.title ?? "Consignment Agreement",
    renderedMd: a.rendered_md,
    agreementSha256: a.rendered_sha256,
    terms: a.terms_snapshot,
    expiresAt: a.invite_expires_at,
  };
}

function readBool(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

async function sign(admin: Admin, req: VercelRequest) {
  const ip = getClientIp(req);
  const limit = checkRateLimit("consignment-sign", ip, 10, 10 * 60_000);
  if (!limit.allowed) throw new HttpError(429, "Too many tries. Wait a few minutes, then try again.");
  const customer = await requireConsignmentCustomer(req, admin);
  const body = await readJsonBody(req, MAX_BODY);
  const a = await agreementForToken(admin, body.t);

  const ackIn = (body.acknowledgments ?? {}) as Record<string, unknown>;
  const acknowledgments = Object.fromEntries(ACKNOWLEDGMENTS.map((x) => [x.key, ackIn[x.key] === true]));
  const chIn = (body.channels ?? {}) as Record<string, unknown>;
  const channels = Object.fromEntries(CONSIGNMENT_CHANNELS.map((c) => [c, readBool(chIn[c])]));
  const text = (v: unknown) => (typeof v === "string" ? v.slice(0, 200) : "");

  const { data: signatureId, error } = await admin.rpc("consignment_sign_agreement", {
    p_agreement_id: a.id,
    p_user_id: customer.userId,
    p_signer_email: customer.email,
    p_legal_name: text(body.legalName),
    p_typed_signature: text(body.typedSignature),
    p_acknowledgments: acknowledgments,
    p_channels: channels,
    p_additional_insurance: readBool(body.additionalInsurance) as boolean,
    p_agreement_sha256: typeof body.agreementSha256 === "string" ? body.agreementSha256 : "",
    p_ip: ip.slice(0, 100),
    p_user_agent: String(req.headers["user-agent"] ?? "").slice(0, 400),
  });
  if (error || !signatureId) throw consignmentDbError(error, "Could not record your signature. Try again.");

  // The signature stands even if the PDF or email hits a snag: staff can
  // make the copy again from the admin, and it's retried on download.
  let pdfReady = true;
  try {
    await finalizeSignedCopy(admin, signatureId as string);
  } catch (e) {
    pdfReady = false;
    console.error("[consignments] signed copy failed", signatureId, e);
  }
  return { ok: true, agreementId: a.id, pdfReady };
}

async function pdfLink(admin: Admin, req: VercelRequest) {
  const customer = await requireConsignmentCustomer(req, admin);
  const agreementId = String(req.query.agreement ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(agreementId)) throw new HttpError(400, "Choose an agreement.");
  const { data: s } = await admin
    .from("consignment_signatures")
    .select("id, user_id, consignment_id, pdf_path")
    .eq("agreement_id", agreementId)
    .maybeSingle();
  // Someone else's agreement looks the same as none.
  if (!s || s.user_id !== customer.userId) throw new HttpError(404, "That agreement isn't there.");
  let path = s.pdf_path;
  if (!path) {
    await finalizeSignedCopy(admin, s.id);
    const { data: again } = await admin.from("consignment_signatures").select("pdf_path").eq("id", s.id).single();
    path = again?.pdf_path ?? null;
  }
  if (!path) throw new HttpError(503, "Your signed copy is still being prepared. Try again in a minute.");
  const { data: c } = await admin.from("consignments").select("consignment_number").eq("id", s.consignment_id).single();
  return { url: await signedPdfLink(admin, path, consignmentLabel(c!.consignment_number)) };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!["GET", "POST"].includes(req.method ?? "")) return methodNotAllowed(res, ["GET", "POST"]);
  res.setHeader("Cache-Control", "no-store");
  try {
    const admin = getSupabaseAdmin();
    if (req.method === "GET") {
      const view = String(req.query.view ?? "");
      if (view === "invite") return sendJson(res, 200, await viewInvite(admin, req));
      if (view === "pdf") return sendJson(res, 200, await pdfLink(admin, req));
      throw new HttpError(400, "Unknown view.");
    }
    const body = (req.body && typeof req.body === "object" ? req.body : {}) as Record<string, unknown>;
    if (body.action !== undefined && body.action !== "sign") throw new HttpError(400, "Unknown action.");
    return sendJson(res, 200, await sign(admin, req));
  } catch (err) {
    if (err instanceof HttpError) return sendJson(res, err.status, { ok: false, message: err.message });
    console.error("[consignments] unexpected", err);
    return sendJson(res, 500, { ok: false, message: "Something went wrong. Try again." });
  }
}
