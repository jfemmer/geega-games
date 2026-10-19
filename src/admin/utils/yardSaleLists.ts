import { yardSaleTotals, type YardSaleTotals } from "../../store/lib/yardSale";
import type { PickupRequest, PickupRequestItem } from "../types";

// Prices for a yard sale list in Pickup Requests, worked out the way
// yard_sale_complete_list charges them: each card's live website price, less
// the sale's discount, plus the register's sales tax.

/** The live price staff will be charging for a card (its price when listed, if inventory has none). */
export function livePriceCents(item: PickupRequestItem): number {
  return item.currentPriceCents ?? item.unitPriceCents;
}

export function yardSaleListTotals(request: PickupRequest, discountPercent: number, taxBps: number): YardSaleTotals {
  return yardSaleTotals(
    request.items.map((item) => ({ priceCents: livePriceCents(item), quantity: item.quantity })),
    discountPercent,
    taxBps,
  );
}
