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

/** A customer's card: picture, name, printing, what they told us, and how we priced it. */
export function OfferCardHead({
  card,
  minCardValueCents,
  showPricing = true,
  aside,
}: {
  card: StaffTradeOfferCard;
  minCardValueCents: number;
  showPricing?: boolean;
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
              ? `Market ${formatCents(card.referencePriceCents)} × ${card.conditionPercent}% = ${formatCents(card.estimatedUnitCents)} each`
              : "No market price: value it by hand"}
            {card.stockOnHand ? ` · ${card.stockOnHand} in stock` : ""}
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
