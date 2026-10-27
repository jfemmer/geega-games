// Internal trade economics (admin Trades): what a finished trade did to our
// retail-priced inventory, with shipping. These are theoretical
// inventory-value differences (their cards at the TCG low staff set, ours
// at retail), not profit: they
// don't account for what the store paid for its cards (cost basis), cash
// flow, payment fees or anything else in the books.
//
//   gross difference    = accepted value in (TCG low) − retail value out
//   net shipping        = what shipping our cards cost − the fee charged
//   shipping-adjusted   = gross difference − net shipping
//
// e.g. $250 in, $200 out: $50 gross; $6 postage, $0 charged: $44 adjusted.
//
// Pure module: no React, browser, Node or Supabase imports. Money is whole cents.

export interface TradeEconomicsInput {
  /** Accepted value of their cards after inspection (the TCG low staff set); null before the final offer. */
  finalValueCents: number | null;
  /** Our cards, at their retail (trade) prices. */
  wantedTotalCents: number;
  /** Shipping our cards, charged to the customer. */
  shippingCents: number | null;
  /** Postage for a label bought through EasyPost (on the order). */
  orderPostageCents: number | null;
  /** Postage staff recorded on the trade. */
  outboundPostageCents: number | null;
}

export type ShippingCostSource = "label" | "recorded" | "estimate";

export interface TradeEconomics {
  incomingMarketCents: number;
  outgoingRetailCents: number;
  grossDifferenceCents: number;
  shippingChargedCents: number;
  shippingCostCents: number;
  /** label: bought through EasyPost; recorded: staff entered it; estimate: the setting. */
  shippingCostSource: ShippingCostSource;
  /** Positive when shipping cost us more than we charged. */
  netShippingCents: number;
  adjustedDifferenceCents: number;
}

/** A trade's numbers, or null before its final value is known. */
export function tradeEconomics(t: TradeEconomicsInput, estimateCents: number): TradeEconomics | null {
  if (t.finalValueCents == null) return null;
  const shippingCostSource: ShippingCostSource =
    t.orderPostageCents != null ? "label" : t.outboundPostageCents != null ? "recorded" : "estimate";
  const shippingCostCents = t.orderPostageCents ?? t.outboundPostageCents ?? estimateCents;
  const shippingChargedCents = t.shippingCents ?? 0;
  const grossDifferenceCents = t.finalValueCents - t.wantedTotalCents;
  const netShippingCents = shippingCostCents - shippingChargedCents;
  return {
    incomingMarketCents: t.finalValueCents,
    outgoingRetailCents: t.wantedTotalCents,
    grossDifferenceCents,
    shippingChargedCents,
    shippingCostCents,
    shippingCostSource,
    netShippingCents,
    adjustedDifferenceCents: grossDifferenceCents - netShippingCents,
  };
}

export interface EconomicsTotals {
  trades: number;
  incomingMarketCents: number;
  outgoingRetailCents: number;
  /** Net change in retail-priced inventory: market value in − retail value out. */
  grossDifferenceCents: number;
  shippingChargedCents: number;
  shippingCostCents: number;
  /** Shipments counted at the estimate (no label or recorded postage). */
  estimatedShipments: number;
  netShippingCents: number;
  adjustedDifferenceCents: number;
  /** Average retail value of our cards per trade (0 with no trades). */
  averageOutgoingCents: number;
  /** Copies we accepted worth at least the per-card minimum each. */
  acceptedSingles: number;
  /** Different printings (with finish and condition) we accepted. */
  uniqueListings: number;
}

export function economicsTotals(rows: readonly TradeEconomics[], cards: { acceptedSingles: number; uniqueListings: number }): EconomicsTotals {
  const sum = (pick: (e: TradeEconomics) => number) => rows.reduce((total, e) => total + pick(e), 0);
  const outgoing = sum((e) => e.outgoingRetailCents);
  return {
    trades: rows.length,
    incomingMarketCents: sum((e) => e.incomingMarketCents),
    outgoingRetailCents: outgoing,
    grossDifferenceCents: sum((e) => e.grossDifferenceCents),
    shippingChargedCents: sum((e) => e.shippingChargedCents),
    shippingCostCents: sum((e) => e.shippingCostCents),
    estimatedShipments: rows.filter((e) => e.shippingCostSource === "estimate").length,
    netShippingCents: sum((e) => e.netShippingCents),
    adjustedDifferenceCents: sum((e) => e.adjustedDifferenceCents),
    averageOutgoingCents: rows.length ? Math.round(outgoing / rows.length) : 0,
    acceptedSingles: cards.acceptedSingles,
    uniqueListings: cards.uniqueListings,
  };
}

/** Accepted copies worth at least `minUnitCents` each, and the different listings among them. */
export function acceptedCardCounts(
  cards: readonly { scryfallId: string | null; cardName: string; finish: string; condition: string | null; quantity: number; unitCents: number }[],
  minUnitCents: number,
): { acceptedSingles: number; uniqueListings: number } {
  const listings = new Set<string>();
  let acceptedSingles = 0;
  for (const c of cards) {
    if (c.quantity <= 0) continue;
    listings.add(`${c.scryfallId ?? c.cardName.toLowerCase()}|${c.finish}|${c.condition ?? ""}`);
    if (c.unitCents >= minUnitCents) acceptedSingles += c.quantity;
  }
  return { acceptedSingles, uniqueListings: listings.size };
}
