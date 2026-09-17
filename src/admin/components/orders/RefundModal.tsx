import { useEffect, useState } from "react";
import { Modal } from "../ui/Modal";
import { Button } from "../ui/Button";
import { TextField, TextArea } from "../ui/Field";
import { orderRepository } from "../../repositories";
import { useToast } from "../../hooks/useToast";
import { formatCents } from "../../utils/format";
import type { Order } from "../../types";

// Refunds a Stripe-paid order. Only ever shown to staff with the
// "orders.refund" capability (owner/administrator) — see OrdersPage.tsx.
// Server-side re-validates the same eligibility independently.
export function RefundModal({
  order,
  open,
  onClose,
  onRefunded,
}: {
  order: Order | null;
  open: boolean;
  onClose: () => void;
  onRefunded: (updated: Order) => void;
}) {
  const toast = useToast();
  const [mode, setMode] = useState<"full" | "partial">("full");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [restock, setRestock] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setMode("full");
      setAmount("");
      setReason("");
      setRestock(false);
    }
  }, [open, order?.id]);

  if (!order) return null;

  const amountDueCents = order.amountDueCents ?? order.totalCents;
  const alreadyRefundedCents = (order.refunds ?? []).reduce(
    (sum, r) => sum + r.amountCents,
    0,
  );
  const remainingCents = amountDueCents - alreadyRefundedCents;
  const eligible =
    order.paymentProvider === "stripe" &&
    order.paymentStatus !== "unpaid" &&
    remainingCents > 0;

  async function confirmRefund() {
    if (!order) return;
    let amountCents: number | undefined;
    if (mode === "partial") {
      const cents = Math.round(Number(amount) * 100);
      if (!Number.isFinite(cents) || cents <= 0) {
        toast.error("Enter a valid refund amount.");
        return;
      }
      if (cents > remainingCents) {
        toast.error(`Only ${formatCents(remainingCents)} is left to refund.`);
        return;
      }
      amountCents = cents;
    }
    setBusy(true);
    try {
      const updated = await orderRepository.refund(order.id, {
        amountCents,
        reason: reason.trim() || undefined,
        restock,
      });
      toast.success(
        mode === "full"
          ? `${order.orderNumber} refunded in full.`
          : `Refunded ${formatCents(amountCents ?? 0)} on ${order.orderNumber}.`,
      );
      onRefunded(updated);
      onClose();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Could not process the refund.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={`Refund ${order.orderNumber}`} size="sm">
      {!eligible ? (
        <p className="gg-muted">
          {remainingCents <= 0
            ? "This order has already been fully refunded."
            : "This order wasn't paid through Stripe, so it can't be refunded here — handle it manually and record the outcome in the internal notes."}
        </p>
      ) : (
        <div className="gg-form-stack">
          <p className="gg-muted">
            Charged {formatCents(amountDueCents)} via Stripe
            {alreadyRefundedCents > 0
              ? ` · ${formatCents(alreadyRefundedCents)} already refunded · ${formatCents(remainingCents)} left`
              : ""}
            .
          </p>

          <div className="gg-radiorow">
            <label className="gg-check-inline">
              <input
                type="radio"
                name="refund-mode"
                checked={mode === "full"}
                onChange={() => setMode("full")}
              />
              Full refund ({formatCents(remainingCents)})
            </label>
            <label className="gg-check-inline">
              <input
                type="radio"
                name="refund-mode"
                checked={mode === "partial"}
                onChange={() => setMode("partial")}
              />
              Partial amount
            </label>
          </div>

          {mode === "partial" && (
            <TextField
              label="Amount to refund (USD)"
              type="number"
              min={0.01}
              max={remainingCents / 100}
              step={0.01}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
            />
          )}

          <TextArea
            label="Reason (optional, internal only)"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={2}
          />

          <label className="gg-check-inline">
            <input
              type="checkbox"
              checked={restock}
              onChange={(e) => setRestock(e.target.checked)}
            />
            Return these cards to inventory
          </label>
        </div>
      )}

      <div className="gg-drawer-actions__buttons" style={{ marginTop: 16 }}>
        <Button variant="ghost" onClick={onClose}>
          Close
        </Button>
        {eligible && (
          <Button variant="danger" loading={busy} onClick={confirmRefund}>
            {mode === "full"
              ? `Refund ${formatCents(remainingCents)}`
              : "Refund amount"}
          </Button>
        )}
      </div>
    </Modal>
  );
}
