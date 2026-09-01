/**
 * enums.ts — TypeScript mirrors of the Postgres enum types.
 * Keep in sync with supabase/migrations/0001_init_extensions_enums.sql.
 */

export const CARD_CONDITIONS = ['NM', 'LP', 'MP', 'HP', 'DMG'] as const;
export type CardCondition = (typeof CARD_CONDITIONS)[number];

export const CARD_FINISHES = ['nonfoil', 'foil', 'etched', 'glossy'] as const;
export type CardFinish = (typeof CARD_FINISHES)[number];

export const ORDER_STATUSES = [
  'pending_payment',
  'paid',
  'packing',
  'ready_to_ship',
  'shipped',
  'delivered',
  'cancelled',
  'refunded',
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const PAYMENT_PROVIDERS = [
  'stripe',
  'paypal',
  'store_credit',
  'manual',
] as const;
export type PaymentProvider = (typeof PAYMENT_PROVIDERS)[number];

export const PAYMENT_STATUSES = [
  'unpaid',
  'processing',
  'paid',
  'refunded',
  'failed',
] as const;
export type PaymentStatusValue = (typeof PAYMENT_STATUSES)[number];

export const TRADE_IN_STATUSES = [
  'new',
  'received',
  'evaluating',
  'offer_made',
  'accepted',
  'paid_out',
  'rejected',
  'cancelled',
] as const;
export type TradeInStatus = (typeof TRADE_IN_STATUSES)[number];

export const APP_ROLES = ['customer', 'staff', 'admin'] as const;
export type AppRole = (typeof APP_ROLES)[number];

/** Human-friendly labels for order statuses (UI display). */
export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  pending_payment: 'Pending payment',
  paid: 'Paid',
  packing: 'Packing',
  ready_to_ship: 'Ready to ship',
  shipped: 'Shipped',
  delivered: 'Delivered',
  cancelled: 'Cancelled',
  refunded: 'Refunded',
};

export const CONDITION_LABELS: Record<CardCondition, string> = {
  NM: 'Near Mint',
  LP: 'Lightly Played',
  MP: 'Moderately Played',
  HP: 'Heavily Played',
  DMG: 'Damaged',
};

/**
 * Legacy free-form order status -> new enum mapping.
 * Used by the Phase 8 data-migration scripts.
 * Note: 'Pending' maps to 'paid' when the order's payment_status was already
 * paid; the migration script applies that conditional, this is the default.
 */
export const LEGACY_ORDER_STATUS_MAP: Record<string, OrderStatus> = {
  Pending: 'pending_payment',
  pending: 'pending_payment',
  packing: 'packing',
  Packing: 'packing',
  'dropped off': 'shipped',
  'Dropped Off': 'shipped',
  shipped: 'shipped',
  Shipped: 'shipped',
  delivered: 'delivered',
  Delivered: 'delivered',
  cancelled: 'cancelled',
  Cancelled: 'cancelled',
};
