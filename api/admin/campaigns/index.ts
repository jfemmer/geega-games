import type { VercelRequest, VercelResponse } from "@vercel/node";
import {
  HttpError,
  methodNotAllowed,
  readJsonBody,
  sendJson,
} from "../../_lib/http.js";
import { requireStaff, type StaffContext } from "../../_lib/adminAuth.js";
import { getSupabaseAdmin } from "../../_lib/supabaseAdmin.js";
import type { Database } from "../../../src/types/database.js";

// /api/admin/campaigns
//
//   GET  -> all campaigns, newest first (empty when none — no seeded/fake rows).
//   POST -> create or update a DRAFT campaign. Delivery statistics
//           (delivered/bounce/open/click) are NEVER set here; they stay at their
//           honest 0/null defaults until a real send pipeline records them.
//
// recipient_count is recomputed server-side from LIVE data via
// campaign_audience_count so a stale/forged client number can't be persisted.

type CampaignRow = Database["public"]["Tables"]["campaigns"]["Row"];
type Audience = Database["public"]["Enums"]["campaign_audience"];

const AUDIENCES = new Set<Audience>([
  "active_subscribers",
  "confirmed_recent",
  "all_customers",
]);

interface SaveBody {
  id?: string;
  name?: string;
  subject?: string;
  previewText?: string;
  body?: string;
  buttonText?: string | null;
  buttonUrl?: string | null;
  audience?: string;
  scheduledAt?: string | null;
}

function actorLabel(staff: StaffContext): string {
  return staff.email || staff.userId;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const staff = await requireStaff(req);
    const admin = getSupabaseAdmin();

    if (req.method === "GET") {
      const { data, error } = await admin
        .from("campaigns")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw new HttpError(500, error.message);
      return sendJson(res, 200, {
        ok: true,
        rows: (data ?? []) as unknown as CampaignRow[],
      });
    }

    if (req.method === "POST") {
      const body = (await readJsonBody(req)) as SaveBody;
      const name = String(body.name ?? "").trim();
      const subject = String(body.subject ?? "").trim();
      if (!name) throw new HttpError(400, "An internal campaign name is required.");
      if (!subject) throw new HttpError(400, "A subject line is required.");

      const audience = (body.audience ?? "active_subscribers") as Audience;
      if (!AUDIENCES.has(audience)) {
        throw new HttpError(400, "Invalid audience.");
      }

      // LIVE recipient count — never trust a client-supplied number.
      const { data: countData, error: countErr } = await admin.rpc(
        "campaign_audience_count",
        { p_audience: audience },
      );
      if (countErr) throw new HttpError(500, countErr.message);
      const recipientCount = Number(countData ?? 0);

      const fields = {
        name,
        subject,
        preview_text: String(body.previewText ?? "").trim(),
        body: String(body.body ?? "").trim(),
        button_text: body.buttonText?.trim() || null,
        button_url: body.buttonUrl?.trim() || null,
        audience,
        recipient_count: recipientCount,
        scheduled_at: body.scheduledAt ?? null,
      };

      if (body.id) {
        // Only DRAFTS are editable; a sent/queued campaign is immutable here.
        const { data: existing, error: exErr } = await admin
          .from("campaigns")
          .select("status")
          .eq("id", body.id)
          .maybeSingle();
        if (exErr) throw new HttpError(500, exErr.message);
        if (!existing) throw new HttpError(404, "Campaign not found.");
        if (existing.status !== "draft") {
          throw new HttpError(409, "Only draft campaigns can be edited.");
        }

        const { data, error } = await admin
          .from("campaigns")
          .update(fields)
          .eq("id", body.id)
          .select("*")
          .single();
        if (error) throw new HttpError(500, error.message);
        return sendJson(res, 200, {
          ok: true,
          campaign: data as unknown as CampaignRow,
        });
      }

      const { data, error } = await admin
        .from("campaigns")
        .insert({ ...fields, status: "draft", created_by: actorLabel(staff) })
        .select("*")
        .single();
      if (error) throw new HttpError(500, error.message);
      return sendJson(res, 201, {
        ok: true,
        campaign: data as unknown as CampaignRow,
      });
    }

    return methodNotAllowed(res, ["GET", "POST"]);
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 500;
    const message =
      err instanceof HttpError ? err.message : "Unexpected server error.";
    return sendJson(res, status, { ok: false, message });
  }
}