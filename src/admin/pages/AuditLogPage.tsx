import { useMemo, useState } from "react";
import { supabase } from "../../supabase";
import { PageHeader } from "../components/layout/PageHeader";
import { SectionCard } from "../components/ui/Card";
import { Badge } from "../components/ui/Badge";
import { Tabs } from "../components/ui/Nav";
import { TableSkeleton, ErrorState, EmptyState } from "../components/ui/States";
import { useAsync } from "../hooks/useAsync";
import { timeAgo } from "../utils/format";

// Reads admin_audit_log directly (RLS restricts SELECT to owner/administrator
// roles — see the admin_audit_log migration), the same "no repository layer
// needed for a straight, RLS-gated read" pattern already used for orders.
// Writes come from api/_lib/auditLog.ts, called at the highest-value mutation
// points (inventory edits/deletes, order status changes) — not every admin
// action, which would be a much larger undertaking than this page itself.

type AuditRow = {
  id: string;
  actor_email: string | null;
  actor_role: string | null;
  action: string;
  resource_type: string;
  resource_id: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  created_at: string;
};

const RESOURCE_TABS = [
  { key: "all", label: "All" },
  { key: "inventory_item", label: "Inventory" },
  { key: "order", label: "Orders" },
];

const ACTION_TONE: Record<string, "info" | "warning" | "danger" | "success"> = {
  delete: "danger",
  cancelled: "danger",
  update: "info",
  shipped: "success",
};

function toneFor(action: string): "info" | "warning" | "danger" | "success" {
  for (const [needle, tone] of Object.entries(ACTION_TONE)) {
    if (action.includes(needle)) return tone;
  }
  return "info";
}

/** Field-level diff between two flat before/after objects — only changed keys. */
function diffFields(
  before: Record<string, unknown> | null,
  after: Record<string, unknown> | null,
): { key: string; from: unknown; to: unknown }[] {
  if (!before || !after) return [];
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  const out: { key: string; from: unknown; to: unknown }[] = [];
  for (const key of keys) {
    const from = before[key];
    const to = after[key];
    if (JSON.stringify(from) !== JSON.stringify(to)) {
      out.push({ key, from, to });
    }
  }
  return out;
}

function fmtValue(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

function AuditDiff({ row }: { row: AuditRow }) {
  const [open, setOpen] = useState(false);
  const fields = useMemo(() => diffFields(row.before, row.after), [row.before, row.after]);

  if (fields.length === 0 && !row.before && !row.after) return null;

  return (
    <div className="gg-auditdiff">
      <button
        type="button"
        className="gg-btn gg-btn-ghost gg-btn-sm"
        onClick={() => setOpen((v) => !v)}
      >
        {open ? "Hide details" : fields.length > 0 ? `${fields.length} field${fields.length === 1 ? "" : "s"} changed` : "View details"}
      </button>
      {open && (
        <div className="gg-auditdiff__body">
          {fields.length > 0 ? (
            <ul className="gg-auditdiff__list">
              {fields.map((f) => (
                <li key={f.key}>
                  <span className="gg-auditdiff__field">{f.key}</span>
                  <span className="gg-auditdiff__from">{fmtValue(f.from)}</span>
                  <span aria-hidden="true">→</span>
                  <span className="gg-auditdiff__to">{fmtValue(f.to)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="gg-card-meta">No field-level changes recorded.</p>
          )}
        </div>
      )}
    </div>
  );
}

export function AuditLogPage() {
  const [resourceFilter, setResourceFilter] = useState("all");

  const log = useAsync(async () => {
    let q = supabase
      .from("admin_audit_log")
      .select("id, actor_email, actor_role, action, resource_type, resource_id, before, after, created_at")
      .order("created_at", { ascending: false })
      .limit(200);
    if (resourceFilter !== "all") q = q.eq("resource_type", resourceFilter);
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as AuditRow[];
  }, [resourceFilter]);

  return (
    <div className="gg-page">
      <PageHeader
        title="Audit Log"
        description="A record of staff actions on inventory and orders — who changed what, and when."
        actions={
          <Tabs
            items={RESOURCE_TABS}
            active={resourceFilter}
            onChange={setResourceFilter}
            ariaLabel="Filter by resource"
          />
        }
      />

      <SectionCard title="Recent actions">
        {log.loading ? (
          <TableSkeleton rows={8} cols={4} />
        ) : log.error ? (
          <ErrorState message="Could not load the audit log." onRetry={log.reload} />
        ) : log.data && log.data.length > 0 ? (
          <ul className="gg-auditlist">
            {log.data.map((row) => (
              <li key={row.id} className="gg-auditlist__row">
                <div className="gg-auditlist__main">
                  <Badge tone={toneFor(row.action)}>{row.action}</Badge>
                  <span className="gg-auditlist__resource">
                    {row.resource_type} · {row.resource_id.slice(0, 8)}
                  </span>
                  <span className="gg-auditlist__actor">
                    {row.actor_email ?? "Unknown"}
                    {row.actor_role ? ` (${row.actor_role})` : ""}
                  </span>
                  <span className="gg-auditlist__time">{timeAgo(row.created_at)}</span>
                </div>
                <AuditDiff row={row} />
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState icon="info" title="No actions recorded yet" message="" />
        )}
      </SectionCard>
    </div>
  );
}
