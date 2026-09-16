import type {
  AccountStatus,
  BuyingLeadPriority,
  BuyingLeadStatus,
  CampaignStatus,
  CardCondition,
  CardFinish,
  CardRarity,
  EmailDeliveryStatus,
  InventoryMovementReason,
  ListingStatus,
  OrderStatus,
  PaymentStatus,
  PrintingTreatment,
  ScanRecognitionMode,
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

export const CONDITION_TONE: Record<CardCondition, BadgeTone> = {
  NM: "success",
  LP: "info",
  MP: "gold",
  HP: "warning",
  DMG: "danger",
};

export const FINISH_LABELS: Record<CardFinish, string> = {
  nonfoil: "Nonfoil",
  foil: "Foil",
  etched: "Etched",
  glossy: "Glossy",
  ripple: "Ripple",
  surge: "Surge",
  rainbow: "Rainbow",
  galaxy: "Galaxy",
  textured: "Textured",
  mana: "Mana",
  gilded: "Gilded",
  halo: "Halo",
};

export const TREATMENT_LABELS: Record<PrintingTreatment, string> = {
  showcase: "Showcase",
  borderless: "Borderless",
  extended_art: "Extended Art",
  retro_frame: "Retro Frame",
  full_art: "Full Art",
  textless: "Textless",
  promo: "Promo",
  etched: "Etched",
  variation: "Variation",
};

export const TREATMENT_TONE: Record<PrintingTreatment, BadgeTone> = {
  showcase: "purple",
  borderless: "info",
  extended_art: "info",
  retro_frame: "gold",
  full_art: "purple",
  textless: "neutral",
  promo: "warning",
  etched: "gold",
  variation: "neutral",
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

/** Null-safe rarity label (legacy rows may have no rarity). */
export function rarityLabel(rarity: CardRarity | null | undefined): string {
  return rarity ? RARITY_LABELS[rarity] : "—";
}

/** Null-safe rarity tone. */
export function rarityTone(rarity: CardRarity | null | undefined): BadgeTone {
  return rarity ? RARITY_TONE[rarity] : "neutral";
}

export const LISTING_STATUS_LABELS: Record<ListingStatus, string> = {
  active: "Active",
  reserved: "Reserved",
  archived: "Archived",
};

export const LISTING_STATUS_TONE: Record<ListingStatus, BadgeTone> = {
  active: "success",
  reserved: "info",
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

export const SCAN_MODE_LABELS: Record<ScanRecognitionMode, string> = {
  card_matching: "Card matching only",
  condition: "Condition only",
  both: "Card matching + condition",
};

export const SCAN_MODE_SHORT: Record<ScanRecognitionMode, string> = {
  card_matching: "Matching",
  condition: "Condition",
  both: "Full",
};

export const MOVEMENT_REASON_LABELS: Record<InventoryMovementReason, string> = {
  manual_add: "Manual add",
  manual_remove: "Manual remove",
  correction: "Correction",
  scan_add: "Scan add",
  batch_scan_add: "Batch scan add",
  order_reserved: "Reserved for order",
  order_shipped: "Shipped on order",
  order_cancelled: "Order cancelled",
  import: "CSV import",
  archive: "Archived",
  restore: "Restored",
};

export const BUYING_LEAD_STATUS_LABELS: Record<BuyingLeadStatus, string> = {
  new: "New",
  reviewing: "Reviewing",
  needs_more_photos: "Needs more photos",
  needs_in_person_review: "Needs in-person review",
  contacted: "Contacted",
  offer_made: "Offer made",
  accepted: "Accepted",
  declined: "Declined",
  completed: "Completed",
  closed: "Closed",
};

export const BUYING_LEAD_STATUS_TONE: Record<BuyingLeadStatus, BadgeTone> = {
  new: "gold",
  reviewing: "info",
  needs_more_photos: "warning",
  needs_in_person_review: "warning",
  contacted: "purple",
  offer_made: "warning",
  accepted: "success",
  declined: "neutral",
  completed: "success",
  closed: "neutral",
};

export const BUYING_LEAD_PRIORITY_LABELS: Record<BuyingLeadPriority, string> = {
  normal: "Normal",
  high_interest: "High interest",
};

export const COLLECTION_SIZE_LABELS: Record<string, string> = {
  under_100: "Under 100",
  "100_to_500": "100–500",
  "500_to_1000": "500–1,000",
  "1000_to_5000": "1,000–5,000",
  "5000_to_10000": "5,000–10,000",
  "10000_plus": "10,000+",
  not_sure: "Not sure",
};

export const COLLECTION_TYPE_LABELS: Record<string, string> = {
  individual_singles: "Individual singles",
  binder_collection: "Binder collection",
  commander_decks: "Commander decks",
  other_constructed_decks: "Other constructed decks",
  bulk_cards: "Bulk cards",
  foils: "Foils",
  vintage_cards: "Older / vintage cards",
  modern_cards: "Modern cards",
  sealed_product: "Sealed product",
  mixed_collection: "Mixed collection",
  not_sure: "Not sure",
};

export const TIMELINE_LABELS: Record<string, string> = {
  asap: "As soon as possible",
  within_week: "Within a week",
  within_month: "Within a month",
  no_rush: "No rush",
};

export const PREFERRED_CONTACT_LABELS: Record<string, string> = {
  email: "Email",
  phone: "Phone call",
  text: "Text message",
};

export const TRANSACTION_PREFERENCE_LABELS: Record<string, string> = {
  local: "Local / in-person",
  ship: "Ship the collection",
  either: "Either is fine",
  not_sure: "Not sure yet",
};