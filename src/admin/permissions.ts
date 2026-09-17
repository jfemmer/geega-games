// Single source of truth for what each staff role is allowed to do.
//
// Imported from BOTH sides of the app: server (api/_lib/adminAuth.ts,
// api/admin/index.ts) enforces it for real, client (useCurrentAdmin/can())
// reads it to hide or disable controls a signed-in staffer can't use. Neither
// side owns its own copy of the rules — there is exactly one CAPABILITY_ROLES
// table, so a role change here takes effect everywhere at once instead of
// needing the client and server versions kept in sync by hand.
//
// The client-side check is a UX convenience only. It is never the security
// boundary — every server branch that calls requireStaff(req, capability)
// re-checks this same table against the caller's verified session.

export const STAFF_ROLES = [
  "owner",
  "administrator",
  "fulfillment",
  "inventory",
] as const;

export type StaffRole = (typeof STAFF_ROLES)[number];

export type StaffCapability =
  | "orders.view"
  | "orders.pack_ship"
  | "orders.cancel"
  | "orders.refund"
  | "pos.sell"
  | "inventory.view"
  | "inventory.write"
  | "campaigns.send"
  | "staff.manage"
  | "audit.view";

const ALL_ROLES = STAFF_ROLES;

/** Which staff roles may exercise each capability. */
export const CAPABILITY_ROLES: Record<StaffCapability, readonly StaffRole[]> = {
  "orders.view": ALL_ROLES,
  "orders.pack_ship": ["owner", "administrator", "fulfillment"],
  "orders.cancel": ["owner", "administrator"],
  "orders.refund": ["owner", "administrator"],
  "pos.sell": ALL_ROLES,
  "inventory.view": ALL_ROLES,
  "inventory.write": ["owner", "administrator", "inventory"],
  "campaigns.send": ["owner", "administrator"],
  "staff.manage": ["owner"],
  "audit.view": ["owner", "administrator"],
};

export function roleCan(role: StaffRole, capability: StaffCapability): boolean {
  return CAPABILITY_ROLES[capability].includes(role);
}
