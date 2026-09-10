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
  /**
   * Canonical Scryfall printing identity. Preferred dedupe key
   * (scryfallId + condition + finish). Null only for legacy rows created
   * before Scryfall integration.
   */
  scryfallId: string | null;
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
  | "scan_add"
  | "batch_scan_add"
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

/* ------------------------------------------------------------------ *
 * Card printings (Scryfall-backed exact-printing model)
 * ------------------------------------------------------------------ *
 *
 * A "printing" is one physical variant of a Magic card — a specific set +
 * collector number + artwork. It is NOT one row per card name. Two Lightning
 * Bolts from different sets, or a showcase vs a borderless treatment in the
 * same set, are DISTINCT printings and must remain separately selectable.
 *
 * `scryfallId` is the canonical identity. Inventory and scans reference the
 * printing by `scryfallId` so identity survives even before a printing is
 * cached locally.
 */

/** Image sizes exposed for one card face (mirrors Scryfall `image_uris`). */
export interface CardImageUris {
  small: string | null;
  normal: string | null;
  large: string | null;
  png: string | null;
  artCrop: string | null;
}

/** One face of a card. Single-faced cards expose exactly one face. */
export interface CardFace {
  name: string;
  manaCost: string | null;
  typeLine: string | null;
  oracleText: string | null;
  artist: string | null;
  illustrationId: string | null;
  images: CardImageUris;
}

/**
 * A printing "treatment" is the visual/product variant of a printing. This is
 * DISTINCT from finish (foil/etched). Showcase, borderless, extended-art,
 * retro-frame, full-art, promo, textless etc. are treatments.
 */
export type PrintingTreatment =
  | "showcase"
  | "borderless"
  | "extended_art"
  | "retro_frame"
  | "full_art"
  | "textless"
  | "promo"
  | "etched" // etched is surfaced as both a finish AND a treatment badge
  | "variation";

/** Scryfall reference prices, one per finish where the market has data. */
export interface CardPrices {
  usd: number | null;
  usdFoil: number | null;
  usdEtched: number | null;
}

/**
 * A fully-normalised Scryfall printing in Geega's own domain shape. Components
 * depend on THIS, never on Scryfall's raw response.
 *
 * The first block of fields is kept identical to the original lightweight
 * `CardPrinting` so all existing code (mock search, AddInventoryDrawer, tests)
 * continues to compile unchanged. New fields are additive.
 */
export interface CardPrinting {
  /** Local/synthetic id used as a React key. Equal to scryfallId when known. */
  id: string;
  cardName: string;
  setName: string;
  setCode: string;
  collectorNumber: string;
  rarity: CardRarity;
  cardType: string;
  /** Best available thumbnail-ish image (normal). Kept for existing callers. */
  imageUrl: string;
  availableFinishes: CardFinish[];
  scryfallPriceCents: number | null;

  /* --- exact-printing metadata (additive) --- */
  scryfallId: string;
  oracleId: string | null;
  /** Primary-face image set; use faces for multi-faced rendering. */
  images: CardImageUris;
  /** One entry per face. Single-faced cards have length 1. */
  faces: CardFace[];
  layout: string;
  artist: string | null;
  releasedAt: string | null;
  language: string;
  frame: string | null;
  frameEffects: string[];
  borderColor: string | null;
  fullArt: boolean;
  textless: boolean;
  promo: boolean;
  promoTypes: string[];
  treatments: PrintingTreatment[];
  prices: CardPrices;
}

/* ------------------------------------------------------------------ *
 * Card scanning (high-volume batch ingestion)
 * ------------------------------------------------------------------ */

export type ScanSourceType =
  | "file_upload"
  | "folder_drop"
  | "scanner_export"
  | "scanner_bridge";

export type ScanSessionStatus =
  | "uploading"
  | "processing"
  | "pending_review"
  | "reviewing"
  | "completed"
  | "partially_failed"
  | "failed";

