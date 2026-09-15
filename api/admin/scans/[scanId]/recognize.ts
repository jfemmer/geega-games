import type { VercelRequest, VercelResponse } from "@vercel/node";
import { HttpError, methodNotAllowed, sendJson } from "../../../_lib/http.js";
import { requireStaff } from "../../../_lib/adminAuth.js";
import { getSupabaseAdmin } from "../../../_lib/supabaseAdmin.js";
import { SCAN_BUCKET, recomputeSession } from "../../../_lib/scan.js";
import { runRecognitionPipeline } from "../../../_lib/recognition/pipeline.js";
import { ocrProvider } from "../../../_lib/ocr/index.js";
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
      .select("*")
      .eq("id", scanId)
      .maybeSingle();
    if (scanErr) throw new HttpError(500, "Could not load the scan.");
    if (!scan) throw new HttpError(404, "Scan not found.");

    await admin
      .from("card_scans")
      .update({ recognition_status: "processing" })
      .eq("id", scanId);

    const [front, back] = await Promise.all([
      downloadImage(admin, scan.front_image_path),
      downloadImage(admin, scan.back_image_path),
    ]);

    if (!front) {
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
        })
        .eq("id", scanId);
      const fresh = await admin
        .from("card_scans")
        .select("*, card_printings!selected_scryfall_id(*)")
        .eq("id", scanId)
        .single();
      return sendJson(res, 200, fresh.data as unknown as Record<string, unknown>);
    }

    const { recognitionResult, autoMatchedPrinting, condition } =
      await runRecognitionPipeline(admin, front, back);

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

    const recognitionStatus: Database["public"]["Enums"]["recognition_status"] =
      !ocrProvider.implemented
        ? "failed"
        : autoMatchedPrinting
          ? "recognized"
          : recognitionResult.candidatePrintings.length > 0
            ? "low_confidence"
            : "failed";

    const patch: Database["public"]["Tables"]["card_scans"]["Update"] = {
      recognition_status: recognitionStatus,
      recognition_confidence: recognitionResult.confidence,
      recognition_data: recognitionResult as unknown as Database["public"]["Tables"]["card_scans"]["Update"]["recognition_data"],
      suggested_condition: condition.suggestedCondition,
      suggested_condition_confidence: condition.confidence,
    };

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
