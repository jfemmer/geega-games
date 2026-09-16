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

// PATCH /api/admin/sell-submissions/:id
//
// Staff-only. Every write to sell_submissions goes through here (there is no
// UPDATE grant to `authenticated` at all — see the sell_submissions
// migration) so the internal-only fields (internal_notes, offer/purchase
// amounts) can never be touched by anything other than a verified staff
// session, and status transitions can set contacted_at/closed_at
// consistently in one place.

type Status = Database["public"]["Enums"]["sell_submission_status"];
type Priority = Database["public"]["Enums"]["sell_priority"];

const STATUSES = new Set<Status>([
  "new",
  "reviewing",
  "contacted",
  "offer_made",
  "accepted",
  "declined",
  "completed",
  "closed",
]);
const PRIORITIES = new Set<Priority>(["normal", "high_interest"]);
const CLOSED_STATUSES = new Set<Status>(["declined", "completed", "closed"]);

interface Body {
  status?: unknown;
  internalNotes?: unknown;
  priority?: unknown;
  favorited?: unknown;
  offerValueCents?: unknown;
  purchaseAmountCents?: unknown;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "PATCH") return methodNotAllowed(res, ["PATCH"]);
  try {
    await requireStaff(req);
    const id = String(req.query.id ?? "");
    if (!id) throw new HttpError(400, "Submission id is required.");

    const body = (await readJsonBody(req, 8 * 1024)) as Body;
    const patch: Database["public"]["Tables"]["sell_submissions"]["Update"] = {};

    if (body.status !== undefined) {
      if (typeof body.status !== "string" || !STATUSES.has(body.status as Status)) {
        throw new HttpError(400, "Invalid status.");
      }
      const status = body.status as Status;
      patch.status = status;
      if (status === "contacted") patch.contacted_at = new Date().toISOString();
      if (CLOSED_STATUSES.has(status)) patch.closed_at = new Date().toISOString();
    }
    if (body.internalNotes !== undefined) {
      if (typeof body.internalNotes !== "string" || body.internalNotes.length > 10_000) {
        throw new HttpError(400, "Invalid internal notes.");
      }
      patch.internal_notes = body.internalNotes || null;
    }
    if (body.priority !== undefined) {
      if (typeof body.priority !== "string" || !PRIORITIES.has(body.priority as Priority)) {
        throw new HttpError(400, "Invalid priority.");
      }
      patch.priority = body.priority as Priority;
    }
    if (body.favorited !== undefined) {
      if (typeof body.favorited !== "boolean") throw new HttpError(400, "Invalid favorited value.");
      patch.favorited = body.favorited;
    }
    if (body.offerValueCents !== undefined) {
      if (body.offerValueCents !== null && (typeof body.offerValueCents !== "number" || body.offerValueCents < 0)) {
        throw new HttpError(400, "Invalid offer amount.");
      }
      patch.offer_value_cents = body.offerValueCents;
    }
    if (body.purchaseAmountCents !== undefined) {
      if (
        body.purchaseAmountCents !== null &&
        (typeof body.purchaseAmountCents !== "number" || body.purchaseAmountCents < 0)
      ) {
        throw new HttpError(400, "Invalid purchase amount.");
      }
      patch.purchase_amount_cents = body.purchaseAmountCents;
    }

    if (Object.keys(patch).length === 0) {
      throw new HttpError(400, "No changes provided.");
    }

    const admin = getSupabaseAdmin();
    const { data, error } = await admin
      .from("sell_submissions")
      .update(patch)
      .eq("id", id)
      .select("id")
      .maybeSingle();
    if (error) throw new HttpError(500, error.message);
    if (!data) throw new HttpError(404, "Submission not found.");

    return sendJson(res, 200, { ok: true });
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 500;
    const message = err instanceof HttpError ? err.message : "Unexpected server error.";
    return sendJson(res, status, { ok: false, message });
  }
}
