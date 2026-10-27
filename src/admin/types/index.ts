// Admin domain types.
//
// These intentionally mirror the shapes in src/types/database.ts (the generated
// Supabase types) so the mock repositories can later be swapped for real
// Supabase/Vercel implementations WITHOUT changing component code. Where the DB
// stores money as integer cents, we keep cents here too and format at the edges.
//
// Enum unions below are copied from the DB enums so a mismatch is a compile
// error rather than a runtime surprise.

import type { ReferralLeadStatus } from "../../store/lib/referralTypes.js";
import type { LeadSourceFields } from "../../store/lib/attribution.js";
import type {
  CheckinAnswer,
  FeeStatus,
  PartnerKind,
  PartnerReferralOutcome,
  PartnerStatus,
} from "../../store/lib/partnerTypes.js";

/* ------------------------------------------------------------------ *
 * Shared enums (kept in sync with public.Enums in database.ts)
 * ------------------------------------------------------------------ */

export type CardCondition = "NM" | "LP" | "MP" | "HP" | "DMG";

// Full finish set as defined by public.card_finish in the live database. The
// storefront still derives a legacy `foil` boolean for visual effects, but the
// underlying model retains the exact finish (task: preserve the real finish).
export type CardFinish =
  | "nonfoil"
  | "foil"
  | "etched"
  | "glossy"
  | "ripple"
  | "surge"
  | "rainbow"
  | "galaxy"
  | "textured"
  | "mana"
  | "gilded"
  | "halo";

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

// Matches public.inventory_status in the live database EXACTLY. Do not translate
// `reserved` to `inactive`: `reserved` means stock held for an open order and is
// intentionally distinct. Only `active` rows appear on the storefront; `archived`
// rows are hidden; `reserved` rows are hidden from the storefront but retained.
export type ListingStatus = "active" | "reserved" | "archived";

// DB `rarity` is nullable free text (legacy rows have no rarity). The mapper
// normalises known Scryfall rarities to this union and falls back to "common"
// for display only when the source value is unknown/null.
export type CardRarity = "common" | "uncommon" | "rare" | "mythic" | "special";

// The 4 rarities a price floor can be set for. "special" (promos, tokens,
// etc.) is deliberately excluded — it's too mixed a bucket for one minimum.
export type FloorableRarity = "common" | "uncommon" | "rare" | "mythic";

/** A per-rarity minimum sell price, used to floor an auto-suggested
 * (Scryfall reference) price in Add Card and scan review, and to raise any
 * existing non-archived inventory line of that rarity priced below it.
 * Never overrides a price staff types in by hand, and never lowers a price
 * — only raises one up to the floor. */
export interface InventoryPriceFloor {
  rarity: FloorableRarity;
  minPriceCents: number;
  updatedAt: string;
  updatedBy: string | null;
}

/** How many existing inventory lines a set of price floors would raise
 * (preview) or did raise (after saving), per rarity. */
export interface PriceFloorRepriceCounts {
  common: number;
  uncommon: number;
  rare: number;
  mythic: number;
  total: number;
}

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
  /** Human set name. Legacy rows may only have the set code; null-safe. */
  setName: string | null;
  setCode: string;
  collectorNumber: string;
  /** Null for legacy rows that predate Scryfall resolution. */
  rarity: CardRarity | null;
  /** Maps to inventory_items.type_line. Null for unresolved legacy rows. */
  cardType: string | null;
  imageUrl: string | null;
  condition: CardCondition;
  finish: CardFinish;
  /**
   * Physical-copy designation beyond the printing itself -- "Artist Proof",
   * "Special Edition", or a custom label. Empty string/null means a standard
   * copy. Part of the line's identity alongside condition+finish (see
   * admin_upsert_inventory and the uq_inventory_sku unique index): the same
   * printing/condition/finish can have separate Standard and Artist Proof
   * lines without colliding.
   */
  variantType?: string | null;
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
  /** When this inventory line most recently entered the active storefront. */
  storefrontListedAt?: string;
  /** True when the line should appear in Deals & Specials. */
  isDeal?: boolean;
  /** Why the line is a deal: staff pick, the 30-day rule, or a flaw/grading quirk. */
  dealSource?: "manual" | "aged_inventory" | "flawed" | null;
  /** Regular pre-discount price, retained so the storefront can show savings. */
  originalPriceCents?: number | null;
  /** Percent markdown currently applied to this line. */
  dealDiscountPercent?: number | null;
  dealStartedAt?: string | null;
  /** Customer-facing explanation of the deal (the specific flaw, for dealSource "flawed"). */
  dealNote?: string | null;
  createdAt: string;
  updatedAt: string;
}

