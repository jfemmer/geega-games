import { useEffect, useMemo, useState } from "react";
import { SectionCard } from "../../components/ui/Card";
import { Button } from "../../components/ui/Button";
import { Badge } from "../../components/ui/Badge";
import { SearchInput, SelectField } from "../../components/ui/Field";
import { EmptyState, ErrorState, Spinner } from "../../components/ui/States";
import { CONSIGNMENT_STATUS_LABELS, consignmentAdminApi, type ConsignmentListRow, type ConsignmentStatus } from "./consignmentAdminApi";

// All consignments, newest first, with search by number, name or email and a
// status filter. Choosing one opens its page.

const TONES: Record<ConsignmentStatus, "neutral" | "warning" | "success" | "info" | "danger"> = {
  draft: "neutral",
  awaiting_signature: "warning",
  signed: "success",
  inventory_received: "info",
  active: "success",
  terminated: "danger",
  closed: "neutral",
};

export function ConsignmentListPanel({ onOpen, onNew, reloadKey }: { onOpen: (id: string) => void; onNew: () => void; reloadKey: number }) {
  const [rows, setRows] = useState<ConsignmentListRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<"" | ConsignmentStatus>("");

  async function load() {
    setError(null);
    try {
      setRows(await consignmentAdminApi.list());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load consignments.");
    }
  }
  useEffect(() => {
    void load();
  }, [reloadKey]);

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (rows ?? []).filter(
      (r) =>
        (!status || r.status === status) &&
        (!q || r.label.toLowerCase().includes(q) || r.consignor.legalName.toLowerCase().includes(q) || r.consignor.email.toLowerCase().includes(q)),
    );
  }, [rows, search, status]);

  return (
    <SectionCard
      title="Consignments"
      action={
        <Button variant="primary" icon="plus" onClick={onNew}>
          New consignment
        </Button>
      }
    >
      <div className="gg-cn-toolbar">
        <SearchInput label="Search consignments" placeholder="GG-C-1001, name or email" value={search} onChange={(e) => setSearch(e.target.value)} />
        <SelectField label="Status" value={status} onChange={(e) => setStatus(e.target.value as "" | ConsignmentStatus)}>
          <option value="">All statuses</option>
          {(Object.keys(CONSIGNMENT_STATUS_LABELS) as ConsignmentStatus[]).map((s) => (
            <option key={s} value={s}>
              {CONSIGNMENT_STATUS_LABELS[s]}
            </option>
          ))}
        </SelectField>
      </div>
      {error ? (
        <ErrorState message={error} onRetry={() => void load()} />
      ) : !rows ? (
        <Spinner label="Loading consignments" />
      ) : rows.length === 0 ? (
        <EmptyState
          icon="box"
          title="No consignments yet"
          message="Create one for a customer, then send them the agreement to sign."
          action={
            <Button variant="primary" icon="plus" onClick={onNew}>
              New consignment
            </Button>
          }
        />
      ) : shown.length === 0 ? (
        <p className="gg-muted">Nothing matches that search.</p>
      ) : (
        <ul className="gg-cn-list">
          {shown.map((r) => (
            <li key={r.id}>
              <button type="button" className="gg-cn-row" onClick={() => onOpen(r.id)}>
                <span className="gg-cn-row__main">
                  <strong>{r.label}</strong> {r.consignor.legalName}
                  <span className="gg-cs-note">
                    {r.consignor.email}
                    {r.consignor.stateCode ? ` · ${r.consignor.stateCode}` : ""} · created {new Date(r.createdAt).toLocaleDateString()}
                  </span>
                </span>
                <span className="gg-cn-row__side">
                  <Badge tone={TONES[r.status]}>{CONSIGNMENT_STATUS_LABELS[r.status]}</Badge>
                  {r.agreement?.status === "pending" && (
                    <span className="gg-cs-note">Link expires {new Date(r.agreement.expiresAt).toLocaleDateString()}</span>
                  )}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  );
}
