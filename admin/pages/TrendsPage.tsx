import { useState } from "react";
import { PageHeader } from "../components/layout/PageHeader";
import { SectionCard, StatCard } from "../components/ui/Card";
import { LineChart, BarChart, Donut } from "../components/ui/Charts";
import { Tabs } from "../components/ui/Nav";
import { ErrorState } from "../components/ui/States";
import { useAsync } from "../hooks/useAsync";
import { analyticsRepository } from "../repositories";
import { formatCents, formatNumber } from "../utils/format";
import {
  CONDITION_LABELS,
  FINISH_LABELS,
} from "../utils/labels";
import type { DateRangeKey, NamedValue } from "../types";

const RANGE_TABS = [
  { key: "7d", label: "7 days" },
  { key: "30d", label: "30 days" },
  { key: "90d", label: "90 days" },
  { key: "ytd", label: "Year" },
];

function relabel(data: NamedValue[], map: Record<string, string>): NamedValue[] {
  return data.map((d) => ({ ...d, label: map[d.label] ?? d.label }));
}

export function TrendsPage() {
  const [range, setRange] = useState<DateRangeKey>("30d");
  const trends = useAsync(() => analyticsRepository.trends(range), [range]);
  const t = trends.data;

  return (
    <div className="gg-page">
      <PageHeader
        title="Trends"
        description="How the store is performing — sales, inventory, and audience."
        actions={
          <Tabs
            items={RANGE_TABS}
            active={range}
            onChange={(k) => setRange(k as DateRangeKey)}
            ariaLabel="Date range"
          />
        }
      />

      {trends.error && (
        <ErrorState message="Could not load trends." onRetry={trends.reload} />
      )}

      <div className="gg-statgrid">
        {!t ? (
          Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="gg-card gg-stat">
              <div className="gg-skeleton" style={{ height: 62 }} />
            </div>
          ))
        ) : (
          <>
            <StatCard
              label="Units sold"
              value={formatNumber(t.unitsSold)}
              icon="box"
              accent="purple"
            />
            <StatCard
              label="Avg. order value"
              value={formatCents(t.averageOrderValueCents)}
              icon="sparkle"
            />
            <StatCard
              label="Inventory value"
              value={formatCents(t.inventoryValueCents)}
              icon="inventory"
              accent="gold"
              caption={`Cost basis ${formatCents(t.estimatedCostBasisCents)}`}
            />
            <StatCard
              label="Est. gross margin"
              value={formatCents(t.estimatedGrossMarginCents)}
              icon="dollar"
              caption="Inventory value − cost basis"
            />
          </>
        )}
      </div>

      <div className="gg-grid-2">
        <SectionCard title="Revenue">
          {!t ? (
            <div className="gg-skeleton" style={{ height: 200 }} />
          ) : (
            <LineChart
              data={t.revenueSeries}
              summaryLabel="Revenue trend"
              format={(v) => formatCents(v)}
              color="var(--gg-gold)"
            />
          )}
        </SectionCard>
        <SectionCard title="Orders">
          {!t ? (
            <div className="gg-skeleton" style={{ height: 200 }} />
          ) : (
            <LineChart
              data={t.orderSeries}
              summaryLabel="Order trend"
              format={(v) => formatNumber(v)}
              color="var(--gg-brand)"
            />
          )}
        </SectionCard>
      </div>

      <div className="gg-grid-2">
        <SectionCard title="Top cards">
          {!t ? (
            <div className="gg-skeleton" style={{ height: 180 }} />
          ) : (
            <BarChart
              data={t.topCards}
              summaryLabel="Top selling cards by units"
              format={(v) => `${formatNumber(v)} sold`}
              color="var(--gg-brand)"
            />
          )}
        </SectionCard>
        <SectionCard title="Top sets">
          {!t ? (
            <div className="gg-skeleton" style={{ height: 180 }} />
          ) : (
            <BarChart
              data={t.topSets}
              summaryLabel="Top selling sets by units"
              format={(v) => `${formatNumber(v)} sold`}
              color="var(--gg-brand-deep)"
            />
          )}
        </SectionCard>
      </div>

      <div className="gg-grid-3">
        <SectionCard title="Sales by condition">
          {!t ? (
            <div className="gg-skeleton" style={{ height: 180 }} />
          ) : (
            <Donut
              data={relabel(t.salesByCondition, CONDITION_LABELS)}
              summaryLabel="Sales share by card condition"
            />
          )}
        </SectionCard>
        <SectionCard title="Sales by finish">
          {!t ? (
            <div className="gg-skeleton" style={{ height: 180 }} />
          ) : (
            <Donut
              data={relabel(t.salesByFinish, FINISH_LABELS)}
              summaryLabel="Sales share by finish"
            />
          )}
        </SectionCard>
        <SectionCard title="Inventory aging">
          {!t ? (
            <div className="gg-skeleton" style={{ height: 180 }} />
          ) : (
            <BarChart
              data={t.agingInventory}
              summaryLabel="Inventory by age bucket"
              format={(v) => `${formatNumber(v)} cards`}
              color="var(--gg-info)"
            />
          )}
        </SectionCard>
      </div>

      <div className="gg-grid-2">
        <SectionCard title="Newsletter growth">
          {!t ? (
            <div className="gg-skeleton" style={{ height: 200 }} />
          ) : (
            <LineChart
              data={t.newsletterGrowth}
              summaryLabel="Newsletter subscriber growth"
              format={(v) => formatNumber(v)}
              color="var(--gg-info)"
            />
          )}
        </SectionCard>
        <SectionCard title="Campaign performance">
          {!t ? (
            <div className="gg-skeleton" style={{ height: 200 }} />
          ) : (
            <BarChart
              data={t.campaignPerformance}
              summaryLabel="Open rate by recent campaign"
              format={(v) => `${v}% open`}
              color="var(--gg-gold)"
            />
          )}
        </SectionCard>
      </div>

      <div className="gg-grid-2">
        <SectionCard title="Customers">
          {!t ? (
            <div className="gg-skeleton" style={{ height: 120 }} />
          ) : (
            <div className="gg-splitstat">
              <div>
                <span className="gg-splitstat__value">
                  {formatNumber(t.newCustomers)}
                </span>
                <span className="gg-splitstat__label">New customers</span>
              </div>
              <div>
                <span className="gg-splitstat__value">
                  {formatNumber(t.repeatCustomers)}
                </span>
                <span className="gg-splitstat__label">Repeat customers</span>
              </div>
            </div>
          )}
        </SectionCard>
        <SectionCard title="Low stock">
          {!t ? (
            <div className="gg-skeleton" style={{ height: 120 }} />
          ) : (
            <div className="gg-splitstat">
              <div>
                <span className="gg-splitstat__value">{t.lowStockCount}</span>
                <span className="gg-splitstat__label">
                  Cards at or below threshold
                </span>
              </div>
            </div>
          )}
        </SectionCard>
      </div>
    </div>
  );
}