/** A persistent batch. Survives page reloads so review can be resumed. */
export interface ScanSession {
  id: string;
  /** Human-facing sequential label, e.g. "Scan Session #1042". */
  label: string;
  createdBy: string;
  /** e.g. "Ricoh fi-8170" — recorded, never used to branch business logic. */
  scannerName: string | null;
  sourceType: ScanSourceType;
  status: ScanSessionStatus;
  totalFiles: number;
  totalCards: number;
  reviewedCards: number;
  matchedCards: number;
  readyCards: number;
  addedCards: number;
  rejectedCards: number;
  failedCards: number;
  note: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

export type ScanReviewStatus =
  | "unreviewed"
  | "pending_match"
  | "matched"
  | "needs_manual_match"
  | "ready"
  | "added"
  | "rejected"
  | "error";

export type ScanFileSide = "front" | "back";

/** Recognition status — drives the future OCR pipeline; stub today. */
export type RecognitionStatus =
  | "none"
  | "queued"
  | "processing"
  | "recognized"
  | "failed";

/**
 * A logical card record within a session. One card may carry a front and/or a
 * back scan image. NOT every uploaded image equals a card — pairing is explicit
 * (see ScanRepository.pairSides) so future fi-8170 duplex output maps cleanly.
 */
export interface CardScan {
  id: string;
  scanSessionId: string;
  /** 1-based position preserving original scanner/batch order. */
  sequenceNumber: number;
  frontImagePath: string | null;
  backImagePath: string | null;
  /** Physical scan images resolved to displayable URLs (Supabase Storage). */
  frontImageUrl: string | null;
  backImageUrl: string | null;

  /* Chosen Scryfall match (identity by scryfallId). */
  selectedScryfallId: string | null;
  selectedPrinting: CardPrinting | null;

  /* Recognition (future OCR) — never overwrites confirmed fields. */
  recognitionStatus: RecognitionStatus;
  recognitionConfidence: number | null;
  recognitionData: CardRecognitionResult | null;
  suggestedCondition: CardCondition | null;
  suggestedConditionConfidence: number | null;

  /* Human-confirmed inventory fields. */
  confirmedCondition: CardCondition | null;
  selectedFinish: CardFinish | null;
  quantity: number;
  priceCents: number | null;
  costCents: number | null;
  storageLocation: string | null;
  notes: string | null;

  reviewStatus: ScanReviewStatus;
  reviewedBy: string | null;
  reviewedAt: string | null;
  /** Set once committed to inventory; prevents double-add (idempotency). */
  inventoryItemId: string | null;

  createdAt: string;
  updatedAt: string;
}

/* ------------------------------------------------------------------ *
 * Recognition (OCR) — interface only, provider is a stub today
 * ------------------------------------------------------------------ */

export interface RecognitionCandidate {
  scryfallId: string;
  cardName: string;
  setCode: string;
  collectorNumber: string;
  confidence: number;
}

export interface CardRecognitionResult {
  detectedName: string | null;
  detectedSetCode: string | null;
  detectedCollectorNumber: string | null;
  detectedLanguage: string | null;
  finishGuess: CardFinish | null;
  candidatePrintings: RecognitionCandidate[];
  confidence: number;
  fieldConfidence: Record<string, number>;
  warnings: string[];
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

/** Filter keys for the scan review queue (map 1:1 to filter tabs). */
export type ScanFilterKey =
  | "all"
  | "unreviewed"
  | "pending_match"
  | "matched"
  | "needs_manual_match"
  | "ready"
  | "added"
  | "rejected"
  | "missing_back"
  | "error";

export interface ScanQuery {
  filter?: ScanFilterKey;
  search?: string;
  page?: number;
  pageSize?: number;
}

/** Editable per-scan review fields applied by the review UI. */
export interface ScanReviewPatch {
  selectedScryfallId?: string | null;
  selectedPrinting?: CardPrinting | null;
  confirmedCondition?: CardCondition | null;
  selectedFinish?: CardFinish | null;
  quantity?: number;
  priceCents?: number | null;
  costCents?: number | null;
  storageLocation?: string | null;
  notes?: string | null;
  reviewStatus?: ScanReviewStatus;
}

/** Summary returned before committing a batch of ready scans to inventory. */
export interface BatchCommitPreview {
  readyCount: number;
  willCreateCount: number;
  willIncrementCount: number;
  errorCount: number;
  errors: { scanId: string; sequenceNumber: number; reason: string }[];
}

/** Result of committing a batch of ready scans to inventory. */
export interface BatchCommitResult {
  addedCount: number;
  createdCount: number;
  incrementedCount: number;
  failedCount: number;
  failures: { scanId: string; sequenceNumber: number; reason: string }[];
}
