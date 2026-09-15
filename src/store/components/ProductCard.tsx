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
      {card.imageUrl ? (
        <img
          className="gg-card-img"
          src={card.imageUrl}
          srcSet={srcSet ?? undefined}
          sizes="(max-width: 800px) 45vw, 180px"
          alt={`${card.name}${card.setName ? `, ${card.setName}` : ""}`}
          loading="lazy"
          width={488}
          height={680}
        />
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

      <div className="gg-card-body">
        <div className="gg-card-name">{card.name}</div>
        <div className="gg-card-meta">
          {card.setName ?? card.set?.toUpperCase()}
          {card.collectorNumber ? ` · #${card.collectorNumber}` : ""}
        </div>
        <div className="gg-card-meta">
          <span className="gg-badge">
            {CONDITION_LABELS[card.condition] ?? card.condition}
          </span>{" "}
          {card.finish !== "nonfoil" && (
            <span className="gg-badge" style={{ background: "#fef3c7", color: "#92400e" }}>
              {card.finish}
            </span>
          )}
        </div>

        <div className="gg-card-foot">
          <span className="gg-price">
            {unpriced ? "—" : formatCents(card.priceCents)}
          </span>
          {soldOut ? (
            <span className="gg-card-meta" style={{ color: "var(--gg-danger)" }}>
              Sold out
            </span>
          ) : unpriced ? (
            <span className="gg-card-meta">Not for sale</span>
          ) : (
            <button
              className="gg-btn gg-btn-sm"
              disabled={!canBuy || adding}
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
        {!soldOut && card.quantity <= 3 && (
          <div className="gg-card-meta" style={{ color: "#92400e" }}>
            Only {card.quantity} left
          </div>
        )}
      </div>
    </div>
  );
}
