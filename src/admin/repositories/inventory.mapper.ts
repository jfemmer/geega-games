// Row <-> domain mapping for the LIVE inventory system.
//
// One place that translates a public.inventory_items row (as returned by the
// admin_search_inventory RPC or a direct select) into the InventoryItem domain
// shape the UI consumes, and back. Keeping this pure and shared means the
// Supabase repository and the tests map rows identically.

import type {
  CardCondition,
  CardFinish,
  CardRarity,
  InventoryItem,
  InventoryMovement,
  InventoryMovementReason,
  ListingStatus,
} from "../types";

/** Superset of the columns returned by admin_search_inventory / inventory row. */
export interface InventoryRowLike {
  id: string;
  scryfall_id: string | null;
  oracle_id?: string | null;
  card_name: string;
  set_code: string;
  set_name: string | null;
  collector_number: string;
  rarity: string | null;
  type_line: string | null;
  image_url: string | null;
  condition: CardCondition;
  finish: CardFinish;
  quantity: number;
  price_cents: number | null;
  cost_cents: number | null;
  scryfall_price_cents: number | null;
  storefront_listed_at?: string;
  is_deal?: boolean;
  deal_source?: "manual" | "aged_inventory" | "flawed" | null;
  original_price_cents?: number | null;
  deal_discount_percent?: number | null;
  deal_started_at?: string | null;
  deal_note?: string | null;
  storage_location: string | null;
  sku: string | null;
  notes: string | null;
  status: ListingStatus;
  variant_type?: string;
  language?: string;
  created_at: string;
  updated_at: string;
}

const KNOWN_RARITIES: CardRarity[] = [
  "common",
  "uncommon",
  "rare",
  "mythic",
  "special",
];

/** Coerce free-text DB rarity to the domain union, or null when unknown. */
export function normalizeRarity(value: string | null | undefined): CardRarity | null {
  if (!value) return null;
  const v = value.toLowerCase();
  return (KNOWN_RARITIES as string[]).includes(v) ? (v as CardRarity) : null;
}

/** Map a DB inventory row to the domain InventoryItem. */
export function mapInventoryRow(row: InventoryRowLike): InventoryItem {
  return {
    id: row.id,
    scryfallId: row.scryfall_id,
    cardName: row.card_name,
    setName: row.set_name,
    setCode: row.set_code,
    collectorNumber: row.collector_number,
    rarity: normalizeRarity(row.rarity),
    cardType: row.type_line,
    imageUrl: row.image_url,
    condition: row.condition,
    finish: row.finish,
    quantity: row.quantity,
    priceCents: row.price_cents ?? 0,
    costCents: row.cost_cents ?? null,
    storageLocation: row.storage_location ?? null,
    sku: row.sku ?? null,
    notes: row.notes ?? null,
    status: row.status,
    variantType: row.variant_type || null,
    scryfallPriceCents: row.scryfall_price_cents ?? null,
    storefrontListedAt: row.storefront_listed_at ?? row.created_at,
    isDeal: row.is_deal ?? false,
    dealSource: row.deal_source ?? null,
    originalPriceCents: row.original_price_cents ?? null,
    dealDiscountPercent: row.deal_discount_percent ?? null,
    dealStartedAt: row.deal_started_at ?? null,
    dealNote: row.deal_note ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Shape of a public.inventory_movements row. */
export interface MovementRowLike {
  id: string;
  inventory_item_id: string;
  card_name: string;
  delta: number;
  previous_quantity: number;
  resulting_quantity: number;
  reason: InventoryMovementReason;
  related_order_number: string | null;
  actor: string | null;
  note: string | null;
  created_at: string;
}

export function mapMovementRow(row: MovementRowLike): InventoryMovement {
  return {
    id: row.id,
    inventoryItemId: row.inventory_item_id,
    cardName: row.card_name,
    delta: row.delta,
    previousQuantity: row.previous_quantity,
    resultingQuantity: row.resulting_quantity,
    reason: row.reason,
    relatedOrderNumber: row.related_order_number,
    actor: row.actor,
    note: row.note,
    createdAt: row.created_at,
  };
}