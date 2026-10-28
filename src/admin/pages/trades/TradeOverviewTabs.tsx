import { useState } from "react";
import { SectionCard, StatCard } from "../../components/ui/Card";
import { Badge } from "../../components/ui/Badge";
import { Button } from "../../components/ui/Button";
import { TextArea } from "../../components/ui/Field";
import { Modal } from "../../components/ui/Modal";
import { Tabs } from "../../components/ui/Nav";
import { DataTable, type Column } from "../../components/ui/DataTable";
import { EmptyState, ErrorState, TableSkeleton } from "../../components/ui/States";
import { useAsync } from "../../hooks/useAsync";
import { useToast } from "../../hooks/useToast";
import { formatCents, formatDateTime, timeAgo } from "../../utils/format";
import {
  tradeCenterRepository,
  type EconomicsPeriod,
  type EconomicsTrade,
  type ReservedLine,
  type TradeCustomerRow,
} from "../../repositories/tradeCenter.supabase";
import {
  CONDITION_NAMES,
  DEPOSIT_STATUS_ADMIN_LABELS,
  TRADE_STATUS_ADMIN_LABELS,
  tradeStatusAdminLabel,
  formatDeadline,
  tradeLabel,
  type DepositStatus,
  type StaffTradeSummary,
} from "../../../store/lib/tradeCenter";
import { LOYALTY_TIER_LABELS, onTimePercent } from "../../../store/lib/tradeRules";
import { DEPOSIT_STATUS_TONE, TRADE_STATUS_TONE } from "./tradeLabels";

// Admin → Trades: the overview tabs beside the trade list. Deposits: every
// deposit and where its money is (held, refunding, refunded, under review,
// kept, failed), with Stripe's fees. Reserved: our cards held for trades
// right now and each trade's deadline. Customers: everyone who has traded,
// their record (completed trades, on-time shipping, abandoned
// reservations) and what it earns them; the store owner can require a
// deposit on every trade of theirs or pause their new trades. Economics:
// what finished trades did to retail-priced inventory, with shipping
// (theoretical inventory-value differences, not profit).

type DepositFilter = "all" | "attention" | DepositStatus;

const DEPOSIT_FILTERS: { key: DepositFilter; label: string }[] = [
  { key: "attention", label: "Needs you" },
  { key: "paid", label: "Held" },
  { key: "refund_pending", label: "Refunding" },
  { key: "refunded", label: "Refunded" },
  { key: "forfeited", label: "Kept" },
  { key: "all", label: "All" },
];

