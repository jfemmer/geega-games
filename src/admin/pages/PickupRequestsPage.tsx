import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PageHeader } from "../components/layout/PageHeader";
import { Button } from "../components/ui/Button";
import { Badge } from "../components/ui/Badge";
import { Spinner } from "../components/ui/States";
import { EmptyState } from "../components/ui/States";
import { ConfirmDialog } from "../components/ui/ConfirmDialog";
import { Icon } from "../components/ui/Icon";
import { PosPaymentStep, PosReceipt, usePosCheckoutState } from "../components/pos/PosShared";
import { PickupItemRow } from "../components/pickup/PickupItemRow";
import { YardSaleListCard } from "../components/pickup/YardSaleListCard";
import { yardSaleListTotals } from "../utils/yardSaleLists";
import { RemoveCardDialog, YardSaleCompleteDialog } from "../components/pickup/PickupDialogs";
import { orderRepository, pickupRequestRepository, posRepository } from "../repositories";
import { useToast } from "../hooks/useToast";
import { usePosTerminal } from "../hooks/usePosTerminal";
import { ADMIN_BASE } from "../hooks/useRouter";
import { formatCents } from "../utils/format";
import { YARD_SALE_PAYMENT_LABELS, yardSaleTermsLine, type YardSalePaymentMethod } from "../../store/lib/yardSale";
import type { PickupQueue, PickupRequest, PickupRequestItem, PosSaleResult } from "../types";

// The staff-facing queue of pickup lists, from two places:
//
//   * the in-store kiosk (src/store/pages/KioskPage.tsx): a customer at a
//     store computer builds a list; staff pull the cards, mark it ready, then
//     collect payment at the register, which converts it into a real order
//     (pos_complete_pickup_sale) at LIVE prices;
//   * the yard sale page (src/store/pages/YardSalePage.tsx): a shopper scans
//     the QR code and sends a list from their phone. Staff grab the cards and
//     tap Complete when the shopper pays in person (cash or Venmo, outside
//     the site), which records the sale with the yard sale discount and takes
//     the cards off the website (yard_sale_complete_list).
//
// Either way the cards are held from the moment the list is sent, and any
// card can be taken off a list (it goes straight back on the website). The
// page refreshes itself while it's open, so new lists show up on their own.

type PaymentPhase = "pay" | "confirming" | "done";

const REFRESH_MS = 15_000;
const SEARCH_FROM = 4;

const EMPTY_QUEUE: PickupQueue = { requests: [], yardSales: [], taxBps: 0 };

