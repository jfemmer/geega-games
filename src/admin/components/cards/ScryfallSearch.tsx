import { useCallback, useEffect, useRef, useState } from "react";
import type { CardPrinting } from "../../types";
import { TextField } from "../ui/Field";
import { Button } from "../ui/Button";
import { Badge } from "../ui/Badge";
import { Spinner } from "../ui/States";
import { CardImage } from "./CardImage";
import { PrintingTreatmentBadges } from "./PrintingPreview";
import { scryfallRepository } from "../../repositories";
import { formatCents } from "../../utils/format";
import { RARITY_LABELS, RARITY_TONE } from "../../utils/labels";

// Reusable, visual Scryfall search. Used by the manual Add-Inventory flow and by
// the scan review "Find Match" action. Every result shows the actual card image
// (hover to enlarge), name, set, collector number, rarity, finishes, treatments,
// and reference price. Supports a dense mode for experienced operators; even in
// dense mode thumbnails keep hover-to-enlarge.
//
// Pagination: the first search walks Scryfall pages server-side and returns a
// complete-as-possible initial set. If Scryfall still reports more pages beyond
// what was returned (a very broad query), a "Load more printings" button fetches
// the next page and MERGES it, de-duplicating by scryfallId so a printing never
// appears twice. Exact Scryfall ids remain the canonical printing identity.

interface ScryfallSearchProps {
  onSelect: (printing: CardPrinting) => void;
  autoFocus?: boolean;
  /** Seed the search box (e.g. from a recognized name). */
  initialQuery?: string;
  /** Persisted across the component's lifetime. */
  defaultDense?: boolean;
}

/** Merge new printings into an existing list, de-duplicating by scryfallId. */
function mergePrintings(
  existing: CardPrinting[],
  incoming: CardPrinting[],
): CardPrinting[] {
  if (incoming.length === 0) return existing;
  const seen = new Set(existing.map((p) => p.scryfallId || p.id));
  const merged = existing.slice();
  for (const p of incoming) {
    const key = p.scryfallId || p.id;
    if (!seen.has(key)) {
      seen.add(key);
      merged.push(p);
    }
  }
  return merged;
}

