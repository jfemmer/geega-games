import type { VercelRequest, VercelResponse } from "@vercel/node";
import {
  HttpError,
  methodNotAllowed,
  readJsonBody,
  sendJson,
} from "../../_lib/http.js";
import { requireStaff } from "../../_lib/adminAuth.js";
import { getSupabaseAdmin } from "../../_lib/supabaseAdmin.js";
import type { Database } from "../../../src/types/database.js";

// POST /api/admin/scan-sessions
//
// Create a new batch scanning session. createdBy always comes from the
// verified staff identity (never a client-supplied name), matching the
// actorLabel pattern used by /api/admin/inventory/*.

type SourceType = Database["public"]["Enums"]["scan_source_type"];
const SOURCE_TYPES = new Set<SourceType>([
  "scanner_export",
  "file_upload",
  "folder_drop",
  "scanner_bridge",
]);

type ScanMode = Database["public"]["Enums"]["scan_recognition_mode"];
const SCAN_MODES = new Set<ScanMode>(["card_matching", "condition", "both"]);

interface Body {
  scannerName?: string | null;
  sourceType?: SourceType;
  scanMode?: ScanMode;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return methodNotAllowed(res, ["POST"]);
  try {
    const staff = await requireStaff(req);
    const body = (await readJsonBody(req)) as Body;

    const sourceType = body.sourceType ?? "scanner_export";
    if (!SOURCE_TYPES.has(sourceType)) {
      throw new HttpError(400, "Invalid source type.");
    }

    const scanMode = body.scanMode ?? "both";
    if (!SCAN_MODES.has(scanMode)) {
      throw new HttpError(400, "Invalid scan mode.");
    }

    const admin = getSupabaseAdmin();

    // A friendly sequential label ("Scan Session #N"). Not a uniqueness
    // guarantee under concurrent creates (there's no dedicated sequence) —
    // acceptable for a low-concurrency internal display label, never used
    // as an identity or key.
    const { count } = await admin
      .from("scan_sessions")
      .select("id", { count: "exact", head: true });

    const { data, error } = await admin
      .from("scan_sessions")
      .insert({
        label: `Scan Session #${(count ?? 0) + 1}`,
        created_by: staff.email ?? staff.userId,
        scanner_name: body.scannerName?.trim() || null,
        source_type: sourceType,
        scan_mode: scanMode,
        status: "uploading",
      })
      .select("*")
      .single();
    if (error) throw new HttpError(500, "Could not create the scan session.");

    return sendJson(res, 200, data as unknown as Record<string, unknown>);
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 500;
    const message =
      err instanceof HttpError ? err.message : "Unexpected server error.";
    return sendJson(res, status, { ok: false, message });
  }
}
