import type { StaffContext } from "./adminAuth.js";
import { logAdminAction } from "./auditLog.js";
import { getSupabaseAdmin } from "./supabaseAdmin.js";
import { HttpError } from "./http.js";
import { consignmentDbError, finalizeSignedCopy, sendInvitation, signedPdfLink } from "./consignments.js";
import { consignmentLabel, publishProblems } from "../../src/store/lib/consignmentAgreement.js";

// Admin > Consignments: consignors and consignments, invitations, agreement
// versions, and signed copies. Used by api/admin/consignments.ts.

type Admin = ReturnType<typeof getSupabaseAdmin>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const US_STATES = new Set(
  "AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY PR".split(" "),
);

function uuid(value: unknown, label: string): string {
  if (typeof value !== "string" || !UUID.test(value)) throw new HttpError(400, `Choose ${label}.`);
  return value;
}

function text(value: unknown, label: string, max: number, required = false): string | null {
  if (value === undefined || value === null || value === "") {
    if (required) throw new HttpError(400, `${label} is required.`);
    return null;
  }
  if (typeof value !== "string") throw new HttpError(400, `${label} must be text.`);
  const t = value.trim().replace(/\s+/g, " ");
  if (required && !t) throw new HttpError(400, `${label} is required.`);
  if (t.length > max) throw new HttpError(400, `${label} is too long.`);
  return t || null;
}

// ---------------------------------------------------------------- consignments

export interface ConsignmentListRow {
  id: string;
  consignmentNumber: number;
  label: string;
  status: string;
  createdAt: string;
  signedAt: string | null;
  consignor: { id: string; legalName: string; email: string; stateCode: string | null; hasAccount: boolean };
  agreement: { id: string; status: string; invitedAt: string; expiresAt: string; lastEmailedAt: string | null } | null;
}

