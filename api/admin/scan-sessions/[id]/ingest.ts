import type { VercelRequest, VercelResponse } from "@vercel/node";
import {
  HttpError,
  methodNotAllowed,
  readJsonBody,
  sendJson,
} from "../../../_lib/http.js";
import { requireStaff } from "../../../_lib/adminAuth.js";
import { getSupabaseAdmin } from "../../../_lib/supabaseAdmin.js";
import {
  filterUnseenUploads,
  getSessionOr404,
  pairUploads,
  recomputeSession,
} from "../../../_lib/scan.js";

// POST /api/admin/scan-sessions/:id/ingest
//
// Finalizes files the browser has ALREADY uploaded to Storage (via signed
// URLs from POST .../uploads) into real card_scans rows: pairs front/back by
// sequenceHint (mirrors the mock's pairFiles), assigns each pair the next
// sequence_number continuing from whatever's already in this session (so
// multiple ingest calls into one session preserve global scan order), and
// inserts. Files that failed to upload never reach this endpoint at all —
// the repository only reports successes here — so there's no per-pair
// failure mode to handle on this side.
//
// Idempotent per Storage path: since POST .../uploads mints a fresh unique
// path per upload attempt, a RETRIED ingest call (uploads already
// succeeded, but the client never saw this endpoint's response) would
// resubmit the SAME paths — those are detected against existing rows and
// skipped rather than re-inserted, so a retry can't double a physical scan.

interface UploadRef {
  fileName: string;
  side: "front" | "back";
  sequenceHint: number;
  path: string;
}

interface Body {
  uploads?: UploadRef[];
}

function isValidUpload(u: unknown): u is UploadRef {
  if (!u || typeof u !== "object") return false;
  const r = u as Record<string, unknown>;
  return (
    typeof r.fileName === "string" &&
    (r.side === "front" || r.side === "back") &&
    typeof r.sequenceHint === "number" &&
    Number.isFinite(r.sequenceHint) &&
    typeof r.path === "string" &&
    r.path.length > 0
  );
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return methodNotAllowed(res, ["POST"]);
  try {
    await requireStaff(req);
    const sessionId = String(req.query.id ?? "");
    if (!sessionId) throw new HttpError(400, "Session id is required.");

    const body = (await readJsonBody(req)) as Body;
    const uploads = Array.isArray(body.uploads) ? body.uploads : [];
    if (!uploads.every(isValidUpload)) {
      throw new HttpError(400, "Each upload needs fileName, side, sequenceHint, and path.");
    }

    const admin = getSupabaseAdmin();
    await getSessionOr404(admin, sessionId);

    // Idempotency guard: drop any upload whose path already belongs to an
    // existing scan in this session (a retried ingest call). Two plain
    // .in() queries (front paths, back paths) rather than one hand-built
    // .or() filter string — simpler to get right than raw PostgREST syntax.
    let toIngest = uploads;
    if (uploads.length > 0) {
      const paths = uploads.map((u) => u.path);
      const [frontMatches, backMatches] = await Promise.all([
        admin
          .from("card_scans")
          .select("front_image_path")
          .eq("scan_session_id", sessionId)
          .in("front_image_path", paths),
        admin
          .from("card_scans")
          .select("back_image_path")
          .eq("scan_session_id", sessionId)
          .in("back_image_path", paths),
      ]);
      if (frontMatches.error || backMatches.error) {
        throw new HttpError(500, "Could not check for already-ingested files.");
      }
      const already = new Set([
        ...(frontMatches.data ?? [])
          .map((r) => r.front_image_path)
          .filter((p): p is string => !!p),
        ...(backMatches.data ?? [])
          .map((r) => r.back_image_path)
          .filter((p): p is string => !!p),
      ]);
      toIngest = filterUnseenUploads(already, uploads);
    }

    const pairs = pairUploads(toIngest);

    const { data: existingScans, error: seqErr } = await admin
      .from("card_scans")
      .select("sequence_number")
      .eq("scan_session_id", sessionId)
      .order("sequence_number", { ascending: false })
      .limit(1);
    if (seqErr) throw new HttpError(500, "Could not determine batch order.");
    let nextSeq = (existingScans?.[0]?.sequence_number ?? 0) + 1;

    // Every pair has at least one file by construction (pairUploads only
    // creates an entry when a file references its sequenceHint), so all of
    // them are insertable — there's no partial-pair failure mode here.
    const rowsToInsert = pairs.map((p) => ({
      scan_session_id: sessionId,
      sequence_number: nextSeq++,
      front_image_path: p.front?.path ?? null,
      back_image_path: p.back?.path ?? null,
    }));

    let created: unknown[] = [];
    if (rowsToInsert.length > 0) {
      const { data, error } = await admin
        .from("card_scans")
        .insert(rowsToInsert)
        .select("*");
      if (error) throw new HttpError(500, "Could not save the scanned cards.");
      created = data ?? [];
    }
    const failed = 0;

    // Increment total_files by the number of files actually processed
    // (fetch-modify-write; low concurrency internal tool, acceptable).
    const session = await getSessionOr404(admin, sessionId);
    await admin
      .from("scan_sessions")
      .update({
        total_files: session.total_files + uploads.length,
        status: "pending_review",
      })
      .eq("id", sessionId);

    await recomputeSession(admin, sessionId);

    return sendJson(res, 200, { created, failed });
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 500;
    const message =
      err instanceof HttpError ? err.message : "Unexpected server error.";
    return sendJson(res, status, { ok: false, message });
  }
}
