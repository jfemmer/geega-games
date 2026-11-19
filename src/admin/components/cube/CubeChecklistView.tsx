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
  UPGRADE_RULES,
  cardKey,
  draftRanks,
  mergeCards,
  roleLabel,
  type ChecklistCard,
  type ChecklistView,
  type DraftRank,
  type SwapOption,
  type UpgradeSuggestion,
  type UpgradesView,
} from "../../../store/lib/cubeChecklist";
import type { CubeChecklistCaller } from "../../../store/lib/cubeChecklistApi";
import {
  SORT_OPTIONS,
  colorsOnList,
  facetCounts,
  isSortKey,
  matchesFilters,
  ordinal,
  sortCards,
  typesOnList,
  type ChecklistFilters,
  type SortKey,
  type View,
} from "./checklistFilters";

// One shared cube checklist, as everyone working on it sees it — the admin
// Cube Checklist page and the public share page both render this, each with
// its own `call` (staff session vs. the share link's token).
//
// Everyone's changes show up within a few seconds: while the tab is visible
// it asks for cards changed since the last refresh and merges them in.
//
// Choosing swaps: every card shows its CubeCobra draft rank, price and how
// widely it's played; the list sorts by any of them and filters by color,
// type and "swap candidates" (the lowest-rated cards, the same ones Suggested
// upgrades works from).

const REFRESH_MS = 8_000;
/** Marking found (or not) takes a second tap within this long, so a stray tap does nothing. */
const CONFIRM_MS = 4_000;
const RECENT_COUNT = 5;
const UPGRADES_SHOWN = 4;
const WEAK_PERCENT = Math.round(UPGRADE_RULES.cutShare * 100);

type Panel = { cardId: string; kind: "printings" | "swap" } | null;

/** What a sort means, shown under the toolbar while it's on. */
function sortHint(sort: SortKey, pricesAsOf: string | null): string | null {
  switch (sort) {
    case "weakest":
    case "strongest":
      return `Draft rank comes from CubeCobra's ratings of real drafts: #1 is the card drafters take earliest. Swap candidates are the lowest-rated ${WEAK_PERCENT}%. Cards swapped in have no rating yet.`;
    case "played":
      return "Most played is EDHREC's rank of how many decks across Magic run the card (#1 is the most played).";
    case "priceHigh":
    case "priceLow":
      return `Price is the cheapest paper printing on Scryfall${pricesAsOf ? `, as of ${formatDay(pricesAsOf)}` : ""}.`;
    default:
      return null;
  }
}

