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

const useLiveScryfall =
  typeof import.meta !== "undefined" &&
  import.meta.env?.VITE_USE_LIVE_SCRYFALL === "1";

export const inventoryRepository: InventoryRepository = mockInventoryRepository;
export const orderRepository: OrderRepository = mockOrderRepository;
export const campaignRepository: CampaignRepository = mockCampaignRepository;
export const userRepository: UserRepository = mockUserRepository;
export const analyticsRepository: AnalyticsRepository = mockAnalyticsRepository;

export const scryfallRepository: ScryfallRepository = useLiveScryfall
  ? liveScryfallRepository
  : mockScryfallRepository;
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
