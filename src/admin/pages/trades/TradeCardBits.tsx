import type { ReactNode } from "react";
import { formatCents } from "../../utils/format";
import {
  CONDITION_NAMES,
  eligibilityMessage,
  printingLabel,
  type StaffTradeOfferCard,
} from "../../../store/lib/tradeCenter";

// Small pieces shared by the trade drawer's card lists.

export function CardThumb({ imageUrl }: { imageUrl: string | null }) {
  return imageUrl ? (
    <img className="gg-trd-thumb" src={imageUrl} alt="" loading="lazy" />
  ) : (
    <span className="gg-trd-thumb gg-trd-thumb--none" aria-hidden="true" />
  );
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
      <CardThumb imageUrl={card.imageUrl} />
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
