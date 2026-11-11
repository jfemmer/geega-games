import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getSupabaseAdmin } from "./_lib/supabaseAdmin.js";
import { HttpError, methodNotAllowed, readJsonBody, sendJson } from "./_lib/http.js";
import { checkRateLimit, getClientIp } from "./_lib/rateLimit.js";
import { agreementForToken, completeSigning, partnerAgreementDbError } from "./_lib/partnerAgreements.js";
import { PARTNER_AGREEMENT_ACKS } from "../src/store/lib/partnerAgreement.js";
import type { PartnerKind } from "../src/store/lib/partnerTypes.js";
import { usStateCode } from "../src/store/lib/usAddress.js";

// PUBLIC: the partner agreement signing page (/partner-agreement?t=…).
//
//   GET  ?t=<secret>                       the agreement behind the link
//   POST { t, legalName, title, typedSignature, acknowledgments, agreementSha256,
//          entity?: { name, type, state, address } }
//                                          sign it (partner_sign_agreement). An
//                                          agreement Geega Games countersigns
//                                          (Referral Partner Agreement v2) also
//                                          takes the legal entity, then waits for
//                                          the owner; any other goes live and the
//                                          signed PDF is made and emailed
//
// Partners have no accounts: the link's secret (emailed only to the partner's
// address, stored only as a hash, open 14 days, replaced by any resend) is
// what lets someone open and sign it. The database checks the text signed
// is exactly the frozen text and that every box was ticked.

const MAX_BODY = 8 * 1024;

type Admin = ReturnType<typeof getSupabaseAdmin>;

async function view(admin: Admin, req: VercelRequest) {
  const limit = checkRateLimit("partner-agreement-view", getClientIp(req), 60, 10 * 60_000);
  if (!limit.allowed) throw new HttpError(429, "Too many tries. Wait a few minutes, then try again.");
  const a = await agreementForToken(admin, req.query.t);
  const { data: p } = await admin.from("partners").select("business_name, contact_name, state").eq("id", a.partner_id).single();
  if (a.status === "signed" || a.status === "awaiting_countersign") {
    return {
      status: a.status === "signed" ? "signed" : "awaiting",
      title: a.title,
      businessName: p?.business_name ?? "",
      signedAt: a.signed_at,
      signerName: a.signer_legal_name,
      effectiveAt: a.status === "signed" ? (a.countersigned_at ?? a.signed_at) : null,
    };
  }
  if (a.status === "void") throw new HttpError(410, "This link was replaced or cancelled. Use the newest link Geega Games sent you.");
  if (new Date(a.invite_expires_at).getTime() <= Date.now()) {
    throw new HttpError(410, "This link has expired. Reply to the email from Geega Games and we'll send a new one.");
  }
  const kind = a.kind as PartnerKind;
  const required = new Set(a.required_acks);
  return {
    status: "pending",
    kind,
    title: a.title,
    versionNumber: a.version_number,
    businessName: p?.business_name ?? "",
    contactName: p?.contact_name ?? "",
    renderedMd: a.rendered_md,
    agreementSha256: a.rendered_sha256,
    acknowledgments: PARTNER_AGREEMENT_ACKS[kind].filter((x) => required.has(x.key)),
    expiresAt: a.invite_expires_at,
    collectEntity: Boolean(a.requires_countersign),
    entityDefaults: { name: p?.business_name ?? "", state: usStateCode(p?.state) ?? "" },
  };
}

async function sign(admin: Admin, req: VercelRequest) {
  const ip = getClientIp(req);
  const limit = checkRateLimit("partner-agreement-sign", ip, 10, 10 * 60_000);
  if (!limit.allowed) throw new HttpError(429, "Too many tries. Wait a few minutes, then try again.");
  const body = (await readJsonBody(req, MAX_BODY)) as Record<string, unknown>;
  const a = await agreementForToken(admin, body.t);
  const text = (v: unknown) => (typeof v === "string" ? v.slice(0, 200) : "");
  const ackIn = (body.acknowledgments ?? {}) as Record<string, unknown>;
  const acknowledgments = Object.fromEntries(a.required_acks.map((k) => [k, ackIn[k] === true]));
  const entity = (body.entity && typeof body.entity === "object" ? body.entity : {}) as Record<string, unknown>;
  const entityText = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : "");

  const { data, error } = await admin.rpc("partner_sign_agreement", {
    p_agreement_id: a.id,
    p_legal_name: text(body.legalName),
    p_title: text(body.title),
    p_typed_signature: text(body.typedSignature),
    p_acknowledgments: acknowledgments,
    p_agreement_sha256: typeof body.agreementSha256 === "string" ? body.agreementSha256 : "",
    p_ip: ip.slice(0, 100),
    p_user_agent: String(req.headers["user-agent"] ?? "").slice(0, 400),
    p_entity_name: entityText(entity.name, 200),
    p_entity_type: entityText(entity.type, 40),
    // "Missouri" or "mo" → "MO"; anything else fails the database's check.
    p_entity_state: usStateCode(entity.state) ?? entityText(entity.state, 40),
    p_business_address: entityText(entity.address, 300),
  });
  if (error || !data) throw partnerAgreementDbError(error, "Could not record your signature. Try again.");
  const r = data as { activated?: boolean; awaitingCountersign?: boolean };
  const activated = Boolean(r.activated);
  const awaitingCountersign = Boolean(r.awaitingCountersign);

  // The signature stands even if the PDF or an email hits a snag.
  const done = await completeSigning(admin, a.id, { activated, awaitingCountersign });
  return { ok: true, activated, awaitingCountersign, kind: a.kind, pdfEmailed: done.emailed };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!["GET", "POST"].includes(req.method ?? "")) return methodNotAllowed(res, ["GET", "POST"]);
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Robots-Tag", "noindex");
  try {
    const admin = getSupabaseAdmin();
    if (req.method === "GET") return sendJson(res, 200, await view(admin, req));
    return sendJson(res, 200, await sign(admin, req));
  } catch (err) {
    if (err instanceof HttpError) return sendJson(res, err.status, { ok: false, message: err.message });
    console.error("[partner-agreement] unexpected", err);
    return sendJson(res, 500, { ok: false, message: "Something went wrong. Try again." });
  }
}
