import type { ReactNode } from "react";
import { CardImage } from "../../components/cards/CardImage";
import type { CardImageUris } from "../../types";
import { scryfallImageAtSize } from "../../../store/lib/cardImages";
import { formatCents } from "../../utils/format";
import {
  CONDITION_NAMES,
  FINISH_NAMES,
  eligibilityMessage,
  printingLabel,
  type StaffTradeOfferCard,
} from "../../../store/lib/tradeCenter";

// Small pieces shared by the trade drawer's card lists.

/**
 * A card's picture on a trade. Hover (or tap, on a touch screen) shows it
 * larger, through the admin's shared CardImage preview. A Scryfall picture is
 * shown at the right size for each (small thumbnail, large preview). With
 * `foil`, the storefront's foil shimmer sweeps across it (src/foilShimmer.css).
 */
export function CardThumb({ imageUrl, alt = "", foil = false }: { imageUrl: string | null; alt?: string; foil?: boolean }) {
  if (!imageUrl) {
    return <span className={`gg-trd-thumb gg-trd-thumb--none${foil ? " gg-foil-frame gg-trd-thumb--foil" : ""}`} aria-hidden="true">{foil && <span className="gg-card-foil-shimmer" />}</span>;
  }
  const image = <CardImage images={tradeCardImages(imageUrl)} alt={alt || "Card"} size="sm" className="gg-trd-thumb-img" />;
  if (!foil) return image;
  return (
    <span className="gg-foil-frame gg-trd-thumb--foil">
      {image}
      <span className="gg-card-foil-shimmer" aria-hidden="true" />
    </span>
  );
}

/** "Foil" or "Etched foil", shimmering, for a card that isn't non-foil (nothing otherwise). */
export function FoilTag({ finish }: { finish: string }) {
  if (finish === "nonfoil") return null;
  return <span className="gg-trd-foiltag">{FINISH_NAMES[finish] ?? finish}</span>;
}

/** One stored picture as the sizes CardImage asks for (the same file when it isn't a Scryfall picture). */
function tradeCardImages(imageUrl: string): CardImageUris {
  return {
    small: scryfallImageAtSize(imageUrl, "small") ?? imageUrl,
    normal: scryfallImageAtSize(imageUrl, "normal") ?? imageUrl,
    large: scryfallImageAtSize(imageUrl, "large") ?? imageUrl,
    png: null,
    artCrop: null,
  };
}

/** TCGplayer's search for a card, to look up its TCG low (staff pick the printing there). */
function tcgplayerSearchUrl(cardName: string): string {
  return `https://www.tcgplayer.com/search/magic/product?productLineName=magic&q=${encodeURIComponent(cardName)}&view=grid`;
}

/**
 * A customer's card: picture, name, printing, what they told us, and how we
 * estimated it (today's market price for the condition its age gives;
 * staff price it at TCG low). With `lookup`, a link to look up its TCG low.
 */
export function OfferCardHead({
  card,
  minCardValueCents,
  showPricing = true,
  lookup = false,
  aside,
}: {
  card: StaffTradeOfferCard;
  minCardValueCents: number;
  showPricing?: boolean;
  /** A "Look up TCG low" link (review and inspection). */
  lookup?: boolean;
  aside?: ReactNode;
}) {
  const printing = printingLabel(card);
  return (
    <div className="gg-trd-card__head">
      <CardThumb imageUrl={card.imageUrl} alt={card.cardName} />
      <div className="gg-trd-card__info">
        <p className="gg-trd-card__name">{card.cardName}</p>
        <p className="gg-trd-card__meta">
          {[printing, `Listed ${CONDITION_NAMES[card.reportedCondition]}`, `× ${card.quantity}`].filter(Boolean).join(" · ")}
        </p>
        {showPricing && (
          <p className="gg-trd-card__meta">
            {card.referencePriceCents != null && card.estimatedUnitCents != null
              ? `Market estimate ${formatCents(card.referencePriceCents)} × ${card.conditionPercent}% = ${formatCents(card.estimatedUnitCents)} each`
              : "No market price"}
            {card.stockOnHand ? ` · ${card.stockOnHand} in stock` : ""}
          </p>
        )}
        {lookup && (
          <p className="gg-trd-card__meta">
            <a href={tcgplayerSearchUrl(card.cardName)} target="_blank" rel="noopener noreferrer">
              Look up TCG low on TCGplayer
            </a>
          </p>
        )}
        {showPricing && card.eligibility !== "eligible" && card.eligibility !== "needs_review" && (
          <p className="gg-trd-card__flag">{eligibilityMessage(card.eligibility, minCardValueCents)}</p>
        )}
        {card.customerEstimateCents != null && (
          <p className="gg-trd-card__meta">Their estimate: {formatCents(card.customerEstimateCents)} each</p>
        )}
        {card.customerNote && <p className="gg-trd-card__quote">&ldquo;{card.customerNote}&rdquo;</p>}
      </div>
      {aside && <div className="gg-trd-card__aside">{aside}</div>}
    </div>
  );
}
