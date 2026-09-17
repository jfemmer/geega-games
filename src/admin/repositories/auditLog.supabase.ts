// LIVE AuditLogRepository — reads directly from admin_audit_log via RLS
// (admin_audit_log_select_privileged restricts SELECT to owner/administrator
// staff; see supabase/migrations/20260918050000_admin_audit_log.sql). There
// is no write path here: every entry is written server-side by
// logAdminAction() in api/_lib/auditLog.ts, from the service-role Vercel
// functions that already perform the privileged action being logged.

import { supabase } from "../../supabase";

export interface AuditLogEntry {
  id: string;
  actorEmail: string | null;
  actorRole: string | null;
  action: string;
  resourceType: string;
  resourceId: string | null;
  before: unknown;
  after: unknown;
  createdAt: string;
}

export interface AuditLogQuery {
  search?: string;
  limit?: number;
}

function mapRow(row: {
  id: string;
  actor_email: string | null;
  actor_role: string | null;
  action: string;
  resource_type: string;
  resource_id: string | null;
  before: unknown;
  after: unknown;
  created_at: string;
}): AuditLogEntry {
  return {
    id: row.id,
    actorEmail: row.actor_email,
    actorRole: row.actor_role,
    action: row.action,
    resourceType: row.resource_type,
    resourceId: row.resource_id,
    before: row.before,
    after: row.after,
    createdAt: row.created_at,
  };
}

export const auditLogRepository = {
  async list(query: AuditLogQuery = {}): Promise<AuditLogEntry[]> {
    let q = supabase
      .from("admin_audit_log")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(query.limit ?? 200);

    const term = query.search?.trim();
    if (term) {
      // Matches on action, actor email, or resource id — the fields someone
      // reconstructing "who did this" is most likely to already know.
      q = q.or(
        `action.ilike.%${term}%,actor_email.ilike.%${term}%,resource_id.ilike.%${term}%`,
      );
    }

    const { data, error } = await q;
    if (error) throw new Error(error.message);
    return (data ?? []).map(mapRow);
  },
};
