import { Icon } from "../ui/Icon";
import { formatCents } from "../../utils/format";
import { CONDITION_LABELS, FINISH_LABELS } from "../../utils/labels";
import type { PickupRequestItem } from "../../types";

// One card on a pickup list (kiosk request or yard sale list): a checkbox to
// tick it off once it's pulled, where it's kept, its price (the yard sale
// price with the website price struck through, for yard sale lists) and an
// × to take it off the list, which puts it back on the website.

export function PickupItemRow({
  item,
  priceCents,
  salePriceCents = null,
  listLabel,
  onToggle,
  onRemove,
}: {
  item: PickupRequestItem;
  /** Price of one copy. */
  priceCents: number;
  /** Yard sale price of one copy, when the list has a discount. */
  salePriceCents?: number | null;
  /** "list #14" or "Ann's request", for the remove button's label. */
  listLabel: string;
  onToggle: () => void;
  onRemove: () => void;
}) {
  const id = `pickup-item-${item.id}`;
  const discounted = salePriceCents !== null && salePriceCents < priceCents;
  return (
    <div className={`gg-pickup-row${item.pulled ? " gg-pickup-row--pulled" : ""}`}>
      <input id={id} type="checkbox" checked={item.pulled} onChange={onToggle} />
      <label htmlFor={id} className="gg-pickup-row__body">
        <span className="gg-pickup-row__name">
          {item.cardName}
          {item.quantity > 1 && <strong> × {item.quantity}</strong>}
        </span>
        <span className="gg-muted">
          {item.setName ?? item.setCode?.toUpperCase()}
          {item.collectorNumber ? ` #${item.collectorNumber}` : ""} · {CONDITION_LABELS[item.condition]} ·{" "}
          {FINISH_LABELS[item.finish]}
        </span>
        {item.storageLocation && (
          <span className="gg-pickup-row__where">
            <Icon name="box" size={13} /> {item.storageLocation}
          </span>
        )}
        {!item.available && (
          <span className="gg-pickup-row__warn">No longer for sale. Take it off the list.</span>
        )}
      </label>
      <span className="gg-pickup-row__price">
        <span className={discounted ? "gg-pickup-row__sale" : undefined}>
          {formatCents((discounted ? (salePriceCents as number) : priceCents) * item.quantity)}
        </span>
        {discounted && (
          <s className="gg-pickup-row__was">
            <span className="gg-visually-hidden">Regular price </span>
            {formatCents(priceCents * item.quantity)}
          </s>
        )}
      </span>
      <button
        type="button"
        className="gg-icon-btn gg-pickup-row__remove"
        onClick={onRemove}
        aria-label={`Take ${item.cardName} off ${listLabel}`}
        title="Take off the list"
      >
        <Icon name="close" size={16} />
      </button>
    </div>
  );
}
