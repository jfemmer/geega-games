import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { SectionCard } from "../ui/Card";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import { Tabs } from "../ui/Nav";
import { Icon } from "../ui/Icon";
import { SearchInput } from "../ui/Field";
import { TableSkeleton, ErrorState, EmptyState, Spinner } from "../ui/States";
import { CardImage } from "../cards/CardImage";
import { PrintingTreatmentBadges } from "../cards/PrintingPreview";
import { useToast } from "../../hooks/useToast";
import { RARITY_LABELS, RARITY_TONE } from "../../utils/labels";
import { formatCents, timeAgo } from "../../utils/format";
import type { CardImageUris, CardPrinting } from "../../types";
import {
  RARITY_RULE_LABELS,
  colorRank,
  mergeCards,
  normalizeName,
  type ChecklistCard,
  type ChecklistView,
  type SwapOption,
} from "../../../store/lib/cubeChecklist";
import type { CubeChecklistCaller } from "../../../store/lib/cubeChecklistApi";

// One shared cube checklist, as everyone working on it sees it — the admin
// Cube Checklist page and the public share page both render this, each with
// its own `call` (staff session vs. the share link's token).
//
// Everyone's changes show up within a few seconds: while the tab is visible
// it asks for cards changed since the last refresh and merges them in.

const REFRESH_MS = 8_000;
/** Marking found (or not) takes a second tap within this long, so a stray tap does nothing. */
const CONFIRM_MS = 4_000;
const RECENT_COUNT = 5;

type View = "remaining" | "all" | "found" | "swapped";
type SortKey = "color" | "name";
type Panel = { cardId: string; kind: "printings" | "swap" } | null;

export interface CubeChecklistViewProps {
  call: CubeChecklistCaller;
  /** Shown above the list, e.g. "Marking as Sam · change". */
  identity?: ReactNode;
  /** Called with the latest card counts (the admin list shows progress). */
  onProgress?: (found: number, total: number) => void;
}

