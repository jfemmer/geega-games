// Repository interfaces — the seam between UI and data source.
//
// The mock implementations in ./mock.ts fulfil these contracts today. A future
// phase can add Supabase/Vercel-backed implementations (e.g. SupabaseInventory
// Repository) that satisfy the SAME interfaces, and swap them in a single place
// (see ./index.ts) with no component changes.

import type {
  AdminActivity,
  BatchCommitPreview,
  BatchCommitResult,
  Campaign,
  CardCondition,
  CardFinish,
  CardPrinting,
  CardRecognitionResult,
  CardScan,
  Customer,
  CustomerQuery,
  CustomerReservations,
  DateRangeKey,
  FloorableRarity,
  InventoryItem,
  InventoryMovement,
  InventoryPriceFloor,
  InventoryPrintingEdit,
  InventoryQuery,
  Order,
  OrderQuery,
  OverviewMetrics,
  Page,
  PriceFloorRepriceCounts,
  Reservation,
  ScanQuery,
  ScanRecognitionMode,
  ScanReviewPatch,
  ScanSession,
  ScanSourceType,
  ShippingCarrier,
  StaffMember,
  StaffRole,
  TimeSeriesPoint,
  TrendMetrics,
} from "../types";

export interface InventoryRepository {
  list(query: InventoryQuery): Promise<Page<InventoryItem>>;
  get(id: string): Promise<InventoryItem | null>;
  /** Distinct sets present in inventory, code + full name, for the set filter. */
  setOptions(): Promise<{ code: string; name: string }[]>;
  create(
    input: Omit<InventoryItem, "id" | "createdAt" | "updatedAt">,
    adminName: string,
  ): Promise<InventoryItem>;
  update(id: string, patch: Partial<InventoryItem>): Promise<InventoryItem>;
  /**
   * Change the EXACT printing (and optionally condition/finish) of an existing
   * line, plus editable fields, in one server-validated call. The server
   * re-resolves the Scryfall printing (never trusts client-supplied printing
   * metadata), constrains the finish to that printing's available finishes,
   * refreshes ALL denormalized printing metadata + image, and rejects a change
   * that would collide with another active line (scryfall_id + condition +
   * finish) with a friendly 409. Quantity is never touched here.
   */
  updatePrinting(
    id: string,
    input: InventoryPrintingEdit,
    adminName: string,
  ): Promise<InventoryItem>;
  /** Adjust quantity through the movement ledger (never silent overwrite). */
  adjustQuantity(
    id: string,
    delta: number,
    reason: InventoryMovement["reason"],
    adminName: string,
  ): Promise<InventoryItem>;
  archive(id: string): Promise<InventoryItem>;
  /** Restore an archived/reserved line back to active (reversible). */
  restore(id: string): Promise<InventoryItem>;
  /**
   * PERMANENTLY delete an inventory line. Only safe for lines never referenced
   * by historical business records (orders, carts, scans). The server returns a
   * 409 (surfaced as an Error) when the row is referenced and must be archived
   * instead. Cascades the movement ledger for the deleted row.
   */
  delete(id: string): Promise<void>;
  movements(itemId?: string): Promise<InventoryMovement[]>;
  /** Find an existing printing+condition+finish match (dupe detection). */
  findMatch(
    setCode: string,
    collectorNumber: string,
    condition: InventoryItem["condition"],
    finish: InventoryItem["finish"],
  ): Promise<InventoryItem | null>;
  /**
   * Preferred dupe detection: identity by Scryfall printing + condition +
   * finish. Falls back to set/collector matching when a legacy row lacks a
   * scryfallId. Used by the new Scryfall-powered add + scan flows.
   */
  findMatchByScryfall(
    scryfallId: string,
    condition: CardCondition,
    finish: CardFinish,
  ): Promise<InventoryItem | null>;
  searchPrintings(term: string): Promise<CardPrinting[]>;
  /** Current per-rarity price floors (one row per rarity). */
  getPriceFloors(): Promise<InventoryPriceFloor[]>;
  /**
   * Preview how many existing (non-archived) inventory lines these floors
   * would raise, without changing anything — call before savePriceFloors
   * so the UI can confirm a potentially large repricing first.
   */
  previewPriceFloors(
    floors: Record<FloorableRarity, number>,
  ): Promise<PriceFloorRepriceCounts>;
  /**
   * Replace all 4 floors in one call, and raise any existing non-archived
   * inventory line of a rarity priced below its new floor up to that floor.
   */
  savePriceFloors(floors: Record<FloorableRarity, number>): Promise<{
    floors: InventoryPriceFloor[];
    repriced: PriceFloorRepriceCounts;
  }>;
}

/* ------------------------------------------------------------------ *
 * Scryfall — live card/printing search + lookup
 * ------------------------------------------------------------------ */

