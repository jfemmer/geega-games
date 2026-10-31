import { useEffect, useState } from "react";
import { PageHeader } from "../../components/layout/PageHeader";
import { SectionCard } from "../../components/ui/Card";
import { Badge } from "../../components/ui/Badge";
import { Icon } from "../../components/ui/Icon";
import { SearchInput, SelectField } from "../../components/ui/Field";
import { Tabs } from "../../components/ui/Nav";
import { DataTable, type Column } from "../../components/ui/DataTable";
import { EmptyState, ErrorState, TableSkeleton } from "../../components/ui/States";
import { useAsync } from "../../hooks/useAsync";
import { ADMIN_BASE } from "../../hooks/useRouter";
import { formatCents, timeAgo } from "../../utils/format";
import { tradeCenterRepository, type TradeListFilter } from "../../repositories/tradeCenter.supabase";
import {
  DEPOSIT_STATUSES,
  DEPOSIT_STATUS_ADMIN_LABELS,
  TRADE_CENTER_PATH,
  TRADE_STATUSES,
  TRADE_STATUS_ADMIN_LABELS,
  formatDeadline,
  tradeStatusAdminLabel,
  formatUsd,
  isDepositStatus,
  isTradeStatus,
  tradeLabel,
  type DepositStatus,
  type StaffTradeSummary,
  type TradeSettings,
} from "../../../store/lib/tradeCenter";
import { DEPOSIT_STATUS_TONE, REVIEW_FLAG_SHORT, TRADE_STATUS_TONE, waitingOnStaff } from "./tradeLabels";
import { TradeDrawer } from "./TradeDrawer";
import { TradeSettingsPanel } from "./TradeSettingsPanel";
import { CustomersTab, DepositsTab, EconomicsTab, ReservedTab } from "./TradeOverviewTabs";

// Admin → Trades: online trades from the storefront's Trade Cards page.
// Trades tab: the list (waiting on you, open, reserved, abandoned, local
// pickup, completed, all, or one status or deposit status; search by TR number,
// name or email) and each trade in a drawer (TradeDrawer) with everything
// staff do to it. Deposits, Reserved, Customers and Economics: overviews.
// Settings: rates, minimums, shipping, limits, deadlines, deposits,
// reliability, the address customers mail their cards to, and turning
// trading on, off or paused. ?trade=<id> opens a trade (staff alerts link
// here); ?tab=<tab> opens a tab.

type View = "trades" | "deposits" | "reserved" | "customers" | "economics" | "settings";
const VIEWS: readonly View[] = ["trades", "deposits", "reserved", "customers", "economics", "settings"];

const MAIN_FILTERS: { key: TradeListFilter; label: string }[] = [
  { key: "waiting", label: "Waiting on you" },
  { key: "open", label: "Open" },
  { key: "reserved", label: "Reserved" },
  { key: "abandoned", label: "Abandoned" },
  { key: "local", label: "Local pickup" },
  // Approved for fulfillment or completed ("completed" alone is a status).
  { key: "finished", label: "Completed" },
  { key: "all", label: "All" },
];

function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), ms);
    return () => window.clearTimeout(timer);
  }, [value, ms]);
  return debounced;
}

/** Their cards' value as it stands: estimated, approved or final (a local pickup trade's: at the meetup). */
function theirValue(t: StaffTradeSummary): { cents: number; stage: string } | null {
  if (t.finalValueCents != null) return { cents: t.finalValueCents, stage: "final" };
  if (t.handoffMethod === "local") return null;
  if (t.approvedValueCents != null) return { cents: t.approvedValueCents, stage: "approved" };
  return { cents: t.estimatedValueCents, stage: "estimate" };
}

/** What's flagged, or the next thing that has a date on it, in a few words. */
function nextUp(t: StaffTradeSummary): string {
  if (t.reviewFlag) return REVIEW_FLAG_SHORT[t.reviewFlag];
  if (t.depositStatus === "forfeiture_review") return "Decide on the deposit";
  if (t.depositStatus === "refund_failed") return "Deposit refund failed";
  if (t.returnStatus === "pending") return "Mail their cards back";
  switch (t.status) {
    case "awaiting_trade_list":
    case "revision_requested":
      return t.listDueAt ? `Due ${formatDeadline(t.listDueAt)}` : "—";
    case "awaiting_confirmation":
    case "awaiting_deposit":
      return t.confirmBy ? `Confirm by ${formatDeadline(t.confirmBy)}` : "—";
    case "awaiting_shipment":
      // Held until it's finished: a local trade has no deadline.
      if (t.handoffMethod === "local") return "Held: arrange the meetup";
      return t.shipBy ? `Ship by ${formatDeadline(t.shipBy)}` : "—";
    case "tracking_submitted":
      return t.shipBy ? `Ship by ${formatDeadline(t.shipBy)}` : "—";
    case "in_transit":
      return t.inboundAcceptedAt ? `Shipped ${timeAgo(t.inboundAcceptedAt)}` : "On its way";
    case "awaiting_payment":
      return t.paymentDueAt ? `Pay by ${formatDeadline(t.paymentDueAt)}` : "—";
    case "pending_review":
      return t.submittedAt ? `Sent ${timeAgo(t.submittedAt)}` : "—";
    default:
      return "—";
  }
}

