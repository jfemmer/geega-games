// Single place the app resolves its repositories.
//
// ── DATA SOURCE STATUS (production) ────────────────────────────────────────
// LIVE (real Supabase + Vercel + Scryfall):
//   • Supabase authentication (AdminAuthGate)
//   • Scryfall lookup .................. liveScryfallRepository (/api/admin/scryfall)
//   • Inventory (card printings, stock,
//     movements, storefront catalog) ... supabaseInventoryRepository
//                                        (reads: RLS + admin_search_inventory RPC;
//                                         writes: /api/admin/inventory/* functions)
//   • Reservations (per-line, per-customer
//     holds; storefront availability) .. supabaseReservationRepository
//                                        (reads: admin_list_reservations RPC;
//                                         writes: /api/admin/reservations/*)
//   • Customers + Staff (Users page) ... supabaseUserRepository
//                                        (customers: admin_customer_list RPC +
//                                         /api/admin/customers/*; staff: Auth
//                                         Admin API via /api/admin/staff/*)
//   • Campaigns / announcements ........ supabaseCampaignRepository
//                                        (reads: public.campaigns RLS;
//                                         writes: /api/admin/campaigns/*).
//                                        Sending is NOT enabled — send() throws
//                                        rather than faking delivery stats.
//   • Orders (fulfillment) ............. supabaseOrderRepository
//                                        (reads: orders/order_items RLS, staff
//                                         see every order; writes:
//                                         /api/admin/orders/* — status changes,
//                                         shipping, notes, packing checklist).
//                                        These are the SAME rows the customer
//                                        account's Track My Order page reads.
//   • Scan sessions / batch ingest ..... supabaseScanRepository
//                                        (reads: RLS + scan_filter_counts RPC;
//                                         writes: /api/admin/scan-sessions/* +
//                                         /api/admin/scans/*; uploads: signed
//                                         Storage URLs into the private
//                                         card-scans bucket; commits: the SAME
//                                         admin_upsert_inventory RPC manual
//                                         adds use, reason=scan_add/
//                                         batch_scan_add).
//
// STILL MOCKED (intentionally, outside this phase's scope):
//   • Analytics / trends / metrics ..... mockAnalyticsRepository
//   • Card recognition (OCR) ........... stubRecognitionProvider — honestly
//     reports unavailable (implemented: false) rather than a silent
//     production fallback; there is no live provider yet.
//
// No component or page imports a mock directly — they all import from here, so
// swapping any remaining mock for a live implementation is a one-line change.

import {
  mockAnalyticsRepository,
  mockCampaignRepository,
  mockInventoryRepository,
  mockOrderRepository,
  mockReservationRepository,
  mockUserRepository,
} from "./mock";
import { supabaseInventoryRepository } from "./inventory.supabase";
import { supabaseUserRepository } from "./user.supabase";
import { supabaseCampaignRepository } from "./campaign.supabase";
import { supabaseReservationRepository } from "./reservation.supabase";
import { supabaseOrderRepository } from "./order.supabase";
import { mockScryfallRepository } from "./scryfall.mock";
import { liveScryfallRepository } from "./scryfall.live";
import { mockScanRepository } from "./scan.mock";
import { supabaseScanRepository } from "./scan.supabase";
import { stubRecognitionProvider } from "./recognition.stub";
import { isSupabaseConfigured } from "../../supabase";
import type {
  AnalyticsRepository,
  CampaignRepository,
  CardRecognitionProvider,
  InventoryRepository,
  OrderRepository,
  ReservationRepository,
  ScanRepository,
  ScryfallRepository,
  UserRepository,
} from "./types";

// Accept common truthy spellings so a value like "true" or "1 " (with a stray
// space from the Vercel dashboard) still enables the live path. Vite inlines
// VITE_* vars AT BUILD TIME, so this must be set BEFORE the build and the
// project must be REDEPLOYED after changing it.
function envFlag(name: string): boolean {
  const raw =
    typeof import.meta !== "undefined"
      ? String(import.meta.env?.[name] ?? "").trim().toLowerCase()
      : "";
  return raw === "1" || raw === "true";
}

