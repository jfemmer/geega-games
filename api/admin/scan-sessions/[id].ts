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

// PATCH /api/admin/scan-sessions/:id — update status and/or note. Both
// optional and independent, same "only provided keys change" pattern as
// PATCH /api/admin/inventory/:id.

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
  if (req.method !== "PATCH") return methodNotAllowed(res, ["PATCH"]);
  try {
    await requireStaff(req);
    const id = String(req.query.id ?? "");
    if (!id) throw new HttpError(400, "Session id is required.");

    const body = (await readJsonBody(req)) as Body;
    const admin = getSupabaseAdmin();
    await getSessionOr404(admin, id);

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
