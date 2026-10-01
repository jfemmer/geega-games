import { useEffect, useState } from "react";
import { Modal } from "../components/ui/Modal";
import { Button } from "../components/ui/Button";
import { TextField, SelectField } from "../components/ui/Field";
import { Icon } from "../components/ui/Icon";
import { orderRepository } from "../repositories";
import { useToast } from "../hooks/useToast";
import { useCurrentAdmin } from "../hooks/useCurrentAdmin";
import { formatCents } from "../utils/format";
import {
  PWE_LABEL_FORMATS,
  hasPrintableAddress,
  type PweLabelFormat,
} from "../utils/shippingLabels";
import type { Order, ShippingCarrier } from "../types";

const CARRIERS: ShippingCarrier[] = ["USPS", "UPS", "FedEx", "Other"];

// PWE (Plain White Envelope) orders are, by design, never tracked — the
// customer chose that shipping method precisely because it's cheaper and
// untracked. Requiring a carrier/tracking number here would force staff to
// invent fake tracking data, which the storefront's "Track My Order" would
// then present to the customer as real. So: `tracked` orders buy a real
// postage label (or fall back to typing in a carrier + tracking number from
// one bought elsewhere); `pwe` orders print a 4×6 address label for the
// envelope, with no postage and no tracking.
//
// Printing is one click either way (LabelPrintView, opened by the Orders page
// through onPrintLabel). Marking an order shipped emails the customer
// (server side, see api/_lib/orderStatusEmail.ts); the preview at the bottom
// shows what they get.

/** Whether the server logged a shipped email for this order. */
function shippedEmailSent(order: Order): boolean {
  return order.emails.some((e) => e.emailType === "order_shipped");
}

