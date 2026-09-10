import type { VercelRequest } from "@vercel/node";
import { HttpError } from "./http.js";
import { getSupabaseAdmin } from "./supabaseAdmin.js";

// Staff authorization for /api/admin/* endpoints.
//
// The browser attaches the caller's Supabase access token as a Bearer token.
// We verify it server-side with the service_role client, then confirm the user
// is staff. Staff status is derived from the same source the SQL is_staff()
// helper uses; here we read it via the admin client so a compromised browser
// cannot elevate itself. Every privileged write endpoint MUST call this first.

export interface StaffContext {
  userId: string;
  email: string | null;
}

/**
 * Verify the request carries a valid Supabase session for a staff user.
 * Throws HttpError(401) when unauthenticated, HttpError(403) when not staff.
 */
export async function requireStaff(req: VercelRequest): Promise<StaffContext> {
  const auth = String(req.headers["authorization"] ?? "");
  const token = auth.toLowerCase().startsWith("bearer ")
    ? auth.slice(7).trim()
    : "";
  if (!token) {
    throw new HttpError(401, "Authentication required.");
  }

  const admin = getSupabaseAdmin();

  // Validate the token and resolve the user.
  const { data: userData, error: userErr } = await admin.auth.getUser(token);
  if (userErr || !userData?.user) {
    throw new HttpError(401, "Invalid or expired session.");
  }
  const user = userData.user;

  // Confirm staff membership. We check a `staff` table keyed by the auth user id
  // and require an active status. Adjust the table/column names here if the
  // staff source of truth differs — this is the single choke point.
  const { data: staff, error: staffErr } = await admin
    .from("staff")
    .select("id, status")
    .eq("id", user.id)
    .maybeSingle();

  if (staffErr) {
    throw new HttpError(500, "Could not verify staff access.");
  }
  if (!staff || (staff as { status?: string }).status === "disabled") {
    throw new HttpError(403, "Staff access required.");
  }

  return { userId: user.id, email: user.email ?? null };
}
