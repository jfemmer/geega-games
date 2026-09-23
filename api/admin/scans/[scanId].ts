import type { VercelRequest, VercelResponse } from "@vercel/node";
import {
  HttpError,
  methodNotAllowed,
  readJsonBody,
  sendJson,
} from "../../_lib/http.js";
import { requireStaff, type StaffContext } from "../../_lib/adminAuth.js";
import { getSupabaseAdmin } from "../../_lib/supabaseAdmin.js";
import { scryfallResolveExact } from "../../_lib/scryfall.js";
import { cachePrinting } from "../../_lib/inventory.js";
import { recomputeSession } from "../../_lib/scan.js";
import type { Database } from "../../../src/types/database.js";

// PATCH /api/admin/scans/:scanId — one review edit.
//
// Not nested under scan-sessions/:id — ScanRepository.updateScan(scanId,
// patch) doesn't carry a sessionId (the UI already knows which scan it's
// editing without it), so the session is read from the row itself.
//
// Mirrors the mock's applyPatch. selectedPrinting is NEVER trusted from the
// client beyond its scryfallId: the server re-resolves + caches the exact
// printing itself (same posture as PATCH /api/admin/inventory/:id), then
// constrains the finish to that printing's available finishes and
// auto-advances reviewStatus to 'matched', exactly like the mock.

type Condition = Database["public"]["Enums"]["card_condition"];
type Finish = Database["public"]["Enums"]["card_finish"];
type ReviewStatus = Database["public"]["Enums"]["card_scan_review_status"];

const CONDITIONS = new Set<Condition>(["NM", "LP", "MP", "HP", "DMG"]);
const REVIEW_STATUSES = new Set<ReviewStatus>([
  "unreviewed",
  "pending_match",
  "matched",
  "needs_manual_match",
  "ready",
  "added",
  "rejected",
  "error",
]);

interface Body {
  selectedScryfallId?: string | null;
  confirmedCondition?: Condition | null;
  selectedFinish?: Finish | null;
  quantity?: number;
  priceCents?: number | null;
  costCents?: number | null;
  storageLocation?: string | null;
  notes?: string | null;
  reviewStatus?: ReviewStatus;
  actor?: string | null;
}

function actorLabel(staff: StaffContext, bodyActor?: string | null): string {
  return (bodyActor && bodyActor.trim()) || staff.email || staff.userId;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "PATCH" && req.method !== "DELETE") return methodNotAllowed(res, ["PATCH", "DELETE"]);
  try {
    const staff = await requireStaff(req);
    const scanId = String(req.query.scanId ?? "");
    if (!scanId) throw new HttpError(400, "Scan id is required.");

    const admin = getSupabaseAdmin();

    const { data: current, error: currentErr } = await admin
      .from("card_scans")
      .select("*")
      .eq("id", scanId)
      .maybeSingle();
    if (currentErr) throw new HttpError(500, "Could not load the scan.");
    if (!current) throw new HttpError(404, "Scan not found.");

    if (req.method === "DELETE") {
      if (current.review_status === "added" || current.inventory_item_id) {
        throw new HttpError(409, "This scan has already been added to inventory and cannot be deleted. Adjust or archive the inventory item instead.");
      }
      const paths = [
        current.front_image_path,
        current.back_image_path,
        current.front_preview_path,
        current.back_preview_path,
      ].filter((p): p is string => !!p);
      const { error: deleteErr } = await admin.from("card_scans").delete().eq("id", scanId);
      if (deleteErr) throw new HttpError(500, "Could not delete the scan.");
      if (paths.length > 0) {
        const { error: storageErr } = await admin.storage.from("card-scans").remove(paths);
        if (storageErr) console.warn("Deleted scan row but could not remove scan image(s):", storageErr.message);
      }
      await recomputeSession(admin, current.scan_session_id);
      return sendJson(res, 200, { ok: true, deletedId: scanId });
    }

    const body = (await readJsonBody(req)) as Body;
    const patch: Database["public"]["Tables"]["card_scans"]["Update"] = {};

    if (body.selectedScryfallId !== undefined) {
      if (body.selectedScryfallId === null) {
        patch.selected_scryfall_id = null;
      } else {
        const card = await scryfallResolveExact({
          scryfallId: body.selectedScryfallId,
        });
        if (!card) {
          throw new HttpError(
            400,
            "Could not resolve that printing on Scryfall. Try the search again.",
          );
        }
        await cachePrinting(admin, card);
        patch.selected_scryfall_id = card.id;

        // Constrain finish to this printing's finishes, same as the mock.
        const available = (card.finishes ?? ["nonfoil"]) as Finish[];
        const targetFinish = body.selectedFinish ?? current.selected_finish;
        if (!targetFinish || !available.includes(targetFinish)) {
          patch.selected_finish = available[0] ?? "nonfoil";
        }
        // Auto-move to 'matched' when a match is chosen, unless already added.
        if (current.review_status !== "added") {
          patch.review_status = "matched";
        }
      }
    }

    if (body.confirmedCondition !== undefined) {
      if (body.confirmedCondition !== null && !CONDITIONS.has(body.confirmedCondition)) {
        throw new HttpError(400, "Invalid condition.");
      }
      patch.confirmed_condition = body.confirmedCondition;
    }
    if (body.selectedFinish !== undefined && patch.selected_finish === undefined) {
      patch.selected_finish = body.selectedFinish;
    }
    if (body.quantity !== undefined) {
      const q = Math.floor(Number(body.quantity));
      if (!Number.isFinite(q) || q < 1) throw new HttpError(400, "Quantity must be at least 1.");
      patch.quantity = q;
    }
    if (body.priceCents !== undefined) {
      patch.price_cents =
        body.priceCents == null ? null : Math.max(0, Math.round(body.priceCents));
    }
    if (body.costCents !== undefined) {
      patch.cost_cents =
        body.costCents == null ? null : Math.max(0, Math.round(body.costCents));
    }
    if (body.storageLocation !== undefined) patch.storage_location = body.storageLocation;
    if (body.notes !== undefined) patch.notes = body.notes;
    if (body.reviewStatus !== undefined) {
      if (!REVIEW_STATUSES.has(body.reviewStatus)) {
        throw new HttpError(400, "Invalid review status.");
      }
      patch.review_status = body.reviewStatus;
    }

    if (Object.keys(patch).length > 0) {
      patch.reviewed_by = actorLabel(staff, body.actor);
      patch.reviewed_at = new Date().toISOString();
      const { error } = await admin.from("card_scans").update(patch).eq("id", scanId);
      if (error) throw new HttpError(500, "Could not save the review changes.");
    }

    await recomputeSession(admin, current.scan_session_id);

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
