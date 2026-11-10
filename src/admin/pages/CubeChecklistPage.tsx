import { useCallback, useEffect, useMemo, useState, type KeyboardEvent } from "react";
import { PageHeader } from "../components/layout/PageHeader";
import { SectionCard } from "../components/ui/Card";
import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { Tabs } from "../components/ui/Nav";
import { Icon } from "../components/ui/Icon";
import { SearchInput } from "../components/ui/Field";
import { ConfirmDialog } from "../components/ui/ConfirmDialog";
import { TableSkeleton, ErrorState, EmptyState, Spinner } from "../components/ui/States";
import { CardImage } from "../components/cards/CardImage";
import { PrintingTreatmentBadges } from "../components/cards/PrintingPreview";
import { useAsync } from "../hooks/useAsync";
import { adminFetch } from "../repositories/apiClient";
import { scryfallRepository } from "../repositories";
import { RARITY_LABELS, RARITY_TONE } from "../utils/labels";
import { formatCents } from "../utils/format";
import type { CardPrinting } from "../types";

// TEMPORARY — Cube Checklist.
//
// Pulls a CubeCobra cube list (via the staff-only /api/admin/cube-list proxy)
// so staff can work through it: search, cross cards off, and look up each
// card's printings (via the existing Scryfall proxy). Crossed-off state is kept
// in this browser's localStorage, per cube — no database table, so removing the
// feature later is just deleting this page, its nav entry, and the endpoint.

const CUBE_ID = "thepaupercube";
const CUBE_URL = `https://cubecobra.com/cube/list/${CUBE_ID}`;
const STORAGE_KEY = `gg-cube-checklist:${CUBE_ID}`;

interface CubeCard {
  name: string;
  type: string | null;
  colorCategory: string | null;
}

interface CubeListResponse {
  cubeId: string;
  name: string | null;
  cards: CubeCard[];
}

type View = "remaining" | "all" | "crossed";
type SortKey = "color" | "name";

/** CubeCobra's own color-category order, so the list reads like the cube page. */
const COLOR_ORDER = [
  "White",
  "Blue",
  "Black",
  "Red",
  "Green",
  "Colorless",
  "Multicolored",
  "Hybrid",
  "Lands",
];

function colorRank(category: string | null): number {
  const i = category ? COLOR_ORDER.indexOf(category) : -1;
  return i < 0 ? COLOR_ORDER.length : i;
}

/** Case- and accent-insensitive key for matching and storage. */
function normalize(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

function loadCrossed(): Set<string> {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(parsed) ? parsed.filter((v) => typeof v === "string") : []);
  } catch {
    return new Set();
  }
}

function saveCrossed(set: Set<string>): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify([...set]));
  } catch {
    /* storage unavailable (private mode, quota) — state still works for this visit */
  }
}

