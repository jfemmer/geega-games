import type { Database } from "../../types/database";

// Shared order-status presentation helpers for the customer account area.
// Kept in sync with the DB enums in src/types/database.ts (public.order_status
// / public.payment_status) so a schema drift is a compile error here too.

export type OrderStatus = Database["public"]["Enums"]["order_status"];
export type PaymentStatus = Database["public"]["Enums"]["payment_status"];

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  pending_payment: "Awaiting payment",
  paid: "Paid",
  packing: "Packing",
  ready_to_ship: "Ready to ship",
  shipped: "Shipped",
  delivered: "Delivered",
  cancelled: "Cancelled",
  refunded: "Refunded",
};

export const PAYMENT_STATUS_LABELS: Record<PaymentStatus, string> = {
  unpaid: "Unpaid",
  processing: "Processing",
  paid: "Paid",
  refunded: "Refunded",
  failed: "Failed",
};

/**
 * Order placed → Paid → Packing → Ready to ship → Shipped → Delivered.
 * Cancelled/refunded orders are handled separately (see isHaltedStatus) so
 * the stepper never shows a cancelled order as "in progress".
 */
export const PROGRESS_STEPS: { status: OrderStatus; label: string }[] = [
  { status: "pending_payment", label: "Order placed" },
  { status: "paid", label: "Paid" },
  { status: "packing", label: "Packing" },
  { status: "ready_to_ship", label: "Ready to ship" },
  { status: "shipped", label: "Shipped" },
  { status: "delivered", label: "Delivered" },
];

export function isHaltedStatus(status: OrderStatus): boolean {
  return status === "cancelled" || status === "refunded";
}

export function progressIndex(status: OrderStatus): number {
  const idx = PROGRESS_STEPS.findIndex((s) => s.status === status);
  return idx === -1 ? 0 : idx;
}

/** Stable, friendly order number derived from the order's UUID. */
export function orderNumber(id: string): string {
  return `#${id.slice(0, 8).toUpperCase()}`;
}
