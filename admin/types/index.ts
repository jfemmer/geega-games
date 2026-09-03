// Admin domain types.
//
// These intentionally mirror the shapes in src/types/database.ts (the generated
// Supabase types) so the mock repositories can later be swapped for real
// Supabase/Vercel implementations WITHOUT changing component code. Where the DB
// stores money as integer cents, we keep cents here too and format at the edges.
//
// Enum unions below are copied from the DB enums so a mismatch is a compile
// error rather than a runtime surprise.

/* ------------------------------------------------------------------ *
 * Shared enums (kept in sync with public.Enums in database.ts)
 * ------------------------------------------------------------------ */

export type CardCondition = "NM" | "LP" | "MP" | "HP" | "DMG";

export type CardFinish = "nonfoil" | "foil" | "etched" | "glossy";

export type OrderStatus =
  | "pending_payment"
  | "paid"
  | "packing"
  | "ready_to_ship"
  | "shipped"
  | "delivered"
  | "cancelled"
  | "refunded";

export type PaymentStatus =
  | "unpaid"
  | "processing"
  | "paid"
  | "refunded"
  | "failed";

export type PaymentProvider = "stripe" | "paypal" | "store_credit" | "manual";

export type SubscriberStatus =
  | "pending"
  | "active"
  | "unsubscribed"
  | "bounced"
  | "complained"
  | "suppressed";

export type EmailDeliveryStatus =
  | "queued"
  | "sent"
  | "delivered"
  | "bounced"
  | "complained"
  | "delivery_delayed"
  | "suppressed"
  | "failed"
  | "canceled";

/* ------------------------------------------------------------------ *
 * Inventory
 * ------------------------------------------------------------------ */

export type ListingStatus = "active" | "inactive" | "archived";

export type CardRarity = "common" | "uncommon" | "rare" | "mythic" | "special";

/** A concrete, sellable inventory line: one printing + condition + finish. */
export interface InventoryItem {
  id: string;
  cardName: string;
  setName: string;
  setCode: string;
  collectorNumber: string;
  rarity: CardRarity;
  cardType: string;
  imageUrl: string | null;
  condition: CardCondition;
  finish: CardFinish;
  quantity: number;
  /** Selling price in integer cents. */
  priceCents: number;
  /** Optional acquisition cost in integer cents. */
  costCents: number | null;
  storageLocation: string | null;
  sku: string | null;
  notes: string | null;
  status: ListingStatus;
  /** Scryfall reference price in cents, for pricing guidance. */
  scryfallPriceCents: number | null;
  createdAt: string;
  updatedAt: string;
}

export type InventoryMovementReason =
  | "manual_add"
  | "manual_remove"
  | "correction"
  | "order_reserved"
  | "order_shipped"
  | "order_cancelled"
  | "import";

/** Append-only ledger entry — the model the real DB will use. */
export interface InventoryMovement {
  id: string;
  inventoryItemId: string;
  cardName: string;
  /** Signed delta: positive adds, negative removes. */
  delta: number;
  previousQuantity: number;
  resultingQuantity: number;
  reason: InventoryMovementReason;
  relatedOrderNumber: string | null;
  adminName: string;
  createdAt: string;
}

/** A Scryfall-style printing returned by card search (mocked). */
export interface CardPrinting {
  id: string;
  cardName: string;
  setName: string;
  setCode: string;
  collectorNumber: string;
  rarity: CardRarity;
  cardType: string;
  imageUrl: string;
  availableFinishes: CardFinish[];
  scryfallPriceCents: number | null;
}

/* ------------------------------------------------------------------ *
 * Orders
 * ------------------------------------------------------------------ */

export interface OrderItem {
  id: string;
  cardName: string;
  setName: string | null;
  setCode: string | null;
  collectorNumber: string | null;
  imageUrl: string | null;
  condition: CardCondition;
  finish: CardFinish;
  quantity: number;
  unitPriceCents: number;
  lineTotalCents: number;
  /** Packing checklist state (client-side workflow). */
  packed: boolean;
}

export type ShippingCarrier = "USPS" | "UPS" | "FedEx" | "Other";

export interface OrderTimelineEvent {
  id: string;
  label: string;
  detail: string | null;
  actor: string;
  at: string;
}

export interface OrderEmailEvent {
  id: string;
  emailType: string;
  toEmail: string;
  status: EmailDeliveryStatus;
  at: string;
}