export function TradesPage({ query, onNavigate }: { query: URLSearchParams; onNavigate: (path: string) => void }) {
  const [view, setView] = useState<View>(() => {
    const tab = query.get("tab");
    return VIEWS.includes(tab as View) ? (tab as View) : "trades";
  });
  const [filter, setFilter] = useState<TradeListFilter>("waiting");
  const [depositFilter, setDepositFilter] = useState<DepositStatus | null>(null);
  const [search, setSearch] = useState("");
  const searchTerm = useDebounced(search.trim(), 300);
  const [selectedId, setSelectedId] = useState<string | null>(query.get("trade"));

  const list = useAsync(() => tradeCenterRepository.list(filter, searchTerm, depositFilter), [filter, searchTerm, depositFilter]);
  // As the latest list response had them (saving settings reloads the list).
  const settings = list.data?.settings ?? null;

  const rows = list.data?.trades ?? [];
  const counts = list.data?.counts ?? {};

  const columns: Column<StaffTradeSummary>[] = [
    {
      key: "trade",
      header: "Trade",
      render: (t) => (
        <div className="gg-ordercell">
          <span className="gg-ordercell__num">
            {waitingOnStaff(t) && <span className="gg-newdot" aria-hidden="true" />}
            {tradeLabel(t.tradeNumber)}
          </span>
          <span className="gg-ordercell__cust">
            {t.customerName || t.customerEmail || "Customer"}
            {t.handoffMethod === "local" && (
              <>
                {" "}
                <Badge tone="purple">Local</Badge>
              </>
            )}
          </span>
          {/* Phones: the status column is hidden, so it shows here. */}
          <span className="gg-trades__inline-status">
            <Badge tone={TRADE_STATUS_TONE[t.status]}>{tradeStatusAdminLabel(t.status, t.handoffMethod)}</Badge>
          </span>
        </div>
      ),
    },
    {
      key: "theirs",
      header: "Their cards",
      align: "right",
      render: (t) => {
        const v = theirValue(t);
        if (!v) return <span className="gg-trades__stage">at the meetup</span>;
        return (
          <span className="gg-trades__value">
            {formatCents(v.cents)}
            <span className="gg-trades__stage">{v.stage}</span>
          </span>
        );
      },
    },
    {
      key: "ours",
      header: "Our cards",
      align: "right",
      secondary: true,
      render: (t) => formatCents(t.wantedTotalCents),
    },
    {
      key: "status",
      header: "Status",
      secondary: true,
      render: (t) => <Badge tone={TRADE_STATUS_TONE[t.status]}>{tradeStatusAdminLabel(t.status, t.handoffMethod)}</Badge>,
    },
    {
      key: "deposit",
      header: "Deposit",
      secondary: true,
      render: (t) =>
        t.depositStatus === "not_required" ? (
          <span className="gg-card-meta">—</span>
        ) : (
          <span className="gg-trades__value">
            <Badge tone={DEPOSIT_STATUS_TONE[t.depositStatus]}>{DEPOSIT_STATUS_ADMIN_LABELS[t.depositStatus]}</Badge>
            <span className="gg-trades__stage">{formatCents(t.depositPaidCents ?? t.depositCents)}</span>
          </span>
        ),
    },
    {
      key: "next",
      header: "Next",
      secondary: true,
      render: (t) => <span className="gg-card-meta">{nextUp(t)}</span>,
    },
    {
      key: "updated",
      header: "Updated",
      secondary: true,
      render: (t) => <span className="gg-card-meta">{timeAgo(t.updatedAt)}</span>,
    },
  ];

  const statusValue = isTradeStatus(filter) ? filter : "";

  return (
    <div className="gg-page">
      <PageHeader
        title="Trades"
        description="Online trades from the Trade Cards page: review each customer's cards, approve and inspect them, send the final offer, and set your trade terms."
        actions={
          <a className="gg-btn gg-btn--secondary gg-btn--sm" href={TRADE_CENTER_PATH} target="_blank" rel="noopener noreferrer">
            View the Trade Cards page
          </a>
        }
      />

      {settings && <TradingStatus settings={settings} onOpenSettings={() => setView("settings")} />}

      <Tabs
        ariaLabel="Trades sections"
        active={view}
        onChange={(k) => setView(k as View)}
        items={[
          { key: "trades", label: "Trades", count: counts.waiting ?? undefined },
          { key: "deposits", label: "Deposits" },
          { key: "reserved", label: "Reserved", count: counts.reserved || undefined },
          { key: "customers", label: "Customers" },
          { key: "economics", label: "Economics" },
          { key: "settings", label: "Settings" },
        ]}
      />

      {view === "settings" ? (
        <SectionCard title="Trade settings">
          <TradeSettingsPanel onSaved={list.reload} />
        </SectionCard>
      ) : view === "deposits" ? (
        <DepositsTab onOpenTrade={setSelectedId} />
      ) : view === "reserved" ? (
        <ReservedTab onOpenTrade={setSelectedId} />
      ) : view === "customers" ? (
        <CustomersTab />
      ) : view === "economics" ? (
        <EconomicsTab onOpenTrade={setSelectedId} />
      ) : (
        <SectionCard title="Trades" className="gg-trades-list">
          <div className="gg-toolbar gg-trades__toolbar">
            <SearchInput
              label="Search trades"
              placeholder="TR number, name or email…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <SelectField
              label="Status"
              value={statusValue}
              onChange={(e) => setFilter((e.target.value || "open") as TradeListFilter)}
            >
              <option value="">Any status</option>
              {TRADE_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {TRADE_STATUS_ADMIN_LABELS[s]} ({counts[s] ?? 0})
                </option>
              ))}
            </SelectField>
            <SelectField
              label="Deposit"
              value={depositFilter ?? ""}
              onChange={(e) => setDepositFilter(isDepositStatus(e.target.value) ? e.target.value : null)}
            >
              <option value="">Any deposit</option>
              {DEPOSIT_STATUSES.map((d) => (
                <option key={d} value={d}>
                  {DEPOSIT_STATUS_ADMIN_LABELS[d]}
                </option>
              ))}
            </SelectField>
          </div>
          <Tabs
            ariaLabel="Filter trades"
            active={filter}
            onChange={(k) => setFilter(k as TradeListFilter)}
            items={MAIN_FILTERS.map((f) => ({ key: f.key, label: f.label, count: counts[f.key] ?? 0 }))}
          />
          {list.loading && !list.data ? (
            <TableSkeleton rows={6} cols={6} />
          ) : list.error ? (
            <ErrorState message={list.error} onRetry={list.reload} />
          ) : rows.length === 0 ? (
            <EmptyState
              icon="cards"
              title={
                searchTerm
                  ? "No trades match that search"
                  : filter === "waiting"
                    ? "Nothing is waiting on you"
                    : (counts.all ?? 0) === 0
                      ? "No trades yet"
                      : "No trades here"
              }
              message={
                searchTerm
                  ? "Search by TR number, the customer's name or their email."
                  : filter === "waiting"
                    ? "Trades to review, flagged scans, proof of shipping, packages to inspect, deposits to decide and cards to mail back show up here. Trades still with the customer are under Open."
                    : (counts.all ?? 0) === 0
                      ? "Trades customers start on the Trade Cards page appear here."
                      : "Try another filter."
              }
            />
          ) : (
            <DataTable
              columns={columns}
              rows={rows}
              rowKey={(t) => t.id}
              onRowClick={(t) => setSelectedId(t.id)}
              caption="Online trades"
            />
          )}
        </SectionCard>
      )}

      <TradeDrawer
        tradeId={selectedId}
        onClose={() => setSelectedId(null)}
        onChanged={list.reload}
        onOpenOrder={(orderId) => onNavigate(`${ADMIN_BASE}/orders?order=${encodeURIComponent(orderId)}`)}
      />
    </div>
  );
}

