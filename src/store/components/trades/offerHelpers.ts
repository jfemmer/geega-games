import type { SellPrinting } from "../../lib/sellTypes";
import { isTradeFinish, type TradeFinish, type TradeOfferCard, type TradeOfferInput } from "../../lib/tradeCenter";

// Small helpers shared by the trade card editor and the list import.

/** The saved list as the server takes it back (ids keep staff's review on unchanged cards). */
export function offerInputs(cards: TradeOfferCard[]): TradeOfferInput[] {
  return cards.flatMap((c) =>
    c.scryfallId && isTradeFinish(c.finish)
      ? [
          {
            id: c.id,
            scryfallId: c.scryfallId,
            finish: c.finish,
            condition: c.reportedCondition,
            quantity: c.quantity,
            customerEstimateCents: c.customerEstimateCents,
            note: c.customerNote,
          },
        ]
      : [],
  );
}

/** A printing's market price for a finish (cents), or null: never another finish's price. */
export function printingPrice(printing: SellPrinting, finish: TradeFinish): number | null {
  const p = printing.prices;
  if (!p) return finish === "nonfoil" ? printing.scryfallPriceCents : null;
  return finish === "foil" ? p.usdFoil : finish === "etched" ? p.usdEtched : p.usd;
}

/** The finishes a printing comes in that trades price (non-foil, foil, etched). */
export function finishesOf(printing: SellPrinting): TradeFinish[] {
  const offered = printing.availableFinishes.filter(isTradeFinish);
  return offered.length > 0 ? offered : ["nonfoil"];
}
