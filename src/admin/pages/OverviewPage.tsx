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
import { countryLabel, placeLabel, regionLabel } from "../utils/geoLabels";
import { DataTable, type Column } from "../components/ui/DataTable";
import type {
  DateRangeKey,
  FormPageStarts,
  FormStart,
  NamedValue,
  RecentVisitor,
  SellerFormProgress,
  SiteCampaign,
  SiteSearch,
  SiteTraffic,
} from "../types";
import { FORM_NAMES, FORM_STEPS } from "../../store/lib/formSteps";
import { biggestDropOff, funnelStages } from "../utils/formFunnel";

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

  const formProgress = useAsync(() => analyticsRepository.formProgress(range), [range]);

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

      <SellerForms progress={formProgress.data} error={formProgress.error} onRetry={formProgress.reload} />

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

function pageLabel(path: string): string {
  return path === "/" ? "Home" : path;
}

function relabel(rows: NamedValue[], fn: (label: string) => string): NamedValue[] {
  return rows.map((r) => ({ ...r, label: fn(r.label) }));
}

const DEVICE_LABEL: Record<RecentVisitor["device"], string> = {
  mobile: "Phone",
  tablet: "Tablet",
  desktop: "Computer",
};

const RECENT_VISITOR_COLUMNS: Column<RecentVisitor>[] = [
  {
    key: "location",
    header: "Location",
    render: (v) => <strong>{placeLabel(v.city, v.region, v.country)}</strong>,
  },
  { key: "when", header: "Last seen", render: (v) => timeAgo(v.lastSeen) },
  {
    key: "device",
    header: "Device",
    secondary: true,
    render: (v) => DEVICE_LABEL[v.device] ?? v.device,
  },
  {
    key: "pages",
    header: "Pages",
    align: "right",
    render: (v) => formatNumber(v.pages),
  },
  {
    key: "last",
    header: "Last page",
    secondary: true,
    render: (v) => <code className="gg-muted">{pageLabel(v.lastPage)}</code>,
  },
  {
    key: "from",
    header: "Arrived from",
    secondary: true,
    render: (v) => v.referrer ?? "Direct / unknown",
  },
];

const SEARCH_COLUMNS: Column<SiteSearch>[] = [
  { key: "query", header: "Search", render: (s) => <strong>{s.query}</strong> },
  { key: "times", header: "Times", align: "right", render: (s) => formatNumber(s.searches) },
  { key: "people", header: "People", align: "right", secondary: true, render: (s) => formatNumber(s.people) },
  { key: "when", header: "Last searched", secondary: true, render: (s) => timeAgo(s.lastSearchedAt) },
];

const TOP_SEARCH_COLUMNS: Column<SiteSearch>[] = [
  { key: "query", header: "Search", render: (s) => <strong>{s.query}</strong> },
  { key: "times", header: "Times", align: "right", render: (s) => formatNumber(s.searches) },
  {
    key: "found",
    header: "Cards found",
    align: "right",
    render: (s) => (s.results === 0 ? <Badge tone="warning">None</Badge> : formatNumber(s.results)),
  },
];