export function CubeChecklistPage() {
  const cube = useAsync(
    () => adminFetch<CubeListResponse>(`/api/admin/cube-list?id=${encodeURIComponent(CUBE_ID)}`),
    [],
  );

  const [crossed, setCrossed] = useState<Set<string>>(loadCrossed);
  const [search, setSearch] = useState("");
  const [view, setView] = useState<View>("remaining");
  const [sort, setSort] = useState<SortKey>("color");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);

  // Keep other tabs on this page in sync (e.g. phone + laptop on the same browser profile).
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY) setCrossed(loadCrossed());
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const toggle = useCallback((name: string) => {
    setCrossed((prev) => {
      const next = new Set(prev);
      const key = normalize(name);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      saveCrossed(next);
      return next;
    });
  }, []);

  const cards = useMemo(() => {
    const list = cube.data?.cards ?? [];
    return [...list].sort((a, b) => {
      if (sort === "color") {
        const d = colorRank(a.colorCategory) - colorRank(b.colorCategory);
        if (d !== 0) return d;
      }
      return a.name.localeCompare(b.name);
    });
  }, [cube.data, sort]);

  const crossedCount = useMemo(
    () => cards.filter((c) => crossed.has(normalize(c.name))).length,
    [cards, crossed],
  );

  const visible = useMemo(() => {
    const q = normalize(search);
    return cards.filter((c) => {
      const isCrossed = crossed.has(normalize(c.name));
      if (view === "remaining" && isCrossed) return false;
      if (view === "crossed" && !isCrossed) return false;
      if (!q) return true;
      return normalize(c.name).includes(q) || (c.type != null && normalize(c.type).includes(q));
    });
  }, [cards, crossed, search, view]);

  const hasColorInfo = cards.some((c) => c.colorCategory);
  const total = cards.length;
  const pct = total > 0 ? Math.round((crossedCount / total) * 100) : 0;

  function onSearchKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    // Fast path for sorting a stack: type a name, Enter crosses off the single match.
    if (e.key === "Enter" && visible.length === 1) {
      e.preventDefault();
      toggle(visible[0].name);
      setSearch("");
    }
  }

  function resetAll() {
    const empty = new Set<string>();
    saveCrossed(empty);
    setCrossed(empty);
    setConfirmReset(false);
  }

  const tabs = [
    { key: "remaining", label: "Remaining", count: total - crossedCount },
    { key: "all", label: "All", count: total },
    { key: "crossed", label: "Crossed off", count: crossedCount },
  ];

  return (
    <div className="gg-page">
      <PageHeader
        title="Cube Checklist"
        description={`Work through ${cube.data?.name ?? "The Pauper Cube"}: search, cross cards off, and check printings. Progress is saved in this browser.`}
        actions={
          <a className="gg-btn gg-btn--ghost gg-btn--md" href={CUBE_URL} target="_blank" rel="noreferrer">
            Open on CubeCobra
          </a>
        }
      />

      <SectionCard
        title={total > 0 ? `${crossedCount} of ${total} crossed off (${pct}%)` : "Cards"}
        action={
          crossedCount > 0 ? (
            <Button size="sm" variant="ghost" onClick={() => setConfirmReset(true)}>
              Reset
            </Button>
          ) : undefined
        }
      >
        {total > 0 && (
          <div className="gg-cubecheck__progress" aria-hidden="true">
            <span style={{ width: `${pct}%` }} />
          </div>
        )}

        <div className="gg-cubecheck__toolbar">
          <SearchInput
            label="Search cards"
            placeholder="Search by name or type… (Enter crosses off a single match)"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={onSearchKeyDown}
            autoComplete="off"
            autoFocus
          />
          <div className="gg-cubecheck__controls">
            <Tabs
              items={tabs}
              active={view}
              onChange={(k) => setView(k as View)}
              ariaLabel="Filter cards"
            />
            {hasColorInfo && (
              <div className="gg-select-wrap">
                <select
                  className="gg-input gg-select gg-cubecheck__sort"
                  aria-label="Sort cards"
                  value={sort}
                  onChange={(e) => setSort(e.target.value as SortKey)}
                >
                  <option value="color">Sort: Color</option>
                  <option value="name">Sort: Name</option>
                </select>
                <Icon name="chevronDown" size={16} className="gg-select-caret" />
              </div>
            )}
          </div>
        </div>

        {cube.loading ? (
          <TableSkeleton rows={10} cols={3} />
        ) : cube.error ? (
          <ErrorState message={`Could not load the cube list. ${cube.error}`} onRetry={cube.reload} />
        ) : visible.length === 0 ? (
          <EmptyState
            icon={view === "remaining" && !search ? "checkCircle" : "search"}
            title={view === "remaining" && !search ? "All done!" : "No cards match"}
            message={
              view === "remaining" && !search
                ? "Every card in the cube is crossed off."
                : "Try a different search or filter."
            }
          />
        ) : (
          <ul className="gg-cubecheck__list">
            {visible.map((card, i) => {
              const key = normalize(card.name);
              const isCrossed = crossed.has(key);
              const isOpen = expanded === key;
              const prev = visible[i - 1];
              const showGroup =
                sort === "color" && hasColorInfo && (!prev || prev.colorCategory !== card.colorCategory);
              return (
                <li key={`${key}:${i}`} className="gg-cubecheck__item">
                  {showGroup && (
                    <div className="gg-cubecheck__group">{card.colorCategory ?? "Other"}</div>
                  )}
                  <div className={`gg-cubecheck__row ${isCrossed ? "is-crossed" : ""}`}>
                    <label className="gg-cubecheck__check">
                      <input
                        type="checkbox"
                        checked={isCrossed}
                        onChange={() => toggle(card.name)}
                      />
                      <span className="gg-cubecheck__name">{card.name}</span>
                      {card.type && <span className="gg-cubecheck__type">{card.type}</span>}
                    </label>
                    <Button
                      size="sm"
                      variant="ghost"
                      iconRight={isOpen ? "chevronDown" : "chevronRight"}
                      aria-expanded={isOpen}
                      onClick={() => setExpanded(isOpen ? null : key)}
                    >
                      Printings
                    </Button>
                  </div>
                  {isOpen && <PrintingsPanel name={card.name} />}
                </li>
              );
            })}
          </ul>
        )}
      </SectionCard>

      <ConfirmDialog
        open={confirmReset}
        title="Reset checklist?"
        message={`This un-crosses all ${crossedCount} cards in this browser.`}
        confirmLabel="Reset"
        tone="danger"
        onConfirm={resetAll}
        onCancel={() => setConfirmReset(false)}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Printings — every paper printing of one card, via the Scryfall proxy.
 * ------------------------------------------------------------------ */

interface PrintingsState {
  printings: CardPrinting[];
  page: number;
  hasMore: boolean;
}

/** Session cache so collapsing and re-opening a card doesn't refetch. */
const printingsCache = new Map<string, PrintingsState>();

function printingsQuery(name: string): string {
  return `!"${name.replace(/"/g, '\\"')}" game:paper`;
}

/** Fetch one page and merge it onto what's already loaded (de-duped by id). */
async function fetchPrintingsPage(
  name: string,
  page: number,
  base: CardPrinting[],
): Promise<PrintingsState> {
  const result = await scryfallRepository.searchPrintingsPage(printingsQuery(name), page);
  const seen = new Set(base.map((p) => p.scryfallId));
  const merged = [...base, ...result.printings.filter((p) => !seen.has(p.scryfallId))];
  const next = { printings: merged, page, hasMore: result.hasMore };
  printingsCache.set(name, next);
  return next;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : "Could not load printings.";
}

function PrintingsPanel({ name }: { name: string }) {
  const [state, setState] = useState<PrintingsState | null>(() => printingsCache.get(name) ?? null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  // First page — skipped when this card's printings are already cached.
  useEffect(() => {
    if (printingsCache.has(name)) return;
    let active = true;
    fetchPrintingsPage(name, 1, [])
      .then((next) => {
        if (active) setState(next);
      })
      .catch((err: unknown) => {
        if (active) setError(errorMessage(err));
      });
    return () => {
      active = false;
    };
  }, [name, attempt]);

  async function loadMore(current: PrintingsState) {
    setLoadingMore(true);
    setError(null);
    try {
      setState(await fetchPrintingsPage(name, current.page + 1, current.printings));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoadingMore(false);
    }
  }

  function retry() {
    setError(null);
    setAttempt((n) => n + 1);
  }

  if (error && !state) {
    return (
      <div className="gg-cubecheck__printings">
        <ErrorState message={error} onRetry={retry} />
      </div>
    );
  }
  if (!state) {
    return (
      <div className="gg-cubecheck__printings">
        <Spinner label={`Loading printings of ${name}`} />
      </div>
    );
  }

  return (
    <div className="gg-cubecheck__printings">
      {state.printings.length === 0 ? (
        <p className="gg-card-meta">No paper printings found on Scryfall.</p>
      ) : (
        <>
          <p className="gg-card-meta">
            {state.printings.length}
            {state.hasMore ? "+" : ""} printing{state.printings.length === 1 ? "" : "s"}, newest first
          </p>
          <ul className="gg-cubecheck__plist">
            {state.printings.map((p) => {
              const price = p.prices.usd ?? p.prices.usdFoil ?? p.prices.usdEtched;
              return (
                <li key={p.scryfallId} className="gg-cubecheck__printing">
                  <CardImage images={p.images} faces={p.faces} alt={`${p.cardName} — ${p.setName}`} size="sm" />
                  <div className="gg-cubecheck__pinfo">
                    <span className="gg-cubecheck__pset">{p.setName}</span>
                    <span className="gg-cubecheck__pmeta">
                      {p.setCode.toUpperCase()} #{p.collectorNumber}
                      {p.releasedAt ? ` · ${p.releasedAt.slice(0, 4)}` : ""}
                    </span>
                    <span className="gg-cubecheck__pbadges">
                      <Badge tone={RARITY_TONE[p.rarity]}>{RARITY_LABELS[p.rarity]}</Badge>
                      <PrintingTreatmentBadges printing={p} max={3} />
                    </span>
                  </div>
                  <span className="gg-cubecheck__pprice">{price != null ? formatCents(price) : "—"}</span>
                </li>
              );
            })}
          </ul>
        </>
      )}
      {error && <p className="gg-field__error" role="alert">{error}</p>}
      {state.hasMore && (
        <Button
          size="sm"
          variant="secondary"
          loading={loadingMore}
          onClick={() => void loadMore(state)}
        >
          Load more printings
        </Button>
      )}
    </div>
  );
}
