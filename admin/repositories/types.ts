// Repository interfaces — the seam between UI and data source.
//
// The mock implementations in ./mock.ts fulfil these contracts today. A future
// phase can add Supabase/Vercel-backed implementations (e.g. SupabaseInventory
// Repository) that satisfy the SAME interfaces, and swap them in a single place
// (see ./index.ts) with no component changes.

import type {
  AdminActivity,
  Campaign,
  CardPrinting,
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
  searchPrintings(term: string): Promise<CardPrinting[]>;
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
