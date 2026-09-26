import type { VercelRequest, VercelResponse } from "@vercel/node";
import { methodNotAllowed, sendJson } from "../_lib/http.js";
import { getSupabaseAdmin } from "../_lib/supabaseAdmin.js";
import { hasStaffRole } from "../_lib/adminAuth.js";
import { checkRateLimit, getClientIp } from "../_lib/rateLimit.js";
import { notifyStaff, shortName } from "../_lib/staffPush.js";

// POST /api/account/new-account   (Authorization: Bearer <customer session>)
//
// Tells staff "a new customer signed up" (admin push, kind "signup"). The
// storefront calls this on a brand-new account's first signed-in session
// (src/store/lib/AuthContext.tsx) — i.e. once the email is confirmed — so
// bot sign-ups that never confirm don't buzz anyone.
//
// Nothing from the request body is trusted: the user comes from the verified
// access token, the account must really be new, and the push is keyed per
// user (staff_push_log), so calling this again — or from another tab — never
// sends a second notification.

const NEW_ACCOUNT_WINDOW_MS = 48 * 60 * 60 * 1000;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return methodNotAllowed(res, ["POST"]);

  const rl = checkRateLimit("account-new", getClientIp(req), 10, 10 * 60_000);
  if (!rl.allowed) return sendJson(res, 429, { ok: false, message: "Too many requests." });

  const token = String(req.headers.authorization ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return sendJson(res, 401, { ok: false, message: "Please sign in." });

  try {
    const admin = getSupabaseAdmin();
    const { data, error } = await admin.auth.getUser(token);
    const user = data?.user;
    if (error || !user) return sendJson(res, 401, { ok: false, message: "Please sign in again." });

    const createdAt = Date.parse(user.created_at);
    const isNew = Number.isFinite(createdAt) && Date.now() - createdAt <= NEW_ACCOUNT_WINDOW_MS;
    // Staff accounts aren't customers; old accounts were announced (or predate this).
    if (!isNew || hasStaffRole(user.app_metadata as Record<string, unknown> | undefined)) {
      return sendJson(res, 200, { ok: true, notified: false });
    }

    const { data: customer } = await admin
      .from("customers")
      .select("id, first_name, last_name")
      .eq("auth_user_id", user.id)
      .maybeSingle();
    const meta = (user.user_metadata ?? {}) as { first_name?: unknown; last_name?: unknown };
    const first = customer?.first_name ?? (typeof meta.first_name === "string" ? meta.first_name : null);
    const last = customer?.last_name ?? (typeof meta.last_name === "string" ? meta.last_name : null);
    const name = first || last ? shortName(first, last) : "A new customer";

    const result = await notifyStaff({
      key: `signup:${user.id}`,
      kind: "signup",
      title: "New customer sign-up",
      body: `${name} just created a Geega Games account.`,
      url: customer ? `/admin_dashboard/users?customer=${customer.id}` : "/admin_dashboard/users",
      tag: `signup:${user.id}`,
    });

    return sendJson(res, 200, { ok: true, notified: result.status === "sent" });
  } catch (err) {
    console.error("[/api/account/new-account] error", err);
    return sendJson(res, 500, { ok: false, message: "Unexpected server error." });
  }
}
