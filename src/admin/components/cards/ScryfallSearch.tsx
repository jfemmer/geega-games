import { useEffect, useRef, useState } from "react";
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

interface ScryfallSearchProps {
  onSelect: (printing: CardPrinting) => void;
  autoFocus?: boolean;
  /** Seed the search box (e.g. from a recognized name). */
  initialQuery?: string;
  /** Persisted across the component's lifetime. */
  defaultDense?: boolean;
}

export function ScryfallSearch({
  onSelect,
  autoFocus,
  initialQuery = "",
  defaultDense = false,
}: ScryfallSearchProps) {
  const [term, setTerm] = useState(initialQuery);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<CardPrinting[]>([]);
  const [dense, setDense] = useState(defaultDense);
  const reqId = useRef(0);

  useEffect(() => {
    const q = term.trim();
    if (q.length < 2) {
      setResults([]);
      setError(null);
      setSearching(false);
      return;
    }
    setSearching(true);
    setError(null);
    const id = ++reqId.current;
    const handle = setTimeout(async () => {
      try {
        const res = await scryfallRepository.searchPrintings(q);
        if (id === reqId.current) setResults(res);
      } catch (err) {
        if (id === reqId.current) {
          setError(
            err instanceof Error ? err.message : "Search failed. Try again.",
          );
          setResults([]);
        }
      } finally {
        if (id === reqId.current) setSearching(false);
      }
    }, 280);
    return () => clearTimeout(handle);
  }, [term]);

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

      <div
        className={
          dense ? "gg-scryfall__list gg-scryfall__list--dense" : "gg-scryfall__grid"
        }
      >
        {results.map((p) =>
          dense ? (
            <button
              key={p.id}
              type="button"
              className="gg-scryrow"
              onClick={() => onSelect(p)}
            >
              <CardImage images={p.images} faces={p.faces} alt={p.cardName} size="xs" />
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
              key={p.id}
              type="button"
              className="gg-scrycard"
              onClick={() => onSelect(p)}
            >
              <CardImage images={p.images} faces={p.faces} alt={p.cardName} size="md" />
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
    </div>
  );
}