/** "picks-2026-10-24" → "Several cards, Oct 24"; "sheoldred-the-apocalypse" → "Sheoldred The Apocalypse". */
function campaignLabel(c: SiteCampaign): string {
  const campaign = c.campaign ?? "";
  const picks = /^picks-(\d{4})-(\d{2})-(\d{2})$/.exec(campaign);
  if (picks) {
    const day = new Date(Number(picks[1]), Number(picks[2]) - 1, Number(picks[3]));
    return `Several cards, ${day.toLocaleDateString("en-US", { month: "short", day: "numeric" })}`;
  }
  if (!campaign) return "Untitled link";
  return campaign
    .split("-")
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

const CAMPAIGN_COLUMNS: Column<SiteCampaign>[] = [
  { key: "post", header: "Link", render: (c) => <strong>{campaignLabel(c)}</strong> },
  {
    key: "source",
    header: "Posted on",
    secondary: true,
    render: (c) => (c.source ? c.source.charAt(0).toUpperCase() + c.source.slice(1) : "Unknown"),
  },
  { key: "visits", header: "Visits", align: "right", render: (c) => formatNumber(c.value) },
];

/** What visitors searched the shop for, and which searches found nothing. */
function VisitorSearches({ traffic }: { traffic: SiteTraffic }) {
  return (
    <div className="gg-grid-2">
      <SectionCard title="Searched for, not found" className="gg-visitor-insight">
        <DataTable
          columns={SEARCH_COLUMNS}
          rows={traffic.missedSearches}
          rowKey={(s) => s.query}
          caption="Shop searches that found no cards"
          emptyContent={
            <EmptyState
              icon="search"
              title="No empty searches"
              message="When a shop search finds nothing, it shows up here, so you know what people want that isn't in stock."
            />
          }
        />
        {traffic.missedSearches.length > 0 && (
          <p className="gg-muted" style={{ marginTop: 12, fontSize: 13 }}>
            Visitors who asked to hear when one of these comes in show up in Market Insights.
          </p>
        )}
      </SectionCard>
      <SectionCard title="Most searched" className="gg-visitor-insight">
        <DataTable
          columns={TOP_SEARCH_COLUMNS}
          rows={traffic.searches}
          rowKey={(s) => s.query}
          caption="Most searched in the shop"
          emptyContent={
            <EmptyState icon="search" title="No searches yet" message="What visitors type into the shop search shows up here." />
          }
        />
      </SectionCard>
    </div>
  );
}

/** Visits that arrived on a tagged link, such as a Facebook post link from Inventory. */
function VisitsFromPosts({ traffic }: { traffic: SiteTraffic }) {
  return (
    <SectionCard title="Visits from your posts" className="gg-visitor-insight">
      <DataTable
        columns={CAMPAIGN_COLUMNS}
        rows={traffic.campaigns}
        rowKey={(c) => `${c.source ?? ""}|${c.campaign ?? ""}`}
        caption="Visits that arrived on a post link"
        emptyContent={
          <EmptyState
            icon="share"
            title="No post links used yet"
            message="In Inventory, select the cards in a post and choose Copy Facebook post link. Visits from that link show up here."
          />
        }
      />
    </SectionCard>
  );
}

function VisitorLocations({ traffic }: { traffic: SiteTraffic }) {
  const noLocations = traffic.cities.length === 0 && traffic.regions.length === 0;
  return (
    <>
      {noLocations ? (
        <SectionCard title="Visitor locations">
          <EmptyState
            icon="info"
            title="No locations yet"
            message="City and state are recorded for visits from now on. Older visits only have a country."
          />
        </SectionCard>
      ) : (
        <div className="gg-grid-2">
          <SectionCard title="Top cities">
            <BarChart
              data={traffic.cities.map((c) => ({
                label: placeLabel(c.city, c.region, c.country),
                value: c.value,
              }))}
              summaryLabel="Visitors by city"
              format={(v) => formatNumber(v)}
              color="var(--gg-info)"
            />
          </SectionCard>
          <SectionCard title="Top states">
            <BarChart
              data={traffic.regions.map((r) => ({
                label: regionLabel(r.region, r.country),
                value: r.value,
              }))}
              summaryLabel="Visitors by state or region"
              format={(v) => formatNumber(v)}
              color="var(--gg-brand-deep)"
            />
          </SectionCard>
        </div>
      )}
      <SectionCard title="Recent visitors" className="gg-recent-visitors">
        <DataTable
          columns={RECENT_VISITOR_COLUMNS}
          rows={traffic.recentVisitors}
          rowKey={(v) => `${v.lastSeen}|${v.lastPage}|${v.pages}`}
          caption="Most recently active visitors in the last 2 days"
          emptyContent={
            <EmptyState
              icon="info"
              title="No visitors in the last 2 days"
              message="Recent visits will show up here as they happen."
            />
          }
        />
        <p className="gg-muted" style={{ marginTop: 12, fontSize: 13 }}>
          Locations are approximate — worked out from the visitor&rsquo;s internet connection,
          which can point to a nearby city or their provider&rsquo;s hub. Visitors aren&rsquo;t
          identified and the connection address isn&rsquo;t stored.
        </p>
      </SectionCard>
    </>
  );
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
        Anonymous and cookie-free. Only people count: your staff, bots (including Facebook
        checking your links), browsers that ask not to be tracked, and page loads where nobody
        scrolled, tapped or moved the mouse are left out.
        {traffic && traffic.filteredVisits > 0 && (
          <>
            {" "}
            {formatNumber(traffic.filteredVisits)} visit{traffic.filteredVisits === 1 ? " was" : "s were"} left out in this
            period.
          </>
        )}
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
          <VisitorSearches traffic={traffic} />
          <VisitsFromPosts traffic={traffic} />
          <VisitorLocations traffic={traffic} />
        </>
      )}
    </>
  );
}

/* -------------------- Seller forms: where people stop -------------------- */

const SELLER_FORMS = ["quick_quote", "sell", "referral"] as const;

function stepLabel(start: FormStart): string {
  const steps = FORM_STEPS[start.form] ?? [];
  if (steps.length <= 1) return "—";
  return `Step ${start.furthestStep} of ${steps.length}: ${start.furthestStepLabel ?? steps[start.furthestStep - 1] ?? "?"}`;
}

function outcome(start: FormStart) {
  if (start.sent) return <Badge tone="success">Sent</Badge>;
  if (start.lastError) return <Badge tone="danger">Stopped after an error</Badge>;
  if (start.submitAttempts > 0) return <Badge tone="warning">Pressed send, didn&rsquo;t finish</Badge>;
  return <Badge tone="neutral">Stopped</Badge>;
}

