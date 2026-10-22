import { useEffect, useRef, useState } from "react";
import type { CatalogCard } from "../lib/useCatalog";
import { scryfallSrcSet } from "../../cards";
import { formatCents } from "../lib/money";
import { CONDITION_LABELS } from "../lib/conditionLabels";

// Visually identical to ProductCard (same brand-grade card grid the real
// shop uses, foil shimmer and special-printing ribbon included) but
// deliberately independent of CartContext — the kiosk never touches a
// signed-in cart, only its own local pickup list. The yard sale page
// (/yard-sale) uses it too, with the yard sale price next to the website
// price.

export default function KioskProductCard({
  card,
  quantityInList,
  onAdd,
  salePriceCents = null,
  regularPriceLabel = null,
}: {
  card: CatalogCard;
  quantityInList: number;
  onAdd: () => void;
  /** A lower price to show instead, with the regular price struck through. */
  salePriceCents?: number | null;
  /** Says where the struck-through price is from ("Website"), so it's clear the lower one isn't. */
  regularPriceLabel?: string | null;
}) {
  const [justAdded, setJustAdded] = useState(false);
  // The "Added ✓" flash: one timer at a time (another tap restarts it), and
  // none left running once the card is gone.
  const addedTimer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(addedTimer.current), []);

  const soldOut = card.quantity <= 0;
  const unpriced = card.priceCents == null || card.priceCents <= 0;
  const atLimit = quantityInList >= card.quantity;
  const canAdd = !soldOut && !unpriced && !atLimit;
  const srcSet = card.imageUrl ? scryfallSrcSet(card.imageUrl) : null;
  const foil = card.finish !== "nonfoil";

  return (
    <div className={`gg-card${card.variantType ? " gg-card--variant" : ""}`}>
      {/* The same foil treatment as ProductCard (store.css, "Foil card treatment"). */}
      <div className={`gg-card-imgwrap${foil ? " gg-card-imgwrap--foil" : ""}`}>
        {/* A special printing (an artist proof…), marked like the shop marks it.
            The badge below says it for screen readers. */}
        {card.variantType && (
          <span className="gg-variant-ribbon" aria-hidden="true">
            ★ {card.variantType}
          </span>
        )}
        {card.imageUrl ? (
          <>
            <img
              className="gg-card-img"
              src={card.imageUrl}
              srcSet={srcSet ?? undefined}
              sizes="(max-width: 420px) 45vw, (max-width: 800px) 30vw, 200px"
              alt={`${card.name}${card.setName ? `, ${card.setName}` : ""}`}
              loading="lazy"
              width={488}
              height={680}
            />
            {foil && <span className="gg-card-foil-shimmer" aria-hidden="true" />}
          </>
        ) : (
          <div className="gg-card-img gg-card-img--none" role="img" aria-label={`${card.name} (no image available)`}>
            No image
          </div>
        )}
      </div>

      <div className="gg-card-body">
        <div className="gg-card-name" title={card.name}>
          {card.name}
        </div>
        <div className="gg-card-meta">
          {card.setName ?? card.set?.toUpperCase()}
          {card.collectorNumber ? ` · #${card.collectorNumber}` : ""}
        </div>
        <div className="gg-card-badges">
          <span className="gg-badge">{CONDITION_LABELS[card.condition] ?? card.condition}</span>
          {card.finish !== "nonfoil" && <span className="gg-badge gg-badge-foil">{card.finish}</span>}
          {card.variantType && <span className="gg-badge gg-badge-variant">{card.variantType}</span>}
        </div>

        {!soldOut && card.quantity <= 3 && !unpriced && (
          <div className="gg-card-stock">Only {card.quantity} left</div>
        )}
        {soldOut && <div className="gg-card-stock gg-card-stock--out">Sold out</div>}
        {quantityInList > 0 && (
          <div className="gg-card-stock gg-card-stock--added">{quantityInList} in your list</div>
        )}

        <div className="gg-card-foot">
          {!unpriced && salePriceCents != null && salePriceCents < (card.priceCents ?? 0) ? (
            <span className="gg-priceblock">
              <span className="gg-price gg-price--deal">{formatCents(salePriceCents)}</span>
              {regularPriceLabel ? (
                <span className="gg-price-was">
                  <span className="gg-price-was__label">{regularPriceLabel}</span>
                  <span className="gg-price-original">{formatCents(card.priceCents)}</span>
                </span>
              ) : (
                <span className="gg-price-original">
                  <span className="visually-hidden">Regular price </span>
                  {formatCents(card.priceCents)}
                </span>
              )}
            </span>
          ) : (
            <span className="gg-price">{unpriced ? "—" : formatCents(card.priceCents)}</span>
          )}
          {!soldOut && unpriced && <span className="gg-card-meta">Not for sale</span>}
        </div>

        <button
          className="gg-btn gg-btn-sm gg-card-cta"
          disabled={!canAdd}
          onClick={() => {
            onAdd();
            setJustAdded(true);
            window.clearTimeout(addedTimer.current);
            addedTimer.current = window.setTimeout(() => setJustAdded(false), 1200);
          }}
        >
          {justAdded ? "Added ✓" : atLimit ? "Max in list" : "Add to list"}
        </button>
      </div>
    </div>
  );
}