export function ShipModal({
  order,
  open,
  onClose,
  onShipped,
  onPrintLabel,
  pweFormat,
  onPweFormatChange,
  easypostConnected,
}: {
  order: Order | null;
  open: boolean;
  onClose: () => void;
  onShipped: (updated: Order) => void;
  /** Opens the print dialog for this order's label (envelope or postage). */
  onPrintLabel: (order: Order) => void;
  pweFormat: PweLabelFormat;
  onPweFormatChange: (format: PweLabelFormat) => void;
  /** Null until known. False: EASYPOST_API_KEY isn't set, labels can't be bought here. */
  easypostConnected: boolean | null;
}) {
  const toast = useToast();
  const currentAdmin = useCurrentAdmin();
  const [carrier, setCarrier] = useState<ShippingCarrier>("USPS");
  const [tracking, setTracking] = useState("");
  const [busy, setBusy] = useState(false);
  const [buyingLabel, setBuyingLabel] = useState(false);
  const [labelError, setLabelError] = useState<string | null>(null);

  // ShipModal stays mounted across orders (no `key` in OrdersPage), so
  // without this a tracking number/carrier typed for one order -- or a
  // label error from one order -- would still be sitting here when a
  // different order's Ship modal opens, and "Mark shipped" would submit it
  // onto the wrong order. Resync whenever the selected order changes.
  useEffect(() => {
    setCarrier("USPS");
    setTracking("");
    setLabelError(null);
  }, [order?.id]);

  if (!order) return null;

  const isPwe = order.shippingMethod === "pwe";
  const addressOk = hasPrintableAddress(order);
  const firstName = order.customerName.split(" ")[0] || "there";

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
      const emailed = shippedEmailSent(updated)
        ? " The customer was emailed."
        : " No email: the customer turned order emails off.";
      toast.success(
        isPwe
          ? `${order.orderNumber} marked shipped (Plain White Envelope, no tracking).${emailed}`
          : `${order.orderNumber} marked shipped.${emailed}`,
      );
      onShipped(updated);
      setTracking("");
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not mark the order shipped.");
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
        `Label bought: ${updated.carrier} ${updated.trackingNumber}. ${order.orderNumber} marked shipped${
          shippedEmailSent(updated) ? " and the customer emailed." : "."
        }`,
      );
      onShipped(updated);
      onClose();
      onPrintLabel(updated);
    } catch (err) {
      setLabelError(err instanceof Error ? err.message : "Could not purchase a shipping label.");
    } finally {
      setBuyingLabel(false);
    }
  }

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
        </div>
      }
    >
      <div className="gg-ship">
        <p className="gg-tag" style={{ marginBottom: "0.75rem" }}>
          Shipping method: <strong>{isPwe ? "Plain White Envelope" : "Tracked"}</strong>
        </p>

        {!addressOk && (
          <div className="gg-alert gg-alert-warn" role="note" style={{ marginBottom: "0.75rem" }}>
            This order&rsquo;s shipping address is incomplete, so there&rsquo;s nothing to print a
            label with. Check the address with the customer first.
          </div>
        )}

        {isPwe ? (
          <>
            <p className="gg-muted">
              The customer chose Plain White Envelope, which has no tracking. Print the envelope, add
              a stamp, and mark it shipped.
            </p>
            <div className="gg-ship__format">
              <SelectField
                label="Envelope size"
                value={pweFormat}
                onChange={(e) => onPweFormatChange(e.target.value as PweLabelFormat)}
              >
                {PWE_LABEL_FORMATS.map((f) => (
                  <option key={f.value} value={f.value}>
                    {f.label}
                  </option>
                ))}
              </SelectField>
            </div>
            <div className="gg-drawer-actions__buttons" style={{ margin: "0.75rem 0" }}>
              <Button
                variant="secondary"
                icon="printer"
                disabled={!addressOk}
                onClick={() => onPrintLabel(order)}
              >
                Print envelope
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
              {easypostConnected === false ? (
                <p className="gg-muted">
                  Label buying isn&rsquo;t connected yet. Add your EasyPost API key as{" "}
                  <code>EASYPOST_API_KEY</code> in Vercel to buy USPS labels here (and send delivery
                  emails automatically). Until then, buy the label elsewhere and enter its tracking
                  number below.
                </p>
              ) : (
                <p className="gg-muted">
                  Buys USPS postage through EasyPost for a standard small mailer, marks the order
                  shipped, emails the customer their tracking number, and opens the print dialog.
                </p>
              )}
              <Button
                variant="primary"
                icon="printer"
                loading={buyingLabel}
                disabled={easypostConnected === false || !addressOk}
                onClick={handleBuyLabel}
              >
                Buy &amp; print label
              </Button>
              {labelError && (
                <div className="gg-alert gg-alert-error" role="alert" style={{ marginTop: "0.6rem" }}>
                  {labelError}
                </div>
              )}
            </div>

            <details className="gg-ship__manual" open={easypostConnected === false}>
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
            <Icon name="printer" size={16} />
            <div>
              A label was already bought for this order
              {order.postageCostCents != null ? ` (${formatCents(order.postageCostCents)} postage)` : ""}.{" "}
              <button type="button" className="gg-linkbutton" onClick={() => onPrintLabel(order)}>
                Print it again
              </button>
            </div>
          </div>
        )}

        <div className="gg-emailpreview">
          <div className="gg-emailpreview__head">
            <Icon name="mail" size={16} />
            <span>Email to {order.customerEmail ?? "the customer"}</span>
            <span className="gg-tag gg-tag--auto">Sent when it&rsquo;s marked shipped</span>
          </div>
          <div className="gg-emailpreview__body">
            <p>
              <strong>Your order has shipped!</strong>
            </p>
            <p>Hi {firstName},</p>
            <p>Your cards are on their way to you.</p>
            {isPwe ? (
              <p>
                This order shipped via Plain White Envelope, which does not include tracking.
                We&rsquo;ll check in after it&rsquo;s had time to arrive.
              </p>
            ) : (
              <p>
                Carrier: {carrier}
                <br />
                Tracking number: {tracking.trim() || "(from the label)"}
              </p>
            )}
            <p className="gg-muted">
              Customers who turned off order emails in their account don&rsquo;t get it.
            </p>
          </div>
        </div>
      </div>
    </Modal>
  );
}
