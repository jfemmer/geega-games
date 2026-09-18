import { useState } from "react";
import type { CatalogCard } from "../lib/useCatalog";
import { useCart } from "../lib/CartContext";
import { scryfallSrcSet } from "../../cards";
import { formatCents } from "../lib/money";

const CONDITION_LABELS: Record<string, string> = {
  NM: "Near Mint",
  LP: "Lightly Played",
  MP: "Moderately Played",
  HP: "Heavily Played",
  DMG: "Damaged",
};

export default function ProductCard({ card }: { card: CatalogCard }) {
  const { addItem } = useCart();
  const [adding, setAdding] = useState(false);
  const [added, setAdded] = useState(false);

  const soldOut = card.quantity <= 0;
  const unpriced = card.priceCents == null || card.priceCents <= 0;
  const canBuy = !soldOut && !unpriced;
  const srcSet = card.imageUrl ? scryfallSrcSet(card.imageUrl) : null;

  return (
    <div className="gg-card">
      <div className={`gg-card-imgwrap ${card.finish !== "nonfoil" ? "gg-card-imgwrap--foil" : ""}`}>
        {card.isDeal && (
          <span className="gg-deal-ribbon">
            {card.dealDiscountPercent ? `${card.dealDiscountPercent}% OFF` : "SPECIAL"}
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
            {card.finish !== "nonfoil" && (
              <span className="gg-card-foil-shimmer" aria-hidden="true" />
            )}
          </>
        ) : (
          <div
            className="gg-card-img"
            role="img"
            aria-label={`${card.name} (no image available)`}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "#999",
              fontSize: "0.8rem",
              padding: "0.5rem",
              textAlign: "center",
            }}
          >
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
          <span className="gg-badge">
            {CONDITION_LABELS[card.condition] ?? card.condition}
          </span>
          {card.finish !== "nonfoil" && (
            <span className="gg-badge gg-badge-foil">{card.finish}</span>
          )}
        </div>

        {!soldOut && card.quantity <= 3 && !unpriced && (
          <div className="gg-card-stock">Only {card.quantity} left</div>
        )}
        {soldOut && <div className="gg-card-stock gg-card-stock--out">Sold out</div>}

        <div className="gg-card-foot">
          <span className="gg-priceblock">
            <span className={card.isDeal ? "gg-price gg-price--deal" : "gg-price"}>
              {unpriced ? "—" : formatCents(card.priceCents)}
            </span>
            {card.isDeal &&
              card.originalPriceCents != null &&
              card.originalPriceCents > (card.priceCents ?? 0) && (
                <span className="gg-price-original">
                  {formatCents(card.originalPriceCents)}
                </span>
              )}
          </span>
          {!soldOut && unpriced && (
            <span className="gg-card-meta">Not for sale</span>
          )}
        </div>
        {canBuy && (
          <button
            className="gg-btn gg-btn-sm gg-card-cta"
            disabled={adding}
            onClick={async () => {
              setAdding(true);
              try {
                await addItem(card.id, 1);
                setAdded(true);
                window.setTimeout(() => setAdded(false), 1500);
              } finally {
                setAdding(false);
              }
            }}
          >
            {added ? "Added ✓" : adding ? "Adding…" : "Add to cart"}
          </button>
        )}
      </div>
    </div>
  );
}
