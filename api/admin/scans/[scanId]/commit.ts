import type { VercelRequest, VercelResponse } from "@vercel/node";
import { HttpError, methodNotAllowed, sendJson } from "../../../_lib/http.js";
import { requireStaff } from "../../../_lib/adminAuth.js";
import { getSupabaseAdmin } from "../../../_lib/supabaseAdmin.js";
import { commitScanToInventory, recomputeSession } from "../../../_lib/scan.js";

// POST /api/admin/scans/:scanId/commit
//
// Commit ONE reviewed scan to inventory (reason='scan_add'). Idempotent —
// see commitScanToInventory. Not nested under scan-sessions/:id —
// ScanRepository.commitScan(scanId, reviewer) doesn't carry a sessionId.

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return methodNotAllowed(res, ["POST"]);
  try {
    const staff = await requireStaff(req);
    const scanId = String(req.query.scanId ?? "");
    if (!scanId) throw new HttpError(400, "Scan id is required.");

    const admin = getSupabaseAdmin();
    const { data: scan, error: scanErr } = await admin
      .from("card_scans")
      .select("*")
      .eq("id", scanId)
      .maybeSingle();
    if (scanErr) throw new HttpError(500, "Could not load the scan.");
    if (!scan) throw new HttpError(404, "Scan not found.");

    await commitScanToInventory(admin, scan, staff.email || staff.userId, "scan_add");
    await recomputeSession(admin, scan.scan_session_id);

    const { data: fresh, error } = await admin
      .from("card_scans")
      .select("*, card_printings!selected_scryfall_id(*)")
      .eq("id", scanId)
      .single();
    if (error) throw new HttpError(500, "Could not reload the scan.");

    return sendJson(res, 200, fresh as unknown as Record<string, unknown>);
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 500;
    const message =
      err instanceof HttpError ? err.message : "Unexpected server error.";
    return sendJson(res, status, { ok: false, message });
  }
}
