import type { VercelRequest, VercelResponse } from "@vercel/node";
import {
  HttpError,
  methodNotAllowed,
  readJsonBody,
  sendJson,
} from "../../_lib/http.js";
import { requireStaff, type StaffContext } from "../../_lib/adminAuth.js";
import { getSupabaseAdmin } from "../../_lib/supabaseAdmin.js";
import { recomputeSession } from "../../_lib/scan.js";
import type { Database } from "../../../src/types/database.js";

// PATCH /api/admin/scans/bulk — safe bulk field edits across scanIds.
//
// Not nested under scan-sessions/:id — ScanRepository.bulkUpdate(scanIds,
// patch, reviewer) doesn't carry a sessionId either; the affected scans'
// OWN scan_session_id values are used to recompute session rollups after.
//
// Intentionally NEVER accepts selectedScryfallId/selectedPrinting — the mock
// enforces the same rule (each card must be matched to its exact printing
// individually) and the review UI's BulkActionsModal already only offers
// storageLocation/costCents/notes/reviewStatus, but the server enforces it
// too rather than trusting the client to keep leaving those fields out.

type ReviewStatus = Database["public"]["Enums"]["card_scan_review_status"];
const REVIEW_STATUSES = new Set<ReviewStatus>([
  "unreviewed",
  "pending_match",
  "matched",
  "needs_manual_match",
  "ready",
  "added",
  "rejected",
  "error",
]);

interface Body {
  scanIds?: string[];
  storageLocation?: string | null;
  costCents?: number | null;
  notes?: string | null;
  reviewStatus?: ReviewStatus;
  actor?: string | null;
}

function actorLabel(staff: StaffContext, bodyActor?: string | null): string {
  return (bodyActor && bodyActor.trim()) || staff.email || staff.userId;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "PATCH") return methodNotAllowed(res, ["PATCH"]);
  try {
    const staff = await requireStaff(req);
    const body = (await readJsonBody(req)) as Body;
    const scanIds = Array.isArray(body.scanIds) ? body.scanIds.filter(Boolean) : [];
    if (scanIds.length === 0) throw new HttpError(400, "No scans selected.");

    const admin = getSupabaseAdmin();

    const patch: Database["public"]["Tables"]["card_scans"]["Update"] = {
      reviewed_by: actorLabel(staff, body.actor),
      reviewed_at: new Date().toISOString(),
    };
    if (body.storageLocation !== undefined) patch.storage_location = body.storageLocation;
    if (body.costCents !== undefined) {
      patch.cost_cents =
        body.costCents == null ? null : Math.max(0, Math.round(body.costCents));
    }
    if (body.notes !== undefined) patch.notes = body.notes;
    if (body.reviewStatus !== undefined) {
      if (!REVIEW_STATUSES.has(body.reviewStatus)) {
        throw new HttpError(400, "Invalid review status.");
      }
      patch.review_status = body.reviewStatus;
    }

    const { data, error } = await admin
      .from("card_scans")
      .update(patch)
      .in("id", scanIds)
      .select("*, card_printings!selected_scryfall_id(*)");
    if (error) throw new HttpError(500, "Could not apply the bulk update.");

    const affected = data ?? [];
    const sessionIds = new Set(affected.map((s) => s.scan_session_id));
    for (const sessionId of sessionIds) {
      await recomputeSession(admin, sessionId);
    }

    return sendJson(res, 200, { scans: affected });
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 500;
    const message =
      err instanceof HttpError ? err.message : "Unexpected server error.";
    return sendJson(res, status, { ok: false, message });
  }
}
