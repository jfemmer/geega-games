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