export function DepositsTab({ onOpenTrade }: { onOpenTrade: (tradeId: string) => void }) {
  const [filter, setFilter] = useState<DepositFilter>("attention");
  const data = useAsync(() => tradeCenterRepository.deposits(), []);
  const totals = data.data?.totals;
  const all = data.data?.trades ?? [];
  const rows = all.filter((t) =>
    filter === "all" ? true : filter === "attention" ? t.depositStatus === "forfeiture_review" || t.depositStatus === "refund_failed" : t.depositStatus === filter,
  );
  const count = (f: DepositFilter) =>
    all.filter((t) =>
      f === "all" ? true : f === "attention" ? t.depositStatus === "forfeiture_review" || t.depositStatus === "refund_failed" : t.depositStatus === f,
    ).length;

  const columns: Column<StaffTradeSummary>[] = [
    {
      key: "trade",
      header: "Trade",
      render: (t) => (
        <div className="gg-ordercell">
          <span className="gg-ordercell__num">{tradeLabel(t.tradeNumber)}</span>
          <span className="gg-ordercell__cust">{t.customerName || t.customerEmail || "Customer"}</span>
        </div>
      ),
    },
    {
      key: "amount",
      header: "Deposit",
      align: "right",
      render: (t) => formatCents(t.depositPaidCents ?? t.depositCents),
    },
    {
      key: "deposit",
      header: "Where it is",
      render: (t) => <Badge tone={DEPOSIT_STATUS_TONE[t.depositStatus]}>{DEPOSIT_STATUS_ADMIN_LABELS[t.depositStatus]}</Badge>,
    },
    {
      key: "status",
      header: "Trade",
      secondary: true,
      render: (t) => <Badge tone={TRADE_STATUS_TONE[t.status]}>{tradeStatusAdminLabel(t.status, t.handoffMethod)}</Badge>,
    },
    {
      key: "updated",
      header: "Updated",
      secondary: true,
      render: (t) => <span className="gg-card-meta">{timeAgo(t.updatedAt)}</span>,
    },
  ];

  if (data.loading && !data.data) return <TableSkeleton rows={5} cols={5} />;
  if (data.error) return <ErrorState message={data.error} onRetry={data.reload} />;

  return (
    <>
      {totals && (
        <div className="gg-statgrid">
          <StatCard label="Held now" value={formatCents(totals.heldCents)} icon="dollar" caption="Refunded once the carrier accepts each package in time" />
          <StatCard
            label="Waiting for your decision"
            value={formatCents(totals.reviewCents)}
            icon="alert"
            accent={totals.reviewCents > 0 ? "gold" : "default"}
            onClick={() => setFilter("attention")}
          />
          <StatCard
            label="Refunds that failed"
            value={formatCents(totals.failedCents)}
            icon="warning"
            accent={totals.failedCents > 0 ? "warning" : "default"}
            onClick={() => setFilter("attention")}
          />
          <StatCard label="Refunding" value={formatCents(totals.refundPendingCents)} icon="swap" />
          <StatCard label="Refunded" value={formatCents(totals.refundedCents)} icon="checkCircle" />
          <StatCard label="Kept" value={formatCents(totals.forfeitedCents)} icon="dollar" />
          <StatCard label="Stripe fees on deposits" value={formatCents(totals.feesCents)} icon="dollar" caption="Absorbed by the store" />
        </div>
      )}
      <SectionCard title="Deposits" className="gg-trades-list">
        <Tabs
          ariaLabel="Filter deposits"
          active={filter}
          onChange={(k) => setFilter(k as DepositFilter)}
          items={DEPOSIT_FILTERS.map((f) => ({ key: f.key, label: f.label, count: count(f.key) }))}
        />
        {rows.length === 0 ? (
          <EmptyState
            icon="dollar"
            title={filter === "attention" ? "No deposits need you" : "No deposits here"}
            message={
              filter === "attention"
                ? "Deposits up for review (a canceled or unshipped reservation) and refunds the bank refused show up here."
                : all.length === 0
                  ? "Trades that need a deposit show up here once the customer confirms."
                  : "Try another filter."
            }
          />
        ) : (
          <DataTable columns={columns} rows={rows} rowKey={(t) => t.id} onRowClick={(t) => onOpenTrade(t.id)} caption="Deposits" />
        )}
      </SectionCard>
    </>
  );
}

const ECONOMICS_PERIODS: { key: string; days: EconomicsPeriod; label: string }[] = [
  { key: "30", days: 30, label: "30 days" },
  { key: "90", days: 90, label: "90 days" },
  { key: "365", days: 365, label: "12 months" },
  { key: "all", days: null, label: "All time" },
];

/** "+$44.00" or "−$12.50". */
function signed(cents: number): string {
  return `${cents < 0 ? "−" : "+"}${formatCents(Math.abs(cents))}`;
}

