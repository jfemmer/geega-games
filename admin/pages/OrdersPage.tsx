import { useEffect, useMemo, useState } from "react";
import { PageHeader } from "../components/layout/PageHeader";
import { SectionCard } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { Badge } from "../components/ui/Badge";
import { Icon } from "../components/ui/Icon";
import { SearchInput } from "../components/ui/Field";
import { Tabs } from "../components/ui/Nav";
import { DataTable, type Column } from "../components/ui/DataTable";
import { TableSkeleton, ErrorState, EmptyState } from "../components/ui/States";
import { Modal } from "../components/ui/Modal";
import { ConfirmDialog } from "../components/ui/ConfirmDialog";
import { ShipModal } from "./ShipModal";
import { useAsync } from "../hooks/useAsync";
import { useToast } from "../hooks/useToast";
import { orderRepository } from "../repositories";
import { CURRENT_ADMIN } from "../data/session.mock";
import {
  formatCents,
  formatDateTime,
  timeAgo,
  waitingSince,
} from "../utils/format";
import {
  ORDER_STATUS_LABELS,
  ORDER_STATUS_TONE,
  PAYMENT_STATUS_LABELS,
  PAYMENT_STATUS_TONE,
  EMAIL_STATUS_LABELS,
  EMAIL_STATUS_TONE,
} from "../utils/labels";
import type { Order, OrderQuery, OrderStatus } from "../types";

type TabKey =
  | "needs_packing"
  | "packing"
  | "ready_to_ship"
  | "shipped"
  | "delivered"
  | "cancelled"
  | "all";

const TAB_TO_STATUS: Record<TabKey, OrderQuery["status"]> = {
  needs_packing: "needs_packing",
  packing: "packing",
  ready_to_ship: "ready_to_ship",
  shipped: "shipped",
  delivered: "delivered",
  cancelled: "cancelled",
  all: "all",
};

