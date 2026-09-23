import type { VercelRequest, VercelResponse } from "@vercel/node";
import {
  HttpError,
  methodNotAllowed,
  readJsonBody,
  sendJson,
} from "../../_lib/http.js";
import { requireStaff } from "../../_lib/adminAuth.js";
import { getSupabaseAdmin } from "../../_lib/supabaseAdmin.js";
import { getSessionOr404 } from "../../_lib/scan.js";
import type { Database } from "../../../src/types/database.js";

// PATCH /api/admin/scan-sessions/:id — update status and/or note.
// DELETE /api/admin/scan-sessions/:id — permanently remove an uncommitted
// session, its card_scans rows (via FK cascade), and uploaded scan images.
// Active sessions containing scans already linked to inventory are protected.
// Completed sessions may be deleted; inventory rows remain untouched while the
// session/scans/images are removed.

type SessionStatus = Database["public"]["Enums"]["scan_session_status"];
const STATUSES = new Set<SessionStatus>([
  "uploading",
  "processing",
  "pending_review",
  "reviewing",
  "completed",
  "partially_failed",
  "failed",
]);

interface Body {
  status?: SessionStatus;
  note?: string | null;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "PATCH" && req.method !== "DELETE") {
    return methodNotAllowed(res, ["PATCH", "DELETE"]);
  }
  try {
    await requireStaff(req);
    const id = String(req.query.id ?? "");
    if (!id) throw new HttpError(400, "Session id is required.");

    const body = (await readJsonBody(req)) as Body;
    const admin = getSupabaseAdmin();
    const session = await getSessionOr404(admin, id);

    if (req.method === "DELETE") {
      const { data: scans, error: scansErr } = await admin
        .from("card_scans")
        .select(
          "id, review_status, inventory_item_id, front_image_path, back_image_path, front_preview_path, back_preview_path",
        )
        .eq("scan_session_id", id);
      if (scansErr) throw new HttpError(500, "Could not inspect the scan session.");

      const hasInventoryLinks = (scans ?? []).some(
        (scan) => scan.review_status === "added" || scan.inventory_item_id,
      );
      if (hasInventoryLinks && session.status !== "completed") {
        throw new HttpError(
          409,
          "This session contains cards already added to inventory. Complete the session before deleting it.",
        );
      }

      const imagePaths = Array.from(
        new Set(
          (scans ?? []).flatMap((scan) =>
            [
              scan.front_image_path,
              scan.back_image_path,
              scan.front_preview_path,
              scan.back_preview_path,
            ].filter((path): path is string => Boolean(path)),
          ),
        ),
      );

      const { error: deleteErr } = await admin
        .from("scan_sessions")
        .delete()
        .eq("id", id);
      if (deleteErr) throw new HttpError(500, "Could not delete the scan session.");

      // Storage cleanup is best-effort after the database delete, matching the
      // existing single-scan deletion posture. A storage hiccup should not
      // resurrect an already-deleted database session.
      for (let i = 0; i < imagePaths.length; i += 500) {
        const { error: storageErr } = await admin.storage
          .from("card-scans")
          .remove(imagePaths.slice(i, i + 500));
        if (storageErr) {
          console.warn(
            "Deleted scan session but could not remove some scan images:",
            storageErr.message,
          );
        }
      }

      return sendJson(res, 200, { ok: true, deletedId: id });
    }

    const patch: Database["public"]["Tables"]["scan_sessions"]["Update"] = {};
    if (body.status !== undefined) {
      if (!STATUSES.has(body.status)) throw new HttpError(400, "Invalid status.");
      patch.status = body.status;
    }
    if (body.note !== undefined) patch.note = body.note;

    if (Object.keys(patch).length > 0) {
      const { error } = await admin
        .from("scan_sessions")
        .update(patch)
        .eq("id", id);
      if (error) throw new HttpError(500, "Could not update the scan session.");
    }

    const fresh = await getSessionOr404(admin, id);
    return sendJson(res, 200, fresh as unknown as Record<string, unknown>);
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 500;
    const message =
      err instanceof HttpError ? err.message : "Unexpected server error.";
    return sendJson(res, status, { ok: false, message });
  }
}