// Matches public.inventory_movement_reason in the live database.
export type InventoryMovementReason =
  | "manual_add"
  | "manual_remove"
  | "correction"
  | "scan_add"
  | "batch_scan_add"
  | "order_reserved"
  | "order_shipped"
  | "order_cancelled"
  | "import"
  | "archive"
  | "restore";

/**
 * Append-only ledger entry. Mirrors public.inventory_movements. `actor` is the
 * signed-in staff member's display name/email (DB column `actor`), replacing the
 * old mock `adminName`. `note` carries optional free text (e.g. adjustment
 * reason). This is now the LIVE model, not a placeholder.
 */
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
  /** Acting staff member (display name or email). DB column: actor. */
  actor: string | null;
  note: string | null;
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

/** What /api/admin/scans/:scanId/recognize does for every scan in a session.
 * "card_matching": identify only, condition stays fully manual (e.g. staff
 * will grade it themselves, or already know the condition). "condition":
 * grade condition only, identity stays fully manual (e.g. re-grading
 * existing stock, or a card already picked by hand via Find Match).
 * "both": the full pipeline (default — matches the original behavior). */
export type ScanRecognitionMode = "card_matching" | "condition" | "both";

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
  /** What recognition does for every scan in this session — set once at
   * creation, applies to the whole batch. */
  scanMode: ScanRecognitionMode;
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

// Matches public.recognition_status in the live database EXACTLY
// (supabase/migrations/20260915194514_scan_sessions_card_scans.sql).
/** Recognition status — drives the future OCR pipeline; stub today. */
export type RecognitionStatus =
  | "none"
  | "queued"
  | "processing"
  | "recognized"
  | "low_confidence"
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
  /** Browser-viewable preview (PNG) of each side, generated during
   * recognition — prefer these over frontImageUrl/backImageUrl for on-screen
   * display, since the original is often a scanner-native TIFF no browser
   * renders in an <img>. Null until recognition has run at least once. */
  frontPreviewUrl: string | null;
  backPreviewUrl: string | null;

  /* Chosen Scryfall match (identity by scryfallId). */
  selectedScryfallId: string | null;
  selectedPrinting: CardPrinting | null;

  /* Recognition (future OCR) — never overwrites confirmed fields. */
  recognitionStatus: RecognitionStatus;
  recognitionConfidence: number | null;
  recognitionData: CardRecognitionResult | null;
  suggestedCondition: CardCondition | null;
  suggestedConditionConfidence: number | null;
  /** Explainable defect findings behind the suggestion — never a black box. */
  conditionFindings: ConditionFindings | null;

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
  /** Why this candidate scored the way it did, e.g. "set+collector exact, visual 0.94". */
  reason?: string;
  /** Scryfall image of this printing, for picking between candidates by eye. */
  imageUrl?: string | null;
}

/** What the scanner PC's own recognizer reported (scanner-bridge/src/recognizer). */
export interface ScannerPcRecognition {
  version: string;
  decision: "sure" | "check" | "none";
  /** 180 when the card went through the feeder upside down. */
  orientation: 0 | 180;
  /** The scanner's second side turned out to be the card's face. */
  sidesSwapped: boolean;
  /** Collector-number text read, when it had to be read. */
  ocrText: string | null;
  timingsMs: Record<string, number>;
  library: { builtAt: string | null; entries: number; model: string };
  /** Which stored images are the PC's cropped, straightened copies (re-runs reuse them as they are). */
  straightened?: { front: boolean; back: boolean };
}

