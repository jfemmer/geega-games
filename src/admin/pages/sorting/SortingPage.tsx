import { useEffect, useMemo, useState } from "react";
import { PageHeader } from "../../components/layout/PageHeader";
import { SectionCard } from "../../components/ui/Card";
import { Badge } from "../../components/ui/Badge";
import { SearchInput } from "../../components/ui/Field";
import { Tabs } from "../../components/ui/Nav";
import { DataTable, type Column } from "../../components/ui/DataTable";
import { EmptyState, ErrorState, TableSkeleton } from "../../components/ui/States";
import { useAsync } from "../../hooks/useAsync";
import { formatCents, formatDateTime } from "../../utils/format";
import { sortingRepository, type SortingListRow } from "../../repositories/sorting.supabase";
import type { SortingRequestDetail, SortingStatus } from "../../types";
import { SortingRequestDrawer } from "./SortingRequestDrawer";
import { SortingRatesPanel } from "./SortingRatesPanel";
import { SORTING_STATUS_TONE } from "./sortingLabels";
import { SORTING_PATH, SORTING_STATUSES, SORTING_STATUS_ADMIN_LABELS } from "../../../store/lib/sortingService";

// Admin → Collection Sorting: requests from /collection-sorting, each with its
// itemized quote and payments (SortingRequestDrawer), and the advertised
// per-1,000-card rates (SortingRatesPanel). ?request=<id> opens a request
// (staff push notifications link here); ?tab=rates opens the rates.

type View = "requests" | "rates";
type Filter = "all" | "open" | "unpaid" | SortingStatus;

const OPEN_STATUSES = new Set<SortingStatus>(["new", "awaiting_cards", "received", "quoted", "approved", "sorting", "ready"]);

function balanceDue(row: SortingListRow): number {
  return row.acceptedTotalCents !== null ? Math.max(0, row.acceptedTotalCents - row.amountPaidCents) : 0;
}

function matches(row: SortingListRow, filter: Filter, search: string): boolean {
  if (filter === "open" && !OPEN_STATUSES.has(row.status)) return false;
  if (filter === "unpaid" && !(balanceDue(row) > 0 && row.status !== "cancelled")) return false;
  if (filter !== "all" && filter !== "open" && filter !== "unpaid" && row.status !== filter) return false;
  if (!search) return true;
  const haystack = `${row.referenceNumber} ${row.firstName} ${row.lastName} ${row.email}`.toLowerCase();
  return haystack.includes(search.toLowerCase());
}

