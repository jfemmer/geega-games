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
import {
  mapAuthUserToStaff,
  isStaffUser,
  STAFF_ROLES,
  type StaffRole,
} from "../../_lib/staff.js";

// /api/admin/staff
//
//   GET  -> real staff: Supabase Auth users whose app_metadata.role is
//           'staff' or 'admin', mapped to the richer StaffMember shape (a
//           trusted app_metadata.staff_role drives owner/administrator/etc.).
//   POST -> invite a new staff member by email via the Auth Admin API. Sets the
//           trusted app_metadata (role + staff_role) so authorization can never
//           be self-edited from user_metadata.
//
// Only admins may invite staff (requireStaff allows staff+admin generally, but
// creating/elevating staff is admin-only here).

interface InviteBody {
  email?: string;
  firstName?: string;
  lastName?: string;
  role?: string;
}

// The Auth listUsers page size; the staff set is tiny, one page is plenty.
const PAGE_SIZE = 200;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const caller = await requireStaff(req);
    const admin = getSupabaseAdmin();

    if (req.method === "GET") {
      const { data, error } = await admin.auth.admin.listUsers({
        page: 1,
        perPage: PAGE_SIZE,
      });
      if (error) throw new HttpError(500, error.message);
      const staff = (data?.users ?? [])
        .filter(isStaffUser)
        .map(mapAuthUserToStaff);
      return sendJson(res, 200, { ok: true, rows: staff });
    }

    if (req.method === "POST") {
      if (caller.role !== "admin") {
        throw new HttpError(403, "Only an admin/owner can invite staff.");
      }
      const body = (await readJsonBody(req)) as InviteBody;
      const email = normalizeEmail(body.email);
      if (!email) throw new HttpError(400, "A valid email address is required.");

      const staffRole = (body.role ?? "fulfillment") as StaffRole;
      if (!STAFF_ROLES.includes(staffRole)) {
        throw new HttpError(400, "Invalid staff role.");
      }
      // Owner can only be granted by promotion, not at invite time.
      if (staffRole === "owner") {
        throw new HttpError(400, "Invite as another role, then promote to owner.");
      }

      const first = (body.firstName ?? "").trim();
      const last = (body.lastName ?? "").trim();

      const { data, error } = await admin.auth.admin.inviteUserByEmail(email, {
        data: { first_name: first, last_name: last },
      });
      if (error) throw new HttpError(500, error.message);
      const user = data?.user;
      if (!user) throw new HttpError(500, "Invite did not return a user.");

      // Set TRUSTED authorization metadata (app_metadata). 'staff' satisfies the
      // is_staff() gate; staff_role drives the richer UI/permissions.
      const { error: metaErr } = await admin.auth.admin.updateUserById(user.id, {
        app_metadata: { role: "staff", staff_role: staffRole },
      });
      if (metaErr) throw new HttpError(500, metaErr.message);

      const refreshed = await admin.auth.admin.getUserById(user.id);
      const staffMember = refreshed.data?.user
        ? mapAuthUserToStaff(refreshed.data.user)
        : mapAuthUserToStaff(user);

      return sendJson(res, 201, { ok: true, staff: staffMember });
    }

    return methodNotAllowed(res, ["GET", "POST"]);
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 500;
    const message =
      err instanceof HttpError ? err.message : "Unexpected server error.";
    return sendJson(res, status, { ok: false, message });
  }
}