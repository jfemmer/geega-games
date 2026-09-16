// LIVE PosRepository — the in-store register. Every action here is a
// privileged write (creating a real order, marking it paid, charging a
// physical card reader), so everything goes through the staff-guarded
// /api/admin?resource=pos&action=* router (service-role key server-side,
// same pattern as user.supabase.ts / reservation.supabase.ts).

import { adminFetch } from "./apiClient";
import type {
  PosSaleItem,
  PosSaleResult,
  PosSettings,
  PosTerminalLocation,
  PosTerminalReader,
} from "../types";
import type { PosRepository } from "./types";

const BASE = "/api/admin?resource=pos";

function action(name: string): string {
  return `${BASE}&action=${name}`;
}

export const supabasePosRepository: PosRepository = {
  async createSale(items: PosSaleItem[], customerId, notes) {
    const res = await adminFetch<{ sale: Record<string, unknown> }>(action("create-sale"), {
      method: "POST",
      body: {
        items: items.map((i) => ({ inventoryItemId: i.inventoryItemId, quantity: i.quantity })),
        customerId: customerId ?? undefined,
        notes: notes ?? undefined,
      },
    });
    const s = res.sale;
    return {
      orderId: String(s.order_id),
      subtotalCents: Number(s.subtotal_cents),
      taxCents: Number(s.tax_cents),
      totalCents: Number(s.total_cents),
      amountDueCents: Number(s.amount_due_cents),
    } satisfies PosSaleResult;
  },

  async markCashPaid(orderId, tenderedCents) {
    const res = await adminFetch<{ changeCents: number }>(action("mark-cash-paid"), {
      method: "POST",
      body: { orderId, tenderedCents },
    });
    return { changeCents: res.changeCents };
  },

  async voidSale(orderId, reason) {
    await adminFetch<{ ok: true }>(action("void-sale"), {
      method: "POST",
      body: { orderId, reason: reason ?? undefined },
    });
  },

  async getSettings() {
    const res = await adminFetch<{ settings: { sales_tax_bps: number } }>(action("settings"), {
      method: "GET",
    });
    return { salesTaxBps: res.settings.sales_tax_bps } satisfies PosSettings;
  },

  async saveSettings(salesTaxBps) {
    const res = await adminFetch<{ settings: { sales_tax_bps: number } }>(
      action("save-settings"),
      { method: "POST", body: { salesTaxBps } },
    );
    return { salesTaxBps: res.settings.sales_tax_bps } satisfies PosSettings;
  },

  async terminalConnectionToken() {
    const res = await adminFetch<{ secret: string }>(action("terminal-connection-token"), {
      method: "POST",
    });
    return res.secret;
  },

  async terminalCreateIntent(orderId) {
    const res = await adminFetch<{ clientSecret: string; paymentIntentId: string }>(
      action("terminal-create-intent"),
      { method: "POST", body: { orderId } },
    );
    return res;
  },

  async terminalLocations() {
    const res = await adminFetch<{ locations: { id: string; display_name: string }[] }>(
      action("terminal-locations"),
      { method: "GET" },
    );
    return res.locations.map((l) => ({ id: l.id, displayName: l.display_name }));
  },

  async terminalCreateLocation(input) {
    const res = await adminFetch<{ location: { id: string; display_name: string } }>(
      action("terminal-create-location"),
      { method: "POST", body: input },
    );
    return { id: res.location.id, displayName: res.location.display_name } satisfies PosTerminalLocation;
  },

  async terminalReaders(locationId) {
    const suffix = locationId ? `&locationId=${encodeURIComponent(locationId)}` : "";
    const res = await adminFetch<{
      readers: { id: string; label: string | null; status: string; device_type: string }[];
    }>(`${action("terminal-readers")}${suffix}`, { method: "GET" });
    return res.readers.map((r) => ({
      id: r.id,
      label: r.label || r.id,
      status: r.status,
      deviceType: r.device_type,
    })) satisfies PosTerminalReader[];
  },
};
