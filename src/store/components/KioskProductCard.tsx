import { useState } from "react";
import type { CatalogCard } from "../lib/useCatalog";
import { scryfallSrcSet } from "../../cards";
import { formatCents } from "../lib/money";

// Visually identical to ProductCard (same brand-grade card grid the real
// shop uses) but deliberately independent of CartContext — the kiosk never
// touches a signed-in cart, only its own local pickup list.

const CONDITION_LABELS: Record<string, string> = {
  NM: "Near Mint",
  LP: "Lightly Played",
  MP: "Moderately Played",
  HP: "Heavily Played",
  DMG: "Damaged",
};

export default function KioskProductCard({
  card,
  quantityInList,
  onAdd,
}: {
  card: CatalogCard;
  quantityInList: number;
  onAdd: () => void;
}) {
  const [justAdded, setJustAdded] = useState(false);

  const soldOut = card.quantity <= 0;
  const unpriced = card.priceCents == null || card.priceCents <= 0;
  const atLimit = quantityInList >= card.quantity;
  const canAdd = !soldOut && !unpriced && !atLimit;
  const srcSet = card.imageUrl ? scryfallSrcSet(card.imageUrl) : null;

  return (
    <div className="gg-card">
      <div className="gg-card-imgwrap">
        {card.imageUrl ? (
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
        </div>

        {!soldOut && card.quantity <= 3 && !unpriced && (
          <div className="gg-card-stock">Only {card.quantity} left</div>
        )}
        {soldOut && <div className="gg-card-stock gg-card-stock--out">Sold out</div>}
        {quantityInList > 0 && (
          <div className="gg-card-stock gg-card-stock--added">{quantityInList} in your list</div>
        )}

        <div className="gg-card-foot">
          <span className="gg-price">{unpriced ? "—" : formatCents(card.priceCents)}</span>
          {!soldOut && unpriced && <span className="gg-card-meta">Not for sale</span>}
        </div>

        <button
          className="gg-btn gg-btn-sm gg-card-cta"
          disabled={!canAdd}
          onClick={() => {
            onAdd();
            setJustAdded(true);
            window.setTimeout(() => setJustAdded(false), 1200);
          }}
        >
          {justAdded ? "Added ✓" : atLimit ? "Max in list" : "Add to list"}
        </button>
      </div>
    </div>
  );
}
