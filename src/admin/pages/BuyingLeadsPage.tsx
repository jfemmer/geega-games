import { useEffect, useMemo, useState } from "react";
import { PageHeader } from "../components/layout/PageHeader";
import { SectionCard } from "../components/ui/Card";
import { Badge } from "../components/ui/Badge";
import { Icon } from "../components/ui/Icon";
import { SearchInput } from "../components/ui/Field";
import { Tabs } from "../components/ui/Nav";
import { DataTable, type Column } from "../components/ui/DataTable";
import { TableSkeleton, ErrorState, EmptyState } from "../components/ui/States";
import { useAsync } from "../hooks/useAsync";
import { buyingLeadsRepository } from "../repositories/buyingLeads.supabase";
import { BuyingLeadDetailDrawer } from "./BuyingLeadDetail";
import { formatDateTime } from "../utils/format";
import {
  BUYING_LEAD_STATUS_LABELS,
  BUYING_LEAD_STATUS_TONE,
  COLLECTION_SIZE_LABELS,
  PREFERRED_CONTACT_LABELS,
} from "../utils/labels";
import type { BuyingLeadDetail, BuyingLeadStatus, BuyingLeadSummary } from "../types";

type TabKey = "all" | BuyingLeadStatus | "has_photos" | "has_cards" | "large";

const TABS: { key: TabKey; label: string }[] = [
  { key: "all", label: "All" },
  { key: "new", label: "New" },
  { key: "reviewing", label: "Reviewing" },
  { key: "contacted", label: "Contacted" },
  { key: "offer_made", label: "Offer made" },
  { key: "accepted", label: "Accepted" },
  { key: "declined", label: "Declined" },
  { key: "completed", label: "Completed" },
  { key: "closed", label: "Closed" },
  { key: "has_photos", label: "Has photos" },
  { key: "has_cards", label: "Has card list" },
  { key: "large", label: "Large collection" },
];

export function BuyingLeadsPage({ query }: { query: URLSearchParams }) {
  const [tab, setTab] = useState<TabKey>("all");
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(query.get("submission"));
  const [detail, setDetail] = useState<BuyingLeadDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [counts, setCounts] = useState<Record<string, number>>({});

  const repoQuery = useMemo(
    () => ({
      search: search.trim() || undefined,
      status: (["all", "has_photos", "has_cards", "large"] as TabKey[]).includes(tab)
        ? "all"
        : (tab as BuyingLeadStatus),
      hasPhotos: tab === "has_photos" ? true : undefined,
      hasCardList: tab === "has_cards" ? true : undefined,
      largeCollection: tab === "large" ? true : undefined,
    }),
    [tab, search],
  ) as Parameters<typeof buyingLeadsRepository.list>[0];

  const leads = useAsync(() => buyingLeadsRepository.list(repoQuery), [repoQuery]);

  function refreshCounts() {
    buyingLeadsRepository.counts().then(setCounts).catch(() => undefined);
  }
  useEffect(() => {
    refreshCounts();
  }, [leads.data]);

  async function openLead(id: string) {
    setSelectedId(id);
    setDetailLoading(true);
    try {
      const d = await buyingLeadsRepository.get(id);
      setDetail(d);
    } finally {
      setDetailLoading(false);
    }
  }

  useEffect(() => {
    if (selectedId) openLead(selectedId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const rows = leads.data ?? [];

  const columns: Column<BuyingLeadSummary>[] = [
    {
      key: "ref",
      header: "Reference",
      render: (l) => (
        <div className="gg-ordercell">
          <span className="gg-ordercell__num">
            {l.status === "new" && <span className="gg-newdot" aria-hidden="true" />}
            {l.referenceNumber}
          </span>
          <span className="gg-ordercell__cust">
            {l.firstName} {l.lastName}
          </span>
        </div>
      ),
    },
    {
      key: "location",
      header: "Location",
      secondary: true,
      render: (l) => [l.city, l.state].filter(Boolean).join(", ") || "—",
    },
    {
      key: "date",
      header: "Date",
      secondary: true,
      render: (l) => formatDateTime(l.createdAt),
    },
    {
      key: "cards",
      header: "Cards",
      align: "right",
      render: (l) => (l.totalCards > 0 ? l.totalCards : "—"),
    },
    {
      key: "size",
      header: "Collection size",
      secondary: true,
      render: (l) => (l.collectionSize ? (COLLECTION_SIZE_LABELS[l.collectionSize] ?? l.collectionSize) : "—"),
    },
    {
      key: "photos",
      header: "Photos",
      align: "right",
      secondary: true,
      render: (l) => (l.photoCount > 0 ? l.photoCount : "—"),
    },
    {
      key: "contact",
      header: "Prefers",
      secondary: true,
      render: (l) => PREFERRED_CONTACT_LABELS[l.preferredContactMethod] ?? l.preferredContactMethod,
    },
    {
      key: "status",
      header: "Status",
      render: (l) => (
        <span className="gg-leadrow-status">
          <Badge tone={BUYING_LEAD_STATUS_TONE[l.status]}>{BUYING_LEAD_STATUS_LABELS[l.status]}</Badge>
          {l.priority === "high_interest" && <Badge tone="gold">High interest</Badge>}
          {l.favorited && <Icon name="sparkle" size={14} />}
        </span>
      ),
    },
  ];

  return (
    <div className="gg-page">
      <PageHeader
        title="Buying Leads"
        description="Sell Your Cards / Sell Your Collection submissions from the storefront."
      />

      <SectionCard title="Submissions">
        <div className="gg-toolbar">
          <SearchInput
            label="Search leads"
            placeholder="Name, email, phone, reference, city, or ZIP…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <Tabs
          ariaLabel="Filter buying leads"
          active={tab}
          onChange={(k) => setTab(k as TabKey)}
          items={TABS.map((t) => ({
            key: t.key,
            label: t.label,
            count: t.key === "all" ? counts.all : counts[t.key],
          }))}
        />

        {leads.loading ? (
          <TableSkeleton rows={6} cols={8} />
        ) : leads.error ? (
          <ErrorState message="Could not load buying leads." onRetry={leads.reload} />
        ) : rows.length === 0 ? (
          <EmptyState
            icon="dollar"
            title="No submissions match this filter"
            message="New Sell Your Cards submissions from the storefront will appear here."
          />
        ) : (
          <DataTable
            columns={columns}
            rows={rows}
            rowKey={(l) => l.id}
            onRowClick={(l) => openLead(l.id)}
            caption="Buying leads"
          />
        )}
      </SectionCard>

      <BuyingLeadDetailDrawer
        lead={detailLoading ? null : detail}
        open={!!selectedId}
        onClose={() => {
          setSelectedId(null);
          setDetail(null);
        }}
        onChanged={() => {
          if (selectedId) openLead(selectedId);
          leads.reload();
        }}
      />
    </div>
  );
}
