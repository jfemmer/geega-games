import { useEffect, useState } from "react";
import { Button } from "../components/ui/Button";
import { Badge } from "../components/ui/Badge";
import { Spinner } from "../components/ui/States";
import { EmptyState } from "../components/ui/States";
import { ConfirmDialog } from "../components/ui/ConfirmDialog";
import { PosPaymentStep, PosReceipt, usePosCheckoutState } from "../components/pos/PosShared";
import { orderRepository, pickupRequestRepository, posRepository } from "../repositories";
import { useToast } from "../hooks/useToast";
import { usePosTerminal } from "../hooks/usePosTerminal";
import { formatCents } from "../utils/format";
import { CONDITION_LABELS, FINISH_LABELS } from "../utils/labels";
import type { PickupRequest, PosSaleResult } from "../types";

// The staff-facing queue for kiosk-submitted pickup requests (see
// src/store/pages/KioskPage.tsx — a customer, standing in the shop at a
// store computer, searches inventory themselves and submits a list; the
// cards are held via a reservation so nothing gets sold out from under the
// request). Staff pull the physical cards, check them off here, mark the
// request ready, then collect payment — which converts it into a real order
// (pos_complete_pickup_sale) at LIVE prices and releases the hold, same
// payment UI as the register.

type PaymentPhase = "pay" | "confirming" | "done";

