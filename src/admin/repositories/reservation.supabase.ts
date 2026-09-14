// LIVE ReservationRepository — real per-line, per-customer stock holds.
//
// Reads use the staff-gated admin_list_reservations RPC (browser client +
// publishable key; SECURITY DEFINER enforces is_staff()). Writes (create /
// release) go through /api/admin/reservations/*, where the atomic RPCs lock the
// inventory row and reject overbooking. The storefront reflects changes
// immediately because inventory_public subtracts ACTIVE reservations.

import { supabase } from "../../supabase";
import type { CustomerReservations, Reservation } from "../types";
import type { ReservationRepository } from "./types";
import { adminFetch } from "./apiClient";
import type { Database } from "../../types/database";

type ReservationRow =
  Database["public"]["Functions"]["admin_list_reservations"]["Returns"][number];

export function mapReservationRow(row: ReservationRow): Reservation {
  return {
    id: row.reservation_id,
    inventoryItemId: row.inventory_item_id,
    customerId: row.customer_id,
    customerEmail: row.customer_email,
    customerFirstName: row.customer_first ?? null,
    customerLastName: row.customer_last ?? null,
    quantity: Number(row.quantity ?? 0),
    note: row.note ?? null,
    reservedBy: row.reserved_by ?? null,
    reservedAt: row.reserved_at,
    cardName: row.card_name,
    setCode: row.set_code,
    setName: row.set_name ?? null,
    collectorNumber: row.collector_number,
    condition: row.condition,
    finish: row.finish,
    imageUrl: row.image_url ?? null,
    onHand: Number(row.on_hand ?? 0),
  };
}

export function groupByCustomer(rows: Reservation[]): CustomerReservations[] {
  const groups = new Map<string, CustomerReservations>();
  for (const r of rows) {
    let group = groups.get(r.customerId);
    if (!group) {
      group = {
        customerId: r.customerId,
        customerEmail: r.customerEmail,
        customerFirstName: r.customerFirstName,
        customerLastName: r.customerLastName,
        totalQuantity: 0,
        reservations: [],
      };
      groups.set(r.customerId, group);
    }
    group.reservations.push(r);
    group.totalQuantity += r.quantity;
  }
  // Stable, friendly ordering: by customer name/email.
  return Array.from(groups.values()).sort((a, b) => {
    const an = `${a.customerFirstName ?? ""} ${a.customerLastName ?? ""}`.trim() ||
      a.customerEmail;
    const bn = `${b.customerFirstName ?? ""} ${b.customerLastName ?? ""}`.trim() ||
      b.customerEmail;
    return an.localeCompare(bn);
  });
}

export const supabaseReservationRepository: ReservationRepository = {
  async listGrouped(): Promise<CustomerReservations[]> {
    const { data, error } = await supabase.rpc("admin_list_reservations");
    if (error) throw new Error(error.message);
    const rows = ((data ?? []) as ReservationRow[]).map(mapReservationRow);
    return groupByCustomer(rows);
  },

  async listForItem(inventoryItemId: string): Promise<Reservation[]> {
    const { data, error } = await supabase.rpc("admin_list_reservations");
    if (error) throw new Error(error.message);
    return ((data ?? []) as ReservationRow[])
      .map(mapReservationRow)
      .filter((r) => r.inventoryItemId === inventoryItemId);
  },

  async create(input): Promise<void> {
    await adminFetch("/api/admin/reservations", {
      method: "POST",
      body: {
        inventoryItemId: input.inventoryItemId,
        customerId: input.customerId,
        quantity: input.quantity,
        note: input.note ?? null,
      },
    });
  },

  async release(reservationId: string, quantity?: number): Promise<void> {
    await adminFetch("/api/admin/reservations/release", {
      method: "POST",
      body: { reservationId, quantity: quantity ?? null },
    });
  },

  async releaseAllForCustomer(
    customerId: string,
    inventoryItemId?: string,
  ): Promise<number> {
    const res = await adminFetch<{ releasedCount: number }>(
      "/api/admin/reservations/release",
      {
        method: "POST",
        body: { customerId, inventoryItemId: inventoryItemId ?? null },
      },
    );
    return Number(res.releasedCount ?? 0);
  },
};