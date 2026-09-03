import { useState } from "react";
import { Modal } from "../components/ui/Modal";
import { Button } from "../components/ui/Button";
import { TextField, SelectField } from "../components/ui/Field";
import { Icon } from "../components/ui/Icon";
import { orderRepository } from "../repositories";
import { useToast } from "../hooks/useToast";
import { CURRENT_ADMIN } from "../data/session.mock";
import type { Order, ShippingCarrier } from "../types";

const CARRIERS: ShippingCarrier[] = ["USPS", "UPS", "FedEx", "Other"];

export function ShipModal({
  order,
  open,
  onClose,
  onShipped,
}: {
  order: Order | null;
  open: boolean;
  onClose: () => void;
  onShipped: (updated: Order) => void;
}) {
  const toast = useToast();
  const [carrier, setCarrier] = useState<ShippingCarrier>("USPS");
  const [tracking, setTracking] = useState("");
  const [busy, setBusy] = useState(false);

  async function confirmShip() {
    if (!order) return;
    if (!tracking.trim()) {
      toast.error("Enter a tracking number.");
      return;
    }
    setBusy(true);
    try {
      const updated = await orderRepository.ship(
        order.id,
        carrier,
        tracking.trim(),
        CURRENT_ADMIN.name,
      );
      toast.success(
        `${order.orderNumber} marked shipped. Confirmation email simulated (not sent).`,
      );
      onShipped(updated);
      setTracking("");
      onClose();
    } catch {
      toast.error("Could not mark the order shipped.");
    } finally {
      setBusy(false);
    }
  }

  if (!order) return null;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Ship ${order.orderNumber}`}
      size="md"
      footer={
        <div className="gg-drawer-actions__buttons">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" icon="truck" loading={busy} onClick={confirmShip}>
            Mark shipped
          </Button>
        </div>
      }
    >
      <div className="gg-ship">
        <div className="gg-form-grid">
          <SelectField
            label="Carrier"
            value={carrier}
            onChange={(e) => setCarrier(e.target.value as ShippingCarrier)}
          >
            {CARRIERS.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </SelectField>
          <TextField
            label="Tracking number"
            value={tracking}
            autoFocus
            onChange={(e) => setTracking(e.target.value)}
            placeholder="e.g. 9400 1000 0000 0000 0000 00"
          />
        </div>

        <div className="gg-emailpreview">
          <div className="gg-emailpreview__head">
            <Icon name="mail" size={16} />
            <span>Customer email preview</span>
            <span className="gg-tag gg-tag--mock">Not sent in mock</span>
          </div>
          <div className="gg-emailpreview__body">
            <p>Hi {order.customerName.split(" ")[0]},</p>
            <p>
              Great news — your Geega Games order {order.orderNumber} is on its
              way via {carrier}
              {tracking.trim() ? `, tracking ${tracking.trim()}` : ""}.
            </p>
            <ul>
              {order.items.map((it) => (
                <li key={it.id}>
                  {it.quantity}× {it.cardName} ({it.condition})
                </li>
              ))}
            </ul>
            <p>Thanks for playing with us.</p>
          </div>
        </div>
      </div>
    </Modal>
  );
}
