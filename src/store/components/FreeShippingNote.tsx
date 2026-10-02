import { SHIPPING, amountUntilFreeShipping, formatCents, formatCentsShort } from "../lib/money";

/**
 * Where the customer stands on free shipping: that the order already ships
 * free, or how much more gets it there. Shown in the cart and at checkout.
 *
 * This only tells the customer. The rule itself is applied by the server
 * when the order is created (checkout_place_order_core): an order with
 * SHIPPING.freeShippingThresholdCents or more of cards ships free and
 * tracked, whatever the browser asked for.
 */
export function FreeShippingNote({ subtotalCents }: { subtotalCents: number }) {
  const gap = amountUntilFreeShipping(subtotalCents);
  const threshold = formatCentsShort(SHIPPING.freeShippingThresholdCents);

  if (gap === 0) {
    return (
      <p className="gg-alert gg-alert-ok" role="status" style={{ margin: "0.5rem 0" }}>
        <strong>Free tracked shipping.</strong> Orders of {threshold} or more ship free with
        tracking, automatically.
      </p>
    );
  }
  return (
    <p className="gg-card-meta" style={{ margin: "0.5rem 0" }}>
      Add {formatCents(gap)} more and your order ships free with tracking (orders of {threshold} or
      more).
    </p>
  );
}