function matches(request: PickupRequest, query: string): boolean {
  const q = query.trim().toLowerCase().replace(/^#/, "");
  if (!q) return true;
  if (request.pickupNumber !== null && String(request.pickupNumber) === q) return true;
  return request.customerName.toLowerCase().includes(q);
}

export function PickupRequestsPage({ onNavigate }: { onNavigate?: (to: string) => void } = {}) {
  const toast = useToast();
  const [queue, setQueue] = useState<PickupQueue>(EMPTY_QUEUE);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [cancelTarget, setCancelTarget] = useState<PickupRequest | null>(null);
  const [removeTarget, setRemoveTarget] = useState<{ request: PickupRequest; item: PickupRequestItem } | null>(null);
  const [completeTarget, setCompleteTarget] = useState<PickupRequest | null>(null);

  const [activeId, setActiveId] = useState<string | null>(null);
  const [paymentPhase, setPaymentPhase] = useState<PaymentPhase>("pay");
  const [sale, setSale] = useState<PosSaleResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const checkout = usePosCheckoutState();
  const terminal = usePosTerminal();

  // Don't swap the list out from under a dialog or a register payment.
  const pausedRef = useRef(false);
  pausedRef.current = !!(activeId || cancelTarget || removeTarget || completeTarget);

  // quiet: a background refresh, no error toast (the next one may work).
  const reload = useCallback(
    async (quiet = false) => {
      try {
        setQueue(await pickupRequestRepository.list());
      } catch (err) {
        if (!quiet) toast.error(err instanceof Error ? err.message : "Could not load pickup requests.");
      } finally {
        setLoading(false);
      }
    },
    [toast],
  );

  useEffect(() => {
    let alive = true;
    pickupRequestRepository
      .list()
      .then((next) => {
        if (alive) setQueue(next);
      })
      .catch((err) => {
        if (alive) toast.error(err instanceof Error ? err.message : "Could not load pickup requests.");
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [toast]);

  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === "visible" && !pausedRef.current) void reload(true);
    };
    const timer = window.setInterval(refresh, REFRESH_MS);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [reload]);

  const requests = queue.requests;
  const salesById = useMemo(() => new Map(queue.yardSales.map((s) => [s.id, s])), [queue.yardSales]);
  const activeSale = queue.yardSales.find((s) => s.active) ?? null;
  const leftOpen = requests.filter((r) => r.yardSaleId && !salesById.get(r.yardSaleId)?.active).length;
  const shown = requests.filter((r) => matches(r, search));

  function updateRequest(requestId: string, change: (r: PickupRequest) => PickupRequest) {
    setQueue((q) => ({ ...q, requests: q.requests.map((r) => (r.id === requestId ? change(r) : r)) }));
  }

  function dropRequest(requestId: string) {
    setQueue((q) => ({ ...q, requests: q.requests.filter((r) => r.id !== requestId) }));
  }

  async function toggleItem(requestId: string, itemId: string) {
    updateRequest(requestId, (r) => ({
      ...r,
      items: r.items.map((it) => (it.id === itemId ? { ...it, pulled: !it.pulled } : it)),
    }));
    try {
      await pickupRequestRepository.toggleItem(itemId);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not update that item.");
      void reload(true);
    }
  }

  async function markReady(requestId: string) {
    try {
      await pickupRequestRepository.markReady(requestId);
      updateRequest(requestId, (r) => ({ ...r, status: "ready" }));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not mark this request ready.");
    }
  }

  async function confirmCancel() {
    if (!cancelTarget) return;
    const target = cancelTarget;
    try {
      await pickupRequestRepository.cancel(target.id);
      toast.info(
        target.pickupNumber !== null
          ? `List #${target.pickupNumber} cancelled. Its cards are back on the website.`
          : "Pickup request cancelled and stock released.",
      );
      dropRequest(target.id);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not cancel this request.");
    } finally {
      setCancelTarget(null);
    }
  }

  async function confirmRemove(quantity: number | null) {
    if (!removeTarget) return;
    const { request, item } = removeTarget;
    try {
      const result = await pickupRequestRepository.removeItem(item.id, quantity);
      if (result.listClosed) {
        toast.info(
          `${request.pickupNumber !== null ? `List #${request.pickupNumber}` : "That request"} had no cards left, so it was closed.`,
        );
        dropRequest(request.id);
      } else {
        toast.info(`${result.cardName} is back on the website.`);
        updateRequest(request.id, (r) => ({
          ...r,
          items: r.items
            .map((it) => (it.id === item.id ? { ...it, quantity: it.quantity - result.removed } : it))
            .filter((it) => it.quantity > 0),
        }));
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not take that card off the list.");
      void reload(true);
    } finally {
      setRemoveTarget(null);
    }
  }

  async function confirmComplete(method: YardSalePaymentMethod) {
    if (!completeTarget) return;
    const target = completeTarget;
    try {
      const result = await pickupRequestRepository.completeYardSaleList(target.id, method);
      toast.success(
        `List #${target.pickupNumber} complete: ${formatCents(result.totalCents)} by ${YARD_SALE_PAYMENT_LABELS[method]}. Those cards are off the website.`,
      );
      dropRequest(target.id);
      setCompleteTarget(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not complete this list.");
      setCompleteTarget(null);
      void reload(true);
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
    void reload();
  }

  if (loading) {
    return (
      <div className="gg-page">
        <Spinner label="Loading pickup requests" />
      </div>
    );
  }

  const completeTotals =
    completeTarget && completeTarget.yardSaleId
      ? yardSaleListTotals(
          completeTarget,
          salesById.get(completeTarget.yardSaleId)?.discountPercent ?? 0,
          queue.taxBps,
        )
      : null;

  return (
    <div className="gg-page">
      <PageHeader
        title="Pickup Requests"
        description="Lists from the in-store kiosk and the yard sale page. Grab each card and check it off. Kiosk requests are paid at the register; complete a yard sale list when they pay you."
      />

      {activeSale && (
        <div className="gg-inline-note gg-pickup-salebar" role="status">
          <Icon name="tag" size={16} />
          <span>
            <strong>Yard sale on</strong> until{" "}
            {new Date(activeSale.endsAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })} ·{" "}
            {yardSaleTermsLine(activeSale.minPriceCents, activeSale.discountPercent)}
          </span>
          <a
            href={`${ADMIN_BASE}/yard-sale`}
            onClick={(e) => {
              if (!onNavigate) return;
              e.preventDefault();
              onNavigate(`${ADMIN_BASE}/yard-sale`);
            }}
          >
            Yard Sale Mode
          </a>
        </div>
      )}
      {leftOpen > 0 && (
        <div className="gg-inline-note gg-inline-note--warning" role="alert">
          The yard sale is over, but {leftOpen === 1 ? "1 list is" : `${leftOpen} lists are`} still open. Complete
          the ones that were paid for and cancel the rest, so the website shows the right stock.
        </div>
      )}

      {requests.length >= SEARCH_FROM && (
        <div className="gg-pickup-search">
          <label htmlFor="pickup-search" className="gg-visually-hidden">
            Find a list
          </label>
          <input
            id="pickup-search"
            type="search"
            className="gg-input"
            placeholder="Find a list by number or name"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      )}

      {requests.length === 0 ? (
        <EmptyState
          icon="package"
          title="No pickup requests waiting"
          message="Lists sent from the kiosk or the yard sale page show up here."
        />
      ) : shown.length === 0 ? (
        <EmptyState icon="search" title="No list matches" message="Try the list number or the shopper's first name." />
      ) : (
        <div className="gg-pickup-list">
          {shown.map((request) => {
            if (request.yardSaleId) {
              return (
                <YardSaleListCard
                  key={request.id}
                  request={request}
                  sale={salesById.get(request.yardSaleId)}
                  taxBps={queue.taxBps}
                  onToggle={(itemId) => void toggleItem(request.id, itemId)}
                  onRemove={(item) => setRemoveTarget({ request, item })}
                  onCancel={() => setCancelTarget(request)}
                  onComplete={() => setCompleteTarget(request)}
                />
              );
            }
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
                        <PickupItemRow
                          key={item.id}
                          item={item}
                          priceCents={item.unitPriceCents}
                          listLabel={`${request.customerName}'s request`}
                          onToggle={() => void toggleItem(request.id, item.id)}
                          onRemove={() => setRemoveTarget({ request, item })}
                        />
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
                          onClick={() => void markReady(request.id)}
                        >
                          Mark ready
                        </Button>
                      )}
                      {request.status === "ready" && (
                        <Button variant="primary" size="sm" onClick={() => void startPayment(request)}>
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
        title={cancelTarget?.pickupNumber != null ? `Cancel list #${cancelTarget.pickupNumber}?` : "Cancel this pickup request?"}
        message={
          cancelTarget?.pickupNumber != null
            ? "Every card on it goes back on the website. Only do this if they didn't buy them."
            : "This releases the held cards back to stock. The customer will need to start over if they still want them."
        }
        confirmLabel={cancelTarget?.pickupNumber != null ? "Cancel list" : "Cancel request"}
        tone="danger"
        onConfirm={confirmCancel}
        onCancel={() => setCancelTarget(null)}
      />
      <RemoveCardDialog
        target={
          removeTarget
            ? {
                item: removeTarget.item,
                listLabel:
                  removeTarget.request.pickupNumber !== null
                    ? `list #${removeTarget.request.pickupNumber}`
                    : `${removeTarget.request.customerName}'s request`,
              }
            : null
        }
        onConfirm={confirmRemove}
        onCancel={() => setRemoveTarget(null)}
      />
      <YardSaleCompleteDialog
        key={completeTarget?.id ?? "none"}
        request={completeTarget}
        totalCents={completeTotals?.totalCents ?? 0}
        onConfirm={confirmComplete}
        onCancel={() => setCompleteTarget(null)}
      />
    </div>
  );
}
