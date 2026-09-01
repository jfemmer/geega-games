import { CONDITION_LABELS, type Card } from "./cards";

export default function CardGrid({ cards }: { cards: Card[] }) {
  if (cards.length === 0) {
    return (
      <div className="empty">
        <p>No cards match your filters.</p>
        <span>Try clearing a filter or searching a different name.</span>
      </div>
    );
  }

  return (
    <div className="card-grid">
      {cards.map((card) => {
        const priced = card.price_usd > 0;
        return (
          <article className="card" key={card.id}>
            <div className={`card-art ${card.foil ? "foil" : ""}`}>
              {card.image_url ? (
                <img src={card.image_url} alt={card.name} loading="lazy" />
              ) : (
                <div className="card-noimg">No image</div>
              )}
              {card.foil && <span className="foil-tag">Foil</span>}
            </div>
            <h3 className="card-name">{card.name}</h3>
            {card.set && <p className="card-meta">{card.set}</p>}
            <p className="card-meta">
              {CONDITION_LABELS[card.condition] ?? card.condition}
            </p>
            <div className="card-foot">
              <span className={`card-price ${priced ? "" : "unpriced"}`}>
                {priced ? `$${card.price_usd.toFixed(2)}` : "Not yet priced"}
              </span>
              <span className="card-qty">{card.quantity} in stock</span>
            </div>
            <button className="card-add" disabled title="Checkout opens at launch">
              Add to cart
            </button>
          </article>
        );
      })}
    </div>
  );
}