export function SortingPage({ query }: { query: URLSearchParams }) {
  const [view, setView] = useState<View>(query.get("tab") === "rates" ? "rates" : "requests");
  const [filter, setFilter] = useState<Filter>("open");
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(query.get("request"));
  const [detail, setDetail] = useState<SortingRequestDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  const list = useAsync(() => sortingRepository.list(), []);
  const rows = useMemo(() => list.data ?? [], [list.data]);

  async function openRequest(id: string) {
    setSelectedId(id);
    setDetailLoading(true);
    setDetailError(null);
    try {
      setDetail(await sortingRepository.get(id));
    } catch (err) {
      setDetail(null);
      setDetailError(err instanceof Error ? err.message : "Could not load the request.");
    } finally {
      setDetailLoading(false);
    }
  }

  // After a change: reload in place, keeping the drawer open.
  async function refreshDetail(id: string) {
    try {
      setDetail(await sortingRepository.get(id));
    } catch (err) {
      setDetailError(err instanceof Error ? err.message : "Could not reload the request.");
    }
  }

  // A link with ?request= (from a push notification or email) opens it.
  useEffect(() => {
    if (selectedId) void openRequest(selectedId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const counts = useMemo(() => {
    const out: Record<string, number> = { all: rows.length, open: 0, unpaid: 0 };
    for (const row of rows) {
      out[row.status] = (out[row.status] ?? 0) + 1;
      if (OPEN_STATUSES.has(row.status)) out.open += 1;
      if (balanceDue(row) > 0 && row.status !== "cancelled") out.unpaid += 1;
    }
    return out;
  }, [rows]);

  const visible = rows.filter((row) => matches(row, filter, search.trim()));

  const filterTabs: { key: Filter; label: string }[] = [
    { key: "open", label: "Open" },
    ...SORTING_STATUSES.map((s) => ({ key: s as Filter, label: SORTING_STATUS_ADMIN_LABELS[s] })),
    { key: "unpaid", label: "Balance due" },
    { key: "all", label: "All" },
  ];

  const columns: Column<SortingListRow>[] = [
    {
      key: "ref",
      header: "Reference",
      render: (r) => (
        <div className="gg-ordercell">
          <span className="gg-ordercell__num">
            {r.status === "new" && <span className="gg-newdot" aria-hidden="true" />}
            {r.referenceNumber}
          </span>
          <span className="gg-ordercell__cust">
            {r.firstName} {r.lastName}
          </span>
        </div>
      ),
    },
    {
      key: "delivery",
      header: "Getting it to us",
      secondary: true,
      render: (r) => (r.deliveryMethod === "ship" ? "Shipping in" : "Drop-off"),
    },
    {
      key: "cards",
      header: "Cards",
      align: "right",
      render: (r) =>
        r.countedCards != null ? r.countedCards.toLocaleString("en-US") : `~${r.estimatedCards.toLocaleString("en-US")}`,
    },
    {
      key: "quote",
      header: "Quote",
      render: (r) => {
        if (r.latestQuote?.status === "sent") return <Badge tone="gold">Sent · {formatCents(r.latestQuote.totalCents)}</Badge>;
        if (r.acceptedTotalCents !== null) return <Badge tone="success">Approved · {formatCents(r.acceptedTotalCents)}</Badge>;
        if (r.latestQuote?.status === "declined") return <Badge tone="danger">Declined</Badge>;
        if (r.hasDraft) return <Badge tone="neutral">Draft</Badge>;
        return <span className="gg-card-meta">—</span>;
      },
    },
    {
      key: "payment",
      header: "Payment",
      secondary: true,
      render: (r) => {
        if (r.acceptedTotalCents === null) return <span className="gg-card-meta">—</span>;
        const due = balanceDue(r);
        return due > 0 ? <span>{formatCents(due)} due</span> : <Badge tone="success">Paid</Badge>;
      },
    },
    {
      key: "status",
      header: "Status",
      render: (r) => <Badge tone={SORTING_STATUS_TONE[r.status]}>{SORTING_STATUS_ADMIN_LABELS[r.status]}</Badge>,
    },
    {
      key: "date",
      header: "Requested",
      secondary: true,
      render: (r) => formatDateTime(r.createdAt),
    },
  ];

  return (
    <div className="gg-page">
      <PageHeader
        title="Collection Sorting"
        description="Sorting requests from the storefront, their itemized quotes and payments, and your per-1,000-card rates."
        actions={
          <a className="gg-btn gg-btn--secondary gg-btn--sm" href={SORTING_PATH} target="_blank" rel="noopener noreferrer">
            View the sorting page
          </a>
        }
      />

      <Tabs
        ariaLabel="Collection sorting sections"
        active={view}
        onChange={(k) => setView(k as View)}
        items={[
          { key: "requests", label: "Requests", count: counts.open },
          { key: "rates", label: "Rates" },
        ]}
      />

      {view === "rates" ? (
        <SectionCard title="Rates">
          <SortingRatesPanel />
        </SectionCard>
      ) : (
        <SectionCard title="Requests">
          <div className="gg-toolbar">
            <SearchInput
              label="Search sorting requests"
              placeholder="Reference, name or email…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <Tabs
            ariaLabel="Filter sorting requests"
            active={filter}
            onChange={(k) => setFilter(k as Filter)}
            items={filterTabs.map((t) => ({ key: t.key, label: t.label, count: counts[t.key] ?? 0 }))}
          />
          {list.loading ? (
            <TableSkeleton rows={6} cols={7} />
          ) : list.error ? (
            <ErrorState message="Could not load sorting requests." onRetry={list.reload} />
          ) : visible.length === 0 ? (
            <EmptyState
              icon="layers"
              title={rows.length === 0 ? "No sorting requests yet" : "No requests match this filter"}
              message={
                rows.length === 0
                  ? "Requests from the collection sorting page will appear here."
                  : "Try another filter or search."
              }
            />
          ) : (
            <DataTable
              columns={columns}
              rows={visible}
              rowKey={(r) => r.id}
              onRowClick={(r) => void openRequest(r.id)}
              caption="Collection sorting requests"
            />
          )}
        </SectionCard>
      )}

      <SortingRequestDrawer
        detail={detail}
        loading={detailLoading}
        open={selectedId !== null && (detailLoading || detail !== null)}
        onClose={() => {
          setSelectedId(null);
          setDetail(null);
        }}
        onChanged={() => {
          if (selectedId) void refreshDetail(selectedId);
          list.reload();
        }}
      />
      {detailError && selectedId && !detailLoading && (
        <p className="gg-sortq__error" role="alert">
          {detailError}
        </p>
      )}
    </div>
  );
}