/** A single page of Scryfall search results, with pagination metadata. */
export interface ScryfallSearchPage {
  /** Printings on this page (already de-duplicated by scryfallId). */
  printings: CardPrinting[];
  /** Total printings Scryfall reports match the query, if known. */
  totalCards: number | null;
  /** True when more pages exist beyond what has been fetched so far. */
  hasMore: boolean;
  /** 1-based page index this result represents. */
  page: number;
}

export interface ScryfallRepository {
  /**
   * Search the full printing catalog. Returns EVERY applicable printing, not
   * one row per name — different sets, collector numbers, artworks, promos,
   * showcase/borderless/etched treatments each appear separately. Accepts plain
   * names, set codes, collector numbers, and Scryfall search syntax.
   *
   * NOTE: this walks pagination server-side and returns a complete-as-possible
   * first result set. Prefer `searchPrintingsPage` when the UI wants explicit
   * incremental "Load more" control.
   */
  searchPrintings(query: string): Promise<CardPrinting[]>;
  /**
   * Fetch ONE page of search results (1-based). Powers the "Load more printings"
   * UI so each additional page costs a single request. De-duplication across
   * combined pages by scryfallId is the caller's responsibility (the UI merges).
   */
  searchPrintingsPage(query: string, page: number): Promise<ScryfallSearchPage>;
  /** Fetch one exact printing by Scryfall id. */
  getByScryfallId(scryfallId: string): Promise<CardPrinting | null>;
  /** Fetch one exact printing by set code + collector number. */
  getBySetAndCollector(
    setCode: string,
    collectorNumber: string,
  ): Promise<CardPrinting | null>;
  /**
   * High-accuracy exact-printing resolution using ALL available identity
   * signals (id, name, set, collector number, finish). Tries exact id, then
   * exact set/collector (with collector-number variants), then targeted
   * name+set+collector search, then name+set — scoring candidates and NEVER
   * returning a name mismatch. Returns null when no confident match exists.
   */
  resolveExact(input: ResolveExactInput): Promise<CardPrinting | null>;
}

/** Identity signals for high-accuracy printing resolution. */
export interface ResolveExactInput {
  scryfallId?: string | null;
  cardName?: string | null;
  setCode?: string | null;
  collectorNumber?: string | null;
  finish?: string | null;
}

/* ------------------------------------------------------------------ *
 * Scan sessions + card scans (high-volume batch ingestion)
 * ------------------------------------------------------------------ */

/** One uploaded file destined for a scan (front or back of a card). */
export interface UploadedScanFile {
  /** Client-side handle; the real impl uploads to Supabase Storage. */
  file: File | Blob;
  fileName: string;
  side: "front" | "back";
  /** Preserves scanner/batch order across concurrent uploads. */
  sequenceHint: number;
}

export interface ScanIngestProgress {
  total: number;
  processed: number;
  failed: number;
}

export interface ScanRepository {
  listSessions(): Promise<ScanSession[]>;
  getSession(id: string): Promise<ScanSession | null>;
  createSession(input: {
    scannerName: string | null;
    sourceType: ScanSourceType;
    createdBy: string;
    /** Defaults to "both" (the original full-pipeline behavior) when omitted. */
    scanMode?: ScanRecognitionMode;
  }): Promise<ScanSession>;
  updateSessionStatus(
    id: string,
    status: ScanSession["status"],
  ): Promise<ScanSession>;
  setSessionNote(id: string, note: string | null): Promise<ScanSession>;

  /**
   * Ingest a batch of uploaded files into an existing session. Uploads are
   * chunked/concurrent; a single failed file does not fail the batch. Front/back
   * files sharing a card are paired into one CardScan (see pairing rules in the
   * mock). Progress is reported through onProgress. Idempotent per file name.
   */
  ingestBatch(
    sessionId: string,
    files: UploadedScanFile[],
    onProgress?: (p: ScanIngestProgress) => void,
  ): Promise<{ created: CardScan[]; failed: number }>;

  listScans(sessionId: string, query: ScanQuery): Promise<Page<CardScan>>;
  getScan(scanId: string): Promise<CardScan | null>;
  /** Counts per filter tab for the current session. */
  filterCounts(sessionId: string): Promise<Record<string, number>>;

  updateScan(scanId: string, patch: ScanReviewPatch): Promise<CardScan>;
  /** Safe bulk field application. Never bulk-assigns a Scryfall match. */
  bulkUpdate(
    scanIds: string[],
    patch: Omit<ScanReviewPatch, "selectedScryfallId" | "selectedPrinting">,
    reviewer: string,
  ): Promise<CardScan[]>;

  /** Preview which ready scans would create vs increment inventory. */
  previewCommit(sessionId: string): Promise<BatchCommitPreview>;
  /**
   * Commit all ready scans in a session to inventory. Transactional per scan,
   * idempotent (a scan already carrying inventoryItemId is skipped), and reports
   * partial failures without rolling back succeeded rows.
   */
  commitReady(
    sessionId: string,
    reviewer: string,
  ): Promise<BatchCommitResult>;
  /** Commit a single reviewed scan to inventory (scan_add movement). */
  commitScan(scanId: string, reviewer: string): Promise<CardScan>;
}

