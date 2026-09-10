// Single place the app resolves its repositories.
//
// TODAY: everything is backed by the in-memory mock implementations, so the
// entire admin dashboard (including Scryfall search and the batch scanning
// pipeline) runs with no network or database.
//
// LATER: to connect real data, implement the same interfaces against Supabase
// (browser client for reads protected by RLS) and Vercel Functions under
// /api/admin/* (for privileged writes), then swap the assignments below. No
// component or page imports a mock directly — they all import from here.
//
// The Scryfall repository already has a live implementation (scryfall.live.ts)
// that proxies through /api/admin/scryfall. It is selected when
// VITE_USE_LIVE_SCRYFALL is set, otherwise the mock catalog is used.

import {
  mockAnalyticsRepository,
  mockCampaignRepository,
  mockInventoryRepository,
  mockOrderRepository,
  mockUserRepository,
} from "./mock";
import { mockScryfallRepository } from "./scryfall.mock";
import { liveScryfallRepository } from "./scryfall.live";
import { mockScanRepository } from "./scan.mock";
import { stubRecognitionProvider } from "./recognition.stub";
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
// project must be REDEPLOYED after changing it — changing it in the dashboard
// without a new deploy has no effect.
const liveFlag =
  typeof import.meta !== "undefined"
    ? String(import.meta.env?.VITE_USE_LIVE_SCRYFALL ?? "")
        .trim()
        .toLowerCase()
    : "";
const useLiveScryfall = liveFlag === "1" || liveFlag === "true";

export const inventoryRepository: InventoryRepository = mockInventoryRepository;
export const orderRepository: OrderRepository = mockOrderRepository;
export const campaignRepository: CampaignRepository = mockCampaignRepository;
export const userRepository: UserRepository = mockUserRepository;
export const analyticsRepository: AnalyticsRepository = mockAnalyticsRepository;

export const scryfallRepository: ScryfallRepository = useLiveScryfall
  ? liveScryfallRepository
  : mockScryfallRepository;

// One-time breadcrumb so it's obvious in the browser console which data source
// is active. If you set VITE_USE_LIVE_SCRYFALL but still see "mock" here, the
// build predates the env change — redeploy.
if (typeof console !== "undefined") {
  console.info(
    `[Geega] Scryfall source: ${useLiveScryfall ? "LIVE (/api/admin/scryfall)" : "mock catalog"}`,
  );
}
export const scanRepository: ScanRepository = mockScanRepository;
export const recognitionProvider: CardRecognitionProvider =
  stubRecognitionProvider;

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