export async function listConsignments(admin: Admin): Promise<ConsignmentListRow[]> {
  const { data: rows, error } = await admin
    .from("consignments")
    .select("id, consignment_number, status, created_at, signed_at, consignor_id")
    .order("created_at", { ascending: false })
    .limit(500);
  if (error) throw new HttpError(500, "Could not load consignments.");
  const consignorIds = [...new Set((rows ?? []).map((r) => r.consignor_id))];
  const ids = (rows ?? []).map((r) => r.id);
  const [consignors, agreements] = await Promise.all([
    consignorIds.length
      ? admin.from("consignors").select("id, legal_name, email, state_code, user_id").in("id", consignorIds)
      : Promise.resolve({ data: [], error: null }),
    ids.length
      ? admin
          .from("consignment_agreements")
          .select("id, consignment_id, status, invited_at, invite_expires_at, last_emailed_at, created_at")
          .in("consignment_id", ids)
          .neq("status", "void")
          .order("created_at", { ascending: false })
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (consignors.error || agreements.error) throw new HttpError(500, "Could not load consignments.");
  const byId = new Map((consignors.data ?? []).map((c) => [c.id, c]));
  const latest = new Map<string, NonNullable<typeof agreements.data>[number]>();
  for (const a of agreements.data ?? []) if (!latest.has(a.consignment_id)) latest.set(a.consignment_id, a);
  return (rows ?? []).map((r) => {
    const p = byId.get(r.consignor_id);
    const a = latest.get(r.id);
    return {
      id: r.id,
      consignmentNumber: r.consignment_number,
      label: consignmentLabel(r.consignment_number),
      status: r.status,
      createdAt: r.created_at,
      signedAt: r.signed_at,
      consignor: {
        id: r.consignor_id,
        legalName: p?.legal_name ?? "",
        email: p?.email ?? "",
        stateCode: p?.state_code ?? null,
        hasAccount: Boolean(p?.user_id),
      },
      agreement: a
        ? { id: a.id, status: a.status, invitedAt: a.invited_at, expiresAt: a.invite_expires_at, lastEmailedAt: a.last_emailed_at }
        : null,
    };
  });
}

export async function consignmentDetail(admin: Admin, id: string) {
  const { data: c, error } = await admin.from("consignments").select("*").eq("id", uuid(id, "a consignment")).maybeSingle();
  if (error) throw new HttpError(500, "Could not load that consignment.");
  if (!c) throw new HttpError(404, "That consignment isn't there.");
  const [consignor, agreements, signatures, elections] = await Promise.all([
    admin.from("consignors").select("*").eq("id", c.consignor_id).single(),
    admin
      .from("consignment_agreements")
      .select("id, version_id, status, rendered_sha256, invited_email, invited_at, invite_expires_at, invited_by, last_emailed_at, signed_at, voided_at, void_reason, voided_by, terms_snapshot")
      .eq("consignment_id", c.id)
      .order("created_at", { ascending: false }),
    admin
      .from("consignment_signatures")
      .select("id, agreement_id, legal_name, typed_signature, signer_email, signed_at, ip, user_agent, channels, additional_insurance, acknowledgments, agreement_sha256, record_sha256, pdf_path, pdf_sha256, emailed_at")
      .eq("consignment_id", c.id),
    admin.rpc("consignment_current_elections", { p_consignment_id: c.id }),
  ]);
  if (consignor.error || agreements.error || signatures.error) throw new HttpError(500, "Could not load that consignment.");
  return {
    consignment: { ...c, label: consignmentLabel(c.consignment_number) },
    consignor: consignor.data,
    agreements: agreements.data ?? [],
    signatures: (signatures.data ?? []).map((s) => ({ ...s, hasPdf: Boolean(s.pdf_path), pdf_path: undefined })),
    elections: elections.data ?? null,
  };
}

/**
 * New consignment for an existing consignor (by email) or a new one. Uses the
 * customer account with that email when there is one, so the consignor sees
 * it in their account.
 */
export async function createConsignment(admin: Admin, staff: StaffContext, body: Record<string, unknown>) {
  const raw = (body.consignor ?? {}) as Record<string, unknown>;
  const email = text(raw.email, "Email", 254, true)!.toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new HttpError(400, "Enter a valid email address.");
  const legalName = text(raw.legalName, "Full legal name", 200, true)!;
  if (legalName.length < 2) throw new HttpError(400, "Enter the consignor's full legal name.");
  const stateCode = text(raw.stateCode, "State of residence", 2)?.toUpperCase() ?? null;
  if (stateCode && !US_STATES.has(stateCode)) throw new HttpError(400, "Choose a US state of residence.");
  const postal = text(raw.postalCode, "ZIP code", 10);
  if (postal && !/^[0-9]{5}(-[0-9]{4})?$/.test(postal)) throw new HttpError(400, "Enter a 5-digit ZIP code.");
  const phone = text(raw.phone, "Phone", 30);
  if (phone && phone.replace(/\D/g, "").length < 7) throw new HttpError(400, "Enter a full phone number.");
  const fields = {
    legal_name: legalName,
    email,
    phone,
    address_line1: text(raw.addressLine1, "Address", 200),
    address_line2: text(raw.addressLine2, "Address line 2", 200),
    city: text(raw.city, "City", 100),
    state_code: stateCode,
    postal_code: postal,
  };
  const adminNotes = text(body.adminNotes, "Notes", 4000);

  // The customer account with this email, if any (case-insensitive).
  const { data: customer } = await admin.from("customers").select("auth_user_id").ilike("email", email).maybeSingle();
  const userId = (customer as { auth_user_id?: string | null } | null)?.auth_user_id ?? null;

  const { data: existing } = await admin.from("consignors").select("*").ilike("email", email).maybeSingle();
  let consignorId: string;
  if (existing) {
    consignorId = existing.id;
    const patch = { ...fields, ...(existing.user_id ? {} : userId ? { user_id: userId } : {}) };
    const { error } = await admin.from("consignors").update(patch).eq("id", existing.id);
    if (error) throw new HttpError(500, "Could not update the consignor.");
  } else {
    const { data: inserted, error } = await admin
      .from("consignors")
      .insert({ ...fields, user_id: userId, created_by: staff.email })
      .select("id")
      .single();
    if (error || !inserted) throw new HttpError(error?.code === "23505" ? 409 : 500, error?.code === "23505" ? "A consignor with that email or account already exists." : "Could not save the consignor.");
    consignorId = inserted.id;
  }

  const { data: settings } = await admin.from("consignment_settings").select("initial_term_days").maybeSingle();
  const { data: c, error: cErr } = await admin
    .from("consignments")
    .insert({ consignor_id: consignorId, admin_notes: adminNotes, created_by: staff.email, initial_term_days: settings?.initial_term_days ?? 90 })
    .select("id, consignment_number")
    .single();
  if (cErr || !c) throw new HttpError(500, "Could not create the consignment.");
  await logAdminAction(admin, staff, {
    action: "consignment.create",
    resourceType: "consignment",
    resourceId: c.id,
    after: { consignmentNumber: c.consignment_number, consignorId, email, legalName, adminNotes },
  });
  return { id: c.id, label: consignmentLabel(c.consignment_number) };
}

export async function inviteConsignor(admin: Admin, staff: StaffContext, body: Record<string, unknown>) {
  const id = uuid(body.consignmentId, "a consignment");
  const result = await sendInvitation(admin, id, staff.email);
  await logAdminAction(admin, staff, {
    action: "consignment.invite",
    resourceType: "consignment",
    resourceId: id,
    after: { agreementId: result.agreementId, emailed: result.emailed },
  });
  return result;
}

export async function voidAgreement(admin: Admin, staff: StaffContext, body: Record<string, unknown>) {
  const id = uuid(body.agreementId, "an agreement");
  const reason = text(body.reason, "Reason", 500, true)!;
  const { data, error } = await admin
    .from("consignment_agreements")
    .update({ status: "void", voided_at: new Date().toISOString(), void_reason: reason, voided_by: staff.email })
    .eq("id", id)
    .eq("status", "pending")
    .select("id, consignment_id")
    .maybeSingle();
  if (error) throw consignmentDbError(error, "Could not cancel that invitation.");
  if (!data) throw new HttpError(409, "Only an unsigned, open invitation can be cancelled.");
  await logAdminAction(admin, staff, { action: "consignment.agreement.void", resourceType: "consignment_agreement", resourceId: id, after: { reason } });
}

export async function resendSignedCopy(admin: Admin, staff: StaffContext, body: Record<string, unknown>) {
  const id = uuid(body.signatureId, "a signature");
  const result = await finalizeSignedCopy(admin, id, { resendEmail: true });
  await logAdminAction(admin, staff, { action: "consignment.signed_copy.resend", resourceType: "consignment_signature", resourceId: id, after: { ...result } });
  return result;
}

export async function staffPdfLink(admin: Admin, signatureId: string) {
  const { data: s } = await admin.from("consignment_signatures").select("id, pdf_path, consignment_id").eq("id", uuid(signatureId, "a signature")).maybeSingle();
  if (!s) throw new HttpError(404, "That signature isn't there.");
  let path = s.pdf_path;
  if (!path) {
    await finalizeSignedCopy(admin, s.id);
    path = (await admin.from("consignment_signatures").select("pdf_path").eq("id", s.id).single()).data?.pdf_path ?? null;
  }
  if (!path) throw new HttpError(503, "The signed copy isn't ready yet.");
  const { data: c } = await admin.from("consignments").select("consignment_number").eq("id", s.consignment_id).single();
  return { url: await signedPdfLink(admin, path, consignmentLabel(c!.consignment_number)) };
}

// ---------------------------------------------------------------- agreement versions

export async function listVersions(admin: Admin) {
  const { data, error } = await admin
    .from("consignment_agreement_versions")
    .select("id, version_number, title, body_md, body_sha256, change_summary, status, published_at, published_by, created_at, created_by, updated_at")
    .order("version_number", { ascending: false });
  if (error) throw new HttpError(500, "Could not load agreement versions.");
  return (data ?? []).map((v) => ({ ...v, problems: v.status === "draft" ? publishProblems(v.body_md) : [] }));
}

export async function saveDraft(admin: Admin, staff: StaffContext, body: Record<string, unknown>) {
  const bodyMd = typeof body.bodyMd === "string" ? body.bodyMd.replace(/\r\n/g, "\n") : "";
  if (bodyMd.trim().length < 100) throw new HttpError(400, "The agreement text is missing.");
  if (bodyMd.length > 200_000) throw new HttpError(400, "The agreement text is too long.");
  const title = text(body.title, "Title", 200, true)!;
  const changeSummary = text(body.changeSummary, "Summary of changes", 2000);
  if (body.id) {
    const id = uuid(body.id, "a draft");
    const { data, error } = await admin
      .from("consignment_agreement_versions")
      .update({ title, body_md: bodyMd, change_summary: changeSummary })
      .eq("id", id)
      .eq("status", "draft")
      .select("id, version_number")
      .maybeSingle();
    if (error) throw consignmentDbError(error, "Could not save the draft.");
    if (!data) throw new HttpError(409, "Only a draft can be edited. Make a new version instead.");
    await logAdminAction(admin, staff, { action: "consignment.agreement_version.save", resourceType: "consignment_agreement_version", resourceId: id, after: { versionNumber: data.version_number, title, changeSummary } });
    return data;
  }
  const { data: open } = await admin.from("consignment_agreement_versions").select("version_number").eq("status", "draft").maybeSingle();
  if (open) throw new HttpError(409, `Version ${open.version_number} is already a draft. Edit it instead of starting another.`);
  const { data: top } = await admin.from("consignment_agreement_versions").select("version_number").order("version_number", { ascending: false }).limit(1).maybeSingle();
  const { data, error } = await admin
    .from("consignment_agreement_versions")
    .insert({ version_number: (top?.version_number ?? 0) + 1, title, body_md: bodyMd, change_summary: changeSummary, created_by: staff.email })
    .select("id, version_number")
    .single();
  if (error || !data) throw consignmentDbError(error, "Could not create the draft.");
  await logAdminAction(admin, staff, { action: "consignment.agreement_version.create", resourceType: "consignment_agreement_version", resourceId: data.id, after: { versionNumber: data.version_number, title, changeSummary } });
  return data;
}

export async function deleteDraft(admin: Admin, staff: StaffContext, body: Record<string, unknown>) {
  const id = uuid(body.id, "a draft");
  const { data, error } = await admin.from("consignment_agreement_versions").delete().eq("id", id).eq("status", "draft").select("version_number").maybeSingle();
  if (error) throw consignmentDbError(error, "Could not delete the draft.");
  if (!data) throw new HttpError(409, "Only a draft can be deleted.");
  await logAdminAction(admin, staff, { action: "consignment.agreement_version.delete", resourceType: "consignment_agreement_version", resourceId: id, before: { versionNumber: data.version_number } });
}

/**
 * Publish a draft: it becomes the version new invitations use, and the one
 * it replaces is retired. Agreements already sent or signed keep their own
 * frozen text. Refused while blanks or attorney notes remain.
 */
export async function publishVersion(admin: Admin, staff: StaffContext, body: Record<string, unknown>) {
  const id = uuid(body.id, "a draft");
  if (body.confirm !== true) throw new HttpError(400, "Confirm the agreement has been reviewed before publishing it.");
  const { data: v, error } = await admin.from("consignment_agreement_versions").select("id, version_number, status, body_md").eq("id", id).maybeSingle();
  if (error) throw new HttpError(500, "Could not load the draft.");
  if (!v || v.status !== "draft") throw new HttpError(409, "Only a draft can be published.");
  const problems = publishProblems(v.body_md);
  if (problems.length) {
    throw new HttpError(409, `Fill in or remove these before publishing: ${problems.slice(0, 6).map((p) => p.text).join(", ")}${problems.length > 6 ? `, and ${problems.length - 6} more` : ""}.`);
  }
  const { data: current } = await admin.from("consignment_agreement_versions").select("version_number").eq("status", "published").maybeSingle();
  const { error: pErr } = await admin.rpc("consignment_publish_version", { p_version_id: id, p_actor: staff.email ?? "staff" });
  if (pErr) throw consignmentDbError(pErr, "Could not publish the draft.");
  await logAdminAction(admin, staff, {
    action: "consignment.agreement_version.publish",
    resourceType: "consignment_agreement_version",
    resourceId: id,
    before: current ? { publishedVersion: current.version_number } : null,
    after: { publishedVersion: v.version_number },
  });
}