function formatDay(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

/** A class-safe slug for a color category's pip ("Multicolored" -> "multicolored"). */
function pipSlug(color: string): string {
  return color.toLowerCase().replace(/[^a-z]+/g, "");
}

/** A card's draft rank, price and popularity, as one line under its name. */
function CardStats({ card, rank }: { card: ChecklistCard; rank: DraftRank | undefined }) {
  if (!rank && card.priceCents == null && card.edhrecRank == null) return null;
  return (
    <span className="gg-cubecheck__stats">
      {rank?.weak && <span className="gg-cubecheck__stat is-weak">Swap candidate</span>}
      {rank && (
        <span className="gg-cubecheck__stat" title={`CubeCobra draft rating ${card.elo}`}>
          Draft rank #{rank.rank} of {rank.of}
        </span>
      )}
      {card.priceCents != null && <span className="gg-cubecheck__stat is-price">{formatCents(card.priceCents)}</span>}
      {card.edhrecRank != null && (
        <span className="gg-cubecheck__stat">#{card.edhrecRank.toLocaleString()} most played</span>
      )}
    </span>
  );
}

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
  const [color, setColor] = useState<string | null>(null);
  const [type, setType] = useState<string | null>(null);
  const [weakOnly, setWeakOnly] = useState(false);
  const [panel, setPanel] = useState<Panel>(null);
  // The card whose found box was tapped once and is waiting for the confirming tap.
  const [armedId, setArmedId] = useState<string | null>(null);
  // Suggested upgrades (low-rated cards + a card from the suggestion list each).
  const [upgrades, setUpgrades] = useState<UpgradesView | null>(null);
  const [upgradesVersion, setUpgradesVersion] = useState(0);
  const [showAllUpgrades, setShowAllUpgrades] = useState(false);
  const [swappingId, setSwappingId] = useState<string | null>(null);
  const syncedAt = useRef<string | null>(null);

  // Loaded once, and again after a swap (which changes what's suggested).
  // Optional: if it fails the rest of the page works as before.
  useEffect(() => {
    let active = true;
    call<{ upgradesView: UpgradesView }>({ action: "upgrades" })
      .then((r) => {
        if (active) setUpgrades(r.upgradesView);
      })
      .catch(() => {
        /* suggestions are extra; stay hidden */
      });
    return () => {
      active = false;
    };
  }, [call, upgradesVersion]);

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
  const cards = useMemo(() => list?.cards ?? [], [list]);
  // Each rated card's place in the cube (and whether it's a swap candidate).
  const ranks = useMemo(() => draftRanks(cards), [cards]);
  const filters = useMemo<ChecklistFilters>(
    () => ({ view, search, color, type, weakOnly }),
    [view, search, color, type, weakOnly],
  );
  const facets = useMemo(() => facetCounts(cards, filters, ranks), [cards, filters, ranks]);
  const colors = useMemo(() => colorsOnList(cards), [cards]);
  const types = useMemo(() => typesOnList(cards), [cards]);
  const filtersOn = color != null || type != null || weakOnly;

  function clearFilters() {
    setColor(null);
    setType(null);
    setWeakOnly(false);
  }

  /** Show only swap candidates, weakest first (or stop). */
  function toggleWeak(on: boolean) {
    setWeakOnly(on);
    if (on && (sort === "color" || sort === "name")) setSort("weakest");
  }

  // Every card on the list right now (kept fresh by the refresh), so the swap
  // panel never offers one that's already on it — one of each card.
  const onList = useMemo(() => new Set(cards.map((c) => cardKey(c.name))), [cards]);

  const recent = useMemo(
    () =>
      cards
        .filter((c) => c.foundAt)
        .sort((a, b) => (b.foundAt ?? "").localeCompare(a.foundAt ?? ""))
        .slice(0, RECENT_COUNT),
    [cards],
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

  const visible = useMemo(
    () =>
      sortCards(
        cards.filter((c) => matchesFilters(c, filters, ranks)),
        sort,
        ranks,
        byRecent,
      ),
    [cards, filters, ranks, sort, byRecent],
  );

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
      setUpgradesVersion((n) => n + 1);
      toast.success(`Put ${saved.name} back.`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't undo that swap.");
    }
  }

  async function applyUpgrade(u: UpgradeSuggestion) {
    setSwappingId(u.cut.id);
    try {
      const { card: saved } = await call<{ card: ChecklistCard }>({ action: "swap", cardId: u.cut.id, newName: u.add.name });
      replaceCard(saved);
      setUpgrades((prev) => (prev ? { ...prev, upgrades: prev.upgrades.filter((x) => x.cut.id !== u.cut.id) } : prev));
      setUpgradesVersion((n) => n + 1);
      toast.success(`Swapped ${u.cut.name} for ${saved.name}. Undo is on the card.`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't make that swap.");
    } finally {
      setSwappingId(null);
    }
  }

  /** Open the card's Swap panel (the list card is first in its Better options). */
  function compareUpgrade(u: UpgradeSuggestion) {
    // Nothing may hide the card.
    clearFilters();
    setView("all");
    setSearch(u.cut.name);
    setPanel({ cardId: u.cut.id, kind: "swap" });
  }

  /** Every swap candidate, weakest first, found or not. */
  function showSwapCandidates() {
    clearFilters();
    setSearch("");
    setView("all");
    toggleWeak(true);
    setSort("weakest");
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
  const hasRatings = ranks.size > 0;
  // Tab counts follow the color, type and search filters (the header stays the whole list).
  const tabs = [
    { key: "remaining", label: "To find", count: facets.views.remaining },
    { key: "all", label: "All", count: facets.views.all },
    { key: "found", label: "Found", count: facets.views.found },
    { key: "swapped", label: "Swapped", count: facets.views.swapped },
  ];
  const hint = byRecent ? null : sortHint(sort, list?.pricesAsOf ?? null);

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

      {upgrades && upgrades.upgrades.length > 0 && (
        <section className="gg-cubecheck__recent gg-cubecheck__upgrades" aria-label="Suggested upgrades">
          <div className="gg-cubecheck__recenthead">
            <h3 className="gg-cubecheck__panelhead">
              Suggested upgrades
              <span className="gg-cubecheck__hint">
                Lowest-rated cards on CubeCobra, each with a card from your list that fills the same role
              </span>
            </h3>
            <span className="gg-cubecheck__upgradelinks">
              {hasRatings && (
                <button type="button" className="gg-cubecheck__link" onClick={showSwapCandidates}>
                  All swap candidates
                </button>
              )}
              {upgrades.upgrades.length > UPGRADES_SHOWN && (
                <button type="button" className="gg-cubecheck__link" onClick={() => setShowAllUpgrades((v) => !v)}>
                  {showAllUpgrades ? "Show fewer" : `Show all ${upgrades.upgrades.length}`}
                </button>
              )}
            </span>
          </div>
          <ul className="gg-cubecheck__recentlist">
            {(showAllUpgrades ? upgrades.upgrades : upgrades.upgrades.slice(0, UPGRADES_SHOWN)).map((u) => {
              const cutRank = ranks.get(u.cut.id);
              return (
              <li key={u.cut.id} className="gg-cubecheck__upgrade">
                <span className="gg-cubecheck__upgradepair">
                  <span>
                    <span className="gg-cubecheck__upgradeout">{u.cut.name}</span>
                    <span className="gg-cubecheck__hint">
                      {cutRank ? ` draft rank #${cutRank.rank} of ${cutRank.of}` : ` rating ${u.cut.elo}`}
                      {u.cut.priceCents != null ? ` · ${formatCents(u.cut.priceCents)}` : ""}
                    </span>
                  </span>
                  <Icon name="chevronRight" size={14} className="gg-cubecheck__upgradearrow" />
                  <span>
                    <span className="gg-cubecheck__recentname">{u.add.name}</span>
                    <span className="gg-cubecheck__hint">
                      {u.add.listRank != null ? ` #${u.add.listRank} on your list` : ""}
                      {u.add.priceCents != null ? ` · ${formatCents(u.add.priceCents)}` : ""}
                    </span>
                  </span>
                </span>
                <span className="gg-cubecheck__upgradeactions">
                  <button type="button" className="gg-cubecheck__link" onClick={() => compareUpgrade(u)}>
                    Compare
                  </button>
                  <Button
                    size="sm"
                    variant="secondary"
                    loading={swappingId === u.cut.id}
                    disabled={swappingId != null}
                    aria-label={`Swap ${u.cut.name} for ${u.add.name}`}
                    onClick={() => void applyUpgrade(u)}
                  >
                    Swap
                  </Button>
                </span>
              </li>
              );
            })}
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
          {!byRecent && (
            <div className="gg-select-wrap">
              <select
                className="gg-input gg-select gg-cubecheck__sort"
                aria-label="Sort cards"
                value={!hasColorInfo && sort === "color" ? "name" : sort}
                onChange={(e) => {
                  if (isSortKey(e.target.value)) setSort(e.target.value);
                }}
              >
                {SORT_OPTIONS.filter((o) => hasColorInfo || o.key !== "color").map((o) => (
                  <option key={o.key} value={o.key}>
                    Sort: {o.label}
                  </option>
                ))}
              </select>
              <Icon name="chevronDown" size={16} className="gg-select-caret" />
            </div>
          )}
        </div>

        {list && (colors.length > 1 || types.length > 1 || hasRatings) && (
          <div className="gg-cubecheck__filters">
            {hasColorInfo && colors.length > 1 && (
              <div className="gg-cubecheck__chips" role="group" aria-label="Filter by color">
                <button
                  type="button"
                  className={`gg-cubecheck__chip ${color == null ? "is-on" : ""}`}
                  aria-pressed={color == null}
                  onClick={() => setColor(null)}
                >
                  All colors
                </button>
                {colors.map((c) => (
                  <button
                    key={c}
                    type="button"
                    className={`gg-cubecheck__chip ${color === c ? "is-on" : ""}`}
                    aria-pressed={color === c}
                    onClick={() => setColor(color === c ? null : c)}
                  >
                    <span className={`gg-cubecheck__pip gg-cubecheck__pip--${pipSlug(c)}`} aria-hidden="true" />
                    {c}
                    <span className="gg-cubecheck__chipcount">{facets.colors.get(c) ?? 0}</span>
                  </button>
                ))}
              </div>
            )}
            <div className="gg-cubecheck__filterrow">
              {types.length > 1 && (
                <div className="gg-select-wrap">
                  <select
                    className="gg-input gg-select gg-cubecheck__type"
                    aria-label="Filter by card type"
                    value={type ?? ""}
                    onChange={(e) => setType(e.target.value || null)}
                  >
                    <option value="">All types</option>
                    {types.map((t) => (
                      <option key={t} value={t}>
                        {t} ({facets.types.get(t) ?? 0})
                      </option>
                    ))}
                  </select>
                  <Icon name="chevronDown" size={16} className="gg-select-caret" />
                </div>
              )}
              {hasRatings && (
                <button
                  type="button"
                  className={`gg-cubecheck__chip gg-cubecheck__chip--weak ${weakOnly ? "is-on" : ""}`}
                  aria-pressed={weakOnly}
                  title={`The lowest-rated ${WEAK_PERCENT}% of the cube on CubeCobra: the best cards to replace`}
                  onClick={() => toggleWeak(!weakOnly)}
                >
                  <Icon name="swap" size={14} />
                  Swap candidates
                  <span className="gg-cubecheck__chipcount">{facets.weak}</span>
                </button>
              )}
              {filtersOn && (
                <button type="button" className="gg-cubecheck__link gg-cubecheck__clear" onClick={clearFilters}>
                  Clear filters
                </button>
              )}
            </div>
          </div>
        )}
        {hint && <p className="gg-cubecheck__sorthint">{hint}</p>}
      </div>

      {!list ? (
        <TableSkeleton rows={10} cols={3} />
      ) : visible.length === 0 ? (
        <EmptyState
          icon={view === "remaining" && !search && !filtersOn ? "checkCircle" : "search"}
          title={view === "remaining" && !search && !filtersOn ? "All found!" : "No cards match"}
          message={
            view === "remaining" && !search && !filtersOn
              ? "Every card on the list has been found."
              : "Try a different search or filter."
          }
          action={
            filtersOn ? (
              <Button size="sm" variant="secondary" onClick={clearFilters}>
                Clear filters
              </Button>
            ) : undefined
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
                      <CardStats card={card} rank={ranks.get(card.id)} />
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
                    rank={ranks.get(card.id)}
                    onList={onList}
                    rarityLabel={list.rarityRule === "common" ? "commons" : "commons and uncommons"}
                    onSwapped={(saved) => {
                      replaceCard(saved);
                      setPanel(null);
                      setUpgradesVersion((n) => n + 1);
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
      {option.listRank != null && (
        <span className="gg-cubecheck__fromlist">From your list · #{option.listRank}</span>
      )}
      <span className="gg-cubecheck__tilestats">
        <span className="gg-cubecheck__tileprice">{option.priceCents != null ? formatCents(option.priceCents) : "No price"}</span>
        <span className="gg-cubecheck__hint">
          {option.edhrecRank != null ? `#${option.edhrecRank.toLocaleString()} most played` : "Not ranked"}
        </span>
      </span>
      {action}
    </li>
  );
}

type OptionOrder = "best" | "played" | "cheapest";

const OPTION_ORDERS: { key: OptionOrder; label: string }[] = [
  { key: "best", label: "Best match" },
  { key: "played", label: "Most played" },
  { key: "cheapest", label: "Cheapest" },
];

/** Options in the chosen order; "best" keeps the server's (your list first, then most played). */
function orderOptions(options: SwapOption[], order: OptionOrder): SwapOption[] {
  if (order === "best") return options;
  const key = (o: SwapOption) => (order === "played" ? o.edhrecRank : o.priceCents) ?? Number.POSITIVE_INFINITY;
  return [...options].sort((a, b) => key(a) - key(b) || a.name.localeCompare(b.name));
}

function SwapPanel({
  call,
  card,
  rank,
  onList,
  rarityLabel,
  onSwapped,
}: {
  call: CubeChecklistCaller;
  card: ChecklistCard;
  /** Its draft rank in the cube, when it has a usable rating. */
  rank: DraftRank | undefined;
  /** cardKeys of everything on the list now. */
  onList: Set<string>;
  rarityLabel: string;
  onSwapped: (card: ChecklistCard) => void;
}) {
  const [order, setOrder] = useState<OptionOrder>("best");
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
  // The server already leaves out cards on the list; this also drops any that
  // someone has swapped in since these options loaded.
  const loaded = showingSearch ? results : suggestions;
  const options = useMemo(
    () => (loaded ? orderOptions(loaded.filter((o) => !onList.has(cardKey(o.name))), order) : null),
    [loaded, onList, order],
  );

  return (
    <div className="gg-cubecheck__panel">
      <p className="gg-card-meta">
        Swap <strong>{card.name}</strong> for another card. Only {rarityLabel} that aren't already on the list.
      </p>
      {rank && (
        <p className={`gg-cubecheck__role ${rank.weak ? "is-weak" : ""}`}>
          Draft rank #{rank.rank} of {rank.of}
          {" · "}
          {rank.roleWeakest === 1 && rank.roleOf > 1
            ? `the lowest-rated of ${rank.roleOf} ${roleLabel(rank.role)}`
            : rank.roleOf > 1
              ? `${ordinal(rank.roleWeakest)} lowest-rated of ${rank.roleOf} ${roleLabel(rank.role)}`
              : `the only rated card among ${roleLabel(rank.role)}`}
          {rank.weak ? ` · a swap candidate (lowest ${WEAK_PERCENT}%)` : ""}
        </p>
      )}
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
      <div className="gg-cubecheck__optionshead">
        <h3 className="gg-cubecheck__panelhead">
          {showingSearch ? "Search results" : "Better options"}
          {!showingSearch && order === "best" && (
            <span className="gg-cubecheck__hint">
              Cards from your list first, then similar cards (same colors, type and about the same cost), most played
              first
            </span>
          )}
        </h3>
        <div className="gg-cubecheck__seg" role="group" aria-label="Order the options">
          {OPTION_ORDERS.map((o) => (
            <button
              key={o.key}
              type="button"
              className={order === o.key ? "is-on" : ""}
              aria-pressed={order === o.key}
              onClick={() => setOrder(o.key)}
            >
              {o.label}
            </button>
          ))}
        </div>
      </div>
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
              edhrecRank: card.edhrecRank,
              priceCents: card.priceCents,
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
