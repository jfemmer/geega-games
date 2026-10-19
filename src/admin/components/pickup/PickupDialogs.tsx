import { useState } from "react";
import { Modal } from "../ui/Modal";
import { Button } from "../ui/Button";
import { formatCents } from "../../utils/format";
import { YARD_SALE_PAYMENT_LABELS, type YardSalePaymentMethod } from "../../../store/lib/yardSale";
import type { PickupRequest, PickupRequestItem } from "../../types";

// The two confirmations on Pickup Requests that change stock: completing a
// yard sale list (it's paid for, so its cards are sold) and taking a card
// off a list (it goes back on the website).

const METHODS: YardSalePaymentMethod[] = ["cash", "venmo"];

export function YardSaleCompleteDialog({
  request,
  totalCents,
  onConfirm,
  onCancel,
}: {
  request: PickupRequest | null;
  totalCents: number;
  onConfirm: (method: YardSalePaymentMethod) => Promise<void>;
  onCancel: () => void;
}) {
  const [method, setMethod] = useState<YardSalePaymentMethod>("cash");
  const [busy, setBusy] = useState(false);
  if (!request) return null;
  const cards = request.items.reduce((sum, i) => sum + i.quantity, 0);

  async function confirm() {
    setBusy(true);
    try {
      await onConfirm(method);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      onClose={busy ? () => {} : onCancel}
      title={`Complete list #${request.pickupNumber}?`}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onCancel} disabled={busy}>
            Not yet
          </Button>
          <Button variant="primary" icon="check" loading={busy} onClick={() => void confirm()}>
            Complete · {formatCents(totalCents)}
          </Button>
        </>
      }
    >
      <div className="gg-yardcomplete">
        <p className="gg-yardcomplete__summary">
          <strong>{request.customerName}</strong> · {cards} card{cards === 1 ? "" : "s"} ·{" "}
          <strong>{formatCents(totalCents)}</strong>
        </p>
        <div className="gg-yardcomplete__method">
          <span id="yardcomplete-method" className="gg-yardcomplete__label">
            How did they pay?
          </span>
          <div className="gg-tabs" role="radiogroup" aria-labelledby="yardcomplete-method">
            {METHODS.map((m) => (
              <button
                key={m}
                type="button"
                role="radio"
                aria-checked={method === m}
                className={`gg-tab ${method === m ? "gg-tab--active" : ""}`}
                disabled={busy}
                onClick={() => setMethod(m)}
              >
                {YARD_SALE_PAYMENT_LABELS[m]}
              </button>
            ))}
          </div>
        </div>
        <p className="gg-muted">
          These cards are marked sold and come off the website for good. Nothing is charged through the site.
        </p>
      </div>
    </Modal>
  );
}

export function RemoveCardDialog({
  target,
  onConfirm,
  onCancel,
}: {
  target: { item: PickupRequestItem; listLabel: string } | null;
  onConfirm: (quantity: number | null) => Promise<void>;
  onCancel: () => void;
}) {
  const [busy, setBusy] = useState<null | "one" | "all">(null);
  if (!target) return null;
  const { item, listLabel } = target;

  async function remove(kind: "one" | "all") {
    setBusy(kind);
    try {
      await onConfirm(kind === "one" ? 1 : null);
    } finally {
      setBusy(null);
    }
  }

  return (
    <Modal
      open
      onClose={busy ? () => {} : onCancel}
      title={`Take ${item.cardName} off ${listLabel}?`}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onCancel} disabled={!!busy}>
            Keep it
          </Button>
          {item.quantity > 1 && (
            <Button variant="secondary" loading={busy === "one"} disabled={!!busy} onClick={() => void remove("one")}>
              Take off 1
            </Button>
          )}
          <Button variant="danger" loading={busy === "all"} disabled={!!busy} onClick={() => void remove("all")}>
            {item.quantity > 1 ? `Take off all ${item.quantity}` : "Take it off"}
          </Button>
        </>
      }
    >
      <p className="gg-confirm__message">
        {item.quantity > 1 ? "The copies you take off go" : "It goes"} back on the website right away.
      </p>
    </Modal>
  );
}