/* ------------------------------------------------------------------ *
 * Card recognition (future OCR) — pluggable provider, stub today
 * ------------------------------------------------------------------ */

export interface CardRecognitionProvider {
  /** Human-readable id, e.g. "stub" or (later) "scryfall-vision". */
  readonly name: string;
  /** Whether real recognition is available (false for the stub). */
  readonly implemented: boolean;
  /** Recognize a single scan. Stub returns an empty, low-confidence result. */
  recognize(scan: CardScan): Promise<CardRecognitionResult>;
  /**
   * Queue recognition for a scan (future batch/async pipeline). The stub is a
   * no-op that resolves immediately; the boundary exists so a job-based
   * implementation can slot in without schema or interface changes.
   */
  queueRecognition(scanId: string): Promise<void>;
}

export interface OrderRepository {
  list(query: OrderQuery): Promise<Order[]>;
  get(id: string): Promise<Order | null>;
  setStatus(id: string, status: Order["status"], adminName: string): Promise<Order>;
  toggleItemPacked(orderId: string, itemId: string): Promise<Order>;
  addNote(orderId: string, note: string): Promise<Order>;
  /**
   * Mark an order shipped. A `tracked` order requires a carrier + tracking
   * number; a `pwe` (Plain White Envelope) order intentionally has neither —
   * pass null for both rather than inventing tracking data.
   */
  ship(
    orderId: string,
    carrier: ShippingCarrier | null,
    trackingNumber: string | null,
    adminName: string,
  ): Promise<Order>;
  counts(): Promise<Record<string, number>>;
}

export interface CampaignRepository {
  list(): Promise<Campaign[]>;
  get(id: string): Promise<Campaign | null>;
  save(
    input: Omit<
      Campaign,
      | "id"
      | "createdAt"
      | "sentAt"
      | "deliveredCount"
      | "bounceCount"
      | "openCount"
      | "clickCount"
    > & { id?: string },
  ): Promise<Campaign>;
  /**
   * Sending real campaigns is intentionally NOT enabled yet (see the live
   * repository). This exists to satisfy the interface; the live implementation
   * throws a clear "not enabled" error rather than faking a successful send.
   */
  send(id: string): Promise<Campaign>;
  cancel(id: string): Promise<Campaign>;
  /** LIVE recipient count for an audience (no hardcoded figures). */
  recipientCount(audience: Campaign["audience"]): Promise<number>;
}

/* ------------------------------------------------------------------ *
 * Reservations — per-line, per-customer stock holds
 * ------------------------------------------------------------------ */

export interface ReservationRepository {
  /** All active reservations grouped by customer (Reserved tab). */
  listGrouped(): Promise<CustomerReservations[]>;
  /** Flat list of active reservations for one inventory line. */
  listForItem(inventoryItemId: string): Promise<Reservation[]>;
  /**
   * Create a hold. The server locks the inventory row and rejects the request
   * (409) when the requested quantity exceeds current availability, so this
   * can never overbook.
   */
  create(input: {
    inventoryItemId: string;
    customerId: string;
    quantity: number;
    note?: string | null;
  }): Promise<void>;
  /** Release one reservation, fully or by a specific quantity. */
  release(reservationId: string, quantity?: number): Promise<void>;
  /** Release ALL active reservations for a customer (optionally one line). */
  releaseAllForCustomer(
    customerId: string,
    inventoryItemId?: string,
  ): Promise<number>;
}

export interface UserRepository {
  listCustomers(query: CustomerQuery): Promise<Customer[]>;
  getCustomer(id: string): Promise<Customer | null>;
  /**
   * Manually add (or link) a customer by email. Never duplicates, never
   * subscribes to marketing, never creates an Auth account. Returns the
   * customer plus whether a brand-new record was created (vs linked to an
   * existing one) so the UI can show the right message.
   */
  addCustomer(input: {
    email: string;
    firstName: string;
    lastName: string;
  }): Promise<{ customer: Customer; created: boolean }>;
  setCustomerStatus(
    id: string,
    status: Customer["accountStatus"],
  ): Promise<Customer>;
  listStaff(): Promise<StaffMember[]>;
  inviteStaff(
    email: string,
    firstName: string,
    lastName: string,
    role: StaffRole,
  ): Promise<StaffMember>;
  setStaffRole(id: string, role: StaffRole): Promise<StaffMember>;
  setStaffStatus(
    id: string,
    status: StaffMember["status"],
  ): Promise<StaffMember>;
}

export interface AnalyticsRepository {
  overview(range: DateRangeKey): Promise<{
    metrics: OverviewMetrics;
    revenue: TimeSeriesPoint[];
    orders: TimeSeriesPoint[];
    recentActivity: AdminActivity[];
  }>;
  trends(range: DateRangeKey): Promise<TrendMetrics>;
}