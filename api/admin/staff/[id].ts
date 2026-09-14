import type { VercelRequest, VercelResponse } from "@vercel/node";
import {
  HttpError,
  methodNotAllowed,
  readJsonBody,
  sendJson,
} from "../../_lib/http.js";
import { requireStaff } from "../../_lib/adminAuth.js";
import { getSupabaseAdmin } from "../../_lib/supabaseAdmin.js";
import {
  mapAuthUserToStaff,
  isStaffUser,
  staffRoleOf,
  STAFF_ROLES,
  type StaffRole,
} from "../../_lib/staff.js";

// PATCH /api/admin/staff/:id
// Body: { role?: StaffRole, status?: "active" | "disabled" }
//
// Admin-only. Updates the trusted app_metadata (role + staff_role) and/or bans/
// unbans the account. Safeguards:
//   * You cannot demote or disable yourself out of owner.
//   * The store must always keep at least one active owner.
// Owner maps to app role 'admin'; every other staff_role maps to app role
// 'staff'. is_staff()/is_admin() therefore stay correct in the database.

interface Body {
  role?: string;
  status?: "active" | "disabled";
}

const BAN_DURATION = "876000h"; // ~100 years; lifted with "none".

function appRoleFor(staffRole: StaffRole): "admin" | "staff" {
  return staffRole === "owner" ? "admin" : "staff";
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "PATCH") return methodNotAllowed(res, ["PATCH"]);
  try {
    const caller = await requireStaff(req);
    if (caller.role !== "admin") {
      throw new HttpError(403, "Only an admin/owner can manage staff.");
    }
    const id = String(req.query.id ?? "");
    if (!id) throw new HttpError(400, "Staff id is required.");

    const body = (await readJsonBody(req)) as Body;
    const admin = getSupabaseAdmin();

    const target = await admin.auth.admin.getUserById(id);
    if (target.error || !target.data?.user) {
      throw new HttpError(404, "Staff member not found.");
    }
    const user = target.data.user;
    if (!isStaffUser(user)) {
      throw new HttpError(400, "That user is not a staff member.");
    }

    const currentRole = staffRoleOf(user);
    const isSelf = user.id === caller.userId;

    // Count active owners for the last-owner safeguard.
    async function activeOwnerCount(): Promise<number> {
      const { data } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
      return (data?.users ?? []).filter((u) => {
        if (!isStaffUser(u)) return false;
        if (staffRoleOf(u) !== "owner") return false;
        const bannedUntil = (u as { banned_until?: string | null }).banned_until;
        const disabled =
          !!bannedUntil && new Date(bannedUntil).getTime() > Date.now();
        return !disabled;
      }).length;
    }

    // ---- Role change ----
    if (body.role !== undefined) {
      const nextRole = body.role as StaffRole;
      if (!STAFF_ROLES.includes(nextRole)) {
        throw new HttpError(400, "Invalid staff role.");
      }
      if (currentRole === "owner" && nextRole !== "owner") {
        if (isSelf) {
          throw new HttpError(
            400,
            "You can't remove your own owner role — ask another owner.",
          );
        }
        if ((await activeOwnerCount()) <= 1) {
          throw new HttpError(
            400,
            "The store must always have at least one active owner.",
          );
        }
      }
      const { error } = await admin.auth.admin.updateUserById(id, {
        app_metadata: { role: appRoleFor(nextRole), staff_role: nextRole },
      });
      if (error) throw new HttpError(500, error.message);
    }

    // ---- Status change ----
    if (body.status !== undefined) {
      if (body.status !== "active" && body.status !== "disabled") {
        throw new HttpError(400, "status must be 'active' or 'disabled'.");
      }
      if (body.status === "disabled") {
        if (isSelf) throw new HttpError(400, "You can't disable your own account.");
        if (currentRole === "owner" && (await activeOwnerCount()) <= 1) {
          throw new HttpError(
            400,
            "The store must always have at least one active owner.",
          );
        }
      }
      const { error } = await admin.auth.admin.updateUserById(id, {
        ban_duration: body.status === "disabled" ? BAN_DURATION : "none",
      });
      if (error) throw new HttpError(500, error.message);
    }

    const refreshed = await admin.auth.admin.getUserById(id);
    const staffMember = refreshed.data?.user
      ? mapAuthUserToStaff(refreshed.data.user)
      : mapAuthUserToStaff(user);
    return sendJson(res, 200, { ok: true, staff: staffMember });
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 500;
    const message =
      err instanceof HttpError ? err.message : "Unexpected server error.";
    return sendJson(res, status, { ok: false, message });
  }
}