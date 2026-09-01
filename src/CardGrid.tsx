import { CONDITION_LABELS, type Card } from "./sampleCards";

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
      {cards.map((card) => (
        <article className="card" key={card.id}>
          <div className={`card-art ${card.foil ? "foil" : ""}`}>
            <img src={card.image} alt={card.name} loading="lazy" width={244} height={340} />
            {card.foil && <span className="foil-tag">Foil</span>}
          </div>
          <h3 className="card-name">{card.name}</h3>
          <p className="card-meta">{card.set}</p>
          <p className="card-meta">{CONDITION_LABELS[card.condition]}</p>
          <div className="card-foot">
            <span className="card-price">${card.priceUsd.toFixed(2)}</span>
            <span className="card-qty">{card.quantity} in stock</span>
          </div>
          <button className="card-add" disabled title="Checkout opens at launch">
            Add to cart
          </button>
        </article>
      ))}
    </div>
  );
}