export interface Order {
  id: string;
  orderNumber: string;
  customerName: string;
  customerEmail: string;
  shipRecipient: string;
  shipLine1: string;
  shipLine2: string | null;
  shipCity: string;
  shipState: string;
  shipPostalCode: string;
  shipCountry: string;
  paymentStatus: PaymentStatus;
  paymentProvider: PaymentProvider | null;
  status: OrderStatus;
  carrier: ShippingCarrier | null;
  trackingNumber: string | null;
  shippingMethod: string;
  items: OrderItem[];
  subtotalCents: number;
  discountCents: number;
  shippingCents: number;
  taxCents: number;
  totalCents: number;
  internalNotes: string | null;
  timeline: OrderTimelineEvent[];
  emails: OrderEmailEvent[];
  createdAt: string;
  paidAt: string | null;
  shippedAt: string | null;
  deliveredAt: string | null;
  cancelledAt: string | null;
}

/* ------------------------------------------------------------------ *
 * Campaigns / announcements
 * ------------------------------------------------------------------ */

export type CampaignStatus =
  | "draft"
  | "queued"
  | "sending"
  | "sent"
  | "failed"
  | "cancelled";

export type CampaignAudience =
  | "active_subscribers"
  | "confirmed_recent"
  | "all_customers";

export interface Campaign {
  id: string;
  name: string;
  subject: string;
  previewText: string;
  body: string;
  buttonText: string | null;
  buttonUrl: string | null;
  audience: CampaignAudience;
  status: CampaignStatus;
  recipientCount: number;
  deliveredCount: number;
  bounceCount: number;
  openCount: number | null;
  clickCount: number | null;
  createdAt: string;
  sentAt: string | null;
  scheduledAt: string | null;
}

/* ------------------------------------------------------------------ *
 * Users: customers + staff
 * ------------------------------------------------------------------ */

export type AccountStatus = "active" | "disabled";

export interface Customer {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  createdAt: string;
  lastSignInAt: string | null;
  orderCount: number;
  lifetimeSpendCents: number;
  lastOrderAt: string | null;
  accountStatus: AccountStatus;
  subscriberStatus: SubscriberStatus | null;
}

export type StaffRole = "owner" | "administrator" | "fulfillment" | "inventory";

export interface StaffActivity {
  id: string;
  action: string;
  at: string;
}

export interface StaffMember {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  role: StaffRole;
  status: AccountStatus;
  lastActiveAt: string | null;
  recentActivity: StaffActivity[];
}

export interface AdminActivity {
  id: string;
  actor: string;
  action: string;
  target: string | null;
  at: string;
}

/* ------------------------------------------------------------------ *
 * Analytics
 * ------------------------------------------------------------------ */

export type DateRangeKey = "7d" | "30d" | "90d" | "ytd";

export interface TimeSeriesPoint {
  date: string; // ISO date (day granularity)
  value: number;
}

export interface NamedValue {
  label: string;
  value: number;
  /** Optional secondary value, e.g. units vs revenue. */
  secondary?: number;
}

export interface OverviewMetrics {
  ordersNeedingPacking: number;
  ordersReadyToShip: number;
  ordersShippedToday: number;
  revenueCents: number;
  revenuePrevCents: number;
  orderCount: number;
  orderCountPrev: number;
  averageOrderValueCents: number;
  averageOrderValuePrevCents: number;
  totalInventoryUnits: number;
  lowStockCount: number;
  activeCustomers: number;
  activeSubscribers: number;
}

export interface TrendMetrics {
  revenueSeries: TimeSeriesPoint[];
  orderSeries: TimeSeriesPoint[];
  averageOrderValueCents: number;
  unitsSold: number;
  topCards: NamedValue[];
  topSets: NamedValue[];
  salesByCondition: NamedValue[];
  salesByFinish: NamedValue[];
  inventoryValueCents: number;
  estimatedCostBasisCents: number;
  estimatedGrossMarginCents: number;
  lowStockCount: number;
  agingInventory: NamedValue[];
  newCustomers: number;
  repeatCustomers: number;
  newsletterGrowth: TimeSeriesPoint[];
  campaignPerformance: NamedValue[];
}

/* ------------------------------------------------------------------ *
 * Repository query helpers
 * ------------------------------------------------------------------ */

export interface Page<T> {
  rows: T[];
  total: number;
}

export interface InventoryQuery {
  search?: string;
  status?: ListingStatus | "all";
  stock?: "all" | "low" | "out";
  condition?: CardCondition | "all";
  finish?: CardFinish | "all";
  setCode?: string | "all";
  sortBy?: "name" | "quantity" | "price" | "updated";
  sortDir?: "asc" | "desc";
  page?: number;
  pageSize?: number;
}

export interface OrderQuery {
  search?: string;
  status?: OrderStatus | "all" | "needs_packing";
  sortBy?: "created" | "total" | "waiting";
  sortDir?: "asc" | "desc";
}

export interface CustomerQuery {
  search?: string;
  accountStatus?: AccountStatus | "all";
  subscriber?: "all" | "subscribed" | "not_subscribed";
}
