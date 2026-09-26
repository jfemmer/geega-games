import crypto from "node:crypto";
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { HttpError, methodNotAllowed, readJsonBody, sendJson } from "../../_lib/http.js";
import { requireStaff } from "../../_lib/adminAuth.js";
import { getSupabaseAdmin } from "../../_lib/supabaseAdmin.js";
import { logAdminAction } from "../../_lib/auditLog.js";
import { PHOTO_REQUEST_BUCKET, sendPhotoRequestPhotos } from "../../_lib/photoRequestEmails.js";
import {
  PHOTO_REQUEST_MAX_PHOTOS,
  PHOTO_REQUEST_MAX_PHOTO_BYTES,
  PHOTO_REQUEST_MAX_STAFF_MESSAGE,
  PHOTO_REQUEST_PHOTO_TYPES,
} from "../../../src/store/lib/photoRequestTypes.js";

// /api/admin/photo-requests/:id — staff only. Answers a shopper's photo
// request from the admin Inventory → Photo requests tab.
//
//   POST { action: "upload_urls", files: [{ mimeType, sizeBytes }] }
//        → signed Storage upload URLs under <id>/ in the private
//          photo-request-photos bucket (bytes never pass through here)
//   POST { action: "send", paths: string[], message?: string }
//        → emails those photos to the shopper as attachments, then marks the
//          request "sent". Paths must exist under <id>/ in Storage.
//   PATCH { status: "closed" | "new" }
//        → close without sending (e.g. the card sold), or reopen.
//
// photo_requests has no write grant for `authenticated` (see its migration),
// so this service_role endpoint is the only way to change a request.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PHOTO_TYPES = new Set<string>(PHOTO_REQUEST_PHOTO_TYPES);
const EXT_BY_TYPE: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