// Inventory is LIVE whenever Supabase is configured. An explicit escape hatch
// (VITE_USE_MOCK_INVENTORY=1) forces the mock for local UI work without a DB.
// The mock is NEVER a silent production fallback: if Supabase is configured we
// use the real database, and configuration errors surface as real errors.
const forceMockInventory = envFlag("VITE_USE_MOCK_INVENTORY");
const useLiveInventory = isSupabaseConfigured && !forceMockInventory;

export const inventoryRepository: InventoryRepository = useLiveInventory
  ? supabaseInventoryRepository
  : mockInventoryRepository;

// Scryfall: live when explicitly enabled OR whenever Supabase is configured
// (the live inventory add flow depends on real printing search). Falls back to
// the mock catalog only for local/dev/tests with no backend.
const useLiveScryfall = envFlag("VITE_USE_LIVE_SCRYFALL") || useLiveInventory;

export const scryfallRepository: ScryfallRepository = useLiveScryfall
  ? liveScryfallRepository
  : mockScryfallRepository;

// Users, campaigns, and reservations go LIVE whenever Supabase is configured
// (same condition as inventory). The mocks remain only as a no-backend fallback
// for local UI work and are never a silent production path.
const useLiveData = isSupabaseConfigured;

export const userRepository: UserRepository = useLiveData
  ? supabaseUserRepository
  : mockUserRepository;

export const campaignRepository: CampaignRepository = useLiveData
  ? supabaseCampaignRepository
  : mockCampaignRepository;

export const reservationRepository: ReservationRepository = useLiveData
  ? supabaseReservationRepository
  : mockReservationRepository;

// Orders go LIVE whenever Supabase is configured, same as the repositories
// above: reads via RLS (staff can SELECT every order), writes via staff-gated
// /api/admin?resource=orders&action=* Vercel Functions (service role). This is
// what lets a real "mark shipped" reach the same order row the customer's
// Track My Order page reads.
export const orderRepository: OrderRepository = useLiveData
  ? supabaseOrderRepository
  : mockOrderRepository;

// Scan sessions / batch ingest go LIVE whenever Supabase is configured, same
// condition as users/campaigns/reservations/orders: reads via RLS +
// scan_filter_counts(), writes via staff-gated /api/admin/scan-sessions/* and
// /api/admin/scans/* Vercel Functions (service role), commits through the
// SAME admin_upsert_inventory RPC manual adds use. `isScanRepositoryLive` lets
// call sites (e.g. the "seed a demo session" dev convenience) tell whether
// they're pointed at the real database and skip anything mock-only.
export const isScanRepositoryLive = useLiveData;
export const scanRepository: ScanRepository = useLiveData
  ? supabaseScanRepository
  : mockScanRepository;

// Recognition (OCR) has no live implementation yet — the stub is honest
// about that (implemented: false, empty result, explicit warning) rather
// than a silent production fallback, so it's used regardless of the flags
// above until a real provider lands.
export const analyticsRepository: AnalyticsRepository = mockAnalyticsRepository;
export const recognitionProvider: CardRecognitionProvider =
  stubRecognitionProvider;

// One-time breadcrumb so it's obvious in the browser console which sources are
// active. If inventory/Scryfall show "mock" unexpectedly, Supabase env vars are
// missing or the build predates the env change — configure + redeploy.
if (typeof console !== "undefined") {
  console.info(
    `[Geega] Inventory source: ${
      useLiveInventory ? "LIVE (Supabase)" : "mock"
    } · Scryfall source: ${
      useLiveScryfall ? "LIVE (/api/admin/scryfall)" : "mock catalog"
    } · Users/Campaigns/Reservations/Orders/Scanning: ${useLiveData ? "LIVE (Supabase)" : "mock"} · Recognition: stub (not implemented)`,
  );
}

export type {
  AnalyticsRepository,
  CampaignRepository,
  CardRecognitionProvider,
  InventoryRepository,
  OrderRepository,
  ReservationRepository,
  ScanRepository,
  ScryfallRepository,
  UserRepository,
};