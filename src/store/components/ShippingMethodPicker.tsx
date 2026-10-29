import { FreeShippingNote } from "./FreeShippingNote";
import { SHIPPING, formatCents, qualifiesForFreeShipping, type ShippingMethod } from "../lib/money";

/**
 * The checkout's shipping choice.
 *
 * Under the free shipping threshold the customer picks tracked or Plain
 * White Envelope, and sees how much more gets free shipping. At or above it
 * there is nothing to pick: the order ships tracked for free (the server
 * does the same, see checkout_place_order_core), so the paid options are
 * replaced by a note saying so. The customer's earlier pick is kept, in
 * case the cart drops back under the threshold.
 */
export function ShippingMethodPicker({
  subtotalCents,
  method,
  onChange,
  trackedOnly = false,
}: {
  subtotalCents: number;
  method: ShippingMethod;
  onChange: (method: ShippingMethod) => void;
  /** The cart holds a consigned card: it ships tracked, with no envelope option. */
  trackedOnly?: boolean;
}) {
  if (qualifiesForFreeShipping(subtotalCents)) {
    return <FreeShippingNote subtotalCents={subtotalCents} />;
  }
  if (trackedOnly) {
    return (
      <>
        <p className="gg-check">Tracked ({formatCents(SHIPPING.trackedCents)})</p>
        <p className="gg-card-meta">Orders with a consigned card ship tracked, so we know when it arrives.</p>
        <FreeShippingNote subtotalCents={subtotalCents} />
      </>
    );
  }
  return (
    <>
      <label className="gg-check">
        <input
          type="radio"
          name="ship"
          checked={method === "tracked"}
          onChange={() => onChange("tracked")}
        />
        Tracked ({formatCents(SHIPPING.trackedCents)})
      </label>
      <label className="gg-check">
        <input
          type="radio"
          name="ship"
          checked={method === "pwe"}
          onChange={() => onChange("pwe")}
        />
        Plain White Envelope ({formatCents(SHIPPING.pweCents)}, untracked)
      </label>
      <FreeShippingNote subtotalCents={subtotalCents} />
    </>
  );
}
