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
  DateRangeKey,
  InventoryItem,
  InventoryMovement,
  InventoryQuery,
  Order,
  OrderQuery,
  OverviewMetrics,
  Page,
  ScanQuery,
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
  /** Distinct set codes present in inventory, for the set filter. */
  setCodes(): Promise<string[]>;
  create(
    input: Omit<InventoryItem, "id" | "createdAt" | "updatedAt">,
    adminName: string,
  ): Promise<InventoryItem>;
  update(id: string, patch: Partial<InventoryItem>): Promise<InventoryItem>;
  /** Adjust quantity through the movement ledger (never silent overwrite). */
  adjustQuantity(
    id: string,
    delta: number,
    reason: InventoryMovement["reason"],
    adminName: string,
  ): Promise<InventoryItem>;
  archive(id: string): Promise<InventoryItem>;
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
  ship(
    orderId: string,
    carrier: ShippingCarrier,
    trackingNumber: string,
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
  /** Mock send — never sends real email; simulates queue -> sent. */
  send(id: string): Promise<Campaign>;
  cancel(id: string): Promise<Campaign>;
  recipientCount(audience: Campaign["audience"]): Promise<number>;
}

export interface UserRepository {
  listCustomers(query: CustomerQuery): Promise<Customer[]>;
  getCustomer(id: string): Promise<Customer | null>;
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