interface PostBody {
  action?: unknown;
  files?: unknown;
  paths?: unknown;
  message?: unknown;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST" && req.method !== "PATCH") return methodNotAllowed(res, ["POST", "PATCH"]);
  try {
    const staff = await requireStaff(req);
    const id = String(req.query.id ?? "");
    if (!UUID_RE.test(id)) throw new HttpError(400, "Request id is required.");

    const admin = getSupabaseAdmin();
    const { data: request, error: loadErr } = await admin
      .from("photo_requests")
      .select("id, status, photo_paths, send_count")
      .eq("id", id)
      .maybeSingle();
    if (loadErr) throw new HttpError(500, loadErr.message);
    if (!request) throw new HttpError(404, "Photo request not found.");

    if (req.method === "PATCH") {
      const body = (await readJsonBody(req, 1024)) as { status?: unknown };
      if (body.status !== "closed" && body.status !== "new") throw new HttpError(400, "Invalid status.");
      const { error } = await admin
        .from("photo_requests")
        .update({ status: body.status, closed_at: body.status === "closed" ? new Date().toISOString() : null })
        .eq("id", id);
      if (error) throw new HttpError(500, error.message);
      await logAdminAction(admin, staff, {
        action: body.status === "closed" ? "photo_request.close" : "photo_request.reopen",
        resourceType: "photo_request",
        resourceId: id,
        before: { status: request.status },
        after: { status: body.status },
      });
      return sendJson(res, 200, { ok: true });
    }

    const body = (await readJsonBody(req, 16 * 1024)) as PostBody;

    if (body.action === "upload_urls") {
      const files = Array.isArray(body.files) ? body.files : [];
      if (files.length === 0) throw new HttpError(400, "No files provided.");
      if (files.length > PHOTO_REQUEST_MAX_PHOTOS) {
        throw new HttpError(400, `You can send up to ${PHOTO_REQUEST_MAX_PHOTOS} photos at a time.`);
      }
      const uploads = await Promise.all(
        files.map(async (raw) => {
          const f = (raw ?? {}) as { mimeType?: unknown; sizeBytes?: unknown };
          const mimeType = typeof f.mimeType === "string" ? f.mimeType.toLowerCase() : "";
          const size = typeof f.sizeBytes === "number" ? f.sizeBytes : 0;
          if (!PHOTO_TYPES.has(mimeType)) throw new HttpError(400, "Photos must be JPEG, PNG or WebP.");
          if (size <= 0 || size > PHOTO_REQUEST_MAX_PHOTO_BYTES) {
            throw new HttpError(400, "Each photo must be under 10 MB.");
          }
          const path = `${id}/${crypto.randomUUID()}.${EXT_BY_TYPE[mimeType]}`;
          const { data, error } = await admin.storage.from(PHOTO_REQUEST_BUCKET).createSignedUploadUrl(path);
          if (error || !data) throw new HttpError(500, "Could not start the photo upload.");
          return { path: data.path, signedUrl: data.signedUrl };
        }),
      );
      return sendJson(res, 200, { uploads });
    }

    if (body.action === "send") {
      if (request.status === "closed") throw new HttpError(409, "This request is closed. Reopen it to send photos.");
      const requested = Array.isArray(body.paths)
        ? [...new Set(body.paths.filter((p): p is string => typeof p === "string" && p.startsWith(`${id}/`)))]
        : [];
      if (requested.length === 0) throw new HttpError(400, "Add at least one photo.");
      if (requested.length > PHOTO_REQUEST_MAX_PHOTOS) {
        throw new HttpError(400, `You can send up to ${PHOTO_REQUEST_MAX_PHOTOS} photos at a time.`);
      }
      const message =
        typeof body.message === "string" && body.message.trim()
          ? body.message.trim().slice(0, PHOTO_REQUEST_MAX_STAFF_MESSAGE)
          : null;

      // Only send files Storage confirms were actually uploaded for this request.
      const { data: listed, error: listErr } = await admin.storage
        .from(PHOTO_REQUEST_BUCKET)
        .list(id, { limit: 100 });
      if (listErr) throw new HttpError(500, "Could not verify the uploaded photos.");
      const existing = new Set((listed ?? []).map((f) => `${id}/${f.name}`));
      const paths = requested.filter((p) => existing.has(p));
      if (paths.length !== requested.length) {
        throw new HttpError(400, "Some photos didn't finish uploading. Remove them and try again.");
      }

      let result;
      try {
        result = await sendPhotoRequestPhotos(id, paths, message);
      } catch (err) {
        console.error("[/api/admin/photo-requests] send failed:", err, "request:", id);
        throw new HttpError(502, "The email couldn't be sent. Please try again.");
      }
      if (result.status === "failed") {
        throw new HttpError(502, `The email couldn't be sent: ${result.error}`);
      }
      if (result.status === "skipped") throw new HttpError(400, "Nothing to send.");

      const allPaths = [...new Set([...request.photo_paths, ...paths])].slice(-12);
      const { error: updErr } = await admin
        .from("photo_requests")
        .update({
          status: "sent",
          photo_paths: allPaths,
          staff_message: message,
          sent_at: new Date().toISOString(),
          sent_by: staff.userId,
          send_count: request.send_count + (result.status === "sent" ? 1 : 0),
          closed_at: null,
        })
        .eq("id", id);
      if (updErr) console.error("[/api/admin/photo-requests] status update failed:", updErr, "request:", id);

      await logAdminAction(admin, staff, {
        action: "photo_request.send",
        resourceType: "photo_request",
        resourceId: id,
        before: { status: request.status },
        after: { status: "sent", photos: paths.length, deduped: result.status === "deduped" },
      });
      return sendJson(res, 200, { ok: true, deduped: result.status === "deduped" });
    }

    throw new HttpError(400, "Invalid action.");
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 500;
    const message = err instanceof HttpError ? err.message : "Unexpected server error.";
    if (!(err instanceof HttpError)) console.error("[/api/admin/photo-requests] error:", err);
    return sendJson(res, status, { ok: false, message });
  }
}
