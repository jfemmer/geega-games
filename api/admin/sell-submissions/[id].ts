import type { VercelRequest, VercelResponse } from "@vercel/node";
import {
  HttpError,
  methodNotAllowed,
  readJsonBody,
  sendJson,
} from "../../_lib/http.js";
import { requireStaff } from "../../_lib/adminAuth.js";
import { getSupabaseAdmin } from "../../_lib/supabaseAdmin.js";
import { logAdminAction } from "../../_lib/auditLog.js";
import { forgetLeadNotifications, removeLeadPhotos } from "../../_lib/leadCleanup.js";
import {
  isNotifiableSellStatus,
  sendSellSubmissionStatusUpdate,
} from "../../_lib/sellSubmissionEmails.js";
import type { Database } from "../../../src/types/database.js";

// PATCH /api/admin/sell-submissions/:id
//
// Staff-only. Every write to sell_submissions goes through here (there is no
// UPDATE grant to `authenticated` at all — see the sell_submissions
// migration) so the internal-only fields (internal_notes, offer/purchase
// amounts) can never be touched by anything other than a verified staff
// session, and status transitions can set contacted_at/closed_at
// consistently in one place.
//
// DELETE /api/admin/sell-submissions/:id
//
// Owner-only (app role "admin"). Permanently deletes a buying lead: the
// submission, its card list and photo records (both cascade) and the
// seller's photos in Storage. Refused once store credit has been issued for
// it, since the credit in the seller's account points back at this lead.
// Recorded in the audit log without the seller's personal details.

type Status = Database["public"]["Enums"]["sell_submission_status"];
type Priority = Database["public"]["Enums"]["sell_priority"];

const STATUSES = new Set<Status>([
  "new",
  "reviewing",
  "needs_more_photos",
  "needs_in_person_review",
  "contacted",
  "offer_made",
  "accepted",
  "declined",
  "completed",
  "closed",
]);
const PRIORITIES = new Set<Priority>(["normal", "high_interest"]);
const CLOSED_STATUSES = new Set<Status>(["declined", "completed", "closed"]);

interface Body {
  status?: unknown;
  internalNotes?: unknown;
  priority?: unknown;
  favorited?: unknown;
  offerValueCents?: unknown;
  purchaseAmountCents?: unknown;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === "DELETE") return handleDelete(req, res);
  if (req.method !== "PATCH") return methodNotAllowed(res, ["PATCH", "DELETE"]);
  try {
    await requireStaff(req);
    const id = String(req.query.id ?? "");
    if (!id) throw new HttpError(400, "Submission id is required.");

    const body = (await readJsonBody(req, 8 * 1024)) as Body;
    const patch: Database["public"]["Tables"]["sell_submissions"]["Update"] = {};

    if (body.status !== undefined) {
      if (typeof body.status !== "string" || !STATUSES.has(body.status as Status)) {
        throw new HttpError(400, "Invalid status.");
      }
      const status = body.status as Status;
      patch.status = status;
      if (status === "contacted") patch.contacted_at = new Date().toISOString();
      if (CLOSED_STATUSES.has(status)) patch.closed_at = new Date().toISOString();
    }
    if (body.internalNotes !== undefined) {
      if (typeof body.internalNotes !== "string" || body.internalNotes.length > 10_000) {
        throw new HttpError(400, "Invalid internal notes.");
      }
      patch.internal_notes = body.internalNotes || null;
    }
    if (body.priority !== undefined) {
      if (typeof body.priority !== "string" || !PRIORITIES.has(body.priority as Priority)) {
        throw new HttpError(400, "Invalid priority.");
      }
      patch.priority = body.priority as Priority;
    }
    if (body.favorited !== undefined) {
      if (typeof body.favorited !== "boolean") throw new HttpError(400, "Invalid favorited value.");
      patch.favorited = body.favorited;
    }
    if (body.offerValueCents !== undefined) {
      if (body.offerValueCents !== null && (typeof body.offerValueCents !== "number" || body.offerValueCents < 0)) {
        throw new HttpError(400, "Invalid offer amount.");
      }
      patch.offer_value_cents = body.offerValueCents;
    }
    if (body.purchaseAmountCents !== undefined) {
      if (
        body.purchaseAmountCents !== null &&
        (typeof body.purchaseAmountCents !== "number" || body.purchaseAmountCents < 0)
      ) {
        throw new HttpError(400, "Invalid purchase amount.");
      }
      patch.purchase_amount_cents = body.purchaseAmountCents;
    }

    if (Object.keys(patch).length === 0) {
      throw new HttpError(400, "No changes provided.");
    }

    const admin = getSupabaseAdmin();
    const { data, error } = await admin
      .from("sell_submissions")
      .update(patch)
      .eq("id", id)
      .select("id")
      .maybeSingle();
    if (error) throw new HttpError(500, error.message);
    if (!data) throw new HttpError(404, "Submission not found.");

    // Email failure must not fail the status change — the submission is
    // already updated in the DB either way.
    if (patch.status && isNotifiableSellStatus(patch.status)) {
      try {
        await sendSellSubmissionStatusUpdate(id, patch.status);
      } catch (mailErr) {
        console.error("[admin/sell-submissions] status update email failed", mailErr);
      }
    }

    return sendJson(res, 200, { ok: true });
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 500;
    const message = err instanceof HttpError ? err.message : "Unexpected server error.";
    return sendJson(res, status, { ok: false, message });
  }
}

async function handleDelete(req: VercelRequest, res: VercelResponse) {
  try {
    const staff = await requireStaff(req);
    if (staff.role !== "admin") throw new HttpError(403, "Only the store owner can delete leads.");
    const id = String(req.query.id ?? "");
    if (!UUID_RE.test(id)) throw new HttpError(400, "Submission id is required.");

    const admin = getSupabaseAdmin();
    const { data: lead, error: readErr } = await admin
      .from("sell_submissions")
      .select(
        "id, reference_number, status, created_at, total_cards, offer_value_cents, purchase_amount_cents, payout_method, store_credit_issued_at",
      )
      .eq("id", id)
      .maybeSingle();
    if (readErr) throw new HttpError(500, readErr.message);
    if (!lead) throw new HttpError(404, "Lead not found.");
    if (lead.store_credit_issued_at) {
      throw new HttpError(
        409,
        "Store credit was issued for this lead, so it's kept as the record of that credit. Set it to Closed instead.",
      );
    }

    // Read the photo paths before the rows cascade away with the submission.
    const { data: photos, error: photosErr } = await admin
      .from("sell_submission_photos")
      .select("storage_path")
      .eq("submission_id", id);
    if (photosErr) throw new HttpError(500, photosErr.message);

    const { error: deleteErr } = await admin.from("sell_submissions").delete().eq("id", id);
    if (deleteErr) throw new HttpError(500, "Could not delete the lead. Please try again.");

    await removeLeadPhotos((photos ?? []).map((p) => p.storage_path), lead.reference_number);
    await forgetLeadNotifications("buying_lead", id);
    await logAdminAction(admin, staff, {
      action: "buying_lead.delete",
      resourceType: "sell_submission",
      resourceId: id,
      before: {
        reference_number: lead.reference_number,
        status: lead.status,
        created_at: lead.created_at,
        total_cards: lead.total_cards,
        offer_value_cents: lead.offer_value_cents,
        purchase_amount_cents: lead.purchase_amount_cents,
        payout_method: lead.payout_method,
        photo_count: photos?.length ?? 0,
      },
      after: null,
    });

    res.status(204).end();
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 500;
    const message = err instanceof HttpError ? err.message : "Unexpected server error.";
    return sendJson(res, status, { ok: false, message });
  }
}
