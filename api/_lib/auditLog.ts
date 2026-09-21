import type { SupabaseClient } from "@supabase/supabase-js";
import type { StaffContext } from "./adminAuth.js";
import type { Database } from "../../src/types/database.js";

// Records a staff action to admin_audit_log for the admin Audit Log page
// (src/admin/pages/AuditLogPage.tsx). Deliberately swallows its own errors —
// an audit-log write failing must never break the actual mutation it's
// describing, so every call site can fire-and-forget this without its own
// try/catch.
export async function logAdminAction(
  admin: SupabaseClient<Database>,
  staff: StaffContext,
  params: {
    action: string;
    resourceType: string;
    resourceId: string;
    before?: Record<string, unknown> | null;
    after?: Record<string, unknown> | null;
  },
): Promise<void> {
  try {
    const { error } = await admin.from("admin_audit_log").insert({
      actor_id: staff.userId,
      actor_email: staff.email,
      actor_role: staff.role,
      action: params.action,
      resource_type: params.resourceType,
      resource_id: params.resourceId,
      before: (params.before ?? null) as never,
      after: (params.after ?? null) as never,
    });
    if (error) console.error("[auditLog] insert failed", params.action, error);
  } catch (err) {
    console.error("[auditLog] unexpected failure", params.action, err);
  }
}
