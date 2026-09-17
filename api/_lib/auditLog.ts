import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../../src/types/database.js";
import type { StaffContext } from "./adminAuth.js";

// Writes one row to admin_audit_log for a notable privileged action. This is
// a record, not a gate — call it AFTER the action already succeeded, so a
// logging failure never blocks or rolls back the thing it's recording.
// Never throws: a broken log write is logged to the server console and
// swallowed rather than surfaced to the caller, since losing an audit entry
// is bad but must never be worse than the alternative of failing the real
// action (e.g. a refund that already went through in Stripe).
//
// `before`/`after` are free-form snapshots of whatever's relevant to that
// action — pass only what changed, not a full row dump, so entries stay
// readable in the admin's Audit Log page.

export interface AuditLogEntry {
  action: string;
  resourceType: string;
  resourceId?: string | null;
  before?: unknown;
  after?: unknown;
}

export async function logAdminAction(
  admin: SupabaseClient<Database>,
  staff: StaffContext,
  entry: AuditLogEntry,
): Promise<void> {
  try {
    const { error } = await admin.from("admin_audit_log").insert({
      actor_id: staff.userId,
      actor_email: staff.email,
      actor_role: staff.staffRole,
      action: entry.action,
      resource_type: entry.resourceType,
      resource_id: entry.resourceId ?? null,
      before: (entry.before ?? null) as never,
      after: (entry.after ?? null) as never,
    });
    if (error) {
      console.error("[auditLog] insert failed", entry.action, error.message);
    }
  } catch (err) {
    console.error("[auditLog] unexpected failure", entry.action, err);
  }
}
