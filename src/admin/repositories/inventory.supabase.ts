// LIVE InventoryRepository — backed by the real Supabase database.
//
// This is the production implementation of the InventoryRepository contract and
// the single source of truth the storefront also reads (via inventory_public).
// It replaces the in-memory mockInventoryRepository for all production flows.
//
// SECURITY MODEL (unchanged from the project's established pattern):
//   * READS use the browser Supabase client with the PUBLISHABLE key. They are
//     gated by RLS and by the staff-guarded SECURITY DEFINER RPC
//     admin_search_inventory(), so a non-staff session sees nothing.
//   * WRITES (create / update / adjust / archive) NEVER touch privileged SQL
//     from the browser. They POST to staff-guarded Vercel Functions under
//     /api/admin/inventory/*, which use the service-role key server-side after
//     verifying the caller's Supabase bearer token via requireStaff(). The
//     service-role key is never exposed to React.
//
// Filtering / sorting / pagination happen IN THE DATABASE (admin_search_inventory
// returns total_count alongside the page), so this scales to tens of thousands
// of rows without downloading the whole table.

import { supabase } from "../../supabase";
import type {
  CardCondition,
  CardFinish,
  FloorableRarity,
  InventoryItem,
  InventoryMovement,
  InventoryPriceFloor,
  InventoryPrintingEdit,
  InventoryQuery,
  Page,
  CardPrinting,
  PriceFloorRepriceCounts,
} from "../types";
import type { InventoryRepository } from "./types";
import {
  mapInventoryRow,
  mapMovementRow,
  type InventoryRowLike,
  type MovementRowLike,
} from "./inventory.mapper";

const API_BASE = "/api/admin/inventory";
const LOW_STOCK_THRESHOLD = 2;

/* ------------------------------------------------------------------ *
 * Auth + fetch helpers (privileged writes)
 * ------------------------------------------------------------------ */

async function getAccessToken(): Promise<string | null> {
  try {
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token ?? null;
  } catch {
    return null;
  }
}

