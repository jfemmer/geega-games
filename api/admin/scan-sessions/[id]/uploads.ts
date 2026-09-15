import type { VercelRequest, VercelResponse } from "@vercel/node";
import {
  HttpError,
  methodNotAllowed,
  readJsonBody,
  sendJson,
} from "../../../_lib/http.js";
import { requireStaff } from "../../../_lib/adminAuth.js";
import { getSupabaseAdmin } from "../../../_lib/supabaseAdmin.js";
import { buildStoragePath, getSessionOr404, SCAN_BUCKET } from "../../../_lib/scan.js";

// POST /api/admin/scan-sessions/:id/uploads
//
// Mints one signed Storage UPLOAD URL per requested file (no bytes pass
// through this function — Vercel's body/duration limits make that a poor
// fit for hundreds of multi-MB 600 DPI scans). The card-scans bucket is
// private with no browser INSERT policy — a signed upload URL is a
// short-lived, single-file token issued with the service_role key that lets
// the browser PUT directly to Storage without needing that policy. The
// browser then uploads to each signedUrl itself and reports successes to
// POST .../ingest, which is what actually creates card_scans rows (so a
// failed or never-attempted upload never becomes a phantom scan).

interface FileReq {
  fileName: string;
  side: "front" | "back";
  sequenceHint: number;
}

interface Body {
  files?: FileReq[];
}

const MAX_FILES_PER_REQUEST = 500;

function isValidFile(f: unknown): f is FileReq {
  if (!f || typeof f !== "object") return false;
  const r = f as Record<string, unknown>;
  return (
    typeof r.fileName === "string" &&
    r.fileName.length > 0 &&
    (r.side === "front" || r.side === "back") &&
    typeof r.sequenceHint === "number" &&
    Number.isFinite(r.sequenceHint)
  );
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return methodNotAllowed(res, ["POST"]);
  try {
    await requireStaff(req);
    const sessionId = String(req.query.id ?? "");
    if (!sessionId) throw new HttpError(400, "Session id is required.");

    const body = (await readJsonBody(req)) as Body;
    const files = Array.isArray(body.files) ? body.files : [];
    if (files.length === 0) throw new HttpError(400, "No files provided.");
    if (files.length > MAX_FILES_PER_REQUEST) {
      throw new HttpError(
        400,
        `Too many files in one request (max ${MAX_FILES_PER_REQUEST}). Split into smaller batches.`,
      );
    }
    if (!files.every(isValidFile)) {
      throw new HttpError(400, "Each file needs a fileName, side, and sequenceHint.");
    }

    const admin = getSupabaseAdmin();
    await getSessionOr404(admin, sessionId);

    const results = await Promise.all(
      files.map(async (f) => {
        const path = buildStoragePath(sessionId, f);
        const { data, error } = await admin.storage
          .from(SCAN_BUCKET)
          .createSignedUploadUrl(path);
        if (error || !data) {
          return {
            fileName: f.fileName,
            side: f.side,
            sequenceHint: f.sequenceHint,
            error: error?.message ?? "Could not create an upload URL.",
          };
        }
        return {
          fileName: f.fileName,
          side: f.side,
          sequenceHint: f.sequenceHint,
          path: data.path,
          token: data.token,
          signedUrl: data.signedUrl,
        };
      }),
    );

    return sendJson(res, 200, { uploads: results });
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 500;
    const message =
      err instanceof HttpError ? err.message : "Unexpected server error.";
    return sendJson(res, status, { ok: false, message });
  }
}