/** Which Part 7 era-strategy the pipeline used for this scan. */
export type RecognitionEra =
  | "modern"
  | "exodus_to_premodern"
  | "vintage"
  | "unknown";

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

  /* --- Additive debug/explainability fields (all optional — a stub or an
   * older stored result simply omits them; nothing downstream should
   * require them). --- */
  /** Which era-strategy (Part 7) was used to generate candidates. */
  era?: RecognitionEra;
  /** Human-readable reason auto-match was accepted OR why it was withheld —
   * Part 10's "record why an automatic match was accepted / sent to review". */
  decisionReason?: string;
  /** Best set-symbol shape-match, independent cross-check (Part 6.5). */
  setSymbolMatch?: { setCode: string; confidence: number } | null;
  /** Combined visual similarity (full-card + art) to the accepted/best candidate. */
  visualSimilarity?: number | null;
  /** Raw OCR text actually read for each region, before parseCollectorLine()
   * or the usable-confidence gate — ground truth for diagnosing WHY
   * detectedName/detectedSetCode/detectedCollectorNumber came back null or
   * wrong, without re-deriving it from a screenshot every time. */
  ocrRawText?: { title: string; collectorInfo: string };
  /** Which recognizer produced this: the cloud OCR pipeline (default when
   * absent) or the scanner PC's picture matcher. */
  engine?: "cloud" | "scanner_pc";
  /** Present when engine is "scanner_pc". */
  scannerPc?: ScannerPcRecognition;
  /** Pixel dimensions of normalizeCardImage()'s actual output for the front
   * scan — the image REGIONS' percentages are applied against. A local
   * screenshot-based check of a crop region can't fully substitute for the
   * real stored image; comparing this against a card's known real aspect
   * ratio (~2.5:3.5) is a fast way to tell whether normalizeCardImage() is
   * producing what those percentages assume, without needing Storage
   * access or another screenshot round-trip. */
  normalizedDimensions?: { width: number; height: number };
}

/* ------------------------------------------------------------------ *
 * Condition analysis (Part 9) — explainable per-region defect findings
 * behind a suggestedCondition. Shared between the server-side analyzer
 * (api/_lib/recognition/condition.ts, which imports these) and the review
 * UI, so there is exactly one definition of the shape.
 * ------------------------------------------------------------------ */

export type DefectSeverity = "none" | "light" | "moderate" | "heavy";

export interface DefectFinding {
  /** e.g. "back upper-left corner", "front surface". */
  region: string;
  kind:
    | "corner_wear"
    | "edge_whitening"
    | "surface_wear"
    | "crease"
    | "writing_or_ink"
    | "stain_or_liquid"
    | "structural";
  severity: DefectSeverity;
  /** Human-readable explanation, e.g. "moderate whitening". */
  note: string;
}