export function PickupRequestsPage() {
  const toast = useToast();
  const [requests, setRequests] = useState<PickupRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [cancelTarget, setCancelTarget] = useState<PickupRequest | null>(null);

  const [activeId, setActiveId] = useState<string | null>(null);
  const [paymentPhase, setPaymentPhase] = useState<PaymentPhase>("pay");
  const [sale, setSale] = useState<PosSaleResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const checkout = usePosCheckoutState();
  const terminal = usePosTerminal();

  async function reload() {
    setLoading(true);
    try {
      setRequests(await pickupRequestRepository.list());
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not load pickup requests.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function toggleItem(itemId: string) {
    setRequests((prev) =>
      prev.map((r) => ({
        ...r,
        items: r.items.map((it) => (it.id === itemId ? { ...it, pulled: !it.pulled } : it)),
      })),
    );
    try {
      await pickupRequestRepository.toggleItem(itemId);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not update that item.");
      reload();
    }
  }

  async function markReady(requestId: string) {
    try {
      await pickupRequestRepository.markReady(requestId);
      setRequests((prev) => prev.map((r) => (r.id === requestId ? { ...r, status: "ready" } : r)));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not mark this request ready.");
    }
  }

  async function confirmCancel() {
    if (!cancelTarget) return;
    try {
      await pickupRequestRepository.cancel(cancelTarget.id);
      toast.info("Pickup request cancelled and stock released.");
      setRequests((prev) => prev.filter((r) => r.id !== cancelTarget.id));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not cancel this request.");
    } finally {
      setCancelTarget(null);
    }
  }

  async function startPayment(request: PickupRequest) {
    setError(null);
    try {
      const result = await pickupRequestRepository.completeSale(request.id);
      setSale(result);
      setActiveId(request.id);
      setPaymentPhase("pay");
      checkout.reset();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not start checkout for this request.");
    }
  }

  async function payCash() {
    if (!sale) return;
    const tendered = Math.round(parseFloat(checkout.cashTendered || "0") * 100);
    if (!Number.isFinite(tendered) || tendered < sale.amountDueCents) {
      setError("Cash tendered must cover the amount due.");
      return;
    }
    setError(null);
    try {
      const res = await posRepository.markCashPaid(sale.orderId, tendered);
      checkout.setChangeCents(res.changeCents);
      checkout.setPaidVia("cash");
      setPaymentPhase("done");
      toast.success("Pickup paid and complete.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not record the cash payment.");
    }
  }

  async function payCard() {
    if (!sale) return;
    setError(null);
    try {
      const { clientSecret } = await posRepository.terminalCreateIntent(sale.orderId);
      await terminal.collectAndProcess(clientSecret);
      checkout.setPaidVia("card");
      setPaymentPhase("confirming");
      for (let i = 0; i < 8; i++) {
        await new Promise((r) => setTimeout(r, 1500));
        const order = await orderRepository.get(sale.orderId);
        if (order?.paymentStatus === "paid") break;
      }
      setPaymentPhase("done");
      toast.success("Pickup paid and complete.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Card payment failed.");
      setPaymentPhase("pay");
    }
  }

  async function voidActiveSale() {
    if (!sale) return;
    try {
      await posRepository.voidSale(sale.orderId, "Voided while collecting pickup payment");
      toast.info("Sale voided; stock restored.");
      finishActive();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not void the sale.");
    }
  }

  function finishActive() {
    setActiveId(null);
    setSale(null);
    setError(null);
    checkout.reset();
    reload();
  }

  if (loading) {
    return (
      <div className="gg-page">
        <Spinner label="Loading pickup requests" />
      </div>
    );
  }

  return (
    <div className="gg-page">
      <h1>Pickup Requests</h1>
      <p className="gg-muted">
        Submitted from the in-store kiosk. Pull each card, mark the request ready, then collect
        payment when the customer's ready to check out.
      </p>

      {requests.length === 0 ? (
        <EmptyState
          icon="package"
          title="No pickup requests waiting"
          message="Requests submitted at the kiosk will show up here."
        />
      ) : (
        <div className="gg-pickup-list">
          {requests.map((request) => {
            const isActive = activeId === request.id;
            const allPulled = request.items.every((it) => it.pulled);
            return (
              <div className="gg-card gg-pickup-card" key={request.id}>
                <div className="gg-pickup-card__head">
                  <div>
                    <strong>{request.customerName}</strong>
                    {request.phone && <span className="gg-muted"> · {request.phone}</span>}
                  </div>
                  <Badge tone={request.status === "ready" ? "success" : "warning"}>
                    {request.status === "ready" ? "Ready for pickup" : "Waiting"}
                  </Badge>
                </div>

                {isActive && sale ? (
                  <>
                    {error && (
                      <div className="gg-inline-note gg-inline-note--warning" role="alert">
                        {error}
                      </div>
                    )}
                    {paymentPhase === "pay" && (
                      <PosPaymentStep
                        sale={sale}
                        paymentMethod={checkout.paymentMethod}
                        setPaymentMethod={checkout.setPaymentMethod}
                        cashTendered={checkout.cashTendered}
                        setCashTendered={checkout.setCashTendered}
                        onPayCash={payCash}
                        onPayCard={payCard}
                        terminal={terminal}
                        onVoid={voidActiveSale}
                        voidLabel="Void this sale"
                      />
                    )}
                    {paymentPhase === "confirming" && (
                      <div className="gg-pos__confirming">
                        <Spinner label="Confirming payment" />
                      </div>
                    )}
                    {paymentPhase === "done" && (
                      <PosReceipt
                        sale={sale}
                        lines={request.items.map((it) => ({
                          id: it.id,
                          name: it.cardName,
                          quantity: it.quantity,
                          lineTotalCents: it.unitPriceCents * it.quantity,
                        }))}
                        customerLabel={request.customerName}
                        paidVia={checkout.paidVia}
                        changeCents={checkout.changeCents}
                        onNewSale={finishActive}
                        newSaleLabel="Done"
                      />
                    )}
                  </>
                ) : (
                  <>
                    <div className="gg-pickup-card__items">
                      {request.items.map((item) => (
                        <label className="gg-pickup-item" key={item.id}>
                          <input
                            type="checkbox"
                            checked={item.pulled}
                            onChange={() => toggleItem(item.id)}
                          />
                          <span className="gg-pickup-item__body">
                            <span>{item.cardName}</span>
                            <span className="gg-muted">
                              {item.setName ?? item.setCode} · {CONDITION_LABELS[item.condition]} ·{" "}
                              {FINISH_LABELS[item.finish]} · qty {item.quantity}
                            </span>
                          </span>
                          <span>{formatCents(item.unitPriceCents * item.quantity)}</span>
                        </label>
                      ))}
                    </div>
                    <div className="gg-pickup-card__actions">
                      <Button variant="ghost" size="sm" onClick={() => setCancelTarget(request)}>
                        Cancel
                      </Button>
                      {request.status === "waiting" && (
                        <Button
                          variant="secondary"
                          size="sm"
                          disabled={!allPulled}
                          onClick={() => markReady(request.id)}
                        >
                          Mark ready
                        </Button>
                      )}
                      {request.status === "ready" && (
                        <Button variant="primary" size="sm" onClick={() => startPayment(request)}>
                          Collect payment
                        </Button>
                      )}
                    </div>
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}

      <ConfirmDialog
        open={!!cancelTarget}
        title="Cancel this pickup request?"
        message="This releases the held cards back to stock. The customer will need to start over if they still want them."
        confirmLabel="Cancel request"
        tone="danger"
        onConfirm={confirmCancel}
        onCancel={() => setCancelTarget(null)}
      />
    </div>
  );
}
