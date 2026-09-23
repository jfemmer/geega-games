import type { VercelRequest, VercelResponse } from "@vercel/node";
import { HttpError, methodNotAllowed, sendJson } from "../../../_lib/http.js";
import { requireStaff } from "../../../_lib/adminAuth.js";
import { getSupabaseAdmin } from "../../../_lib/supabaseAdmin.js";
import { SCAN_BUCKET, buildPreviewStoragePath, recomputeSession } from "../../../_lib/scan.js";
import { runRecognitionPipeline } from "../../../_lib/recognition/pipeline.js";
import { normalizeCardImage } from "../../../_lib/recognition/imageRegions.js";
import type { Database } from "../../../../src/types/database.js";

// POST /api/admin/scans/:scanId/recognize
//
// Runs the full multi-signal recognition pipeline (api/_lib/recognition/)
// for one scan and writes the result back: recognition_status/confidence/
// data always; selected_scryfall_id + review_status only when the pipeline
// actually auto-matched (Part 10 — never a low-confidence guess written as
// if it were settled); suggested_condition/suggested_condition_confidence
// from the condition analysis (never confirmed_condition — that stays a
// human action, per the existing suggested/confirmed separation).
//
// Idempotent and safe to retry: re-running recognition on an already-
// reviewed or already-added scan simply re-suggests (it never touches
// confirmed_condition, selected_finish, or a manually-set review_status
// beyond 'unreviewed'/'pending_match'/'matched'/'needs_manual_match').
//
// Downloads front/back from the private card-scans bucket via the
// service-role client (never a signed URL round-trip — this runs entirely
// server-side).

async function downloadImage(
  admin: ReturnType<typeof getSupabaseAdmin>,
  path: string | null,
): Promise<Buffer | null> {
  if (!path) return null;
  const { data, error } = await admin.storage.from(SCAN_BUCKET).download(path);
  if (error || !data) return null;
  return Buffer.from(await data.arrayBuffer());
}

/**
 * Uploads a normalized preview buffer as this scan's browser-viewable
 * stand-in for its scanner-native (often TIFF, unrenderable in an <img>)
 * source file. Deterministic path + upsert: re-running recognition simply
 * overwrites the same object rather than accumulating orphans. Best-effort
 * — a failed upload logs and returns null so recognition's own result is
 * never lost over a display-only concern; the caller then just omits that
 * patch key, leaving whatever preview (if any) already exists untouched.
 */
async function uploadPreview(
  admin: ReturnType<typeof getSupabaseAdmin>,
  originalPath: string,
  preview: Buffer | null,
): Promise<string | null> {
  if (!preview) return null;
  const previewPath = buildPreviewStoragePath(originalPath);
  const { error } = await admin.storage
    .from(SCAN_BUCKET)
    .upload(previewPath, preview, { contentType: "image/png", upsert: true });
  if (error) {
    console.warn(`Could not upload preview for ${originalPath}:`, error.message);
    return null;
  }
  return previewPath;
}

