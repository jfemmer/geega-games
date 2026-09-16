import type { VercelRequest, VercelResponse } from "@vercel/node";
import {
  HttpError,
  methodNotAllowed,
  readJsonBody,
  sendJson,
} from "../_lib/http.js";
import { getSupabaseAdmin } from "../_lib/supabaseAdmin.js";
import { checkRateLimit, getClientIp } from "../_lib/rateLimit.js";
import {
  buildSellPhotoPath,
  isAllowedPhotoMimeType,
  isValidDraftId,
  listDraftPhotos,
  MAX_PHOTOS_PER_SUBMISSION,
  SELL_PHOTOS_BUCKET,
} from "../_lib/sell.js";

// POST /api/sell/photo-uploads
//
// PUBLIC. Mints signed Storage UPLOAD URLs for the private sell-photos
// bucket, exactly like /api/admin/scan-sessions/:id/uploads does for staff —
// no bytes pass through this function, and the browser uploads directly to
// each signedUrl. The bucket has no public INSERT policy; a signed upload
// URL is a short-lived, single-file token minted with the service_role key.
//
// There is no submission row yet at this point (the seller may still be
// filling out the form), so uploads are namespaced under a client-generated
// `draftId` (a random UUID with no other meaning — never treated as a
// secret or as proof of ownership). At final submit, /api/sell/submit lists
// what actually landed under that prefix and attaches it to the real
// submission; nothing here writes to the database.
//
// Real validation:
//   - the bucket itself enforces file_size_limit + allowed_mime_types
//     (Storage-side, not just this function trusting the client)
//   - this function additionally checks the declared mimeType against the
//     same allowlist up front, so a bad file gets a clear error immediately
//     rather than an opaque failure at PUT time
//   - a running per-draft count keeps one draft from accumulating far more
//     photos than the feature is meant to support

interface FileReq {
  fileName: string;
  mimeType: string;
  sizeBytes: number;
}

interface Body {
  draftId?: string;
  files?: FileReq[];
}

const MAX_FILES_PER_REQUEST = 20;
const MAX_FILE_SIZE_BYTES = 15 * 1024 * 1024; // matches the bucket's file_size_limit
const MAX_FILENAME_LENGTH = 200;
const RATE_LIMIT_PER_WINDOW = 60;
const RATE_WINDOW_MS = 60_000;

function isValidFile(f: unknown): f is FileReq {
  if (!f || typeof f !== "object") return false;
  const r = f as Record<string, unknown>;
  return (
    typeof r.fileName === "string" &&
    r.fileName.length > 0 &&
    r.fileName.length <= MAX_FILENAME_LENGTH &&
    typeof r.mimeType === "string" &&
    typeof r.sizeBytes === "number" &&
    Number.isFinite(r.sizeBytes) &&
    r.sizeBytes > 0
  );
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return methodNotAllowed(res, ["POST"]);
  try {
    const ip = getClientIp(req);
    const rl = checkRateLimit("sell-photo-uploads", ip, RATE_LIMIT_PER_WINDOW, RATE_WINDOW_MS);
    if (!rl.allowed) {
      res.setHeader("Retry-After", String(Math.ceil((rl.retryAfterMs ?? 1000) / 1000)));
      throw new HttpError(429, "Too many upload requests. Please wait a moment and try again.");
    }

    const body = (await readJsonBody(req, 16 * 1024)) as Body;
    if (!isValidDraftId(body.draftId)) {
      throw new HttpError(400, "Missing or invalid draft id.");
    }
    const draftId = body.draftId;

    const files = Array.isArray(body.files) ? body.files : [];
    if (files.length === 0) throw new HttpError(400, "No files provided.");
    if (files.length > MAX_FILES_PER_REQUEST) {
      throw new HttpError(400, `Too many files in one request (max ${MAX_FILES_PER_REQUEST}).`);
    }
    if (!files.every(isValidFile)) {
      throw new HttpError(400, "Each file needs a fileName, mimeType, and sizeBytes.");
    }
    for (const f of files) {
      if (!isAllowedPhotoMimeType(f.mimeType)) {
        throw new HttpError(400, `${f.fileName}: unsupported image type.`);
      }
      if (f.sizeBytes > MAX_FILE_SIZE_BYTES) {
        throw new HttpError(400, `${f.fileName}: file is too large (max 15 MB).`);
      }
    }

    const admin = getSupabaseAdmin();

    const existing = await listDraftPhotos(admin, draftId);
    if (existing.length + files.length > MAX_PHOTOS_PER_SUBMISSION) {
      throw new HttpError(
        400,
        `This submission already has ${existing.length} photo(s); the maximum is ${MAX_PHOTOS_PER_SUBMISSION}.`,
      );
    }

    const results = await Promise.all(
      files.map(async (f) => {
        const path = buildSellPhotoPath(draftId, f.fileName);
        const { data, error } = await admin.storage
          .from(SELL_PHOTOS_BUCKET)
          .createSignedUploadUrl(path);
        if (error || !data) {
          return {
            fileName: f.fileName,
            error: error?.message ?? "Could not create an upload URL.",
          };
        }
        return {
          fileName: f.fileName,
          path: data.path,
          token: data.token,
          signedUrl: data.signedUrl,
        };
      }),
    );

    return sendJson(res, 200, { uploads: results });
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 500;
    const message = err instanceof HttpError ? err.message : "Unexpected server error.";
    return sendJson(res, status, { ok: false, message });
  }
}
