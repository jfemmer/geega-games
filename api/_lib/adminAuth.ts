import type { VercelRequest } from "@vercel/node";
import { HttpError } from "./http.js";
import { getSupabaseAdmin } from "./supabaseAdmin.js";
import { staffRoleOf } from "./staff.js";
import {
  roleCan,
  type StaffCapability,
  type StaffRole,
} from "../../src/admin/permissions.js";

// Staff/admin authorization for /api/admin/* endpoints.
//
// The browser attaches the caller's Supabase access token as a Bearer header.
// We verify it server-side with the service_role client, then read the user's
// role from app_metadata.role — the SAME source of truth the database uses
// (public.current_app_role() reads app_metadata.role from the JWT, and
// is_admin()/is_staff() build on it). app_metadata can only be written with the
// service_role key, so a user cannot elevate their own role from the browser.
//
// Roles: 'customer' | 'staff' | 'admin'. Admin endpoints require staff OR admin.

const ALLOWED_ROLES = new Set(["staff", "admin"]);

export interface StaffContext {
  userId: string;
  email: string | null;
  role: string;
  /** Fine-grained role (owner/administrator/fulfillment/inventory). */
  staffRole: StaffRole;
}

/** Read the app role from a user's app_metadata, defaulting to 'customer'. */
function roleFromUser(appMetadata: Record<string, unknown> | undefined): string {
  const raw =
    (appMetadata?.role as string | undefined) ??
    (appMetadata?.app_role as string | undefined) ??
    "customer";
  return typeof raw === "string" ? raw : "customer";
}

/**
 * Verify the request carries a valid Supabase session for a staff/admin user.
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

  // Validate the token and resolve the user (this also confirms the token is
  // genuine and unexpired — it's checked against Supabase's auth server).
  const { data: userData, error: userErr } = await admin.auth.getUser(token);
  if (userErr || !userData?.user) {
    throw new HttpError(401, "Invalid or expired session.");
  }
  const user = userData.user;

  const role = roleFromUser(
    user.app_metadata as Record<string, unknown> | undefined,
  );
  if (!ALLOWED_ROLES.has(role)) {
    throw new HttpError(403, "Admin access required.");
  }

  return {
    userId: user.id,
    email: user.email ?? null,
    role,
    staffRole: staffRoleOf(user),
  };
}

/**
 * Gate a specific action to the staff roles allowed to perform it, per the
 * shared matrix in src/admin/permissions.ts. Call this INSIDE a resource/
 * action branch, after the top-level requireStaff(req) has already
 * confirmed the caller is staff at all — this is the finer-grained check on
 * top of that coarse one, not a replacement for it.
 */
export function requireCapability(
  staff: StaffContext,
  capability: StaffCapability,
): void {
  if (!roleCan(staff.staffRole, capability)) {
    throw new HttpError(
      403,
      `Your staff role (${staff.staffRole}) isn't allowed to do this.`,
    );
  }
}