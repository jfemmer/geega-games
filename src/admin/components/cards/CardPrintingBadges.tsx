import { useCardPrinting, type ResolvableCard } from "../../hooks/useCardImages";
import { Badge } from "../ui/Badge";
import {
  FINISH_LABELS,
  TREATMENT_LABELS,
  TREATMENT_TONE,
} from "../../utils/labels";
import type { CardFinish } from "../../types";

// Resolves the exact Scryfall printing for a card row and renders its TREATMENT
// badges (Borderless, Showcase, Extended Art, Retro Frame, Promo, Etched…) plus
// an optional finish badge. This is how staff VERIFY that the shown art matches
// the intended printing: if a card is the borderless Solitude, a "Borderless"
// badge appears next to it. Inventory rows/order items don't store treatments
// themselves (only finish), so we read them from the resolved printing.
//
// Renders nothing until resolved, and nothing if the printing has no special
// treatments (a plain printing simply shows no treatment badge).

export function CardPrintingBadges({
  card,
  showFinish = false,
  max,
}: {
  card: ResolvableCard;
  /** Also show the item's finish (foil/etched) as a badge. */
  showFinish?: boolean;
  /** Cap the number of treatment badges shown. */
  max?: number;
}) {
  const printing = useCardPrinting(card);
  const treatments = printing?.treatments ?? [];
  const shown = max ? treatments.slice(0, max) : treatments;

  const finish = (card.finish ?? null) as CardFinish | null;
  const showFinishBadge =
    showFinish && finish != null && finish !== "nonfoil";

  if (shown.length === 0 && !showFinishBadge) return null;

  return (
    <span className="gg-treatments">
      {showFinishBadge && finish && (
        <Badge tone="gold">{FINISH_LABELS[finish]}</Badge>
      )}
      {shown.map((t) => (
        <Badge key={t} tone={TREATMENT_TONE[t]}>
          {TREATMENT_LABELS[t]}
        </Badge>
      ))}
    </span>
  );
}