async function authFetch<T>(
  path: string,
  init: { method: string; body?: unknown },
): Promise<T> {
  const token = await getAccessToken();
  if (!token) {
    throw new Error(
      "You must be signed in as staff to modify inventory. Please sign in and try again.",
    );
  }
  const res = await fetch(`${API_BASE}${path}`, {
    method: init.method,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    credentials: "same-origin",
    body: init.body != null ? JSON.stringify(init.body) : undefined,
  });

  if (res.status === 401 || res.status === 403) {
    throw new Error(
      "Your session isn't authorized to change inventory. Sign in as a staff user and retry.",
    );
  }
  if (!res.ok) {
    // Preserve the server's friendly message for 400/404/409 (duplicate
    // identity, unsafe delete, invalid finish, etc.) so the UI can show it.
    let message = `Request failed (${res.status}).`;
    try {
      const body = (await res.json()) as { message?: string };
      if (body?.message) message = body.message;
    } catch {
      /* ignore */
    }
    throw new Error(message);
  }
  // 204 No Content (delete) has no body to parse.
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

/* ------------------------------------------------------------------ *
 * Query param mapping (domain -> RPC args)
 * ------------------------------------------------------------------ */

function stockArg(stock: InventoryQuery["stock"]): string {
  // Domain stock filter is 'all' | 'in' | 'low' | 'out'; all are understood by
  // admin_search_inventory(p_stock), so quantity filtering happens IN THE DB.
  return stock && stock !== "all" ? stock : "all";
}

/* ------------------------------------------------------------------ *
 * Repository
 * ------------------------------------------------------------------ */

export const supabaseInventoryRepository: InventoryRepository = {
  async list(query: InventoryQuery): Promise<Page<InventoryItem>> {
    const page = Math.max(1, query.page ?? 1);
    const pageSize = Math.min(200, Math.max(1, query.pageSize ?? 25));
    const offset = (page - 1) * pageSize;

    const { data, error } = await supabase.rpc("admin_search_inventory", {
      p_query: query.search?.trim() || undefined,
      p_status: query.status && query.status !== "all" ? query.status : "all",
      p_stock: stockArg(query.stock),
      p_condition:
        query.condition && query.condition !== "all" ? query.condition : "all",
      p_finish: query.finish && query.finish !== "all" ? query.finish : "all",
      p_set_code:
        query.setCode && query.setCode !== "all" ? query.setCode : "all",
      p_sort: query.sortBy ?? "updated",
      p_sort_dir: query.sortDir ?? "desc",
      p_low_stock_threshold: LOW_STOCK_THRESHOLD,
      p_limit: pageSize,
      p_offset: offset,
    });

    if (error) throw new Error(error.message);

    const rows = (data ?? []) as (InventoryRowLike & { total_count: number })[];
    const total = rows.length > 0 ? Number(rows[0].total_count) : 0;
    return { rows: rows.map(mapInventoryRow), total };
  },

  async get(id: string): Promise<InventoryItem | null> {
    const { data, error } = await supabase
      .from("inventory_items")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return data ? mapInventoryRow(data as InventoryRowLike) : null;
  },

  async setOptions(): Promise<{ code: string; name: string }[]> {
    const { data, error } = await supabase.rpc("admin_inventory_set_codes");
    if (error) throw new Error(error.message);
    return ((data ?? []) as { set_code: string; set_name: string | null }[]).map((r) => ({
      code: r.set_code,
      name: r.set_name ?? r.set_code,
    }));
  },

  async create(
    input: Omit<InventoryItem, "id" | "createdAt" | "updatedAt">,
    adminName: string,
  ): Promise<InventoryItem> {
    // Privileged: server upserts printing + inventory line + movement atomically.
    const row = await authFetch<InventoryRowLike>("", {
      method: "POST",
      body: {
        scryfallId: input.scryfallId,
        cardName: input.cardName,
        setCode: input.setCode,
        setName: input.setName,
        collectorNumber: input.collectorNumber,
        rarity: input.rarity,
        cardType: input.cardType,
        imageUrl: input.imageUrl,
        condition: input.condition,
        finish: input.finish,
        quantity: input.quantity,
        priceCents: input.priceCents,
        costCents: input.costCents,
        scryfallPriceCents: input.scryfallPriceCents,
        storageLocation: input.storageLocation,
        sku: input.sku,
        notes: input.notes,
        actor: adminName,
      },
    });
    return mapInventoryRow(row);
  },

  async update(
    id: string,
    patch: Partial<InventoryItem>,
  ): Promise<InventoryItem> {
    const row = await authFetch<InventoryRowLike>(`/${id}`, {
      method: "PATCH",
      body: {
        priceCents: patch.priceCents,
        costCents: patch.costCents,
        scryfallPriceCents: patch.scryfallPriceCents,
        storageLocation: patch.storageLocation,
        sku: patch.sku,
        notes: patch.notes,
        status: patch.status,
        imageUrl: patch.imageUrl,
      },
    });
    return mapInventoryRow(row);
  },

  async adjustQuantity(
    id: string,
    delta: number,
    reason: InventoryMovement["reason"],
    adminName: string,
  ): Promise<InventoryItem> {
    const row = await authFetch<InventoryRowLike>(`/${id}/adjust`, {
      method: "POST",
      body: { delta, reason, actor: adminName },
    });
    return mapInventoryRow(row);
  },

  async updatePrinting(
    id: string,
    input: InventoryPrintingEdit,
    adminName: string,
  ): Promise<InventoryItem> {
    // The PATCH endpoint validates + re-resolves the exact printing server-side
    // and refreshes all denormalized metadata. A duplicate identity or an
    // unavailable finish comes back as a 409/400 with a friendly message.
    const row = await authFetch<InventoryRowLike>(`/${id}`, {
      method: "PATCH",
      body: {
        scryfallId: input.scryfallId,
        setCode: input.setCode,
        collectorNumber: input.collectorNumber,
        cardName: input.cardName,
        condition: input.condition,
        finish: input.finish,
        priceCents: input.priceCents,
        costCents: input.costCents,
        storageLocation: input.storageLocation,
        sku: input.sku,
        notes: input.notes,
        actor: adminName,
      },
    });
    return mapInventoryRow(row);
  },

  async archive(id: string): Promise<InventoryItem> {
    const row = await authFetch<InventoryRowLike>(`/${id}/archive`, {
      method: "POST",
      body: {},
    });
    return mapInventoryRow(row);
  },

  async restore(id: string): Promise<InventoryItem> {
    const row = await authFetch<InventoryRowLike>(`/${id}/archive`, {
      method: "POST",
      body: { restore: true },
    });
    return mapInventoryRow(row);
  },

  async delete(id: string): Promise<void> {
    // The server runs the historical-safety check and returns 409 when the row
    // is referenced by orders/carts/scans; authFetch turns that into an Error
    // whose message tells the admin to archive instead.
    await authFetch<void>(`/${id}`, { method: "DELETE" });
  },

  async movements(itemId?: string): Promise<InventoryMovement[]> {
    let q = supabase
      .from("inventory_movements")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(200);
    if (itemId) q = q.eq("inventory_item_id", itemId);
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    return ((data ?? []) as MovementRowLike[]).map(mapMovementRow);
  },

  async findMatch(
    setCode: string,
    collectorNumber: string,
    condition: CardCondition,
    finish: CardFinish,
  ): Promise<InventoryItem | null> {
    const { data, error } = await supabase
      .from("inventory_items")
      .select("*")
      .eq("set_code", setCode)
      .eq("collector_number", collectorNumber)
      .eq("condition", condition)
      .eq("finish", finish)
      .neq("status", "archived")
      .limit(1);
    if (error) throw new Error(error.message);
    const row = (data ?? [])[0] as InventoryRowLike | undefined;
    return row ? mapInventoryRow(row) : null;
  },

  async findMatchByScryfall(
    scryfallId: string,
    condition: CardCondition,
    finish: CardFinish,
  ): Promise<InventoryItem | null> {
    const { data, error } = await supabase
      .from("inventory_items")
      .select("*")
      .eq("scryfall_id", scryfallId)
      .eq("condition", condition)
      .eq("finish", finish)
      .neq("status", "archived")
      .limit(1);
    if (error) throw new Error(error.message);
    const row = (data ?? [])[0] as InventoryRowLike | undefined;
    return row ? mapInventoryRow(row) : null;
  },

  async searchPrintings(term: string): Promise<CardPrinting[]> {
    // Inventory-scoped printing search is not used by the live add flow (the
    // Scryfall repository powers printing search). Return empty rather than
    // guess; kept to satisfy the interface.
    void term;
    return [];
  },

  async getPriceFloors(): Promise<InventoryPriceFloor[]> {
    const { data, error } = await supabase
      .from("inventory_price_floors")
      .select("rarity, min_price_cents, updated_at, updated_by")
      .order("rarity");
    if (error) throw new Error(error.message);
    return (data ?? []).map((r) => ({
      rarity: r.rarity as FloorableRarity,
      minPriceCents: r.min_price_cents,
      updatedAt: r.updated_at,
      updatedBy: r.updated_by,
    }));
  },

  async previewPriceFloors(
    floors: Record<FloorableRarity, number>,
  ): Promise<PriceFloorRepriceCounts> {
    const res = await authFetch<{ repriced: PriceFloorRepriceCounts }>("/price-floors", {
      method: "PUT",
      body: { ...floors, dryRun: true },
    });
    return res.repriced;
  },

  async savePriceFloors(floors: Record<FloorableRarity, number>): Promise<{
    floors: InventoryPriceFloor[];
    repriced: PriceFloorRepriceCounts;
  }> {
    const res = await authFetch<{
      floors: {
        rarity: FloorableRarity;
        min_price_cents: number;
        updated_at: string;
        updated_by: string | null;
      }[];
      repriced: PriceFloorRepriceCounts;
    }>("/price-floors", { method: "PUT", body: floors });
    return {
      floors: res.floors.map((r) => ({
        rarity: r.rarity,
        minPriceCents: r.min_price_cents,
        updatedAt: r.updated_at,
        updatedBy: r.updated_by,
      })),
      repriced: res.repriced,
    };
  },

  async bulkUpdate(
    itemIds: string[],
    patch: {
      status?: "active" | "archived";
      priceCents?: number;
      priceAdjustPercent?: number;
      storageLocation?: string | null;
    },
  ): Promise<{ updatedCount: number }> {
    const res = await authFetch<{ updatedCount: number }>("/bulk", {
      method: "PATCH",
      body: { itemIds, ...patch },
    });
    return { updatedCount: res.updatedCount };
  },
};