export function CubeChecklistView({ call, identity, onProgress }: CubeChecklistViewProps) {
  const toast = useToast();
  const [list, setList] = useState<ChecklistView | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [search, setSearch] = useState("");
  const [view, setView] = useState<View>("remaining");
  const [sort, setSort] = useState<SortKey>("color");
  const [panel, setPanel] = useState<Panel>(null);
  // The card whose found box was tapped once and is waiting for the confirming tap.
  const [armedId, setArmedId] = useState<string | null>(null);
  const syncedAt = useRef<string | null>(null);

  // An armed box goes back to normal if the second tap doesn't come.
  useEffect(() => {
    if (!armedId) return;
    const t = window.setTimeout(() => setArmedId(null), CONFIRM_MS);
    return () => window.clearTimeout(t);
  }, [armedId]);

  // Put in a card exactly as given: the server's answer to our own action, or
  // our optimistic guess. (Background refreshes go through mergeCards, which
  // never lets an older copy win.)
  const replaceCard = useCallback((card: ChecklistCard) => {
    setList((prev) =>
      prev ? { ...prev, cards: prev.cards.map((c) => (c.id === card.id ? card : c)) } : prev,
    );
  }, []);

  // First load, then incremental refreshes while the tab is visible.
  useEffect(() => {
    let active = true;
    let timer: number | undefined;

    async function refresh() {
      try {
        const { view: next } = await call<{ view: ChecklistView }>({
          action: "get",
          since: syncedAt.current ?? undefined,
        });
        if (!active) return;
        const isFirst = syncedAt.current == null;
        syncedAt.current = next.syncedAt;
        setList((prev) =>
          isFirst || !prev ? next : { ...next, cards: mergeCards(prev.cards, next.cards) },
        );
        setLoadError(null);
      } catch (err) {
        if (active && syncedAt.current == null) {
          setLoadError(err instanceof Error ? err.message : "Could not load the checklist.");
        }
        // A failed background refresh just tries again next tick.
      }
    }

    function schedule() {
      timer = window.setTimeout(async () => {
        if (document.visibilityState === "visible") await refresh();
        if (active) schedule();
      }, REFRESH_MS);
    }

    syncedAt.current = null;
    void refresh().then(() => {
      if (active) schedule();
    });
    const onVisible = () => {
      if (document.visibilityState === "visible" && syncedAt.current) void refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      active = false;
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [call, attempt]);

  // The Found tab lists the most recently found first.
  const byRecent = view === "found";
  const cards = useMemo(() => {
    const all = list?.cards ?? [];
    return [...all].sort((a, b) => {
      if (byRecent) return (b.foundAt ?? "").localeCompare(a.foundAt ?? "") || a.name.localeCompare(b.name);
      if (sort === "color") {
        const d = colorRank(a.colorCategory) - colorRank(b.colorCategory);
        if (d !== 0) return d;
      }
      return a.name.localeCompare(b.name);
    });
  }, [list, sort, byRecent]);

  const recent = useMemo(
    () =>
      (list?.cards ?? [])
        .filter((c) => c.foundAt)
        .sort((a, b) => (b.foundAt ?? "").localeCompare(a.foundAt ?? ""))
        .slice(0, RECENT_COUNT),
    [list],
  );

  const counts = useMemo(() => {
    let found = 0;
    let swapped = 0;
    for (const c of cards) {
      if (c.foundAt) found++;
      if (c.originalName) swapped++;
    }
    return { total: cards.length, found, swapped };
  }, [cards]);

  useEffect(() => {
    if (list) onProgress?.(counts.found, counts.total);
  }, [list, counts.found, counts.total, onProgress]);

  const visible = useMemo(() => {
    const q = normalizeName(search);
    return cards.filter((c) => {
      if (view === "remaining" && c.foundAt) return false;
      if (view === "found" && !c.foundAt) return false;
      if (view === "swapped" && !c.originalName) return false;
      if (!q) return true;
      return (
        normalizeName(c.name).includes(q) ||
        (c.typeLine != null && normalizeName(c.typeLine).includes(q)) ||
        (c.originalName != null && normalizeName(c.originalName).includes(q)) ||
        (c.foundBy != null && normalizeName(c.foundBy).includes(q))
      );
    });
  }, [cards, search, view]);

  /** First tap arms the box; a second tap on the same box within CONFIRM_MS does it. */
  function tapFound(card: ChecklistCard) {
    if (armedId !== card.id) {
      setArmedId(card.id);
      return;
    }
    setArmedId(null);
    void setFound(card, card.foundAt == null);
  }

  async function setFound(card: ChecklistCard, found: boolean) {
    // Optimistic: tick it now, put the server's copy in when it answers. The
    // guess keeps the card's old updatedAt so this device's clock never
    // decides anything.
    replaceCard({
      ...card,
      foundAt: found ? new Date().toISOString() : null,
      foundBy: found ? "you" : null,
    });
    try {
      const { card: saved, alreadyFound } = await call<{ card: ChecklistCard; alreadyFound?: boolean }>({
        action: "found",
        cardId: card.id,
        found,
      });
      replaceCard(saved);
      if (alreadyFound && saved.foundBy) toast.info(`${saved.foundBy} already found ${saved.name}.`);
    } catch (err) {
      replaceCard(card);
      toast.error(err instanceof Error ? err.message : "Couldn't save that. Try again.");
    }
  }

  async function undoSwap(card: ChecklistCard) {
    try {
      const { card: saved } = await call<{ card: ChecklistCard }>({ action: "unswap", cardId: card.id });
      replaceCard(saved);
      toast.success(`Put ${saved.name} back.`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't undo that swap.");
    }
  }

  function onSearchKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    // Sorting a stack: type a name, then Enter twice marks the one match found
    // (the first Enter arms its box, like a first tap).
    if (e.key === "Enter" && visible.length === 1 && !visible[0].foundAt) {
      e.preventDefault();
      if (armedId === visible[0].id) setSearch("");
      tapFound(visible[0]);
    }
  }

  if (loadError && !list) {
    return (
      <SectionCard title="Cards">
        <ErrorState message={loadError} onRetry={() => setAttempt((n) => n + 1)} />
      </SectionCard>
    );
  }

  const pct = counts.total > 0 ? Math.round((counts.found / counts.total) * 100) : 0;
  const hasColorInfo = cards.some((c) => c.colorCategory);
  const tabs = [
    { key: "remaining", label: "To find", count: counts.total - counts.found },
    { key: "all", label: "All", count: counts.total },
    { key: "found", label: "Found", count: counts.found },
    { key: "swapped", label: "Swapped", count: counts.swapped },
  ];

  return (
    <SectionCard
      title={list ? `${counts.found} of ${counts.total} found (${pct}%)` : "Cards"}
      action={list ? <Badge tone="neutral">Swaps: {RARITY_RULE_LABELS[list.rarityRule]}</Badge> : undefined}
    >
      {list && (
        <div className="gg-cubecheck__progress" aria-hidden="true">
          <span style={{ width: `${pct}%` }} />
        </div>
      )}
      {identity && <div className="gg-cubecheck__identity">{identity}</div>}

      {recent.length > 0 && (
        <section className="gg-cubecheck__recent" aria-label="Recently found">
          <div className="gg-cubecheck__recenthead">
            <h3 className="gg-cubecheck__panelhead">Recently found</h3>
            {view !== "found" && (
              <button type="button" className="gg-cubecheck__link" onClick={() => setView("found")}>
                See all {counts.found}
              </button>
            )}
          </div>
          <ul className="gg-cubecheck__recentlist">
            {recent.map((card) => (
              <li key={card.id} className="gg-cubecheck__recentitem">
                <Icon name="check" size={14} className="gg-cubecheck__recentcheck" />
                <span className="gg-cubecheck__recentname">{card.name}</span>
                <span className="gg-cubecheck__hint">
                  {card.foundBy} · {timeAgo(card.foundAt)}
                </span>
                <button
                  type="button"
                  className="gg-cubecheck__link"
                  aria-label={`Undo: put ${card.name} back on the list to find`}
                  onClick={() => {
                    void setFound(card, false);
                    toast.info(`${card.name} is back on the list to find.`);
                  }}
                >
                  Undo
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="gg-cubecheck__toolbar">
        <SearchInput
          label="Search cards"
          placeholder="Search by name, type, or who found it… (Enter twice marks a single match found)"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={onSearchKeyDown}
          autoComplete="off"
        />
        <div className="gg-cubecheck__controls">
          <Tabs items={tabs} active={view} onChange={(k) => setView(k as View)} ariaLabel="Filter cards" />
          {hasColorInfo && !byRecent && (
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

      {!list ? (
        <TableSkeleton rows={10} cols={3} />
      ) : visible.length === 0 ? (
        <EmptyState
          icon={view === "remaining" && !search ? "checkCircle" : "search"}
          title={view === "remaining" && !search ? "All found!" : "No cards match"}
          message={
            view === "remaining" && !search
              ? "Every card on the list has been found."
              : "Try a different search or filter."
          }
        />
      ) : (
        <ul className="gg-cubecheck__list">
          {visible.map((card, i) => {
            const prev = visible[i - 1];
            const showGroup =
              !byRecent &&
              sort === "color" &&
              hasColorInfo &&
              (!prev || prev.colorCategory !== card.colorCategory);
            const armed = armedId === card.id;
            const found = card.foundAt != null;
            const open = panel?.cardId === card.id ? panel.kind : null;
            const toggle = (kind: "printings" | "swap") =>
              setPanel(open === kind ? null : { cardId: card.id, kind });
            return (
              <li key={card.id} className="gg-cubecheck__item">
                {showGroup && <div className="gg-cubecheck__group">{card.colorCategory ?? "Other"}</div>}
                <div className={`gg-cubecheck__row ${card.foundAt ? "is-crossed" : ""}`}>
                  <div className="gg-cubecheck__check">
                    {/* Only this box marks a card, and it takes two taps (see tapFound). */}
                    <button
                      type="button"
                      className={`gg-cubecheck__toggle ${found ? "is-found" : ""} ${armed ? "is-armed" : ""}`}
                      aria-pressed={found}
                      aria-label={
                        armed
                          ? `Tap again to ${found ? "unmark" : "mark"} ${card.name} ${found ? "" : "found"}`.trim()
                          : found
                            ? `${card.name} is found. Tap twice to unmark`
                            : `Mark ${card.name} found (tap twice)`
                      }
                      onClick={() => tapFound(card)}
                    >
                      {(found || armed) && <Icon name={found && armed ? "close" : "check"} size={16} />}
                    </button>
                    <span className="gg-cubecheck__text">
                      <span className="gg-cubecheck__name">{card.name}</span>
                      {armed && (
                        <span className="gg-cubecheck__confirmhint" role="status">
                          Tap again to {found ? "unmark" : "confirm"}
                        </span>
                      )}
                      {card.typeLine && <span className="gg-cubecheck__type">{card.typeLine}</span>}
                      {card.foundBy && (
                        <span className="gg-cubecheck__who">
                          Found by {card.foundBy}
                          {card.foundAt ? ` · ${timeAgo(card.foundAt)}` : ""}
                        </span>
                      )}
                    </span>
                  </div>
                  <div className="gg-cubecheck__actions">
                    <Button size="sm" variant="ghost" aria-expanded={open === "swap"} onClick={() => toggle("swap")}>
                      Swap
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      iconRight={open === "printings" ? "chevronDown" : "chevronRight"}
                      aria-expanded={open === "printings"}
                      onClick={() => toggle("printings")}
                    >
                      Printings
                    </Button>
                  </div>
                </div>
                {card.originalName && (
                  <div className="gg-cubecheck__swapnote">
                    <Icon name="swap" size={14} />
                    <span>
                      Replaced <strong>{card.originalName}</strong>
                      {card.swappedBy ? ` · by ${card.swappedBy}` : ""}
                    </span>
                    <button type="button" className="gg-cubecheck__link" onClick={() => void undoSwap(card)}>
                      Undo
                    </button>
                  </div>
                )}
                {open === "printings" && <PrintingsPanel call={call} name={card.name} />}
                {open === "swap" && list && (
                  <SwapPanel
                    call={call}
                    card={card}
                    rarityLabel={list.rarityRule === "common" ? "commons" : "commons and uncommons"}
                    onSwapped={(saved) => {
                      replaceCard(saved);
                      setPanel(null);
                      toast.success(`Swapped in ${saved.name}.`);
                    }}
                  />
                )}
              </li>
            );
          })}
        </ul>
      )}
    </SectionCard>
  );
}

/* ------------------------------------------------------------------ *
 * Swap — better options for this slot, or search for any allowed card.
 * ------------------------------------------------------------------ */

function optionImages(o: SwapOption): CardImageUris {
  return { small: o.imageSmall, normal: o.imageNormal, large: o.imageNormal, png: null, artCrop: null };
}

/** One card in the comparison strip: picture, cost and type, and how widely it's played. */
function CompareTile({ option, label, current = false, action }: {
  option: SwapOption;
  label?: string;
  current?: boolean;
  action?: ReactNode;
}) {
  return (
    <li className={`gg-cubecheck__tile ${current ? "gg-cubecheck__tile--current" : ""}`}>
      {label && <span className="gg-cubecheck__tilelabel">{label}</span>}
      <CardImage images={optionImages(option)} alt={option.name} size="lg" />
      <span className="gg-cubecheck__tilename">{option.name}</span>
      <span className="gg-cubecheck__tilemeta">{[option.manaCost, option.typeLine].filter(Boolean).join(" · ")}</span>
      <span className="gg-cubecheck__hint">
        {option.edhrecRank != null ? `#${option.edhrecRank.toLocaleString()} most played` : "Not ranked"}
      </span>
      {action}
    </li>
  );
}

function SwapPanel({
  call,
  card,
  rarityLabel,
  onSwapped,
}: {
  call: CubeChecklistCaller;
  card: ChecklistCard;
  rarityLabel: string;
  onSwapped: (card: ChecklistCard) => void;
}) {
  const [suggestions, setSuggestions] = useState<SwapOption[] | null>(null);
  // The card on the list now, shown pinned beside the options to compare.
  const [current, setCurrent] = useState<SwapOption | null>(null);
  const [suggestError, setSuggestError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SwapOption[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    call<{ options: SwapOption[]; current?: SwapOption | null }>({ action: "suggest", cardId: card.id })
      .then((r) => {
        if (!active) return;
        setSuggestions(r.options);
        setCurrent(r.current ?? null);
      })
      .catch((err: unknown) => {
        if (active) setSuggestError(err instanceof Error ? err.message : "Couldn't load suggestions.");
      });
    return () => {
      active = false;
    };
  }, [call, card.id]);

  // Debounced search for any card allowed in this cube.
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) return;
    let active = true;
    const t = window.setTimeout(() => {
      setSearching(true);
      call<{ options: SwapOption[] }>({ action: "search", query: q })
        .then((r) => {
          if (active) setResults(r.options);
        })
        .catch((err: unknown) => {
          if (active) setError(err instanceof Error ? err.message : "Search failed.");
        })
        .finally(() => {
          if (active) setSearching(false);
        });
    }, 300);
    return () => {
      active = false;
      window.clearTimeout(t);
    };
  }, [call, query]);

  async function swapIn(name: string) {
    setBusy(name);
    setError(null);
    try {
      const { card: saved } = await call<{ card: ChecklistCard }>({ action: "swap", cardId: card.id, newName: name });
      onSwapped(saved);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't swap that card.");
    } finally {
      setBusy(null);
    }
  }

  const showingSearch = query.trim().length >= 2;
  const options = showingSearch ? results : suggestions;

  return (
    <div className="gg-cubecheck__panel">
      <p className="gg-card-meta">
        Swap <strong>{card.name}</strong> for another card. Only {rarityLabel} that aren't already on the list.
      </p>
      <SearchInput
        label="Search for a card to swap in"
        placeholder="Search any card by name…"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          if (e.target.value.trim().length < 2) setResults(null);
          setError(null);
        }}
        autoComplete="off"
      />
      <h3 className="gg-cubecheck__panelhead">
        {showingSearch ? "Search results" : "Better options"}
        {!showingSearch && (
          <span className="gg-cubecheck__hint">
            Similar cards (same colors, type and about the same cost), most played first
          </span>
        )}
      </h3>
      {error && (
        <p className="gg-field__error" role="alert">
          {error}
        </p>
      )}
      {/* The card on the list stays pinned on the left while the options scroll past it. */}
      <ul className="gg-cubecheck__compare" aria-label={`${card.name} compared with ${showingSearch ? "search results" : "better options"}`}>
        <CompareTile
          option={
            current ?? {
              name: card.name,
              typeLine: card.typeLine,
              manaCost: null,
              imageSmall: null,
              imageNormal: null,
              edhrecRank: null,
            }
          }
          label="On the list now"
          current
        />
        {!showingSearch && suggestError ? (
          <li className="gg-cubecheck__tilenote">{suggestError}</li>
        ) : options == null || (showingSearch && searching && results == null) ? (
          <li className="gg-cubecheck__tilenote">
            <Spinner label="Loading cards" />
          </li>
        ) : options.length === 0 ? (
          <li className="gg-cubecheck__tilenote">
            {showingSearch ? "No allowed cards match that name." : "No similar cards found. Try searching instead."}
          </li>
        ) : (
          options.map((o) => (
            <CompareTile
              key={o.name}
              option={o}
              action={
                <Button
                  size="sm"
                  variant="secondary"
                  loading={busy === o.name}
                  disabled={busy != null}
                  onClick={() => void swapIn(o.name)}
                >
                  Swap in
                </Button>
              }
            />
          ))
        )}
      </ul>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Printings — every paper printing of one card.
 * ------------------------------------------------------------------ */

interface PrintingsState {
  printings: CardPrinting[];
  page: number;
  hasMore: boolean;
}

/** Session cache so collapsing and re-opening a card doesn't refetch. */
const printingsCache = new Map<string, PrintingsState>();

async function fetchPrintings(
  call: CubeChecklistCaller,
  name: string,
  page: number,
  base: CardPrinting[],
): Promise<PrintingsState> {
  const r = await call<{ printings: CardPrinting[]; hasMore: boolean }>({ action: "printings", name, page });
  const seen = new Set(base.map((p) => p.scryfallId));
  const next = {
    printings: [...base, ...r.printings.filter((p) => !seen.has(p.scryfallId))],
    page,
    hasMore: r.hasMore,
  };
  printingsCache.set(name, next);
  return next;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : "Could not load printings.";
}

function PrintingsPanel({ call, name }: { call: CubeChecklistCaller; name: string }) {
  const [state, setState] = useState<PrintingsState | null>(() => printingsCache.get(name) ?? null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (printingsCache.has(name)) return;
    let active = true;
    fetchPrintings(call, name, 1, [])
      .then((next) => {
        if (active) setState(next);
      })
      .catch((err: unknown) => {
        if (active) setError(errorMessage(err));
      });
    return () => {
      active = false;
    };
  }, [call, name, attempt]);

  async function loadMore(current: PrintingsState) {
    setLoadingMore(true);
    setError(null);
    try {
      setState(await fetchPrintings(call, name, current.page + 1, current.printings));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoadingMore(false);
    }
  }

  if (error && !state) {
    return (
      <div className="gg-cubecheck__panel">
        <ErrorState
          message={error}
          onRetry={() => {
            setError(null);
            setAttempt((n) => n + 1);
          }}
        />
      </div>
    );
  }
  if (!state) {
    return (
      <div className="gg-cubecheck__panel">
        <Spinner label={`Loading printings of ${name}`} />
      </div>
    );
  }

  return (
    <div className="gg-cubecheck__panel">
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
      {error && (
        <p className="gg-field__error" role="alert">
          {error}
        </p>
      )}
      {state.hasMore && (
        <Button size="sm" variant="secondary" loading={loadingMore} onClick={() => void loadMore(state)}>
          Load more printings
        </Button>
      )}
    </div>
  );
}
