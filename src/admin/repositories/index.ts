// Single place the app resolves its repositories.
//
// ── DATA SOURCE STATUS (Card/Inventory production cutover) ─────────────────
// LIVE (real Supabase + Vercel + Scryfall):
//   • Supabase authentication (AdminAuthGate)
//   • Scryfall lookup .................. liveScryfallRepository (/api/admin/scryfall)
//   • Inventory (card printings, stock,
//     movements, storefront catalog) ... supabaseInventoryRepository
//                                        (reads: RLS + admin_search_inventory RPC;
//                                         writes: /api/admin/inventory/* functions)
//
// STILL MOCKED (intentionally, for a later phase):
//   • Orders ........................... mockOrderRepository
//   • Campaigns / announcements ........ mockCampaignRepository
//   • Customers / staff / users ........ mockUserRepository
//   • Analytics / trends / metrics ..... mockAnalyticsRepository
//   • Scan sessions / batch ingest ..... mockScanRepository (OCR is a stub; when a
//                                        scan is committed it must target the LIVE
//                                        inventory — see scan.mock TODO boundary)
//   • Card recognition (OCR) ........... stubRecognitionProvider
//
// No component or page imports a mock directly — they all import from here, so
// swapping any remaining mock for a live implementation is a one-line change.

import {
  mockAnalyticsRepository,
  mockCampaignRepository,
  mockInventoryRepository,
  mockOrderRepository,
  mockUserRepository,
} from "./mock";
import { supabaseInventoryRepository } from "./inventory.supabase";
import { mockScryfallRepository } from "./scryfall.mock";
import { liveScryfallRepository } from "./scryfall.live";
import { mockScanRepository } from "./scan.mock";
import { stubRecognitionProvider } from "./recognition.stub";
import { isSupabaseConfigured } from "../../supabase";
import type {
  AnalyticsRepository,
  CampaignRepository,
  CardRecognitionProvider,
  InventoryRepository,
  OrderRepository,
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

// Still mocked for this phase (see status banner above).
export const orderRepository: OrderRepository = mockOrderRepository;
export const campaignRepository: CampaignRepository = mockCampaignRepository;
export const userRepository: UserRepository = mockUserRepository;
export const analyticsRepository: AnalyticsRepository = mockAnalyticsRepository;
export const scanRepository: ScanRepository = mockScanRepository;
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
    }`,
  );
}

export type {
  AnalyticsRepository,
  CampaignRepository,
  CardRecognitionProvider,
  InventoryRepository,
  OrderRepository,
  ScanRepository,
  ScryfallRepository,
  UserRepository,
};