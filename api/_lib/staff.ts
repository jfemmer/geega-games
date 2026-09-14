import type { User } from "@supabase/supabase-js";

// Staff identity helpers shared by the /api/admin/staff/* Functions.
//
// AUTHORIZATION SOURCE OF TRUTH (never user-editable):
//   * app_metadata.role       — 'staff' | 'admin' (gates is_staff()/requireStaff)
//   * app_metadata.staff_role — richer UI role: owner | administrator |
//                               fulfillment | inventory
// user_metadata is user-writable and is used ONLY for display (name), never for
// authorization. When no staff_role is present, an app role of 'admin' maps to
// 'owner' and 'staff' maps to 'fulfillment' so legacy users render sensibly.

export const STAFF_ROLES = [
  "owner",
  "administrator",
  "fulfillment",
  "inventory",
] as const;

export type StaffRole = (typeof STAFF_ROLES)[number];

export interface StaffMemberDTO {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  role: StaffRole;
  status: "active" | "disabled";
  lastActiveAt: string | null;
  recentActivity: never[];
}

function appMeta(user: User): Record<string, unknown> {
  return (user.app_metadata as Record<string, unknown> | undefined) ?? {};
}

function userMeta(user: User): Record<string, unknown> {
  return (user.user_metadata as Record<string, unknown> | undefined) ?? {};
}

/** True when the Auth user is staff/admin per the trusted app role. */
export function isStaffUser(user: User): boolean {
  const role = appMeta(user).role;
  return role === "staff" || role === "admin";
}

/** Resolve the display staff role from trusted metadata. */
export function staffRoleOf(user: User): StaffRole {
  const meta = appMeta(user);
  const explicit = meta.staff_role;
  if (typeof explicit === "string" && STAFF_ROLES.includes(explicit as StaffRole)) {
    return explicit as StaffRole;
  }
  // Legacy fallback: admin => owner, staff => fulfillment.
  return meta.role === "admin" ? "owner" : "fulfillment";
}

/** Map a Supabase Auth user to the admin StaffMember DTO. */
export function mapAuthUserToStaff(user: User): StaffMemberDTO {
  const meta = userMeta(user);
  const first = (meta.first_name as string | undefined) ?? "";
  const last = (meta.last_name as string | undefined) ?? "";
  // A banned user (banned_until in the future) counts as disabled.
  const bannedUntil = (user as { banned_until?: string | null }).banned_until;
  const disabled =
    !!bannedUntil && new Date(bannedUntil).getTime() > Date.now();
  return {
    id: user.id,
    firstName: first,
    lastName: last,
    email: user.email ?? "",
    role: staffRoleOf(user),
    status: disabled ? "disabled" : "active",
    lastActiveAt: user.last_sign_in_at ?? null,
    recentActivity: [],
  };
}