// Review states this endpoint may move a scan OUT of automatically. A scan
// already reviewed by a human (ready/added/rejected) is never silently
// reclassified — recognition only ever proposes into the pre-review states.
const OVERWRITABLE_REVIEW_STATUSES = new Set([
  "unreviewed",
  "pending_match",
  "matched",
  "needs_manual_match",
  "error",
]);

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return methodNotAllowed(res, ["POST"]);
  try {
    await requireStaff(req);
    const scanId = String(req.query.scanId ?? "");
    if (!scanId) throw new HttpError(400, "Scan id is required.");

    const admin = getSupabaseAdmin();
    const { data: scan, error: scanErr } = await admin
      .from("card_scans")
      .select("*, scan_sessions!scan_session_id(scan_mode)")
      .eq("id", scanId)
      .maybeSingle();
    if (scanErr) throw new HttpError(500, "Could not load the scan.");
    if (!scan) throw new HttpError(404, "Scan not found.");

    const sessionRow = Array.isArray(scan.scan_sessions) ? scan.scan_sessions[0] : scan.scan_sessions;
    const scanMode: Database["public"]["Enums"]["scan_recognition_mode"] = sessionRow?.scan_mode ?? "both";
    const doIdentity = scanMode !== "condition";

    // Only touch recognition_status for a session that actually attempts
    // identity — otherwise a condition-only scan would flip to "processing"
    // here and then never get set back (the identity branch below, which is
    // the only place that resolves it, never runs for this mode).
    if (doIdentity) {
      await admin
        .from("card_scans")
        .update({ recognition_status: "processing" })
        .eq("id", scanId);
    }

    const [front, back] = await Promise.all([
      downloadImage(admin, scan.front_image_path),
      downloadImage(admin, scan.back_image_path),
    ]);

    // Identification needs a front image; condition-only mode does not (it
    // grades whatever sides exist) — so this short-circuit only applies when
    // this session actually attempts identity. The back image (if any) still
    // deserves to be viewable in the review UI even though identity failed,
    // so it gets normalized + previewed here same as the main path below —
    // this branch returns before ever reaching runRecognitionPipeline.
    if (doIdentity && !front) {
      const backNormalized = back ? await normalizeCardImage(back) : null;
      const backPreviewPath = scan.back_image_path
        ? await uploadPreview(admin, scan.back_image_path, backNormalized?.buffer ?? null)
        : null;
      await admin
        .from("card_scans")
        .update({
          recognition_status: "failed",
          recognition_data: {
            detectedName: null,
            detectedSetCode: null,
            detectedCollectorNumber: null,
            detectedLanguage: null,
            finishGuess: null,
            candidatePrintings: [],
            confidence: 0,
            fieldConfidence: {},
            warnings: ["No front scan image available — cannot identify."],
          } as unknown as Database["public"]["Tables"]["card_scans"]["Update"]["recognition_data"],
          ...(backPreviewPath ? { back_preview_path: backPreviewPath } : {}),
        })
        .eq("id", scanId);
      const fresh = await admin
        .from("card_scans")
        .select("*, card_printings!selected_scryfall_id(*)")
        .eq("id", scanId)
        .single();
      return sendJson(res, 200, fresh.data as unknown as Record<string, unknown>);
    }

    const { recognitionResult, autoMatchedPrinting, condition, frontPreview, backPreview } =
      await runRecognitionPipeline(admin, front, back, scanMode);

    const [frontPreviewPath, backPreviewPath] = await Promise.all([
      scan.front_image_path ? uploadPreview(admin, scan.front_image_path, frontPreview) : null,
      scan.back_image_path ? uploadPreview(admin, scan.back_image_path, backPreview) : null,
    ]);

    // Cache the auto-matched (or best-candidate) printing so the review UI
    // can show it even without an inventory line yet.
    if (autoMatchedPrinting) {
      await admin.from("card_printings").upsert(
        {
          scryfall_id: autoMatchedPrinting.scryfallId,
          oracle_id: autoMatchedPrinting.oracleId,
          card_name: autoMatchedPrinting.cardName,
          set_code: autoMatchedPrinting.setCode,
          set_name: autoMatchedPrinting.setName,
          collector_number: autoMatchedPrinting.collectorNumber,
          rarity: autoMatchedPrinting.rarity,
          card_type: autoMatchedPrinting.cardType,
          layout: autoMatchedPrinting.layout,
          artist: autoMatchedPrinting.artist,
          released_at: autoMatchedPrinting.releasedAt,
          language: autoMatchedPrinting.language,
          frame: autoMatchedPrinting.frame,
          frame_effects: autoMatchedPrinting.frameEffects,
          border_color: autoMatchedPrinting.borderColor,
          full_art: autoMatchedPrinting.fullArt,
          textless: autoMatchedPrinting.textless,
          promo: autoMatchedPrinting.promo,
          promo_types: autoMatchedPrinting.promoTypes,
          treatments: autoMatchedPrinting.treatments,
          available_finishes: autoMatchedPrinting.availableFinishes,
          images: autoMatchedPrinting.images as unknown as Database["public"]["Tables"]["card_printings"]["Insert"]["images"],
          faces: autoMatchedPrinting.faces as unknown as Database["public"]["Tables"]["card_printings"]["Insert"]["faces"],
          price_usd_cents: autoMatchedPrinting.prices.usd,
          price_usd_foil_cents: autoMatchedPrinting.prices.usdFoil,
          price_usd_etched_cents: autoMatchedPrinting.prices.usdEtched,
          prices_updated_at: new Date().toISOString(),
        },
        { onConflict: "scryfall_id" },
      );
    }

    const patch: Database["public"]["Tables"]["card_scans"]["Update"] = {};

    // Display-only, independent of scan mode or match outcome: a scan the
    // pipeline couldn't identify at all still deserves a viewable image in
    // the review UI. Omitted (not set to null) on a failed upload, same
    // "leave whatever was already there alone" rule condition fields below
    // follow — never regress an existing preview over a transient error.
    if (frontPreviewPath) patch.front_preview_path = frontPreviewPath;
    if (backPreviewPath) patch.back_preview_path = backPreviewPath;

    // Identity fields: only touched when this session actually attempts
    // card matching. A condition-only session's scans keep whatever
    // recognition_status they already had (their default, 'none') rather
    // than being marked "failed" for something that was never attempted.
    if (doIdentity) {
      const recognitionStatus: Database["public"]["Enums"]["recognition_status"] =
        autoMatchedPrinting
          ? "recognized"
          : recognitionResult.candidatePrintings.length > 0
            ? "low_confidence"
            : "failed";

      patch.recognition_status = recognitionStatus;
      patch.recognition_confidence = recognitionResult.confidence;
      patch.recognition_data = recognitionResult as unknown as Database["public"]["Tables"]["card_scans"]["Update"]["recognition_data"];

      // Never override a human's own review decision — only move the scan
      // between the PRE-review states.
      if (OVERWRITABLE_REVIEW_STATUSES.has(scan.review_status)) {
        if (autoMatchedPrinting) {
          patch.selected_scryfall_id = autoMatchedPrinting.scryfallId;
          patch.review_status = "matched";
          // Constrain finish to the printing's finishes if a previously-
          // selected one is no longer valid; otherwise leave finish alone —
          // it's always a manual field (Part 5).
          if (
            scan.selected_finish &&
            !autoMatchedPrinting.availableFinishes.includes(scan.selected_finish)
          ) {
            patch.selected_finish = autoMatchedPrinting.availableFinishes[0] ?? null;
          }
        } else if (recognitionResult.candidatePrintings.length > 0) {
          patch.review_status = "needs_manual_match";
        } else {
          patch.review_status = "pending_match";
        }
      }
    }

    // Condition fields: only touched when this session actually attempts
    // condition grading — `condition` is null for a card-matching-only
    // session, and omitting these keys entirely (rather than writing null)
    // leaves any prior suggestion untouched on a re-run.
    if (condition) {
      patch.suggested_condition = condition.suggestedCondition;
      patch.suggested_condition_confidence = condition.confidence;
      patch.condition_findings = {
        findings: condition.findings,
        summary: condition.summary,
        backImageMissing: condition.backImageMissing,
      } as unknown as Database["public"]["Tables"]["card_scans"]["Update"]["condition_findings"];
    }

    const { error: updateErr } = await admin.from("card_scans").update(patch).eq("id", scanId);
    if (updateErr) throw new HttpError(500, "Could not save recognition results.");

    await recomputeSession(admin, scan.scan_session_id);

    const { data: fresh, error: freshErr } = await admin
      .from("card_scans")
      .select("*, card_printings!selected_scryfall_id(*)")
      .eq("id", scanId)
      .single();
    if (freshErr) throw new HttpError(500, "Could not reload the scan.");

    return sendJson(res, 200, fresh as unknown as Record<string, unknown>);
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 500;
    const message =
      err instanceof HttpError ? err.message : "Unexpected server error.";
    return sendJson(res, status, { ok: false, message });
  }
}
