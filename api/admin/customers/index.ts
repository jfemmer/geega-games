import type { VercelRequest, VercelResponse } from "@vercel/node";
import {
  HttpError,
  methodNotAllowed,
  readJsonBody,
  sendJson,
} from "../../_lib/http.js";
import { requireStaff } from "../../_lib/adminAuth.js";
import { getSupabaseAdmin } from "../../_lib/supabaseAdmin.js";
import { normalizeEmail } from "../../_lib/tokens.js";

// /api/admin/customers
//
//   GET  -> enriched customer list (real newsletter + order + sign-in data)
//   POST -> manually add (or link) a customer by email. Never duplicates, never
//           subscribes to marketing, never creates an Auth account.
//
// Both branches verify staff first (requireStaff) and use the service_role
// client, which the SECURITY DEFINER RPCs additionally guard.

interface CreateBody {
  email?: string;
  firstName?: string | null;
  lastName?: string | null;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    await requireStaff(req);
    const admin = getSupabaseAdmin();

    if (req.method === "GET") {
      const { data, error } = await admin.rpc("admin_customer_list");
      if (error) throw new HttpError(500, error.message);
      return sendJson(res, 200, { ok: true, rows: (data ?? []) as unknown[] });
    }

    if (req.method === "POST") {
      const body = (await readJsonBody(req)) as CreateBody;
      const email = normalizeEmail(body.email);
      if (!email) {
        throw new HttpError(400, "A valid email address is required.");
      }

      // Detect a pre-existing customer so the UI can show a friendly "linked to
      // an existing customer" message instead of implying a brand-new record.
      const { data: existing } = await admin
        .from("customers")
        .select("id")
        .eq("email", email)
        .maybeSingle();

      const { data, error } = await admin.rpc("admin_upsert_customer", {
        p_email: email,
        p_first_name: body.firstName ?? undefined,
        p_last_name: body.lastName ?? undefined,
        p_source: "manual",
      });
      if (error) throw new HttpError(500, error.message);

      return sendJson(res, existing ? 200 : 201, {
        ok: true,
        created: !existing,
        customer: data as unknown as Record<string, unknown>,
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