export function EconomicsTab({ onOpenTrade }: { onOpenTrade: (tradeId: string) => void }) {
  const [period, setPeriod] = useState("90");
  const days = ECONOMICS_PERIODS.find((p) => p.key === period)?.days ?? null;
  const data = useAsync(() => tradeCenterRepository.economics(days), [days]);
  const t = data.data?.totals;
  const settings = data.data?.settings;
  const trades = data.data?.trades ?? [];

  const columns: Column<EconomicsTrade>[] = [
    {
      key: "trade",
      header: "Trade",
      render: (r) => (
        <div className="gg-ordercell">
          <span className="gg-ordercell__num">{tradeLabel(r.tradeNumber)}</span>
          <span className="gg-ordercell__cust">{r.customerName || r.customerEmail || "Customer"}</span>
        </div>
      ),
    },
    { key: "in", header: "Their cards (TCG low)", align: "right", render: (r) => formatCents(r.economics.incomingMarketCents) },
    { key: "out", header: "Our cards (retail)", align: "right", render: (r) => formatCents(r.economics.outgoingRetailCents) },
    { key: "gross", header: "Gross difference", align: "right", secondary: true, render: (r) => signed(r.economics.grossDifferenceCents) },
    {
      key: "ship",
      header: "Net shipping",
      align: "right",
      secondary: true,
      render: (r) => (
        <span className="gg-trades__value">
          {formatCents(r.economics.netShippingCents < 0 ? 0 : r.economics.netShippingCents)}
          {r.economics.netShippingCents < 0 && <span className="gg-trades__stage">{formatCents(-r.economics.netShippingCents)} over cost</span>}
          {r.economics.shippingCostSource === "estimate" && <span className="gg-trades__stage">estimated</span>}
        </span>
      ),
    },
    { key: "adjusted", header: "After shipping", align: "right", render: (r) => <strong>{signed(r.economics.adjustedDifferenceCents)}</strong> },
    {
      key: "paid",
      header: "Finished",
      secondary: true,
      render: (r) => <span className="gg-card-meta">{r.paidAt ? formatDateTime(r.paidAt) : "—"}</span>,
    },
  ];

  return (
    <>
      <Tabs
        ariaLabel="Period"
        active={period}
        onChange={setPeriod}
        items={ECONOMICS_PERIODS.map((p) => ({ key: p.key, label: p.label }))}
      />
      {data.loading && !data.data ? (
        <TableSkeleton rows={5} cols={6} />
      ) : data.error ? (
        <ErrorState message={data.error} onRetry={data.reload} />
      ) : t ? (
        <>
          <div className="gg-statgrid">
            <StatCard label="Trades finished" value={String(t.trades)} icon="swap" caption={t.trades ? `Average ${formatCents(t.averageOutgoingCents)} of our cards` : undefined} />
            <StatCard label="Their cards in (TCG low)" value={formatCents(t.incomingMarketCents)} icon="arrowDown" />
            <StatCard label="Our cards out (retail)" value={formatCents(t.outgoingRetailCents)} icon="arrowUp" />
            <StatCard
              label="Net change in retail-priced inventory"
              value={signed(t.grossDifferenceCents)}
              icon="layers"
              accent={t.grossDifferenceCents < 0 ? "warning" : "default"}
            />
            <StatCard
              label="Shipping: cost less charged"
              value={formatCents(Math.max(t.netShippingCents, 0))}
              icon="truck"
              caption={`${formatCents(t.shippingCostCents)} cost, ${formatCents(t.shippingChargedCents)} charged`}
            />
            <StatCard label="After shipping" value={signed(t.adjustedDifferenceCents)} icon="trends" caption="Theoretical, not profit" />
            <StatCard
              label={`Singles taken worth ${settings ? formatCents(settings.minCardValueCents) : "the minimum"}+`}
              value={String(t.acceptedSingles)}
              icon="cards"
              caption={`${t.uniqueListings} different listing${t.uniqueListings === 1 ? "" : "s"}`}
            />
          </div>
          <p className="gg-card-meta gg-trd-econ__note">
            Theoretical inventory-value differences: what the cards we took in are worth (the TCG low you set), less the retail value of the cards we sent,
            less what shipping our cards cost beyond what customers paid. They aren&rsquo;t profit: they don&rsquo;t account for what our
            cards cost us, payment fees or cash flow.
            {t.estimatedShipments > 0 && settings
              ? ` ${t.estimatedShipments} of ${t.trades} shipment${t.trades === 1 ? "" : "s"} counted at the ${formatCents(settings.shipCostEstimateCents)} estimate (no label bought here or postage recorded).`
              : ""}
          </p>
          <SectionCard title="Finished trades" className="gg-trades-list">
            {trades.length === 0 ? (
              <EmptyState
                icon="swap"
                title="No finished trades in this period"
                message="Trades show up here once the customer has accepted the final offer and paid."
              />
            ) : (
              <DataTable
                columns={columns}
                rows={trades}
                rowKey={(r) => r.id}
                onRowClick={(r) => onOpenTrade(r.id)}
                caption="Finished trades and what each did to inventory value"
              />
            )}
            {t.trades > trades.length && (
              <p className="gg-card-meta">
                Showing the latest {trades.length} of {t.trades}.{" "}
                {data.data?.truncated ? "The totals above count the latest 20,000 only." : "The totals above count all of them."}
              </p>
            )}
          </SectionCard>
        </>
      ) : null}
    </>
  );
}