export interface ConditionFindings {
  findings: DefectFinding[];
  /** Short human summary, e.g. "minor whitening on 2 back edges." */
  summary: string;
  /** True when the back image was unavailable — confidence is lowered and
   * this is surfaced explicitly, per Part 4/9's explicit requirement. */
  backImageMissing: boolean;
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
  /** "Artist Proof", "Special Edition", a custom label, or null for a standard copy. */
  variantType?: string | null;
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
  channel: "online" | "pos";
  customerId: string | null;
  customerName: string;
  customerEmail: string | null;
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
  shippingMethod: string | null;
  /**
   * The postage label bought through "Buy & print label" (EasyPost): a 4×6
   * PNG, or a PDF for labels bought before 2026-09-30. Null otherwise.
   */
  labelUrl: string | null;
  postageCostCents: number | null;
  shippingService: string | null;
  /** Latest carrier status from EasyPost (in_transit, delivered, …), when tracked. */
  trackingStatus?: string | null;
  /** When the shipping-updates worker last checked the tracking. */
  trackingCheckedAt?: string | null;
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
 * POS — the in-store register
 * ------------------------------------------------------------------ */

export interface PosSaleItem {
  inventoryItemId: string;
  quantity: number;
}

export interface PosSaleResult {
  orderId: string;
  subtotalCents: number;
  taxCents: number;
  totalCents: number;
  amountDueCents: number;
}

export interface PosSettings {
  salesTaxBps: number;
}

export interface PosTerminalLocation {
  id: string;
  displayName: string;
}

export interface PosTerminalReader {
  id: string;
  label: string;
  status: string;
  deviceType: string;
}

/* ------------------------------------------------------------------ *
 * Pickup requests — kiosk-submitted "hold these while I browse" lists
 * ------------------------------------------------------------------ */

export type PickupRequestStatus = "waiting" | "ready" | "completed" | "cancelled";

export interface PickupRequestItem {
  id: string;
  inventoryItemId: string | null;
  cardName: string;
  setName: string | null;
  setCode: string | null;
  collectorNumber: string | null;
  condition: CardCondition;
  finish: CardFinish;
  imageUrl: string | null;
  quantity: number;
  /** The price when the card went on the list. */
  unitPriceCents: number;
  pulled: boolean;
  /** Where the card is kept (inventory's storage location). */
  storageLocation: string | null;
  /** What the card sells for now; yard sale lists are charged at this, less the discount. */
  currentPriceCents: number | null;
  /** Still in inventory and priced, so the list can be completed. */
  available: boolean;
}

export interface PickupRequest {
  id: string;
  customerName: string;
  phone: string | null;
  status: PickupRequestStatus;
  notes: string | null;
  createdAt: string;
  items: PickupRequestItem[];
  /** Set for a list sent from /yard-sale (null for kiosk requests). */
  yardSaleId: string | null;
  /** The yard sale list's number, as the shopper's phone shows it. */
  pickupNumber: number | null;
}

/** A yard sale, as the pickup queue needs it. */
export interface PickupYardSale {
  id: string;
  startedAt: string;
  endsAt: string;
  endedAt: string | null;
  active: boolean;
  discountPercent: number;
  minPriceCents: number;
}

/** Everything the Pickup Requests page shows. */
export interface PickupQueue {
  requests: PickupRequest[];
  /** The sales the open yard sale lists belong to, and the latest sale. */
  yardSales: PickupYardSale[];
  /** The register's sales tax, which yard sale lists are charged too. */
  taxBps: number;
}

export interface PickupRemoveResult {
  cardName: string;
  removed: number;
  itemsLeft: number;
  /** The list had no cards left, so it was closed. */
  listClosed: boolean;
}

export interface YardSaleCompleteResult {
  orderId: string;
  subtotalCents: number;
  discountCents: number;
  taxCents: number;
  totalCents: number;
}

/** A card in the hand on the printed yard sale sign (one of the most valuable newer cards at the sale). */
export interface YardSaleShowcaseCard {
  id: string;
  /** For the picture's alt text: the front face's name. */
  name: string;
  imageUrl: string;
}

/** Admin → Yard Sale Mode (GET /api/admin/yard-sale). */
export interface YardSaleSnapshot {
  sale: {
    id: string;
    startedAt: string;
    endsAt: string;
    endedAt: string | null;
    active: boolean;
    discountPercent: number;
    minPriceCents: number;
    listsSent: number;
  } | null;
  openLists: number;
  openListsFromEndedSales: number;
  completedLists: number;
  completedTotalCents: number;
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
  /** How they became a customer: signed up, checked out, newsletter, or added/imported by staff. */
  source?: "manual" | "newsletter" | "account_signup" | "checkout" | "import";
}

/* ------------------------------------------------------------------ *
 * Reservations (per-line, per-customer stock holds)
 * ------------------------------------------------------------------ */

/** One active reservation, enriched with customer + card fields for the UI. */
export interface Reservation {
  id: string;
  inventoryItemId: string;
  customerId: string;
  customerEmail: string;
  customerFirstName: string | null;
  customerLastName: string | null;
  quantity: number;
  note: string | null;
  reservedBy: string | null;
  reservedAt: string;
  cardName: string;
  setCode: string;
  setName: string | null;
  collectorNumber: string;
  condition: CardCondition;
  finish: CardFinish;
  imageUrl: string | null;
  /** Physical on-hand quantity of the underlying inventory line. */
  onHand: number;
}

/** Active reservations grouped under one customer (Reserved tab). */
export interface CustomerReservations {
  customerId: string;
  customerEmail: string;
  customerFirstName: string | null;
  customerLastName: string | null;
  totalQuantity: number;
  reservations: Reservation[];
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

/** Storefront visitor stats for the Overview (admin_site_traffic RPC). */
export interface SiteTraffic {
  /**
   * Visits by people: one per anonymous daily id that interacted with a page
   * or viewed more than one (machines are counted in filteredVisits).
   */
  visitors: number;
  visitorsPrev: number;
  pageViews: number;
  pageViewsPrev: number;
  /** Unique visitors in the last 5 minutes. */
  liveNow: number;
  /** Unique visitors per day. */
  series: TimeSeriesPoint[];
  topPages: NamedValue[];
  referrers: NamedValue[];
  devices: NamedValue[];
  /** ISO country codes ("??" when unknown). */
  countries: NamedValue[];
  /** Top cities by visitors (approximate, from Vercel's geo-IP headers). */
  cities: VisitorCity[];
  /** Top states / regions by visitors. */
  regions: VisitorRegion[];
  /** Most recently active visitors in the last 2 days, newest first. */
  recentVisitors: RecentVisitor[];
  /** Visits left out: Facebook's link checks, bots, page loads with no sign of a person. */
  filteredVisits: number;
  /** The most searched shop queries in the range. */
  searches: SiteSearch[];
  /** Searches whose latest try found nothing, with no filters on: what people want that isn't in stock. */
  missedSearches: SiteSearch[];
  /** Visits that arrived on a tagged link (utm_source / utm_campaign), e.g. a Facebook post. */
  campaigns: SiteCampaign[];
}

export interface SiteSearch {
  /** Lower-cased, as typed. */
  query: string;
  searches: number;
  /** Different visitors who searched it. */
  people: number;
  /** Cards the latest search for it found. */
  results: number;
  lastSearchedAt: string;
}

export interface SiteCampaign {
  source: string | null;
  campaign: string | null;
  value: number;
}

export interface VisitorRegion {
  /** ISO 3166-2 subdivision code without the country, e.g. "MO". */
  region: string;
  /** ISO country code, or null if unknown. */
  country: string | null;
  value: number;
}

export interface VisitorCity {
  city: string;
  region: string | null;
  country: string | null;
  value: number;
}

export interface RecentVisitor {
  lastSeen: string;
  city: string | null;
  region: string | null;
  country: string | null;
  device: "mobile" | "tablet" | "desktop";
  /** First external site they arrived from, if any. */
  referrer: string | null;
  lastPage: string;
  pages: number;
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

/** Unmet demand for a card: wishlist saves + still-pending back-in-stock
 * subscriptions, cross-referenced against current stock. See
 * admin_sourcing_signals(). */
export interface SourcingSignal {
  oracleId: string;
  cardName: string;
  wishlistCount: number;
  stockAlertCount: number;
  totalDemand: number;
  currentlyInStock: boolean;
  inStockQuantity: number;
}

/** Paid orders grouped by ship-to state/city. See admin_order_geography(). */
export interface OrderGeographyRow {
  shipState: string;
  shipCity: string;
  orderCount: number;
  totalRevenueCents: number;
  firstOrderAt: string;
  lastOrderAt: string;
  /** A real 5-digit zip from one of this group's orders, if any looked valid — used to place this city on the map. */
  samplePostalCode: string | null;
}

/** A manually-researched note on a candidate market (competitor count,
 * population, free-text notes) for comparing against OrderGeographyRow when
 * evaluating a physical location. */
export interface MarketResearchNote {
  id: string;
  regionLabel: string;
  state: string | null;
  competitorCount: number | null;
  population: number | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface MarketResearchNoteInput {
  regionLabel: string;
  state: string | null;
  competitorCount: number | null;
  population: number | null;
  notes: string | null;
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
  /**
   * Stock filter. `in` = quantity > 0 (the storefront-visible working set),
   * `out` = quantity exactly 0, `low` = 0 < quantity <= low-stock threshold,
   * `all` = no quantity constraint. The `in` value is executed IN THE DATABASE
   * by admin_search_inventory(p_stock) so the In-Stock tab never downloads
   * out-of-stock rows only to hide them client-side.
   */
  stock?: "all" | "in" | "low" | "out";
  condition?: CardCondition | "all";
  finish?: CardFinish | "all";
  setCode?: string | "all";
  sortBy?: "name" | "quantity" | "price" | "updated";
  sortDir?: "asc" | "desc";
  page?: number;
  pageSize?: number;
}

/**
 * Payload for editing an existing inventory line's card identity + fields. The
 * server re-resolves the Scryfall printing from these identity signals (id
 * preferred), so client-supplied denormalized metadata is never trusted. Every
 * field is optional: only provided keys are changed. Quantity is intentionally
 * NOT part of this payload — it always flows through adjustQuantity().
 */
export interface InventoryPrintingEdit {
  /** New exact Scryfall printing id (drives re-resolution of all metadata). */
  scryfallId?: string | null;
  /** Fallback identity signals when no id is available (legacy rows). */
  setCode?: string | null;
  collectorNumber?: string | null;
  cardName?: string | null;
  condition?: CardCondition;
  finish?: CardFinish;
  priceCents?: number;
  costCents?: number | null;
  storageLocation?: string | null;
  sku?: string | null;
  notes?: string | null;
  variantType?: string | null;
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

/** One card in a Quick approve batch: the printing staff confirmed for it. */
export interface QuickApproveItem {
  scanId: string;
  scryfallId: string;
  /** A price typed in Quick approve (otherwise the card's own, else today's Scryfall price). */
  priceCents?: number | null;
}

export interface QuickApproveRequest {
  items: QuickApproveItem[];
  /** For cards nobody has graded yet. */
  condition: CardCondition;
  /** For cards without a storage location yet. */
  storageLocation?: string | null;
  /** Add the approved cards to inventory straight away (else they're left "ready"). */
  addToInventory: boolean;
}

export interface QuickApproveResult {
  /** Marked ready (and, with addToInventory, then added). */
  approvedCount: number;
  addedCount: number;
  createdCount: number;
  incrementedCount: number;
  failures: { scanId: string; sequenceNumber: number; reason: string }[];
}

/* ------------------------------------------------------------------ *
 * Buying Leads — Sell Your Cards / Sell Your Collection submissions
 * ------------------------------------------------------------------ */

export type BuyingLeadStatus =
  | "new"
  | "reviewing"
  | "needs_more_photos"
  | "needs_in_person_review"
  | "contacted"
  | "offer_made"
  | "accepted"
  | "declined"
  | "completed"
  | "closed";

export type BuyingLeadPriority = "normal" | "high_interest";

export interface BuyingLeadSummary {
  id: string;
  referenceNumber: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  createdAt: string;
  totalCards: number;
  photoCount: number;
  collectionSize: string | null;
  preferredContactMethod: string;
  transactionPreference: string;
  status: BuyingLeadStatus;
  priority: BuyingLeadPriority;
  favorited: boolean;
  estimatedValueCents: number | null;
}

export interface BuyingLeadCard {
  id: string;
  scryfallId: string | null;
  cardName: string;
  setName: string | null;
  setCode: string | null;
  collectorNumber: string | null;
  imageUrl: string | null;
  condition: CardCondition | null;
  finish: CardFinish;
  quantity: number;
  scryfallPriceCents: number | null;
  sellerNotes: string | null;
  matchStatus: "matched" | "ambiguous" | "unmatched";
  /** Correlates to BuyingLeadPhoto.clientCardId when the seller attached a photo to this specific card. */
  clientCardId: string | null;
}

export interface BuyingLeadPhoto {
  id: string;
  originalFilename: string;
  mimeType: string;
  sizeBytes: number;
  signedUrl: string | null;
  /** Set when the seller attached this photo to a specific card (see BuyingLeadCard.clientCardId), rather than the general collection uploader. */
  clientCardId: string | null;
  /** "front" or "back" when clientCardId is set; null otherwise. */
  side: "front" | "back" | null;
}

export interface BuyingLeadDetail extends BuyingLeadSummary {
  userId: string | null;
  collectionTypes: string[];
  collectionEras: string[];
  timeline: string | null;
  valuableCardsNotes: string | null;
  notes: string | null;
  internalNotes: string | null;
  referralSource: string | null;
  offerValueCents: number | null;
  /** When staff actually sent offerValueCents to the seller via Send Offer. Null means it's still just a private note. */
  offerSentAt: string | null;
  /** How the seller responded on the public /sell/offer page. Reset to null whenever a new offer is sent — see send-offer.ts. */
  offerResponse: "accepted" | "declined" | "countered" | null;
  /** The seller's counter amount — set only when offerResponse === "countered". */
  counterOfferCents: number | null;
  offerRespondedAt: string | null;
  /** Seller's payout choice at acceptance. store_credit = offer + bonus, issued automatically on "completed". */
  payoutMethod: "paypal" | "store_credit" | null;
  storeCreditBonusPercent: number | null;
  /** Store credit actually issued (set when the lead is marked completed). */
  storeCreditCents: number | null;
  storeCreditIssuedAt: string | null;
  purchaseAmountCents: number | null;
  contactedAt: string | null;
  closedAt: string | null;
  cards: BuyingLeadCard[];
  photos: BuyingLeadPhoto[];
  /** The seller ticked "if Geega Games passes, share it with a partner store". Null: never send it on. */
  partnerConsentAt: string | null;
  /** Where the seller came from: tagged link, referral code, first page, what they said. */
  source: LeadSourceFields;
}

export interface BuyingLeadsQuery {
  search?: string;
  status?: BuyingLeadStatus | "all";
  hasPhotos?: boolean;
  hasCardList?: boolean;
  largeCollection?: boolean;
}
/* ------------------------------------------------------------------ *
 * Partner Leads — Pokémon / One Piece / video game sellers who asked to
 * be passed to a partner store (referral_leads)
 * ------------------------------------------------------------------ */

export type { ReferralLeadStatus };

export interface ReferralLead {
  id: string;
  referenceNumber: string;
  createdAt: string;
  categories: string[];
  description: string;
  collectionSize: string | null;
  handoff: string;
  firstName: string;
  lastName: string | null;
  email: string;
  phone: string | null;
  preferredContactMethod: string;
  location: string | null;
  photoPaths: string[];
  sourcePath: string | null;
  consentToShareAt: string;
  status: ReferralLeadStatus;
  /** Where the seller came from: tagged link, referral code, first page, what they said. */
  source: LeadSourceFields;
}

/* ------------------------------------------------------------------ *
 * Partner program — partner stores, referral partners, leads sent to
 * stores, referral rewards (see src/store/lib/partnerTypes.ts)
 * ------------------------------------------------------------------ */

export type { PartnerKind, PartnerStatus, PartnerReferralOutcome, FeeStatus, CheckinAnswer };

export interface Partner {
  id: string;
  createdAt: string;
  kind: PartnerKind;
  status: PartnerStatus;
  businessName: string;
  contactName: string;
  email: string;
  phone: string | null;
  website: string | null;
  city: string | null;
  state: string | null;
  categories: string[];
  coverage: string | null;
  buysByMail: boolean;
  profession: string | null;
  notes: string | null;
  internalNotes: string | null;
  feePercent: number;
  approvedAt: string | null;
  agreedToStandardsAt: string;
  /** Referral partners: their personal code, once approved. */
  referralCode: string | null;
  source: LeadSourceFields;
}

export interface PartnerReferral {
  id: string;
  createdAt: string;
  partnerId: string;
  referralLeadId: string | null;
  sellSubmissionId: string | null;
  leadReference: string;
  sentAt: string;
  outcome: PartnerReferralOutcome;
  outcomeAt: string | null;
  saleAmountCents: number | null;
  feePercent: number;
  feeCents: number | null;
  feeStatus: FeeStatus;
  feePaidAt: string | null;
  checkinSentAt: string | null;
  checkinResponse: CheckinAnswer | null;
  checkinAmountCents: number | null;
  checkinRespondedAt: string | null;
  notes: string | null;
}

export interface ReferralReward {
  id: string;
  createdAt: string;
  referralLeadId: string | null;
  sellSubmissionId: string | null;
  leadReference: string;
  refCode: string;
  userId: string | null;
  partnerId: string | null;
  kind: "store_credit" | "cash";
  amountCents: number;
  status: "owed" | "paid";
  paidAt: string | null;
}

/** Who a referral code belongs to, named for staff. */
export interface ReferralCodeOwner {
  code: string;
  userId: string | null;
  partnerId: string | null;
  /** "Jane Doe (customer)" / "Acme Estate Sales (referral partner)". */
  label: string;
  email: string | null;
}

/* ------------------------------------------------------------------ *
 * Photo requests — a shopper wants a photo of the actual copy of a
 * listing (photo_requests); answered from Inventory → Photo requests
 * ------------------------------------------------------------------ */

export interface PhotoRequest {
  id: string;
  referenceNumber: string;
  createdAt: string;
  updatedAt: string;
  inventoryItemId: string | null;
  cardName: string;
  setCode: string | null;
  setName: string | null;
  collectorNumber: string | null;
  condition: string | null;
  finish: string | null;
  cardPath: string | null;
  firstName: string;
  email: string;
  note: string | null;
  status: "new" | "sent" | "closed";
  photoPaths: string[];
  staffMessage: string | null;
  sentAt: string | null;
  sendCount: number;
  closedAt: string | null;
  /** From the live listing (null if it was deleted). */
  listing: {
    imageUrl: string | null;
    storageLocation: string | null;
    quantity: number;
    status: string;
  } | null;
}

/* ------------------------------------------------------------------ *
 * Collection sorting — customers drop off or ship in a collection, staff
 * sort it and send an itemized quote the customer approves and pays
 * (sorting_requests / sorting_quotes / sorting_payments; rates in
 * sorting_service_options). Shared wording and math:
 * src/store/lib/sortingService.ts.
 * ------------------------------------------------------------------ */

export type SortingStatus =
  | "new"
  | "awaiting_cards"
  | "received"
  | "quoted"
  | "approved"
  | "sorting"
  | "ready"
  | "returned"
  | "cancelled";

export type SortingQuoteState = "draft" | "sent" | "accepted" | "declined" | "superseded";

export interface SortingOptionAdmin {
  id: string;
  name: string;
  description: string | null;
  ratePerThousandCents: number;
  sortOrder: number;
  active: boolean;
  updatedAt: string;
}

export interface SortingQuoteAdmin {
  id: string;
  version: number;
  status: SortingQuoteState;
  countedCards: number | null;
  sortingServiceCents: number;
  returnShippingCents: number;
  returnPackagingCents: number;
  otherCharges: { label: string; amountCents: number }[];
  /** Always the sum of the items (the database computes it). */
  totalCents: number;
  noteToCustomer: string | null;
  createdAt: string;
  updatedAt: string;
  sentAt: string | null;
  acceptedAt: string | null;
  declinedAt: string | null;
  declineReason: string | null;
  supersededAt: string | null;
}

export interface SortingPaymentAdmin {
  id: string;
  amountCents: number;
  method: "card_online" | "in_store_card" | "cash" | "other";
  providerReference: string | null;
  note: string | null;
  createdAt: string;
}

export interface SortingRequestSummary {
  id: string;
  referenceNumber: string;
  createdAt: string;
  firstName: string;
  lastName: string;
  email: string;
  deliveryMethod: "drop_off" | "ship";
  optionName: string;
  estimatedCards: number;
  countedCards: number | null;
  status: SortingStatus;
  acceptedQuoteId: string | null;
  amountPaidCents: number;
}

export interface SortingRequestDetail extends SortingRequestSummary {
  userId: string | null;
  phone: string | null;
  ratePerThousandCents: number;
  estimatedSortingCents: number;
  customerNotes: string | null;
  internalNotes: string | null;
  statusChangedAt: string;
  returnAddress: {
    recipient: string | null;
    line1: string | null;
    line2: string | null;
    city: string | null;
    state: string | null;
    postalCode: string | null;
  } | null;
  shippingTermsAcceptedAt: string | null;
  shippingTermsText: string | null;
  returnCarrier: string | null;
  returnTrackingNumber: string | null;
  receivedAt: string | null;
  returnedAt: string | null;
  cancelledAt: string | null;
  /** Newest first. */
  quotes: SortingQuoteAdmin[];
  payments: SortingPaymentAdmin[];
}
