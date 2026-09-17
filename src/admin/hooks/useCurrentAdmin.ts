import { useEffect, useState } from "react";
import { supabase, isSupabaseConfigured } from "../../supabase";
import {
  roleCan,
  type StaffCapability,
  type StaffRole,
} from "../permissions";

// Current signed-in staff identity, for labelling inventory movements ("actor")
// and for hiding/disabling admin controls the signed-in role can't use.
//
// Reads the real Supabase session (email / user metadata / app_metadata)
// rather than a mock admin. app_metadata is included in the user's own
// session but is NOT writable from the browser, so staffRole here is a
// legitimate (read-only) reflection of the same trusted value the server
// checks — but it is a UX convenience, never the security boundary: every
// privileged endpoint re-checks the caller's role itself via requireStaff()/
// requireCapability() against their verified bearer token.

export interface CurrentAdmin {
  /** Display name: full name if present, else email, else a neutral fallback. */
  name: string;
  email: string | null;
  userId: string | null;
  staffRole: StaffRole;
  /** Whether the signed-in role may exercise a given capability. */
  can: (capability: StaffCapability) => boolean;
}

const FALLBACK_ROLE: StaffRole = "fulfillment";
const FALLBACK: CurrentAdmin = {
  name: "Staff",
  email: null,
  userId: null,
  staffRole: FALLBACK_ROLE,
  can: (capability) => roleCan(FALLBACK_ROLE, capability),
};

function staffRoleFromAppMeta(meta: Record<string, unknown>): StaffRole {
  const explicit = meta.staff_role;
  const STAFF_ROLES: StaffRole[] = ["owner", "administrator", "fulfillment", "inventory"];
  if (typeof explicit === "string" && STAFF_ROLES.includes(explicit as StaffRole)) {
    return explicit as StaffRole;
  }
  // Legacy fallback, mirroring api/_lib/staff.ts's staffRoleOf(): admin => owner,
  // staff => fulfillment.
  return meta.role === "admin" ? "owner" : "fulfillment";
}

function fromSessionUser(user: {
  id: string;
  email?: string | null;
  user_metadata?: Record<string, unknown> | null;
  app_metadata?: Record<string, unknown> | null;
}): CurrentAdmin {
  const meta = user.user_metadata ?? {};
  const first = (meta.first_name as string | undefined) ?? "";
  const last = (meta.last_name as string | undefined) ?? "";
  const full = `${first} ${last}`.trim();
  const displayName = (meta.name as string | undefined) ?? full;
  const staffRole = staffRoleFromAppMeta(user.app_metadata ?? {});
  return {
    name: displayName || user.email || "Staff",
    email: user.email ?? null,
    userId: user.id,
    staffRole,
    can: (capability) => roleCan(staffRole, capability),
  };
}

export function useCurrentAdmin(): CurrentAdmin {
  const [admin, setAdmin] = useState<CurrentAdmin>(FALLBACK);

  useEffect(() => {
    if (!isSupabaseConfigured) return;
    let active = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      const user = data.session?.user;
      if (user) setAdmin(fromSessionUser(user));
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
      if (!active) return;
      setAdmin(s?.user ? fromSessionUser(s.user) : FALLBACK);
    });
    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  return admin;
}