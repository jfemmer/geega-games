import { useEffect, useState } from "react";
import { PageHeader } from "../components/layout/PageHeader";
import { StatCard, SectionCard } from "../components/ui/Card";
import { BarChart, Donut, LineChart } from "../components/ui/Charts";
import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { Icon } from "../components/ui/Icon";
import { Tabs } from "../components/ui/Nav";
import { TableSkeleton, ErrorState, EmptyState } from "../components/ui/States";
import { useAsync } from "../hooks/useAsync";
import { analyticsRepository, orderRepository, inventoryRepository } from "../repositories";
import {
  formatCents,
  formatNumber,
  timeAgo,
  waitingSince,
} from "../utils/format";
import { ORDER_STATUS_LABELS, ORDER_STATUS_TONE } from "../utils/labels";
import type { DateRangeKey, NamedValue, SiteTraffic } from "../types";

const RANGE_TABS = [
  { key: "7d", label: "7 days" },
  { key: "30d", label: "30 days" },
  { key: "90d", label: "90 days" },
  { key: "ytd", label: "Year" },
];

export function OverviewPage({
  onNavigate,
}: {
  onNavigate: (path: string) => void;
}) {
  const [range, setRange] = useState<DateRangeKey>("30d");

  const overview = useAsync(() => analyticsRepository.overview(range), [range]);
  const needsPacking = useAsync(
    () => orderRepository.list({ status: "needs_packing", sortBy: "waiting", sortDir: "desc" }),
    [],
  );
  const lowStock = useAsync(
    () => inventoryRepository.list({ stock: "low", pageSize: 5, sortBy: "quantity", sortDir: "asc" }),
    [],
  );

  const traffic = useAsync(() => analyticsRepository.traffic(range), [range]);
  // Keeps "On the site now" current. Previous numbers stay on screen while
  // refreshing (the section only shows skeletons before the first load).
  const reloadTraffic = traffic.reload;
  useEffect(() => {
    const timer = window.setInterval(reloadTraffic, 60_000);
    return () => window.clearInterval(timer);
  }, [reloadTraffic]);

  const m = overview.data?.metrics;

  return (
    <div className="gg-page">
      <PageHeader
        title="Overview"
        description="Your storefront at a glance — what needs attention today."
        actions={
          <Tabs
            items={RANGE_TABS}
            active={range}
            onChange={(k) => setRange(k as DateRangeKey)}
            ariaLabel="Date range"
          />
        }
      />

      {overview.error && (
        <ErrorState message="Could not load metrics." onRetry={overview.reload} />
      )}

      <div className="gg-statgrid">
        {overview.loading || !m ? (
          Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="gg-card gg-stat gg-stat--skeleton">
              <div className="gg-skeleton" style={{ height: 62 }} />
            </div>
          ))
        ) : (
          <>
            <StatCard
              label="Revenue"
              value={formatCents(m.revenueCents)}
              icon="dollar"
              change={pctChange(m.revenueCents, m.revenuePrevCents)}
              caption="vs previous period"
              accent="gold"
            />
            <StatCard
              label="Orders"
              value={formatNumber(m.orderCount)}
              icon="orders"
              change={pctChange(m.orderCount, m.orderCountPrev)}
              caption="vs previous period"
            />
            <StatCard
              label="Avg. order value"
              value={formatCents(m.averageOrderValueCents)}
              icon="sparkle"
              change={pctChange(
                m.averageOrderValueCents,
                m.averageOrderValuePrevCents,
              )}
              caption="vs previous period"
            />
            <StatCard
              label="Needs packing"
              value={formatNumber(m.ordersNeedingPacking)}
              icon="package"
              accent={m.ordersNeedingPacking > 0 ? "purple" : "default"}
              caption={`${m.ordersReadyToShip} ready to ship`}
              onClick={() => onNavigate("/admin_dashboard/orders")}
            />
          </>
        )}
      </div>

      <div className="gg-grid-2">
        <SectionCard
          title="Revenue"
          action={
            <Button
              variant="ghost"
              size="sm"
              iconRight="chevronRight"
              onClick={() => onNavigate("/admin_dashboard/trends")}
            >
              Trends
            </Button>
          }
        >
          {overview.loading || !overview.data ? (
            <div className="gg-skeleton" style={{ height: 200 }} />
          ) : (
            <LineChart
              data={overview.data.revenue}
              summaryLabel="Revenue over the selected period"
              format={(v) => formatCents(v)}
              color="var(--gg-gold)"
            />
          )}
        </SectionCard>

        <SectionCard
          title="Orders"
          action={
            <Button
              variant="ghost"
              size="sm"
              iconRight="chevronRight"
              onClick={() => onNavigate("/admin_dashboard/orders")}
            >
              All orders
            </Button>
          }
        >
          {overview.loading || !overview.data ? (
            <div className="gg-skeleton" style={{ height: 200 }} />
          ) : (
            <LineChart
              data={overview.data.orders}
              summaryLabel="Orders over the selected period"
              format={(v) => formatNumber(v)}
              color="var(--gg-brand)"
            />
          )}
        </SectionCard>
      </div>

      <WebsiteVisitors traffic={traffic.data} error={traffic.error} onRetry={traffic.reload} />

      <div className="gg-grid-2">
        <SectionCard
          title="Needs packing"
          action={
            <Button
              variant="ghost"
              size="sm"
              iconRight="chevronRight"
              onClick={() => onNavigate("/admin_dashboard/orders")}
            >
              Open queue
            </Button>
          }
        >
          {needsPacking.loading ? (
            <TableSkeleton rows={4} cols={3} />
          ) : needsPacking.error ? (
            <ErrorState message="Could not load orders." onRetry={needsPacking.reload} />
          ) : needsPacking.data && needsPacking.data.length > 0 ? (
            <ul className="gg-attention-list">
              {needsPacking.data.slice(0, 6).map((o) => (
                <li key={o.id}>
                  <button
                    className="gg-attention"
                    onClick={() =>
                      onNavigate(`/admin_dashboard/orders?order=${o.id}`)
                    }
                  >
                    <span className="gg-attention__main">
                      <span className="gg-attention__title">
                        {o.orderNumber}
                      </span>
                      <span className="gg-attention__sub">
                        {o.customerName} · {o.items.length} item
                        {o.items.length === 1 ? "" : "s"}
                      </span>
                    </span>
                    <span className="gg-attention__meta">
                      <Badge tone={ORDER_STATUS_TONE[o.status]}>
                        {ORDER_STATUS_LABELS[o.status]}
                      </Badge>
                      <span className="gg-attention__time">
                        <Icon name="clock" size={13} />{" "}
                        {waitingSince(o.paidAt ?? o.createdAt)}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState
              icon="checkCircle"
              title="All caught up"
              message="No orders are waiting to be packed."
            />
          )}
        </SectionCard>

        <SectionCard
          title="Low stock"
          action={
            <Button
              variant="ghost"
              size="sm"
              iconRight="chevronRight"
              onClick={() =>
                onNavigate("/admin_dashboard/inventory?stock=low")
              }
            >
              Inventory
            </Button>
          }
        >
          {lowStock.loading ? (
            <TableSkeleton rows={4} cols={2} />
          ) : lowStock.error ? (
            <ErrorState message="Could not load inventory." onRetry={lowStock.reload} />
          ) : lowStock.data && lowStock.data.rows.length > 0 ? (
            <ul className="gg-attention-list">
              {lowStock.data.rows.map((i) => (
                <li key={i.id}>
                  <button
                    className="gg-attention"
                    onClick={() =>
                      onNavigate(`/admin_dashboard/inventory?item=${i.id}`)
                    }
                  >
                    <span className="gg-attention__main">
                      <span className="gg-attention__title">{i.cardName}</span>
                      <span className="gg-attention__sub">
                        {i.setName ?? i.setCode} · {i.condition} · {i.finish}
                      </span>
                    </span>
                    <span className="gg-attention__meta">
                      <Badge tone={i.quantity === 0 ? "danger" : "warning"}>
                        {i.quantity === 0 ? "Out of stock" : `${i.quantity} left`}
                      </Badge>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState
              icon="checkCircle"
              title="Stock looks healthy"
              message="No cards are below the low-stock threshold."
            />
          )}
        </SectionCard>
      </div>

      <div className="gg-grid-2">
        <SectionCard title="Customer activity">
          {overview.loading || !overview.data ? (
            <TableSkeleton rows={4} cols={2} />
          ) : overview.data.customerActivity.length > 0 ? (
            <ul className="gg-activity-list">
              {overview.data.customerActivity.map((a) => (
                <li key={a.id} className="gg-activity">
                  <span className="gg-activity__dot" aria-hidden="true" />
                  <span className="gg-activity__text">
                    <strong>{a.actor}</strong> {a.action}
                    {a.target && <span className="gg-activity__target"> {a.target}</span>}
                  </span>
                  <span className="gg-activity__time">{timeAgo(a.at)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState icon="info" title="No customer activity yet" message="" />
          )}
        </SectionCard>

        <SectionCard title="Staff activity">
          {overview.loading || !overview.data ? (
            <TableSkeleton rows={4} cols={2} />
          ) : overview.data.recentActivity.length > 0 ? (
            <ul className="gg-activity-list">
              {overview.data.recentActivity.map((a) => (
                <li key={a.id} className="gg-activity">
                  <span className="gg-activity__dot" aria-hidden="true" />
                  <span className="gg-activity__text">
                    <strong>{a.actor}</strong> {a.action}
                    {a.target && <span className="gg-activity__target"> {a.target}</span>}
                  </span>
                  <span className="gg-activity__time">{timeAgo(a.at)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState icon="info" title="No recent activity" message="" />
          )}
        </SectionCard>
      </div>
    </div>
  );
}

/* ------------------------- Website visitors ------------------------- */

const countryNames = (() => {
  try {
    return new Intl.DisplayNames(undefined, { type: "region" });
  } catch {
    return null;
  }
})();

function countryLabel(code: string): string {
  if (code === "??") return "Unknown";
  return countryNames?.of(code) ?? code;
}

function pageLabel(path: string): string {
  return path === "/" ? "Home" : path;
}

function relabel(rows: NamedValue[], fn: (label: string) => string): NamedValue[] {
  return rows.map((r) => ({ ...r, label: fn(r.label) }));
}

function WebsiteVisitors({
  traffic,
  error,
  onRetry,
}: {
  traffic: SiteTraffic | null;
  error: string | null;
  onRetry: () => void;
}) {
  const heading = (
    <div className="gg-overview-heading">
      <h2>Website visitors</h2>
      <p className="gg-muted">
        Anonymous and cookie-free. Your staff, bots and browsers that ask not to be
        tracked aren&rsquo;t counted.
      </p>
    </div>
  );
  if (error && !traffic) {
    return (
      <>
        {heading}
        <ErrorState message="Could not load website visitors." onRetry={onRetry} />
      </>
    );
  }
  if (!traffic) {
    return (
      <>
        {heading}
        <div className="gg-statgrid">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="gg-card gg-stat gg-stat--skeleton">
              <div className="gg-skeleton" style={{ height: 62 }} />
            </div>
          ))}
        </div>
      </>
    );
  }

  const noData = traffic.pageViews === 0;
  const pagesPerVisit = traffic.visitors > 0 ? traffic.pageViews / traffic.visitors : 0;
  const pagesPerVisitPrev =
    traffic.visitorsPrev > 0 ? traffic.pageViewsPrev / traffic.visitorsPrev : 0;

  return (
    <>
      {heading}
      <div className="gg-statgrid">
        <StatCard
          label="Website visitors"
          value={formatNumber(traffic.visitors)}
          icon="users"
          change={pctChange(traffic.visitors, traffic.visitorsPrev)}
          caption="vs previous period"
        />
        <StatCard
          label="Page views"
          value={formatNumber(traffic.pageViews)}
          icon="eye"
          change={pctChange(traffic.pageViews, traffic.pageViewsPrev)}
          caption="vs previous period"
        />
        <StatCard
          label="Pages per visit"
          value={pagesPerVisit.toFixed(1)}
          icon="layers"
          change={pctChange(pagesPerVisit, pagesPerVisitPrev)}
          caption="vs previous period"
        />
        <StatCard
          label="On the site now"
          value={formatNumber(traffic.liveNow)}
          icon="clock"
          accent={traffic.liveNow > 0 ? "purple" : "default"}
          caption="Last 5 minutes"
        />
      </div>

      {noData ? (
        <SectionCard title="Website visitors">
          <EmptyState
            icon="info"
            title="No visits recorded yet"
            message="Visits are counted from when tracking was switched on. Your own visits and staff devices are never counted."
          />
        </SectionCard>
      ) : (
        <>
          <div className="gg-grid-2">
            <SectionCard title="Visitors per day">
              <LineChart
                data={traffic.series}
                summaryLabel="Unique website visitors per day"
                format={(v) => formatNumber(v)}
                color="var(--gg-info)"
              />
            </SectionCard>
            <SectionCard title="Most viewed pages">
              <BarChart
                data={relabel(traffic.topPages, pageLabel)}
                summaryLabel="Most viewed pages"
                format={(v) => formatNumber(v)}
              />
            </SectionCard>
          </div>
          <div className="gg-grid-2">
            <SectionCard title="Where visitors come from">
              <BarChart
                data={traffic.referrers}
                summaryLabel="Visitors by referring website"
                format={(v) => formatNumber(v)}
                color="var(--gg-gold)"
              />
            </SectionCard>
            <SectionCard title="Devices and countries">
              <Donut data={traffic.devices} summaryLabel="Visitors by device" unit="visitors" />
              <div style={{ marginTop: 16 }}>
                <BarChart
                  data={relabel(traffic.countries, countryLabel)}
                  summaryLabel="Visitors by country"
                  format={(v) => formatNumber(v)}
                  color="var(--gg-brand-deep)"
                />
              </div>
            </SectionCard>
          </div>
        </>
      )}
    </>
  );
}

function pctChange(current: number, previous: number): number | undefined {
  if (!previous) return undefined;
  return ((current - previous) / previous) * 100;
}
