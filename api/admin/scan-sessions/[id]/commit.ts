import type { VercelRequest, VercelResponse } from "@vercel/node";
import { HttpError, methodNotAllowed, sendJson } from "../../../_lib/http.js";
import { requireStaff, type StaffContext } from "../../../_lib/adminAuth.js";
import { getSupabaseAdmin } from "../../../_lib/supabaseAdmin.js";
import {
  commitScanToInventory,
  getSessionOr404,
  recomputeSession,
  validateScanForCommit,
} from "../../../_lib/scan.js";
import type { Database } from "../../../../src/types/database.js";

// GET  /api/admin/scan-sessions/:id/commit — preview (read-only)
// POST /api/admin/scan-sessions/:id/commit — commit all 'ready' scans
//
// Each ready scan commits individually and transactionally (via
// admin_upsert_inventory, reason='batch_scan_add') — a failure on one scan
// is recorded and skipped, never rolling back scans that already succeeded,
// and a scan that already carries inventory_item_id is a no-op (so retrying
// this endpoint after a partial failure never double-adds).

type CardScanRow = Database["public"]["Tables"]["card_scans"]["Row"];

function actorLabel(staff: StaffContext): string {
  return staff.email || staff.userId;
}

async function readyScans(
  admin: ReturnType<typeof getSupabaseAdmin>,
  sessionId: string,
): Promise<CardScanRow[]> {
  const { data, error } = await admin
    .from("card_scans")
    .select("*")
    .eq("scan_session_id", sessionId)
    .eq("review_status", "ready")
    .order("sequence_number", { ascending: true });
  if (error) throw new HttpError(500, "Could not load ready scans.");
  return data ?? [];
}

async function handlePreview(req: VercelRequest, res: VercelResponse) {
  await requireStaff(req);
  const sessionId = String(req.query.id ?? "");
  if (!sessionId) throw new HttpError(400, "Session id is required.");

  const admin = getSupabaseAdmin();
  await getSessionOr404(admin, sessionId);
  const ready = await readyScans(admin, sessionId);

  let willCreate = 0;
  let willIncrement = 0;
  const errors: { scanId: string; sequenceNumber: number; reason: string }[] = [];

  for (const scan of ready) {
    const problem = validateScanForCommit(scan);
    if (problem) {
      errors.push({ scanId: scan.id, sequenceNumber: scan.sequence_number, reason: problem });
      continue;
    }
    if (scan.inventory_item_id) continue; // already added, not counted either way
    const { data: existing } = await admin
      .from("inventory_items")
      .select("id")
      .eq("status", "active")
      .eq("scryfall_id", scan.selected_scryfall_id!)
      .eq("condition", scan.confirmed_condition!)
      .eq("finish", scan.selected_finish!)
      .limit(1)
      .maybeSingle();
    if (existing) willIncrement += 1;
    else willCreate += 1;
  }

  return sendJson(res, 200, {
    readyCount: ready.length,
    willCreateCount: willCreate,
    willIncrementCount: willIncrement,
    errorCount: errors.length,
    errors,
  });
}

async function handleCommit(req: VercelRequest, res: VercelResponse) {
  const staff = await requireStaff(req);
  const sessionId = String(req.query.id ?? "");
  if (!sessionId) throw new HttpError(400, "Session id is required.");

  const admin = getSupabaseAdmin();
  await getSessionOr404(admin, sessionId);
  const ready = await readyScans(admin, sessionId);

  let created = 0;
  let incremented = 0;
  const failures: { scanId: string; sequenceNumber: number; reason: string }[] = [];

  for (const scan of ready) {
    try {
      const result = await commitScanToInventory(
        admin,
        scan,
        actorLabel(staff),
        "batch_scan_add",
      );
      if (result.outcome === "created") created += 1;
      else incremented += 1;
    } catch (err) {
      failures.push({
        scanId: scan.id,
        sequenceNumber: scan.sequence_number,
        reason: err instanceof HttpError ? err.message : "Unknown error",
      });
    }
  }

  await recomputeSession(admin, sessionId);

  return sendJson(res, 200, {
    addedCount: created + incremented,
    createdCount: created,
    incrementedCount: incremented,
    failedCount: failures.length,
    failures,
  });
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method === "GET") return await handlePreview(req, res);
    if (req.method === "POST") return await handleCommit(req, res);
    return methodNotAllowed(res, ["GET", "POST"]);
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 500;
    const message =
      err instanceof HttpError ? err.message : "Unexpected server error.";
    return sendJson(res, status, { ok: false, message });
  }
}