export function ScryfallSearch({
  onSelect,
  autoFocus,
  initialQuery = "",
  defaultDense = false,
}: ScryfallSearchProps) {
  const [term, setTerm] = useState(initialQuery);
  const [searching, setSearching] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<CardPrinting[]>([]);
  const [dense, setDense] = useState(defaultDense);
  const [hasMore, setHasMore] = useState(false);
  const [totalCards, setTotalCards] = useState<number | null>(null);
  // Highest page we've successfully loaded for the CURRENT query.
  const [page, setPage] = useState(1);
  const reqId = useRef(0);

  useEffect(() => {
    const q = term.trim();
    if (q.length < 2) {
      setResults([]);
      setError(null);
      setSearching(false);
      setHasMore(false);
      setTotalCards(null);
      setPage(1);
      return;
    }
    setSearching(true);
    setError(null);
    const id = ++reqId.current;
    const handle = setTimeout(async () => {
      try {
        const res = await scryfallRepository.searchPrintingsPage(q, 1);
        if (id === reqId.current) {
          setResults(res.printings);
          setHasMore(res.hasMore);
          setTotalCards(res.totalCards);
          setPage(1);
        }
      } catch (err) {
        if (id === reqId.current) {
          setError(
            err instanceof Error ? err.message : "Search failed. Try again.",
          );
          setResults([]);
          setHasMore(false);
          setTotalCards(null);
        }
      } finally {
        if (id === reqId.current) setSearching(false);
      }
    }, 280);
    return () => clearTimeout(handle);
  }, [term]);

  const loadMore = useCallback(async () => {
    const q = term.trim();
    if (q.length < 2 || loadingMore || !hasMore) return;
    const id = reqId.current; // stay tied to the current query
    setLoadingMore(true);
    try {
      const nextPage = page + 1;
      const res = await scryfallRepository.searchPrintingsPage(q, nextPage);
      if (id === reqId.current) {
        setResults((prev) => mergePrintings(prev, res.printings));
        setHasMore(res.hasMore);
        if (res.totalCards != null) setTotalCards(res.totalCards);
        setPage(nextPage);
      }
    } catch (err) {
      if (id === reqId.current) {
        setError(
          err instanceof Error
            ? err.message
            : "Could not load more printings.",
        );
      }
    } finally {
      if (id === reqId.current) setLoadingMore(false);
    }
  }, [term, loadingMore, hasMore, page]);

  return (
    <div className="gg-scryfall">
      <div className="gg-scryfall__bar">
        <TextField
          label="Search every Magic printing"
          placeholder="Name, set:MH2, cn:138, or Scryfall syntax…"
          value={term}
          autoFocus={autoFocus}
          onChange={(e) => setTerm(e.target.value)}
          hint="Searches the full printing catalog — every set, artwork, and treatment appears separately."
        />
        <Button
          variant="ghost"
          size="sm"
          icon={dense ? "box" : "overview"}
          onClick={() => setDense((d) => !d)}
          aria-pressed={dense}
        >
          {dense ? "Comfortable" : "Dense"}
        </Button>
      </div>

      {error && (
        <div className="gg-inline-note gg-inline-note--warning" role="alert">
          {error}
        </div>
      )}

      {searching && (
        <div className="gg-scryfall__loading">
          <Spinner label="Searching Scryfall" />
        </div>
      )}

      {!searching && term.trim().length >= 2 && results.length === 0 && !error && (
        <p className="gg-muted gg-scryfall__empty">
          No printings match “{term}”. Try a set code (set:MH2) or collector
          number (cn:138).
        </p>
      )}

      {!searching && results.length > 0 && (
        <p className="gg-scryfall__count gg-muted">
          Showing {results.length}
          {totalCards != null && totalCards > results.length
            ? ` of ${totalCards}`
            : ""}{" "}
          printing{results.length === 1 ? "" : "s"}.
        </p>
      )}

      <div
        className={
          dense ? "gg-scryfall__list gg-scryfall__list--dense" : "gg-scryfall__grid"
        }
      >
        {results.map((p) =>
          dense ? (
            <button
              key={p.scryfallId || p.id}
              type="button"
              className="gg-scryrow"
              onClick={() => onSelect(p)}
            >
              <CardImage
                images={p.images}
                faces={p.faces}
                alt={p.cardName}
                size="xs"
                loadingPriority="eager"
              />
              <span className="gg-scryrow__main">
                <span className="gg-scryrow__name">{p.cardName}</span>
                <span className="gg-scryrow__sub">
                  {p.setName} ({p.setCode}) · #{p.collectorNumber}
                </span>
              </span>
              <span className="gg-scryrow__badges">
                <Badge tone={RARITY_TONE[p.rarity]}>{RARITY_LABELS[p.rarity]}</Badge>
                <PrintingTreatmentBadges printing={p} max={2} />
              </span>
              {p.scryfallPriceCents != null && (
                <span className="gg-scryrow__price">
                  {formatCents(p.scryfallPriceCents)}
                </span>
              )}
            </button>
          ) : (
            <button
              key={p.scryfallId || p.id}
              type="button"
              className="gg-scrycard"
              onClick={() => onSelect(p)}
            >
              <CardImage
                images={p.images}
                faces={p.faces}
                alt={p.cardName}
                size="md"
                loadingPriority="eager"
              />
              <span className="gg-scrycard__body">
                <span className="gg-scrycard__name">{p.cardName}</span>
                <span className="gg-scrycard__sub">
                  {p.setName} ({p.setCode}) · #{p.collectorNumber}
                </span>
                <span className="gg-scrycard__tags">
                  <Badge tone={RARITY_TONE[p.rarity]}>{RARITY_LABELS[p.rarity]}</Badge>
                  <PrintingTreatmentBadges printing={p} max={2} />
                </span>
                <span className="gg-scrycard__foot">
                  <span className="gg-scrycard__finishes">
                    {p.availableFinishes.join(" · ")}
                  </span>
                  {p.scryfallPriceCents != null && (
                    <span className="gg-scrycard__price">
                      {formatCents(p.scryfallPriceCents)}
                    </span>
                  )}
                </span>
              </span>
            </button>
          ),
        )}
      </div>

      {!searching && hasMore && (
        <div className="gg-scryfall__more">
          <Button
            variant="secondary"
            size="sm"
            icon="plus"
            loading={loadingMore}
            onClick={loadMore}
          >
            Load more printings
          </Button>
        </div>
      )}
    </div>
  );
}