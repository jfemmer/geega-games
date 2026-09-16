import { useEffect, useRef, useState } from "react";
import { searchSellPrintings } from "../../lib/sellApi";
import type { SellPrinting } from "../../lib/sellTypes";
import { storefrontImageUrl } from "../../../cards";
import { formatCents } from "../../lib/money";

// Public card search for the Sell page. Identifies the EXACT printing (set,
// collector number, treatment), not just a card name — mirrors the admin
// ScryfallSearch component's intent, but is its own storefront-native
// implementation (the storefront never imports from src/admin) hitting the
// PUBLIC /api/sell/scryfall-search endpoint instead of the staff-only admin
// one.

export function SellCardSearch({
  onSelect,
  initialQuery = "",
  autoFocus,
}: {
  onSelect: (printing: SellPrinting) => void;
  initialQuery?: string;
  autoFocus?: boolean;
}) {
  const [term, setTerm] = useState(initialQuery);
  const [results, setResults] = useState<SellPrinting[]>([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
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
        const res = await searchSellPrintings(q);
        if (id === reqId.current) setResults(res.printings);
      } catch (err) {
        if (id === reqId.current) {
          setError(err instanceof Error ? err.message : "Search failed. Try again.");
          setResults([]);
        }
      } finally {
        if (id === reqId.current) setSearching(false);
      }
    }, 300);
    return () => clearTimeout(handle);
  }, [term]);

  return (
    <div className="gg-sellsearch">
      <div className="gg-field">
        <label htmlFor="sell-card-search">Search for a card</label>
        <input
          id="sell-card-search"
          type="text"
          value={term}
          autoFocus={autoFocus}
          placeholder="Card name, e.g. Lightning Bolt"
          onChange={(e) => setTerm(e.target.value)}
        />
      </div>

      {error && (
        <div className="gg-alert gg-alert-error" role="alert">
          {error}
        </div>
      )}
      {searching && <p className="gg-card-meta">Searching…</p>}
      {!searching && term.trim().length >= 2 && results.length === 0 && !error && (
        <p className="gg-card-meta">
          No printings found for &ldquo;{term}&rdquo;. Try just the card name.
        </p>
      )}

      {results.length > 0 && (
        <ul className="gg-sellsearch__results">
          {results.slice(0, 30).map((p) => (
            <li key={p.scryfallId}>
              <button
                type="button"
                className="gg-sellsearch__result"
                onClick={() => onSelect(p)}
              >
                <img
                  src={storefrontImageUrl(p.imageUrl) ?? undefined}
                  alt=""
                  loading="lazy"
                  className="gg-sellsearch__thumb"
                />
                <span className="gg-sellsearch__info">
                  <span className="gg-sellsearch__name">{p.cardName}</span>
                  <span className="gg-card-meta">
                    {p.setName} ({p.setCode}) · #{p.collectorNumber}
                    {p.rarity ? ` · ${p.rarity}` : ""}
                  </span>
                  <span className="gg-card-meta">
                    {p.availableFinishes.join(" · ")}
                    {p.scryfallPriceCents != null ? ` · ~${formatCents(p.scryfallPriceCents)}` : ""}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
