import { useMemo, useState } from "react";
import type { FormEvent } from "react";
import { PageHeader } from "../components/layout/PageHeader";
import { SectionCard } from "../components/ui/Card";
import { BarChart } from "../components/ui/Charts";
import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { Tabs } from "../components/ui/Nav";
import { DataTable, type Column } from "../components/ui/DataTable";
import { TableSkeleton, ErrorState, EmptyState } from "../components/ui/States";
import { useAsync } from "../hooks/useAsync";
import { insightsRepository } from "../repositories";
import { formatCents, formatNumber } from "../utils/format";
import type {
  MarketResearchNote,
  MarketResearchNoteInput,
  OrderGeographyRow,
  SourcingSignal,
} from "../types";

const TABS = [
  { key: "sourcing", label: "Sourcing Signals" },
  { key: "geography", label: "Order Geography" },
  { key: "research", label: "Market Research" },
];

export function MarketInsightsPage() {
  const [tab, setTab] = useState<string>("sourcing");

  return (
    <div className="gg-page">
      <PageHeader
        title="Market Insights"
        description="What to source next, where your customers actually are, and how that stacks up against candidate markets for a physical store."
        actions={<Tabs items={TABS} active={tab} onChange={setTab} ariaLabel="Insights view" />}
      />
      {tab === "sourcing" && <SourcingSignalsTab />}
      {tab === "geography" && <OrderGeographyTab />}
      {tab === "research" && <MarketResearchTab />}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Sourcing Signals — unmet demand, ranked
 * ------------------------------------------------------------------ */

function SourcingSignalsTab() {
  const signals = useAsync(() => insightsRepository.sourcingSignals(), []);

  const columns: Column<SourcingSignal>[] = [
    { key: "card", header: "Card", render: (r) => <strong>{r.cardName}</strong> },
    {
      key: "wishlist",
      header: "Wishlist saves",
      align: "right",
      render: (r) => formatNumber(r.wishlistCount),
    },
    {
      key: "alerts",
      header: "Back-in-stock alerts",
      align: "right",
      render: (r) => formatNumber(r.stockAlertCount),
    },
    {
      key: "demand",
      header: "Total demand",
      align: "right",
      sortKey: "demand",
      render: (r) => <strong>{formatNumber(r.totalDemand)}</strong>,
    },
    {
      key: "stock",
      header: "Currently in stock",
      render: (r) =>
        r.currentlyInStock ? (
          <Badge tone="success">{formatNumber(r.inStockQuantity)} in stock</Badge>
        ) : (
          <Badge tone="warning">Out of stock</Badge>
        ),
    },
  ];

  return (
    <SectionCard title="Cards customers are waiting on">
      {signals.error ? (
        <ErrorState message={signals.error} onRetry={signals.reload} />
      ) : signals.loading ? (
        <TableSkeleton rows={6} cols={5} />
      ) : !signals.data || signals.data.length === 0 ? (
        <EmptyState
          icon="box"
          title="No open demand yet"
          message="Once customers start saving cards to their wishlist or subscribing to back-in-stock alerts, the cards with the most unmet demand will show up here — ranked so you know exactly what to source next."
        />
      ) : (
        <DataTable
          columns={columns}
          rows={signals.data}
          rowKey={(r) => r.oracleId}
          caption="Cards ranked by unmet customer demand"
        />
      )}
    </SectionCard>
  );
}

/* ------------------------------------------------------------------ *
 * Order Geography — where paid orders actually ship
 * ------------------------------------------------------------------ */

type StateRollup = { state: string; orderCount: number; revenueCents: number };

function rollupByState(rows: OrderGeographyRow[]): StateRollup[] {
  const map = new Map<string, StateRollup>();
  for (const r of rows) {
    const cur = map.get(r.shipState) ?? { state: r.shipState, orderCount: 0, revenueCents: 0 };
    cur.orderCount += r.orderCount;
    cur.revenueCents += r.totalRevenueCents;
    map.set(r.shipState, cur);
  }
  return [...map.values()].sort((a, b) => b.orderCount - a.orderCount);
}

// --- Sample order-location map -------------------------------------------
// Preview only — hand-picked sample points, not wired to insightsRepository.
// Real geography rows have no lat/long yet; plotting live orders later needs
// a city → coordinates lookup (or capturing lat/long at checkout).

type MapPoint = {
  city: string;
  state: string;
  lat: number;
  lon: number;
  orderCount: number;
  revenueCents: number;
};

const SAMPLE_MAP_POINTS: MapPoint[] = [
  { city: "St. Louis", state: "MO", lat: 38.63, lon: -90.2, orderCount: 42, revenueCents: 215000 },
  { city: "Kansas City", state: "MO", lat: 39.1, lon: -94.58, orderCount: 9, revenueCents: 41000 },
  { city: "Chicago", state: "IL", lat: 41.88, lon: -87.63, orderCount: 27, revenueCents: 148000 },
  { city: "Nashville", state: "TN", lat: 36.16, lon: -86.78, orderCount: 14, revenueCents: 71000 },
  { city: "Indianapolis", state: "IN", lat: 39.77, lon: -86.16, orderCount: 11, revenueCents: 56000 },
  { city: "Austin", state: "TX", lat: 30.27, lon: -97.74, orderCount: 16, revenueCents: 84000 },
  { city: "Dallas", state: "TX", lat: 32.78, lon: -96.8, orderCount: 13, revenueCents: 69000 },
  { city: "Atlanta", state: "GA", lat: 33.75, lon: -84.39, orderCount: 19, revenueCents: 97000 },
  { city: "New York", state: "NY", lat: 40.71, lon: -74.01, orderCount: 31, revenueCents: 178000 },
  { city: "Boston", state: "MA", lat: 42.36, lon: -71.06, orderCount: 15, revenueCents: 79000 },
  { city: "Miami", state: "FL", lat: 25.76, lon: -80.19, orderCount: 10, revenueCents: 52000 },
  { city: "Denver", state: "CO", lat: 39.74, lon: -104.99, orderCount: 8, revenueCents: 39000 },
  { city: "Phoenix", state: "AZ", lat: 33.45, lon: -112.07, orderCount: 6, revenueCents: 27000 },
  { city: "Los Angeles", state: "CA", lat: 34.05, lon: -118.24, orderCount: 22, revenueCents: 121000 },
  { city: "Seattle", state: "WA", lat: 47.61, lon: -122.33, orderCount: 12, revenueCents: 63000 },
  { city: "Minneapolis", state: "MN", lat: 44.98, lon: -93.27, orderCount: 7, revenueCents: 33000 },
];

// Simplified low-poly continental-US border, [lat, lon] pairs traced
// clockwise from Maine. Stylized for a dashboard backdrop, not survey-grade.
const US_OUTLINE: [number, number][] = [
  [47.35, -68.2], [45.05, -67.05], [44.3, -68.2], [43.65, -70.2], [42.85, -70.75],
  [41.7, -70.0], [41.3, -71.9], [41.05, -73.4], [40.6, -73.9], [39.6, -74.25],
  [38.9, -75.05], [37.9, -75.4], [37.0, -76.0], [35.9, -75.6], [33.9, -78.0],
  [32.7, -79.9], [31.1, -81.3], [30.35, -81.4], [28.9, -80.6], [26.7, -80.05],
  [25.25, -80.5], [26.0, -81.8], [27.5, -82.6], [29.7, -84.4], [30.4, -87.2],
  [30.2, -89.1], [29.15, -89.4], [29.75, -91.1], [29.75, -93.3], [29.3, -94.8],
  [27.8, -97.2], [25.95, -97.15], [29.4, -101.4], [31.75, -106.5], [31.35, -108.2],
  [31.33, -111.05], [32.5, -114.8], [32.55, -117.1], [34.0, -119.7], [36.6, -121.9],
  [37.8, -122.5], [40.4, -124.3], [43.3, -124.4], [46.2, -124.1], [48.1, -124.6],
  [48.4, -122.7], [49.0, -117.0], [49.0, -104.0], [49.35, -97.2], [49.35, -95.15],
  [48.0, -94.8], [47.5, -92.1], [47.0, -88.4], [45.8, -84.8], [45.0, -83.4],
  [43.6, -82.5], [42.0, -83.1], [41.5, -82.7], [42.1, -79.8], [43.6, -79.4],
  [44.5, -75.8], [45.0, -73.3], [45.3, -71.1],
];

const MAP_WIDTH = 960;
const MAP_HEIGHT = 580;
const MAP_LON_MIN = -125.5;
const MAP_LON_MAX = -66.5;
const MAP_LAT_MIN = 24;
const MAP_LAT_MAX = 49.8;

function projectLatLon(lat: number, lon: number): [number, number] {
  const x = ((lon - MAP_LON_MIN) / (MAP_LON_MAX - MAP_LON_MIN)) * MAP_WIDTH;
  const y = MAP_HEIGHT - ((lat - MAP_LAT_MIN) / (MAP_LAT_MAX - MAP_LAT_MIN)) * MAP_HEIGHT;
  return [x, y];
}

// Sequential magnitude encoding: one hue (brand), lighter → darker via
// opacity, size scaling the same variable so the legend covers both at once.
const MAP_LEGEND_BUCKETS = [
  { max: 9, label: "1–9 orders", opacity: 0.35, radius: 6 },
  { max: 17, label: "10–17 orders", opacity: 0.55, radius: 11 },
  { max: 27, label: "18–27 orders", opacity: 0.75, radius: 16 },
  { max: Infinity, label: "28+ orders", opacity: 1, radius: 21 },
];

function bucketFor(orderCount: number) {
  return (
    MAP_LEGEND_BUCKETS.find((b) => orderCount <= b.max) ??
    MAP_LEGEND_BUCKETS[MAP_LEGEND_BUCKETS.length - 1]
  );
}

function OrdersMap({ points }: { points: MapPoint[] }) {
  const outlinePath =
    US_OUTLINE.map(([lat, lon], i) => {
      const [x, y] = projectLatLon(lat, lon);
      return `${i === 0 ? "M" : "L"} ${x.toFixed(1)} ${y.toFixed(1)}`;
    }).join(" ") + " Z";
  const maxCount = Math.max(...points.map((p) => p.orderCount), 1);

  return (
    <div className="gg-mapchart">
      <div className="gg-mapchart__scroll">
        <svg
          viewBox={`0 0 ${MAP_WIDTH} ${MAP_HEIGHT}`}
          className="gg-mapchart__svg"
          role="img"
          aria-label={`Sample order locations: ${points
            .map((p) => `${p.city}, ${p.state} ${p.orderCount} orders`)
            .join(", ")}.`}
        >
          <path d={outlinePath} className="gg-mapchart__outline" />
          {points.map((p) => {
            const [cx, cy] = projectLatLon(p.lat, p.lon);
            const bucket = bucketFor(p.orderCount);
            const r = 6 + Math.sqrt(p.orderCount / maxCount) * 16;
            return (
              <g key={`${p.state}-${p.city}`}>
                <circle
                  cx={cx}
                  cy={cy}
                  r={r}
                  className="gg-mapchart__dot"
                  style={{ fillOpacity: bucket.opacity }}
                />
                <circle cx={cx} cy={cy} r={Math.max(16, r)} className="gg-mapchart__hit">
                  <title>
                    {p.city}, {p.state} — {formatNumber(p.orderCount)} orders —{" "}
                    {formatCents(p.revenueCents)}
                  </title>
                </circle>
              </g>
            );
          })}
        </svg>
      </div>
      <div className="gg-mapchart__legend">
        {MAP_LEGEND_BUCKETS.map((b) => (
          <div className="gg-mapchart__legend-item" key={b.label}>
            <span
              className="gg-mapchart__legend-dot"
              style={{ opacity: b.opacity, width: b.radius, height: b.radius }}
              aria-hidden="true"
            />
            <span>{b.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function OrderGeographyTab() {
  const geography = useAsync(() => insightsRepository.orderGeography(), []);
  const [selectedState, setSelectedState] = useState<string | null>(null);

  const rows = geography.data ?? [];
  const stateRollup = useMemo(() => rollupByState(rows), [rows]);
  const cityRows = selectedState ? rows.filter((r) => r.shipState === selectedState) : [];

  const stateColumns: Column<StateRollup>[] = [
    {
      key: "state",
      header: "State",
      render: (r) => (
        <button className="gg-link-btn" onClick={() => setSelectedState(r.state)}>
          {r.state}
        </button>
      ),
    },
    { key: "orders", header: "Orders", align: "right", render: (r) => formatNumber(r.orderCount) },
    {
      key: "revenue",
      header: "Revenue",
      align: "right",
      render: (r) => formatCents(r.revenueCents),
    },
  ];

  const cityColumns: Column<OrderGeographyRow>[] = [
    { key: "city", header: "City", render: (r) => r.shipCity },
    { key: "orders", header: "Orders", align: "right", render: (r) => formatNumber(r.orderCount) },
    {
      key: "revenue",
      header: "Revenue",
      align: "right",
      render: (r) => formatCents(r.totalRevenueCents),
    },
  ];

  return (
    <>
      <SectionCard
        title="Where orders ship"
        action={<Badge tone="info">Sample data — preview</Badge>}
      >
        <p className="gg-card-meta" style={{ marginTop: 0 }}>
          A first look at plotting order locations on a map — these are illustrative sample
          points, not your real orders yet. Once you like how it looks, this can be wired to the
          same paid-order data as the table below.
        </p>
        <OrdersMap points={SAMPLE_MAP_POINTS} />
      </SectionCard>

      <SectionCard title="Orders by state">
        {geography.error ? (
          <ErrorState message={geography.error} onRetry={geography.reload} />
        ) : geography.loading ? (
          <TableSkeleton rows={5} cols={3} />
        ) : stateRollup.length === 0 ? (
          <EmptyState
            icon="package"
            title="No paid orders yet"
            message="Once you have paid orders, this shows where they ship — the clearest signal of where demand for Geega Games actually is."
          />
        ) : (
          <>
            <BarChart
              data={stateRollup.slice(0, 10).map((s) => ({ label: s.state, value: s.orderCount }))}
              summaryLabel="Orders by state"
              format={(v) => formatNumber(v)}
            />
            <DataTable
              columns={stateColumns}
              rows={stateRollup}
              rowKey={(r) => r.state}
              caption="Paid orders grouped by state"
            />
          </>
        )}
      </SectionCard>

      {selectedState && (
        <SectionCard
          title={`Cities in ${selectedState}`}
          action={
            <Button variant="ghost" size="sm" onClick={() => setSelectedState(null)}>
              Clear
            </Button>
          }
        >
          <DataTable
            columns={cityColumns}
            rows={cityRows}
            rowKey={(r) => `${r.shipState}-${r.shipCity}`}
            caption={`Paid orders in ${selectedState} by city`}
          />
        </SectionCard>
      )}
    </>
  );
}

/* ------------------------------------------------------------------ *
 * Market Research — manually-curated competitor notes vs. real demand
 * ------------------------------------------------------------------ */

const EMPTY_FORM: MarketResearchNoteInput = {
  regionLabel: "",
  state: "",
  competitorCount: null,
  population: null,
  notes: "",
};

function MarketResearchTab() {
  const notes = useAsync(() => insightsRepository.listMarketResearchNotes(), []);
  const geography = useAsync(() => insightsRepository.orderGeography(), []);
  const stateRollup = useMemo(() => rollupByState(geography.data ?? []), [geography.data]);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<MarketResearchNoteInput>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  function demandFor(state: string | null): StateRollup | null {
    if (!state) return null;
    return (
      stateRollup.find((r) => r.state.toLowerCase() === state.toLowerCase()) ?? {
        state,
        orderCount: 0,
        revenueCents: 0,
      }
    );
  }

  function startEdit(note: MarketResearchNote) {
    setEditingId(note.id);
    setForm({
      regionLabel: note.regionLabel,
      state: note.state ?? "",
      competitorCount: note.competitorCount,
      population: note.population,
      notes: note.notes ?? "",
    });
  }

  function startNew() {
    setEditingId("new");
    setForm(EMPTY_FORM);
  }

  function cancelEdit() {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setFormError(null);
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!form.regionLabel.trim()) {
      setFormError("A region label is required — e.g. \"St. Louis, MO\".");
      return;
    }
    setSaving(true);
    setFormError(null);
    try {
      await insightsRepository.saveMarketResearchNote(editingId === "new" ? null : editingId, {
        ...form,
        state: form.state?.trim() || null,
        notes: form.notes?.trim() || null,
      });
      cancelEdit();
      notes.reload();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Could not save this note.");
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: string) {
    if (!window.confirm("Delete this market research note?")) return;
    await insightsRepository.deleteMarketResearchNote(id);
    notes.reload();
  }

  return (
    <>
      <SectionCard
        title="Candidate markets"
        action={
          editingId === null && (
            <Button variant="primary" size="sm" onClick={startNew}>
              Add a market
            </Button>
          )
        }
      >
        <p className="gg-card-meta" style={{ marginTop: 0 }}>
          A place to log what you find researching a candidate city — competitor count from a quick
          map search, population, anything relevant — next to your own real order demand for that
          state. This is intentionally manual: an automated competitor count needs its own paid
          API and isn&rsquo;t worth setting up until you have a short list of markets to actually compare.
        </p>

        {editingId !== null && (
          <form className="gg-form" onSubmit={submit} style={{ marginBottom: "1.25rem" }}>
            {formError && (
              <div className="gg-alert gg-alert-error" role="alert">
                {formError}
              </div>
            )}
            <div className="gg-form-grid">
              <div className="gg-field">
                <label htmlFor="mr-region">Region label</label>
                <input
                  id="mr-region"
                  type="text"
                  placeholder="e.g. St. Louis, MO"
                  value={form.regionLabel}
                  onChange={(e) => setForm((f) => ({ ...f, regionLabel: e.target.value }))}
                  required
                />
              </div>
              <div className="gg-field">
                <label htmlFor="mr-state">State (to match against order data)</label>
                <input
                  id="mr-state"
                  type="text"
                  placeholder="e.g. Missouri"
                  value={form.state ?? ""}
                  onChange={(e) => setForm((f) => ({ ...f, state: e.target.value }))}
                />
              </div>
              <div className="gg-field">
                <label htmlFor="mr-competitors">Known competitor stores</label>
                <input
                  id="mr-competitors"
                  type="number"
                  min={0}
                  value={form.competitorCount ?? ""}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      competitorCount: e.target.value === "" ? null : Number(e.target.value),
                    }))
                  }
                />
              </div>
              <div className="gg-field">
                <label htmlFor="mr-population">Population (optional)</label>
                <input
                  id="mr-population"
                  type="number"
                  min={0}
                  value={form.population ?? ""}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      population: e.target.value === "" ? null : Number(e.target.value),
                    }))
                  }
                />
              </div>
              <div className="gg-field gg-field-span2">
                <label htmlFor="mr-notes">Notes</label>
                <textarea
                  id="mr-notes"
                  rows={3}
                  placeholder="Store names, links, anything worth remembering"
                  value={form.notes ?? ""}
                  onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                />
              </div>
            </div>
            <div style={{ display: "flex", gap: "0.5rem" }}>
              <Button type="submit" variant="primary" loading={saving}>
                {editingId === "new" ? "Add market" : "Save changes"}
              </Button>
              <Button type="button" variant="ghost" onClick={cancelEdit} disabled={saving}>
                Cancel
              </Button>
            </div>
          </form>
        )}

        {notes.error ? (
          <ErrorState message={notes.error} onRetry={notes.reload} />
        ) : notes.loading ? (
          <TableSkeleton rows={3} cols={4} />
        ) : !notes.data || notes.data.length === 0 ? (
          <EmptyState
            icon="search"
            title="No markets logged yet"
            message="Add a candidate city to start comparing its competitor density against your real order demand there."
          />
        ) : (
          <div className="gg-marketnotes">
            {notes.data.map((note) => {
              const demand = demandFor(note.state);
              return (
                <div className="gg-marketnote" key={note.id}>
                  <div className="gg-marketnote__head">
                    <strong>{note.regionLabel}</strong>
                    <div style={{ display: "flex", gap: "0.4rem" }}>
                      <Button variant="ghost" size="sm" onClick={() => startEdit(note)}>
                        Edit
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => remove(note.id)}>
                        Delete
                      </Button>
                    </div>
                  </div>
                  <div className="gg-marketnote__stats">
                    <div>
                      <span className="gg-card-meta">Known competitors</span>
                      <strong>{note.competitorCount ?? "—"}</strong>
                    </div>
                    <div>
                      <span className="gg-card-meta">Population</span>
                      <strong>{note.population ? formatNumber(note.population) : "—"}</strong>
                    </div>
                    <div>
                      <span className="gg-card-meta">Our orders from here</span>
                      <strong>
                        {demand ? formatNumber(demand.orderCount) : "No state on file"}
                      </strong>
                    </div>
                    <div>
                      <span className="gg-card-meta">Our revenue from here</span>
                      <strong>{demand ? formatCents(demand.revenueCents) : "—"}</strong>
                    </div>
                  </div>
                  {note.notes && <p className="gg-marketnote__notes">{note.notes}</p>}
                </div>
              );
            })}
          </div>
        )}
      </SectionCard>
    </>
  );
}
