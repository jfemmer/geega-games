import { CONDITION_LABELS, scryfallSrcSet, type Card } from "./cards";

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
        // A real responsive srcSet ONLY when we can derive genuine Scryfall
        // size variants (normal 488w + large 672w). For non-Scryfall images we
        // omit srcSet entirely rather than emit fake entries for the same file.
        const srcSet = scryfallSrcSet(card.image_url);
        // Descriptive alt: name, set, and finish for screen-reader users.
        const altText = [
          card.name,
          card.set ? `(${card.set})` : null,
          card.foil ? "foil" : null,
        ]
          .filter(Boolean)
          .join(" ");
        return (
          <article className="card" key={card.id}>
            <div className={`card-art ${card.foil ? "foil" : ""}`}>
              {card.image_url ? (
                <img
                  src={card.image_url}
                  {...(srcSet
                    ? {
                        srcSet,
                        // Grid columns are minmax(200px, 1fr); ~220px is a good
                        // typical rendered width across the responsive layout.
                        sizes: "(max-width: 760px) 45vw, 220px",
                      }
                    : {})}
                  alt={altText}
                  loading="lazy"
                  decoding="async"
                />
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