const FORM_START_COLUMNS: Column<FormStart>[] = [
  {
    key: "when",
    header: "Started",
    render: (f) => (
      <span title={new Date(f.startedAt).toLocaleString()}>
        <strong>{timeAgo(f.startedAt)}</strong>
      </span>
    ),
  },
  {
    key: "form",
    header: "Form",
    render: (f) => (
      <>
        {FORM_NAMES[f.form] ?? f.form}
        <br />
        <code className="gg-muted">{f.path}</code>
      </>
    ),
  },
  { key: "outcome", header: "Outcome", render: outcome },
  { key: "step", header: "Got to", render: stepLabel },
  {
    key: "field",
    header: "Last field touched",
    render: (f) => f.lastField ?? <span className="gg-muted">—</span>,
  },
  {
    key: "error",
    header: "Error they saw",
    secondary: true,
    render: (f) => f.lastError ?? <span className="gg-muted">None</span>,
  },
  { key: "photos", header: "Photos", align: "right", secondary: true, render: (f) => formatNumber(f.photos) },
  {
    key: "who",
    header: "Where",
    secondary: true,
    render: (f) => `${placeLabel(f.city, f.region, f.country)} · ${DEVICE_LABEL[f.device] ?? f.device}`,
  },
];

const FORM_PAGE_COLUMNS: Column<FormPageStarts>[] = [
  { key: "page", header: "Page", render: (p) => <code>{pageLabel(p.path)}</code> },
  { key: "form", header: "Form", secondary: true, render: (p) => FORM_NAMES[p.form] ?? p.form },
  { key: "started", header: "Started", align: "right", render: (p) => formatNumber(p.started) },
  { key: "sent", header: "Sent", align: "right", render: (p) => formatNumber(p.sent) },
];

/** How far each seller form start got, and where people stop. */
function SellerForms({
  progress,
  error,
  onRetry,
}: {
  progress: SellerFormProgress | null;
  error: string | null;
  onRetry: () => void;
}) {
  const heading = (
    <div className="gg-overview-heading">
      <h2>Seller forms: where people stop</h2>
      <p className="gg-muted">
        Every time someone starts one of the sell forms — taps or types in a field — you see how
        far they got, the last field they touched, and any error the form showed them. Anonymous:
        never what they typed, and never you or your staff.
      </p>
    </div>
  );
  if (error && !progress) {
    return (
      <>
        {heading}
        <ErrorState message="Could not load seller form progress." onRetry={onRetry} />
      </>
    );
  }
  if (!progress) {
    return (
      <>
        {heading}
        <div className="gg-skeleton" style={{ height: 180 }} />
      </>
    );
  }

  const active = SELLER_FORMS.map((form) => progress.forms.find((f) => f.form === form)).filter(
    (f): f is NonNullable<typeof f> => Boolean(f && f.started > 0),
  );

  if (active.length === 0) {
    return (
      <>
        {heading}
        <SectionCard title="Seller forms">
          <EmptyState
            icon="info"
            title="No form starts in this period"
            message="When someone starts the quick photo quote, the full sell form or a partner-store form, you'll see here how far they got."
          />
        </SectionCard>
      </>
    );
  }

  return (
    <>
      {heading}
      <div className="gg-grid-2">
        {active.map((f) => {
          const steps = FORM_STEPS[f.form] ?? [];
          const summary = biggestDropOff(f, steps);
          return (
            <SectionCard key={f.form} title={FORM_NAMES[f.form] ?? f.form}>
              <BarChart
                data={funnelStages(f, steps)}
                summaryLabel={`${FORM_NAMES[f.form] ?? f.form}: how far people got`}
                format={(v) => formatNumber(v)}
                color="var(--gg-brand)"
              />
              {summary && (
                <p className="gg-muted" style={{ marginTop: 12, fontSize: 13 }}>
                  {summary}
                </p>
              )}
            </SectionCard>
          );
        })}
        {progress.pages.length > 1 && (
          <SectionCard title="Where forms were started" className="gg-visitor-insight">
            <DataTable
              columns={FORM_PAGE_COLUMNS}
              rows={progress.pages}
              rowKey={(p) => `${p.form}|${p.path}`}
              caption="Form starts by page"
            />
          </SectionCard>
        )}
      </div>
      <SectionCard title="Recent form starts" className="gg-recent-visitors">
        <DataTable
          columns={FORM_START_COLUMNS}
          rows={progress.recent}
          rowKey={(f) => f.id}
          caption="The latest seller form starts and where each one stopped"
        />
        <p className="gg-muted" style={{ marginTop: 12, fontSize: 13 }}>
          A start that shows &ldquo;Stopped&rdquo; may still be in progress if it began in the last
          few minutes. On a phone, the error and location columns are hidden — turn the phone
          sideways or use a computer to see them.
        </p>
      </SectionCard>
    </>
  );
}

function pctChange(current: number, previous: number): number | undefined {
  if (!previous) return undefined;
  return ((current - previous) / previous) * 100;
}