export function OrdersPage({
  query,
  onNavigate,
}: {
  query: URLSearchParams;
  onNavigate: (path: string) => void;
}) {
  const toast = useToast();
  const [tab, setTab] = useState<TabKey>("needs_packing");
  const [search, setSearch] = useState("");
  const [detail, setDetail] = useState<Order | null>(null);
  const [shipOpen, setShipOpen] = useState(false);
  const [cancelTarget, setCancelTarget] = useState<Order | null>(null);
  const [counts, setCounts] = useState<Record<string, number>>({});

  const q: OrderQuery = useMemo(
    () => ({
      status: TAB_TO_STATUS[tab],
      search: search.trim() || undefined,
      sortBy: tab === "needs_packing" ? "waiting" : "created",
      sortDir: "desc",
    }),
    [tab, search],
  );

  const orders = useAsync(() => orderRepository.list(q), [q]);

  function refreshCounts() {
    orderRepository.counts().then(setCounts);
  }
  useEffect(() => {
    refreshCounts();
  }, [orders.data]);

  // Deep link ?order=<id>
  useEffect(() => {
    const id = query.get("order");
    if (id) {
      orderRepository.get(id).then((o) => {
        if (o) setDetail(o);
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  const tabs = [
    { key: "needs_packing", label: "Needs packing", count: counts.needs_packing },
    { key: "packing", label: "Packing", count: counts.packing },
    { key: "ready_to_ship", label: "Ready to ship", count: counts.ready_to_ship },
    { key: "shipped", label: "Shipped", count: counts.shipped },
    { key: "delivered", label: "Delivered", count: counts.delivered },
    { key: "cancelled", label: "Cancelled", count: counts.cancelled },
    { key: "all", label: "All", count: counts.all },
  ];

  function closeDetail() {
    setDetail(null);
    if (query.get("order")) onNavigate("/admin_dashboard/orders");
  }

  async function refreshDetail(id: string) {
    const fresh = await orderRepository.get(id);
    setDetail(fresh);
    orders.reload();
    refreshCounts();
  }

  const rows = orders.data ?? [];

  const columns: Column<Order>[] = [
    {
      key: "order",
      header: "Order",
      render: (o) => (
        <div className="gg-ordercell">
          <span className="gg-ordercell__num">{o.orderNumber}</span>
          <span className="gg-ordercell__cust">{o.customerName}</span>
        </div>
      ),
    },
    {
      key: "items",
      header: "Items",
      align: "right",
      render: (o) => o.items.reduce((a, it) => a + it.quantity, 0),
    },
    {
      key: "total",
      header: "Total",
      align: "right",
      render: (o) => formatCents(o.totalCents),
    },
    {
      key: "payment",
      header: "Payment",
      secondary: true,
      render: (o) => (
        <Badge tone={PAYMENT_STATUS_TONE[o.paymentStatus]}>
          {PAYMENT_STATUS_LABELS[o.paymentStatus]}
        </Badge>
      ),
    },
    {
      key: "status",
      header: "Status",
      render: (o) => (
        <Badge tone={ORDER_STATUS_TONE[o.status]}>
          {ORDER_STATUS_LABELS[o.status]}
        </Badge>
      ),
    },
    {
      key: "waiting",
      header: "Age",
      align: "right",
      secondary: true,
      render: (o) => (
        <span title={formatDateTime(o.createdAt)}>
          {o.status === "paid"
            ? waitingSince(o.paidAt ?? o.createdAt)
            : timeAgo(o.createdAt)}
        </span>
      ),
    },
  ];

  return (
    <div className="gg-page">
      <PageHeader
        title="Orders"
        description="Fulfillment first — pack what's waiting, then ship it."
      />

      <SectionCard title="">
        <div className="gg-orders-toolbar">
          <Tabs
            items={tabs}
            active={tab}
            onChange={(k) => setTab(k as TabKey)}
            ariaLabel="Order status"
          />
          <SearchInput
            label="Search orders"
            placeholder="Order # or customer…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        {orders.loading ? (
          <TableSkeleton rows={6} cols={6} />
        ) : orders.error ? (
          <ErrorState message="Could not load orders." onRetry={orders.reload} />
        ) : rows.length === 0 ? (
          <EmptyState
            icon={tab === "needs_packing" ? "checkCircle" : "orders"}
            title={
              tab === "needs_packing"
                ? "Nothing to pack"
                : search.trim()
                  ? "No matching orders"
                  : "No orders here"
            }
            message={
              tab === "needs_packing"
                ? "Paid orders will appear here the moment they arrive."
                : "Try another tab or search."
            }
          />
        ) : (
          <DataTable
            columns={columns}
            rows={rows}
            rowKey={(o) => o.id}
            onRowClick={(o) => setDetail(o)}
            caption="Orders"
          />
        )}
      </SectionCard>

      <OrderDetail
        order={detail}
        onClose={closeDetail}
        onShip={() => setShipOpen(true)}
        onCancel={(o) => setCancelTarget(o)}
        onChanged={() => detail && refreshDetail(detail.id)}
      />

      <ShipModal
        order={detail}
        open={shipOpen}
        onClose={() => setShipOpen(false)}
        onShipped={(updated) => {
          setDetail(updated);
          orders.reload();
          refreshCounts();
        }}
      />

      <ConfirmDialog
        open={!!cancelTarget}
        title="Cancel this order?"
        message={
          cancelTarget
            ? `${cancelTarget.orderNumber} will be marked cancelled. In production this would trigger a refund workflow. No email is sent in the mock.`
            : ""
        }
        confirmLabel="Cancel order"
        tone="danger"
        onConfirm={async () => {
          if (!cancelTarget) return;
          await orderRepository.setStatus(
            cancelTarget.id,
            "cancelled",
            CURRENT_ADMIN.name,
          );
          toast.success(`${cancelTarget.orderNumber} cancelled.`);
          const id = cancelTarget.id;
          setCancelTarget(null);
          refreshDetail(id);
        }}
        onCancel={() => setCancelTarget(null)}
      />
    </div>
  );
}

/* --------------------------- Order detail --------------------------- */

function OrderDetail({
  order,
  onClose,
  onShip,
  onCancel,
  onChanged,
}: {
  order: Order | null;
  onClose: () => void;
  onShip: () => void;
  onCancel: (o: Order) => void;
  onChanged: () => void;
}) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");

  useEffect(() => {
    setNote(order?.internalNotes ?? "");
  }, [order]);

  if (!order) return null;

  const packedCount = order.items.filter((i) => i.packed).length;
  const allPacked = packedCount === order.items.length;
  const canStartPacking = order.status === "paid";
  const canReady = order.status === "packing" && allPacked;
  const canShip = order.status === "ready_to_ship";
  const isClosed = ["shipped", "delivered", "cancelled", "refunded"].includes(
    order.status,
  );

  async function toggleItem(itemId: string) {
    if (!order) return;
    await orderRepository.toggleItemPacked(order.id, itemId);
    onChanged();
  }

  async function setStatus(status: OrderStatus, label: string) {
    if (!order) return;
    setBusy(true);
    try {
      await orderRepository.setStatus(order.id, status, CURRENT_ADMIN.name);
      toast.success(label);
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  async function saveNote() {
    if (!order) return;
    await orderRepository.addNote(order.id, note.trim());
    toast.success("Note saved.");
    onChanged();
  }

  return (
    <Modal
      open={!!order}
      onClose={onClose}
      title={order.orderNumber}
      variant="drawer"
      size="lg"
      headerExtra={
        <Badge tone={ORDER_STATUS_TONE[order.status]}>
          {ORDER_STATUS_LABELS[order.status]}
        </Badge>
      }
      footer={
        <div className="gg-drawer-actions__buttons">
          {!isClosed && (
            <Button
              variant="ghost"
              onClick={() => onCancel(order)}
              disabled={busy}
            >
              Cancel order
            </Button>
          )}
          {canStartPacking && (
            <Button
              variant="primary"
              icon="package"
              loading={busy}
              onClick={() => setStatus("packing", "Started packing.")}
            >
              Start packing
            </Button>
          )}
          {order.status === "packing" && (
            <Button
              variant="primary"
              icon="check"
              loading={busy}
              disabled={!canReady}
              onClick={() =>
                setStatus("ready_to_ship", "Marked ready to ship.")
              }
            >
              {allPacked
                ? "Mark ready to ship"
                : `Pack all items (${packedCount}/${order.items.length})`}
            </Button>
          )}
          {canShip && (
            <Button variant="primary" icon="truck" onClick={onShip}>
              Ship order
            </Button>
          )}
          {isClosed && (
            <Button variant="ghost" onClick={onClose}>
              Close
            </Button>
          )}
        </div>
      }
    >
      <div className="gg-orderdetail">
        <div className="gg-orderdetail__cols">
          <section className="gg-orderdetail__main">
            <div className="gg-orderdetail__cardhead">
              <h3 className="gg-detail__h3">
                Packing checklist
                <span className="gg-orderdetail__progress">
                  {packedCount}/{order.items.length} packed
                </span>
              </h3>
            </div>
            <ul className="gg-packlist">
              {order.items.map((it) => (
                <li
                  key={it.id}
                  className={`gg-packitem ${it.packed ? "gg-packitem--done" : ""}`}
                >
                  <label className="gg-packitem__check">
                    <input
                      type="checkbox"
                      checked={it.packed}
                      disabled={order.status !== "packing"}
                      onChange={() => toggleItem(it.id)}
                    />
                    <img
                      src={it.imageUrl ?? ""}
                      alt=""
                      className="gg-packitem__img"
                      width={34}
                      height={47}
                      loading="lazy"
                    />
                    <span className="gg-packitem__text">
                      <span className="gg-packitem__name">
                        {it.quantity}× {it.cardName}
                      </span>
                      <span className="gg-packitem__meta">
                        {it.setCode ? `${it.setCode} · ` : ""}
                        {it.condition} · {it.finish}
                      </span>
                    </span>
                  </label>
                  <span className="gg-packitem__price">
                    {formatCents(it.lineTotalCents)}
                  </span>
                </li>
              ))}
            </ul>
            {order.status === "paid" && (
              <p className="gg-muted gg-orderdetail__hint">
                Start packing to enable the checklist.
              </p>
            )}

            <h3 className="gg-detail__h3">Internal notes</h3>
            <textarea
              className="gg-input gg-textarea"
              rows={2}
              value={note}
              placeholder="Notes visible to staff only…"
              onChange={(e) => setNote(e.target.value)}
            />
            <div className="gg-note-actions">
              <Button variant="secondary" size="sm" onClick={saveNote}>
                Save note
              </Button>
            </div>

            <h3 className="gg-detail__h3">Timeline</h3>
            <ul className="gg-timeline">
              {order.timeline.map((ev) => (
                <li key={ev.id} className="gg-timeline__row">
                  <span className="gg-timeline__dot" aria-hidden="true" />
                  <span className="gg-timeline__body">
                    <span className="gg-timeline__label">{ev.label}</span>
                    {ev.detail && (
                      <span className="gg-timeline__detail">{ev.detail}</span>
                    )}
                    <span className="gg-timeline__meta">
                      {ev.actor} · {formatDateTime(ev.at)}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          </section>

          <aside className="gg-orderdetail__side">
            <div className="gg-orderdetail__panel">
              <h3 className="gg-detail__h3">Summary</h3>
              <dl className="gg-summary">
                <div>
                  <dt>Subtotal</dt>
                  <dd>{formatCents(order.subtotalCents)}</dd>
                </div>
                {order.discountCents > 0 && (
                  <div>
                    <dt>Discount</dt>
                    <dd>−{formatCents(order.discountCents)}</dd>
                  </div>
                )}
                <div>
                  <dt>Shipping</dt>
                  <dd>{formatCents(order.shippingCents)}</dd>
                </div>
                <div>
                  <dt>Tax</dt>
                  <dd>{formatCents(order.taxCents)}</dd>
                </div>
                <div className="gg-summary__total">
                  <dt>Total</dt>
                  <dd>{formatCents(order.totalCents)}</dd>
                </div>
              </dl>
            </div>

            <div className="gg-orderdetail__panel">
              <h3 className="gg-detail__h3">Customer</h3>
              <p className="gg-orderdetail__cust">
                {order.customerName}
                <br />
                <a href={`mailto:${order.customerEmail}`} className="gg-link">
                  {order.customerEmail}
                </a>
              </p>
              <h4 className="gg-orderdetail__h4">Ship to</h4>
              <address className="gg-address">
                {order.shipRecipient}
                <br />
                {order.shipLine1}
                {order.shipLine2 && (
                  <>
                    <br />
                    {order.shipLine2}
                  </>
                )}
                <br />
                {order.shipCity}, {order.shipState} {order.shipPostalCode}
                <br />
                {order.shipCountry}
              </address>
              <p className="gg-muted">{order.shippingMethod}</p>
              {order.trackingNumber && (
                <p className="gg-orderdetail__tracking">
                  <Icon name="truck" size={15} /> {order.carrier} ·{" "}
                  {order.trackingNumber}
                </p>
              )}
            </div>

            <div className="gg-orderdetail__panel">
              <h3 className="gg-detail__h3">Emails</h3>
              {order.emails.length === 0 ? (
                <p className="gg-muted">No emails yet.</p>
              ) : (
                <ul className="gg-emaillog">
                  {order.emails.map((em) => (
                    <li key={em.id} className="gg-emaillog__row">
                      <span className="gg-emaillog__type">{em.emailType}</span>
                      <Badge tone={EMAIL_STATUS_TONE[em.status]}>
                        {EMAIL_STATUS_LABELS[em.status]}
                      </Badge>
                      <span className="gg-emaillog__time">
                        {timeAgo(em.at)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </aside>
        </div>
      </div>
    </Modal>
  );
}
