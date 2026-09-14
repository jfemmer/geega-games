import type { VercelRequest, VercelResponse } from "@vercel/node";
import {
  HttpError,
  methodNotAllowed,
  readJsonBody,
  sendJson,
} from "../../../_lib/http.js";
import { requireStaff } from "../../../_lib/adminAuth.js";
import { getSupabaseAdmin } from "../../../_lib/supabaseAdmin.js";

// POST /api/admin/customers/:id/status
// Body: { status: "active" | "disabled" }
//
// Sets the customer record status. When the customer is linked to a real
// Supabase Auth account, we ALSO ban/unban that Auth user so disabling truly
// prevents sign-in (not just a cosmetic flag). ban_duration "none" lifts a ban;
// a long duration effectively disables the account. The Auth Admin API is only
// ever called server-side with the service_role key.

interface Body {
  status?: "active" | "disabled";
}

// ~100 years — an effectively permanent ban that we lift by setting "none".
const BAN_DURATION = "876000h";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return methodNotAllowed(res, ["POST"]);
  try {
    await requireStaff(req);
    const id = String(req.query.id ?? "");
    if (!id) throw new HttpError(400, "Customer id is required.");

    const body = (await readJsonBody(req)) as Body;
    const status = body.status;
    if (status !== "active" && status !== "disabled") {
      throw new HttpError(400, "status must be 'active' or 'disabled'.");
    }

    const admin = getSupabaseAdmin();

    const { data: customer, error: readErr } = await admin
      .from("customers")
      .select("id, auth_user_id")
      .eq("id", id)
      .maybeSingle();
    if (readErr) throw new HttpError(500, readErr.message);
    if (!customer) throw new HttpError(404, "Customer not found.");

    const { data: updated, error: updErr } = await admin
      .from("customers")
      .update({ status })
      .eq("id", id)
      .select("*")
      .single();
    if (updErr) throw new HttpError(500, updErr.message);

    // Enforce on the linked Auth account, if any.
    if (customer.auth_user_id) {
      const { error: authErr } = await admin.auth.admin.updateUserById(
        customer.auth_user_id,
        { ban_duration: status === "disabled" ? BAN_DURATION : "none" },
      );
      if (authErr) {
        // The customer flag is already updated; surface the Auth failure so the
        // admin knows sign-in enforcement may not have applied.
        throw new HttpError(
          500,
          `Customer flag updated, but the linked account could not be ${
            status === "disabled" ? "banned" : "unbanned"
          }: ${authErr.message}`,
        );
      }
    }

    return sendJson(res, 200, {
      ok: true,
      customer: updated as unknown as Record<string, unknown>,
    });
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 500;
    const message =
      err instanceof HttpError ? err.message : "Unexpected server error.";
    return sendJson(res, status, { ok: false, message });
  }
}