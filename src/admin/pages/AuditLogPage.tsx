import { useMemo, useState } from "react";
import { PageHeader } from "../components/layout/PageHeader";
import { SectionCard } from "../components/ui/Card";
import { SearchInput } from "../components/ui/Field";
import { DataTable, type Column } from "../components/ui/DataTable";
import { TableSkeleton, ErrorState, EmptyState } from "../components/ui/States";
import { useAsync } from "../hooks/useAsync";
import { auditLogRepository, type AuditLogEntry } from "../repositories/auditLog.supabase";
import { formatDateTime } from "../utils/format";

// Read-only. Every row here was written server-side by logAdminAction()
// at the moment a privileged action succeeded — there is nothing to edit
// or delete from this page, by design (see the migration's RLS comment).

function ActionCell({ entry }: { entry: AuditLogEntry }) {
  const [open, setOpen] = useState(false);
  const hasDetail = entry.before != null || entry.after != null;
  return (
    <div>
      <code className="gg-audit__action">{entry.action}</code>
      {hasDetail && (
        <button
          type="button"
          className="gg-audit__detailtoggle"
          onClick={() => setOpen((v) => !v)}
        >
          {open ? "Hide details" : "Show details"}
        </button>
      )}
      {open && (
        <pre className="gg-audit__detail">
          {JSON.stringify({ before: entry.before, after: entry.after }, null, 2)}
        </pre>
      )}
    </div>
  );
}

export function AuditLogPage() {
  const [search, setSearch] = useState("");
  const query = useMemo(() => ({ search: search.trim() || undefined }), [search]);
  const log = useAsync(() => auditLogRepository.list(query), [query]);
  const rows = log.data ?? [];

  const columns: Column<AuditLogEntry>[] = [
    {
      key: "when",
      header: "When",
      render: (e) => formatDateTime(e.createdAt),
    },
    {
      key: "actor",
      header: "Staff member",
      render: (e) => (
        <div className="gg-ordercell">
          <span className="gg-ordercell__num">{e.actorEmail ?? "—"}</span>
          <span className="gg-ordercell__cust">{e.actorRole ?? "—"}</span>
        </div>
      ),
    },
    {
      key: "action",
      header: "Action",
      render: (e) => <ActionCell entry={e} />,
    },
    {
      key: "resource",
      header: "Resource",
      render: (e) => (
        <div className="gg-ordercell">
          <span className="gg-ordercell__num">{e.resourceType}</span>
          {e.resourceId && (
            <span className="gg-ordercell__cust">{e.resourceId}</span>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="gg-page">
      <PageHeader
        title="Audit Log"
        description="Every refund, cancellation, inventory change, and staff-role change — who did it and when. Visible to owners and administrators only."
      />
      <SectionCard
        title=""
        action={
          <SearchInput
            label="Search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by action, staff email, or resource id"
          />
        }
      >
        {log.loading ? (
          <TableSkeleton rows={8} />
        ) : log.error ? (
          <ErrorState message={log.error} onRetry={log.reload} />
        ) : rows.length === 0 ? (
          <EmptyState
            title="Nothing logged yet"
            message="Refunds, cancellations, inventory edits, and staff changes will show up here as they happen."
          />
        ) : (
          <DataTable columns={columns} rows={rows} rowKey={(e) => e.id} />
        )}
      </SectionCard>
    </div>
  );
}
