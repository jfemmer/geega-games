import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import { formatCents } from "../../utils/format";
import { PickupItemRow } from "./PickupItemRow";
import { yardSalePriceCents } from "../../../store/lib/yardSale";
import { livePriceCents, yardSaleListTotals } from "../../utils/yardSaleLists";
import type { PickupRequest, PickupRequestItem, PickupYardSale } from "../../types";

// A list a shopper sent from /yard-sale, in Pickup Requests: the pickup
// number their phone shows, each card with where it's kept and its yard sale
// price, and the total Complete will record. There's no "ready" step: grab
// the cards, then Complete when they pay (cash or Venmo, outside the site).

function timeOf(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

export function YardSaleListCard({
  request,
  sale,
  taxBps,
  onToggle,
  onRemove,
  onCancel,
  onComplete,
}: {
  request: PickupRequest;
  sale: PickupYardSale | undefined;
  taxBps: number;
  onToggle: (itemId: string) => void;
  onRemove: (item: PickupRequestItem) => void;
  onCancel: () => void;
  onComplete: () => void;
}) {
  const discount = sale?.discountPercent ?? 0;
  const totals = yardSaleListTotals(request, discount, taxBps);
  const cards = request.items.reduce((sum, i) => sum + i.quantity, 0);
  const pulled = request.items.filter((i) => i.pulled).length;
  const blocked = request.items.some((i) => !i.available);
  const listLabel = `list #${request.pickupNumber}`;

  return (
    <div className="gg-card gg-pickup-card gg-pickup-card--yard">
      <div className="gg-pickup-card__head">
        <div className="gg-pickup-card__who">
          <span className="gg-pickup-card__number" aria-label={`List number ${request.pickupNumber}`}>
            #{request.pickupNumber}
          </span>
          <span>
            <strong>{request.customerName}</strong>
            <span className="gg-muted"> · sent {timeOf(request.createdAt)}</span>
          </span>
        </div>
        <Badge tone={sale?.active ? "info" : "warning"}>{sale?.active ? "Yard sale" : "Sale over"}</Badge>
      </div>

      <div className="gg-pickup-card__items">
        {request.items.map((item) => (
          <PickupItemRow
            key={item.id}
            item={item}
            priceCents={livePriceCents(item)}
            salePriceCents={discount > 0 ? yardSalePriceCents(livePriceCents(item), discount) : null}
            listLabel={listLabel}
            onToggle={() => onToggle(item.id)}
            onRemove={() => onRemove(item)}
          />
        ))}
      </div>

      <dl className="gg-pickup-card__totals">
        <div>
          <dt>
            {cards} card{cards === 1 ? "" : "s"} · {pulled} of {request.items.length} grabbed
          </dt>
          <dd />
        </div>
        {totals.discountCents > 0 && (
          <div>
            <dt>Yard sale discount ({discount}%)</dt>
            <dd>−{formatCents(totals.discountCents)}</dd>
          </div>
        )}
        {totals.taxCents > 0 && (
          <div>
            <dt>Tax</dt>
            <dd>{formatCents(totals.taxCents)}</dd>
          </div>
        )}
        <div className="gg-pickup-card__total">
          <dt>Total</dt>
          <dd>{formatCents(totals.totalCents)}</dd>
        </div>
      </dl>

      <div className="gg-pickup-card__actions">
        {blocked && <span className="gg-pickup-card__hint">Take the cards that are no longer for sale off first.</span>}
        <Button variant="ghost" size="sm" onClick={onCancel}>
          Cancel list
        </Button>
        <Button variant="primary" size="sm" icon="check" disabled={blocked} onClick={onComplete}>
          Complete
        </Button>
      </div>
    </div>
  );
}