export function ReservedTab({ onOpenTrade }: { onOpenTrade: (tradeId: string) => void }) {
  const data = useAsync(() => tradeCenterRepository.reserved(), []);
  const lines = data.data?.lines ?? [];
  const totalCents = lines.reduce((sum, l) => sum + l.unitPriceCents * l.quantity, 0);
  const copies = lines.reduce((n, l) => n + l.quantity, 0);
  const trades = new Set(lines.map((l) => l.tradeId)).size;

  const columns: Column<ReservedLine>[] = [
    {
      key: "card",
      header: "Card",
      render: (l) => (
        <div className="gg-ordercell">
          <span className="gg-ordercell__num">{l.cardName}</span>
          <span className="gg-ordercell__cust">
            {[l.setCode?.toUpperCase(), l.collectorNumber ? `#${l.collectorNumber}` : null, CONDITION_NAMES[l.condition as keyof typeof CONDITION_NAMES] ?? l.condition]
              .filter(Boolean)
              .join(" · ")}
          </span>
        </div>
      ),
    },
    { key: "qty", header: "Copies", align: "right", render: (l) => l.quantity },
    { key: "value", header: "Value", align: "right", secondary: true, render: (l) => formatCents(l.unitPriceCents * l.quantity) },
    {
      key: "trade",
      header: "Trade",
      render: (l) => (
        <div className="gg-ordercell">
          <span className="gg-ordercell__num">{tradeLabel(l.tradeNumber)}</span>
          <span className="gg-ordercell__cust">{l.customerName || l.customerEmail || "Customer"}</span>
        </div>
      ),
    },
    {
      key: "when",
      header: "Reserved until",
      secondary: true,
      render: (l) => (
        <span className="gg-card-meta">
          {l.handoffMethod === "local"
            ? l.shipBy
              ? `Local pickup: meet by ${formatDeadline(l.shipBy)}`
              : "Local pickup"
            : l.shippedAt
              ? "Shipped: reserved until settled"
              : l.shipBy
                ? `Ship by ${formatDeadline(l.shipBy)}`
                : TRADE_STATUS_ADMIN_LABELS[l.status]}
        </span>
      ),
    },
  ];

  if (data.loading && !data.data) return <TableSkeleton rows={5} cols={5} />;
  if (data.error) return <ErrorState message={data.error} onRetry={data.reload} />;

  return (
    <SectionCard
      title="Our cards reserved for trades"
      className="gg-trades-list"
      action={<span className="gg-card-meta">{lines.length > 0 ? `${copies} cop${copies === 1 ? "y" : "ies"} · ${formatCents(totalCents)} · ${trades} trade${trades === 1 ? "" : "s"}` : null}</span>}
    >
      <p className="gg-card-meta">
        Reserved once a customer confirms (and pays any deposit), and released if they don&rsquo;t ship in time, cancel, or the trade closes.
        Reserved copies can&rsquo;t be bought at checkout.
      </p>
      {lines.length === 0 ? (
        <EmptyState icon="cards" title="Nothing is reserved" message="Cards reserved for confirmed trades show up here." />
      ) : (
        <DataTable columns={columns} rows={lines} rowKey={(l) => l.itemId} onRowClick={(l) => onOpenTrade(l.tradeId)} caption="Reserved cards" />
      )}
    </SectionCard>
  );
}

export function CustomersTab() {
  const data = useAsync(() => tradeCenterRepository.customers(), []);
  const [editing, setEditing] = useState<TradeCustomerRow | null>(null);
  const [customers, setCustomers] = useState<TradeCustomerRow[] | null>(null);
  const rows = customers ?? data.data?.customers ?? [];
  const owner = data.data?.owner ?? false;

  const columns: Column<TradeCustomerRow>[] = [
    {
      key: "customer",
      header: "Customer",
      render: (c) => (
        <div className="gg-ordercell">
          <span className="gg-ordercell__num">{c.name || c.email || "Customer"}</span>
          <span className="gg-ordercell__cust">{c.name ? c.email : null}</span>
        </div>
      ),
    },
    {
      key: "tier",
      header: "Standing",
      render: (c) => (
        <span className="gg-trd-badges">
          <Badge tone={c.privileges.tier === "new" ? "neutral" : "success"}>{LOYALTY_TIER_LABELS[c.privileges.tier]}</Badge>
          {c.privileges.blocked && <Badge tone="danger">No new trades</Badge>}
          {!c.privileges.blocked && (c.record.depositRequired || c.privileges.reliabilityDeposit) && <Badge tone="gold">Deposit required</Badge>}
        </span>
      ),
    },
    { key: "completed", header: "Completed", align: "right", render: (c) => c.record.completedTrades },
    {
      key: "ontime",
      header: "On time",
      align: "right",
      secondary: true,
      render: (c) => {
        const p = onTimePercent(c.record);
        return p === null ? "—" : `${p}%`;
      },
    },
    { key: "abandoned", header: "Counting against", align: "right", secondary: true, render: (c) => c.record.recentFaults },
    { key: "days", header: "Days to ship", align: "right", secondary: true, render: (c) => c.privileges.shipDays },
    {
      key: "last",
      header: "Last trade",
      secondary: true,
      render: (c) => <span className="gg-card-meta">{c.lastTradeAt ? timeAgo(c.lastTradeAt) : "—"}</span>,
    },
  ];

  if (data.loading && !data.data) return <TableSkeleton rows={5} cols={6} />;
  if (data.error) return <ErrorState message={data.error} onRetry={data.reload} />;

  return (
    <SectionCard title="Customers who trade" className="gg-trades-list">
      <p className="gg-card-meta">
        Completed trades earn more time to ship. Canceling after confirming or not shipping in time counts against a customer (you can clear
        one on its trade). {owner ? "Select a customer to require a deposit on every trade or pause their new trades." : ""}
      </p>
      {rows.length === 0 ? (
        <EmptyState icon="users" title="No trading customers yet" message="Customers show up here after their first trade." />
      ) : (
        <DataTable
          columns={columns}
          rows={rows}
          rowKey={(c) => c.userId}
          onRowClick={owner ? (c) => setEditing(c) : undefined}
          caption="Customers who trade"
        />
      )}
      {editing && (
        <CustomerFlagsDialog
          customer={editing}
          onClose={() => setEditing(null)}
          onSaved={(next) => {
            setCustomers(next);
            setEditing(null);
          }}
        />
      )}
    </SectionCard>
  );
}

