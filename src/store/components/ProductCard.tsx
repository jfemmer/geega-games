import { useEffect, useId, useRef, useState } from "react";
import type { CatalogCard } from "../lib/useCatalog";
import { useCart } from "../lib/CartContext";
import { scryfallSrcSet } from "../../cards";
import { formatCents } from "../lib/money";
import { Link } from "../lib/router";
import { cardDetailPath } from "../lib/cardSlug";
import WishlistButton from "./WishlistButton";
import { CONDITION_LABELS } from "../lib/conditionLabels";
import { useTradeTerms } from "../lib/tradeCenterApi";
import { tradeCart, useTradeCart } from "../lib/tradeCart";
import { TRADE_CENTER_PATH, tradePriceCents, tradingOpen } from "../lib/tradeCenter";

export default function ProductCard({ card }: { card: CatalogCard }) {
  const { addItem } = useCart();
  const [adding, setAdding] = useState(false);
  const [added, setAdded] = useState(false);

  const soldOut = card.quantity <= 0;
  const unpriced = card.priceCents == null || card.priceCents <= 0;
  const canBuy = !soldOut && !unpriced;
  const srcSet = card.imageUrl ? scryfallSrcSet(card.imageUrl) : null;
  const detailPath = cardDetailPath(card.name);

  // "Add to trade" (Trade Center), once staff switch trading on: the copy
  // goes in the trade cart at its regular price (deals and sales don't apply
  // to trades). Once it's there, the button becomes the way to the cart.
  const tradeTerms = useTradeTerms();
  const tradePrice = tradePriceCents(card);
  const canTrade = tradingOpen(tradeTerms) && !soldOut && tradePrice != null && tradePrice > 0;
  const inTrade = useTradeCart().some((i) => i.inventoryItemId === card.id);
  const tradesAtRegularPrice =
    card.isDeal && card.originalPriceCents != null && card.originalPriceCents > (card.priceCents ?? 0);
  const tradePriceId = `${useId()}-trade-price`;
  // The button turns into a link when the card's added: keep keyboard focus on it.
  const tradeRef = useRef<HTMLDivElement>(null);
  const focusTradeLink = useRef(false);
  useEffect(() => {
    if (!inTrade || !focusTradeLink.current) return;
    focusTradeLink.current = false;
    tradeRef.current?.querySelector<HTMLAnchorElement>("a")?.focus();
  }, [inTrade]);

  return (
    <div className={`gg-card${card.variantType ? " gg-card--variant" : ""}`}>
      <Link
        to={detailPath}
        className={`gg-card-imgwrap ${card.finish !== "nonfoil" ? "gg-card-imgwrap--foil" : ""}`}
      >
        {card.isDeal && (
          <span className="gg-deal-ribbon">
            {card.dealDiscountPercent ? `${card.dealDiscountPercent}% OFF` : "SPECIAL"}
          </span>
        )}
        {card.variantType && (
          <span className="gg-variant-ribbon">★ {card.variantType}</span>
        )}
        <WishlistButton oracleId={card.oracleId} cardName={card.name} />
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
      </Link>

      <div className="gg-card-body">
        <Link to={detailPath} className="gg-card-name" title={card.name}>
          {card.name}
        </Link>
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
          {card.variantType && (
            <span className="gg-badge gg-badge-variant">{card.variantType}</span>
          )}
        </div>

        {card.isDeal && card.dealNote && (
          <p className="gg-deal-note">
            {card.dealSource === "flawed" ? <strong>Condition note: </strong> : null}
            {card.dealNote}
          </p>
        )}

        {!soldOut && card.quantity <= 3 && !unpriced && (
          <div className="gg-card-stock">Only {card.quantity} left</div>
        )}
        {soldOut && <div className="gg-card-stock gg-card-stock--out">Sold out</div>}
        {/* Above the price, so prices and buttons still line up across a row. */}
        {canTrade && tradesAtRegularPrice && (
          <div className="gg-card-trade__price" id={tradePriceId}>
            Trades at {formatCents(tradePrice)}
          </div>
        )}

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
        {canTrade && (
          <div className="gg-card-trade" ref={tradeRef}>
            {inTrade ? (
              <Link
                to={`${TRADE_CENTER_PATH}#trade-cart`}
                className="gg-btn gg-btn-ghost gg-btn-sm gg-card-cta gg-card-trade__in"
                aria-label={`In your trade: ${card.name}. Review your trade`}
              >
                In your trade ✓
              </Link>
            ) : (
              <button
                type="button"
                className="gg-btn gg-btn-ghost gg-btn-sm gg-card-cta"
                aria-label={`Add to trade: ${card.name}`}
                aria-describedby={tradesAtRegularPrice ? tradePriceId : undefined}
                onClick={() => {
                  focusTradeLink.current = true;
                  tradeCart.add({
                    inventoryItemId: card.id,
                    cardName: card.name,
                    setCode: card.set,
                    setName: card.setName,
                    collectorNumber: card.collectorNumber,
                    condition: card.condition,
                    finish: card.finish,
                    imageUrl: card.imageUrl,
                    maxQuantity: card.quantity,
                    tradePriceCents: tradePrice,
                    cardPath: detailPath,
                  });
                }}
              >
                Add to trade
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
