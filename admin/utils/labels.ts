import type {
  AccountStatus,
  CampaignStatus,
  CardCondition,
  CardFinish,
  CardRarity,
  EmailDeliveryStatus,
  InventoryMovementReason,
  ListingStatus,
  OrderStatus,
  PaymentStatus,
  StaffRole,
  SubscriberStatus,
} from "../types";

/** Semantic tone for a status badge — maps to CSS classes in admin.css. */
export type BadgeTone =
  | "neutral"
  | "info"
  | "success"
  | "warning"
  | "danger"
  | "gold"
  | "purple";

export const CONDITION_LABELS: Record<CardCondition, string> = {
  NM: "Near Mint",
  LP: "Lightly Played",
  MP: "Moderately Played",
  HP: "Heavily Played",
  DMG: "Damaged",
};

export const CONDITION_SHORT: Record<CardCondition, string> = {
  NM: "NM",
  LP: "LP",
  MP: "MP",
  HP: "HP",
  DMG: "DMG",
};

export const FINISH_LABELS: Record<CardFinish, string> = {
  nonfoil: "Nonfoil",
  foil: "Foil",
  etched: "Etched",
  glossy: "Glossy",
};

export const RARITY_LABELS: Record<CardRarity, string> = {
  common: "Common",
  uncommon: "Uncommon",
  rare: "Rare",
  mythic: "Mythic",
  special: "Special",
};

export const RARITY_TONE: Record<CardRarity, BadgeTone> = {
  common: "neutral",
  uncommon: "info",
  rare: "gold",
  mythic: "warning",
  special: "purple",
};

export const LISTING_STATUS_LABELS: Record<ListingStatus, string> = {
  active: "Active",
  inactive: "Inactive",
  archived: "Archived",
};

export const LISTING_STATUS_TONE: Record<ListingStatus, BadgeTone> = {
  active: "success",
  inactive: "neutral",
  archived: "neutral",
};

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  pending_payment: "Pending payment",
  paid: "Needs packing",
  packing: "Packing",
  ready_to_ship: "Ready to ship",
  shipped: "Shipped",
  delivered: "Delivered",
  cancelled: "Cancelled",
  refunded: "Refunded",
};

export const ORDER_STATUS_TONE: Record<OrderStatus, BadgeTone> = {
  pending_payment: "warning",
  paid: "purple",
  packing: "info",
  ready_to_ship: "gold",
  shipped: "info",
  delivered: "success",
  cancelled: "neutral",
  refunded: "danger",
};

export const PAYMENT_STATUS_LABELS: Record<PaymentStatus, string> = {
  unpaid: "Unpaid",
  processing: "Processing",
  paid: "Paid",
  refunded: "Refunded",
  failed: "Failed",
};

export const PAYMENT_STATUS_TONE: Record<PaymentStatus, BadgeTone> = {
  unpaid: "warning",
  processing: "info",
  paid: "success",
  refunded: "neutral",
  failed: "danger",
};

export const CAMPAIGN_STATUS_LABELS: Record<CampaignStatus, string> = {
  draft: "Draft",
  queued: "Queued",
  sending: "Sending",
  sent: "Sent",
  failed: "Failed",
  cancelled: "Cancelled",
};

export const CAMPAIGN_STATUS_TONE: Record<CampaignStatus, BadgeTone> = {
  draft: "neutral",
  queued: "info",
  sending: "gold",
  sent: "success",
  failed: "danger",
  cancelled: "neutral",
};

export const SUBSCRIBER_STATUS_LABELS: Record<SubscriberStatus, string> = {
  pending: "Pending",
  active: "Subscribed",
  unsubscribed: "Unsubscribed",
  bounced: "Bounced",
  complained: "Complained",
  suppressed: "Suppressed",
};

export const SUBSCRIBER_STATUS_TONE: Record<SubscriberStatus, BadgeTone> = {
  pending: "warning",
  active: "success",
  unsubscribed: "neutral",
  bounced: "danger",
  complained: "danger",
  suppressed: "danger",
};

export const EMAIL_STATUS_LABELS: Record<EmailDeliveryStatus, string> = {
  queued: "Queued",
  sent: "Sent",
  delivered: "Delivered",
  bounced: "Bounced",
  complained: "Complained",
  delivery_delayed: "Delayed",
  suppressed: "Suppressed",
  failed: "Failed",
  canceled: "Canceled",
};

export const EMAIL_STATUS_TONE: Record<EmailDeliveryStatus, BadgeTone> = {
  queued: "neutral",
  sent: "info",
  delivered: "success",
  bounced: "danger",
  complained: "danger",
  delivery_delayed: "warning",
  suppressed: "neutral",
  failed: "danger",
  canceled: "neutral",
};

export const ACCOUNT_STATUS_LABELS: Record<AccountStatus, string> = {
  active: "Active",
  disabled: "Disabled",
};

export const ACCOUNT_STATUS_TONE: Record<AccountStatus, BadgeTone> = {
  active: "success",
  disabled: "danger",
};

export const STAFF_ROLE_LABELS: Record<StaffRole, string> = {
  owner: "Owner",
  administrator: "Administrator",
  fulfillment: "Fulfillment",
  inventory: "Inventory",
};

export const STAFF_ROLE_TONE: Record<StaffRole, BadgeTone> = {
  owner: "gold",
  administrator: "purple",
  fulfillment: "info",
  inventory: "neutral",
};

export const CAMPAIGN_AUDIENCE_LABELS = {
  active_subscribers: "Active subscribers",
  confirmed_recent: "Confirmed in last 90 days",
  all_customers: "All customers",
} as const;

export const MOVEMENT_REASON_LABELS: Record<InventoryMovementReason, string> = {
  manual_add: "Manual add",
  manual_remove: "Manual remove",
  correction: "Correction",
  order_reserved: "Reserved for order",
  order_shipped: "Shipped on order",
  order_cancelled: "Order cancelled",
  import: "CSV import",
};
