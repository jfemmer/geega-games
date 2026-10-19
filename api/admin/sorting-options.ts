import type { VercelRequest, VercelResponse } from "@vercel/node";
import { HttpError, methodNotAllowed, readJsonBody, sendJson } from "../_lib/http.js";
import { requireStaff } from "../_lib/adminAuth.js";
import { getSupabaseAdmin } from "../_lib/supabaseAdmin.js";
import { logAdminAction } from "../_lib/auditLog.js";
import { UUID_RE, cleanText } from "../_lib/sorting.js";
import { SORTING_LIMITS } from "../../src/store/lib/sortingService.js";
import type { Database } from "../../src/types/database.js";

// Staff-only: the collection sorting rates customers see on /collection-sorting.
//
//   POST   /api/admin/sorting-options             { name, description?, ratePerThousandCents, sortOrder?, active? }
//   PATCH  /api/admin/sorting-options?id=<uuid>   any of the same fields
//   DELETE /api/admin/sorting-options?id=<uuid>
//
// A request keeps its own copy of the option's name and rate from the moment
// it was made, so editing or deleting an option never changes what anyone
// was already quoted. Every change is in the audit log.

type OptionInsert = Database["public"]["Tables"]["sorting_service_options"]["Insert"];

interface Body {
  name?: unknown;
  description?: unknown;
  ratePerThousandCents?: unknown;
  sortOrder?: unknown;
  active?: unknown;
}

function fieldsFrom(body: Body, creating: boolean): Partial<OptionInsert> {
  const out: Partial<OptionInsert> = {};
  if (creating || body.name !== undefined) {
    const name = cleanText(body.name, 200);
    if (!name || name.length > 80) throw new HttpError(400, "Give the option a name (up to 80 characters).");
    out.name = name;
  }
  if (body.description !== undefined) {
    const description = cleanText(body.description, 1000);
    if (description && description.length > 400) throw new HttpError(400, "Keep the description to 400 characters.");
    out.description = description;
  }
  if (creating || body.ratePerThousandCents !== undefined) {
    const rate = body.ratePerThousandCents;
    if (typeof rate !== "number" || !Number.isInteger(rate) || rate < 1 || rate > SORTING_LIMITS.maxChargeCents) {
      throw new HttpError(400, "Enter the price per 1,000 cards (more than $0).");
    }
    out.rate_per_thousand_cents = rate;
  }
  if (body.sortOrder !== undefined) {
    const order = body.sortOrder;
    if (typeof order !== "number" || !Number.isInteger(order) || order < -1000 || order > 1000) {
      throw new HttpError(400, "Order must be a whole number.");
    }
    out.sort_order = order;
  }
  if (body.active !== undefined) {
    if (typeof body.active !== "boolean") throw new HttpError(400, "Invalid shown/hidden value.");
    out.active = body.active;
  }
  return out;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST" && req.method !== "PATCH" && req.method !== "DELETE") {
    return methodNotAllowed(res, ["POST", "PATCH", "DELETE"]);
  }
  try {
    const staff = await requireStaff(req);
    const admin = getSupabaseAdmin();

    if (req.method === "POST") {
      const body = (await readJsonBody(req, 4 * 1024)) as Body;
      const fields = fieldsFrom(body, true) as OptionInsert;
      const { data, error } = await admin
        .from("sorting_service_options")
        .insert({ ...fields, updated_by: staff.userId })
        .select("*")
        .single();
      if (error || !data) throw new HttpError(500, "Could not save the option.");
      await logAdminAction(admin, staff, {
        action: "sorting.option_created",
        resourceType: "sorting_service_option",
        resourceId: data.id,
        after: { name: data.name, rate_per_thousand_cents: data.rate_per_thousand_cents, active: data.active },
      });
      return sendJson(res, 200, { ok: true, option: data });
    }

    const id = String(req.query.id ?? "");
    if (!UUID_RE.test(id)) throw new HttpError(400, "Option id is required.");
    const { data: before, error: readErr } = await admin
      .from("sorting_service_options")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (readErr) throw new HttpError(500, "Could not load the option.");
    if (!before) throw new HttpError(404, "Option not found.");

    if (req.method === "DELETE") {
      const { error } = await admin.from("sorting_service_options").delete().eq("id", id);
      if (error) throw new HttpError(500, "Could not delete the option.");
      await logAdminAction(admin, staff, {
        action: "sorting.option_deleted",
        resourceType: "sorting_service_option",
        resourceId: id,
        before: { name: before.name, rate_per_thousand_cents: before.rate_per_thousand_cents, active: before.active },
        after: null,
      });
      res.status(204).end();
      return;
    }

    const body = (await readJsonBody(req, 4 * 1024)) as Body;
    const fields = fieldsFrom(body, false);
    if (Object.keys(fields).length === 0) throw new HttpError(400, "No changes provided.");
    const { data, error } = await admin
      .from("sorting_service_options")
      .update({ ...fields, updated_by: staff.userId })
      .eq("id", id)
      .select("*")
      .single();
    if (error || !data) throw new HttpError(500, "Could not save the option.");
    await logAdminAction(admin, staff, {
      action: "sorting.option_updated",
      resourceType: "sorting_service_option",
      resourceId: id,
      before: { name: before.name, rate_per_thousand_cents: before.rate_per_thousand_cents, active: before.active },
      after: { name: data.name, rate_per_thousand_cents: data.rate_per_thousand_cents, active: data.active },
    });
    return sendJson(res, 200, { ok: true, option: data });
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 500;
    const message = err instanceof HttpError ? err.message : "Unexpected server error.";
    if (!(err instanceof HttpError)) console.error("[admin/sorting-options] error:", err);
    return sendJson(res, status, { ok: false, message });
  }
}
