import { useState } from "react";
import { Modal } from "../components/ui/Modal";
import { Button } from "../components/ui/Button";
import { TextField, SelectField } from "../components/ui/Field";
import { Icon } from "../components/ui/Icon";
import { AddressLabelPrint } from "../components/orders/AddressLabelPrint";
import { orderRepository } from "../repositories";
import { useToast } from "../hooks/useToast";
import { useCurrentAdmin } from "../hooks/useCurrentAdmin";
import { formatCents } from "../utils/format";
import type { Order, ShippingCarrier } from "../types";

const CARRIERS: ShippingCarrier[] = ["USPS", "UPS", "FedEx", "Other"];

// PWE (Plain White Envelope) orders are, by design, never tracked — the
// customer chose that shipping method precisely because it's cheaper and
// untracked. Requiring a carrier/tracking number here would force staff to
// invent fake tracking data, which the storefront's "Track My Order" would
// then present to the customer as real. So: `tracked` orders can buy a real
// postage label (or fall back to typing in a carrier + tracking number from
// one bought elsewhere); `pwe` orders only ever get a plain address label
// with no postage and no tracking.
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
  const currentAdmin = useCurrentAdmin();
  const [carrier, setCarrier] = useState<ShippingCarrier>("USPS");
  const [tracking, setTracking] = useState("");
  const [busy, setBusy] = useState(false);
  const [buyingLabel, setBuyingLabel] = useState(false);
  const [labelError, setLabelError] = useState<string | null>(null);
  const [printingAddressLabel, setPrintingAddressLabel] = useState(false);

  if (!order) return null;

  const isPwe = order.shippingMethod === "pwe";

  async function confirmShip() {
    if (!order) return;
    if (!isPwe && !tracking.trim()) {
      toast.error("Enter a tracking number.");
      return;
    }
    setBusy(true);
    try {
      const updated = await orderRepository.ship(
        order.id,
        isPwe ? null : carrier,
        isPwe ? null : tracking.trim(),
        currentAdmin.name,
      );
      toast.success(
        isPwe
          ? `${order.orderNumber} marked shipped (Plain White Envelope — no tracking).`
          : `${order.orderNumber} marked shipped. No confirmation email is sent automatically.`,
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

  async function handleBuyLabel() {
    if (!order) return;
    setLabelError(null);
    setBuyingLabel(true);
    try {
      const updated = await orderRepository.buyLabel(order.id);
      toast.success(
        `Label purchased — ${updated.carrier} ${updated.trackingNumber}. ${order.orderNumber} marked shipped.`,
      );
      onShipped(updated);
      if (updated.labelUrl) window.open(updated.labelUrl, "_blank", "noopener,noreferrer");
      onClose();
    } catch (err) {
      setLabelError(err instanceof Error ? err.message : "Could not purchase a shipping label.");
    } finally {
      setBuyingLabel(false);
    }
  }

  return (
    <>
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
          </div>
        }
      >
        <div className="gg-ship">
          <p className="gg-tag" style={{ marginBottom: "0.75rem" }}>
            Shipping method: <strong>{isPwe ? "Plain White Envelope" : "Tracked"}</strong>
          </p>

          {isPwe ? (
            <>
              <div className="gg-alert gg-alert-warn" role="note">
                This order was placed with Plain White Envelope shipping, which is
                intentionally untracked. No carrier or tracking number is recorded —
                marking it shipped will not create fake tracking data.
              </div>
              <div className="gg-drawer-actions__buttons" style={{ margin: "0.75rem 0" }}>
                <Button variant="secondary" icon="box" onClick={() => setPrintingAddressLabel(true)}>
                  Print address label
                </Button>
                <Button variant="primary" icon="truck" loading={busy} onClick={confirmShip}>
                  Mark shipped
                </Button>
              </div>
            </>
          ) : (
            <>
              <div className="gg-ship__buylabel">
                <h4>Buy &amp; print a label</h4>
                <p className="gg-muted">
                  Buys real USPS postage via EasyPost using your saved return address and a
                  standard package weight, then marks this order shipped — no other apps needed.
                </p>
                <Button variant="primary" icon="truck" loading={buyingLabel} onClick={handleBuyLabel}>
                  Buy &amp; print label
                </Button>
                {labelError && (
                  <div className="gg-alert gg-alert-error" role="alert" style={{ marginTop: "0.6rem" }}>
                    {labelError}
                  </div>
                )}
              </div>

              <details className="gg-ship__manual">
                <summary>Or enter tracking manually</summary>
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
                    onChange={(e) => setTracking(e.target.value)}
                    placeholder="e.g. 9400 1000 0000 0000 0000 00"
                  />
                </div>
                <Button variant="secondary" loading={busy} onClick={confirmShip}>
                  Mark shipped
                </Button>
              </details>
            </>
          )}

          {order.labelUrl && (
            <div className="gg-inline-note gg-inline-note--info" style={{ marginBottom: "0.75rem" }}>
              <Icon name="download" size={16} />
              <div>
                A label was already purchased for this order
                {order.postageCostCents != null ? ` (${formatCents(order.postageCostCents)} postage)` : ""}.{" "}
                <a href={order.labelUrl} target="_blank" rel="noopener noreferrer">
                  Open label
                </a>
              </div>
            </div>
          )}

          <div className="gg-emailpreview">
            <div className="gg-emailpreview__head">
              <Icon name="mail" size={16} />
              <span>Customer email preview</span>
              <span className="gg-tag gg-tag--mock">Preview only — not sent</span>
            </div>
            <div className="gg-emailpreview__body">
              <p>Hi {order.customerName.split(" ")[0]},</p>
              <p>
                Great news — your Geega Games order {order.orderNumber} is on its
                way{" "}
                {isPwe
                  ? "via Plain White Envelope. This shipping method does not include tracking."
                  : `via ${carrier}${tracking.trim() ? `, tracking ${tracking.trim()}` : ""}.`}
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
      {printingAddressLabel && (
        <AddressLabelPrint order={order} onClose={() => setPrintingAddressLabel(false)} />
      )}
    </>
  );
}
