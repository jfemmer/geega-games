import { formatCents } from "../lib/money";

/**
 * The yard sale price for some copies of a card, with the website price
 * struck through when it's lower. Used in the yard sale page's list sheet,
 * the sent list and "Shop your deck".
 */
export default function YardSalePriceCell({
  priceCents,
  salePriceCents,
  quantity,
}: {
  priceCents: number;
  salePriceCents: number;
  quantity: number;
}) {
  const discounted = salePriceCents < priceCents;
  return (
    <span className="gg-priceblock gg-yard-line__price">
      <span className={discounted ? "gg-price gg-price--deal" : "gg-price"}>{formatCents(salePriceCents * quantity)}</span>
      {discounted && (
        <span className="gg-price-original">
          <span className="visually-hidden">Regular price </span>
          {formatCents(priceCents * quantity)}
        </span>
      )}
    </span>
  );
}