/** Owner: a deposit on every trade of theirs, or no new trades for now. */
function CustomerFlagsDialog({
  customer,
  onClose,
  onSaved,
}: {
  customer: TradeCustomerRow;
  onClose: () => void;
  onSaved: (customers: TradeCustomerRow[]) => void;
}) {
  const toast = useToast();
  const r = customer.record;
  const [depositRequired, setDepositRequired] = useState(r.depositRequired);
  const [blocked, setBlocked] = useState(r.blocked);
  const [note, setNote] = useState(r.flagNote ?? "");
  const [saving, setSaving] = useState(false);
  const onTime = onTimePercent(r);

  async function save() {
    setSaving(true);
    try {
      const result = await tradeCenterRepository.setCustomerFlags(customer.userId, { depositRequired, blocked, note: note.trim() });
      toast.success("Saved.");
      onSaved(result.customers);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={customer.name || customer.email || "Customer"}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => void save()} loading={saving}>
            Save
          </Button>
        </>
      }
    >
      <div className="gg-trd">
        <dl className="gg-trd-money">
          <div>
            <dt>Completed trades</dt>
            <dd>{r.completedTrades}</dd>
          </div>
          <div>
            <dt>Shipped on time</dt>
            <dd>{onTime === null ? "—" : `${onTime}%`}</dd>
          </div>
          <div>
            <dt>Canceled after confirming</dt>
            <dd>{r.abandonedReservations}</dd>
          </div>
          <div>
            <dt>Missed shipping deadlines</dt>
            <dd>{r.missedDeadlines}</dd>
          </div>
          <div>
            <dt>Counting against them now</dt>
            <dd>{r.recentFaults}</dd>
          </div>
          <div>
            <dt>Declined after inspection (never counts)</dt>
            <dd>{r.declinedAfterInspection}</dd>
          </div>
          <div className="gg-trd-money__total">
            <dt>{LOYALTY_TIER_LABELS[customer.privileges.tier]}</dt>
            <dd>{customer.privileges.shipDays} days to ship</dd>
          </div>
        </dl>
        {customer.privileges.overAbandonLimit && (
          <p className="gg-trd-blocker" role="note">
            Over the abandonment limit: {customer.privileges.blocked ? "no new trades" : "a deposit on every trade"} until older ones age out or you clear
            them.
          </p>
        )}
        <label className="gg-check-inline">
          <input type="checkbox" checked={depositRequired} onChange={(e) => setDepositRequired(e.target.checked)} />
          Require a deposit on every trade of theirs
        </label>
        <label className="gg-check-inline">
          <input type="checkbox" checked={blocked} onChange={(e) => setBlocked(e.target.checked)} />
          No new trades for now (trades already started carry on)
        </label>
        <TextArea label="Note (staff only)" rows={2} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} />
        {customer.lastTradeAt && <p className="gg-card-meta">Last trade {formatDateTime(customer.lastTradeAt)}.</p>}
      </div>
    </Modal>
  );
}