/** Whether customers can start trades right now, in one line. */
function TradingStatus({ settings, onOpenSettings }: { settings: TradeSettings; onOpenSettings: () => void }) {
  const settingsLink = (
    <button type="button" className="gg-link-btn" onClick={onOpenSettings}>
      Open settings
    </button>
  );
  if (!settings.enabled) {
    return (
      <div className="gg-inline-note gg-inline-note--info gg-trades__status" role="status">
        <Icon name="info" size={18} />
        <div>
          <strong>Trading is off.</strong> Customers can&rsquo;t start trades and the Trade Cards link is hidden.{" "}
          {settings.shipTo ? "" : "Add the address customers mail their cards to before turning it on. "}
          {settingsLink}
        </div>
      </div>
    );
  }
  if (settings.paused) {
    return (
      <div className="gg-inline-note gg-inline-note--warning gg-trades__status" role="status">
        <Icon name="pause" size={18} />
        <div>
          <strong>New trades are paused.</strong> Customers see: &ldquo;{settings.pauseMessage}&rdquo; Trades already
          started carry on as usual. {settingsLink}
        </div>
      </div>
    );
  }
  return (
    <div className="gg-inline-note gg-inline-note--success gg-trades__status" role="status">
      <Icon name="checkCircle" size={18} />
      <div>
        <strong>Trading is open:</strong> {settings.creditRatePercent}% store credit on cards worth{" "}
        {formatUsd(settings.minCardValueCents)} or more
        {settings.localPickupEnabled &&
        (settings.localCreditRatePercent !== settings.creditRatePercent || settings.localMinCardValueCents !== settings.minCardValueCents)
          ? ` (local pickup: ${settings.localCreditRatePercent}% on ${formatUsd(settings.localMinCardValueCents)} or more)`
          : ""}
        . {settingsLink}
      </div>
    </div>
  );
}
