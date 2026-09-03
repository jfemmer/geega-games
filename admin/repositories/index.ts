// Single place the app resolves its repositories.
//
// TODAY: everything is backed by the in-memory mock implementations.
//
// LATER: to connect real data, implement the same interfaces against Supabase
// (browser client for reads protected by RLS) and Vercel Functions under
// /api/admin/* (for privileged writes), then swap the assignments below. No
// component or page imports the mock directly — they all import from here.

import {
  mockAnalyticsRepository,
  mockCampaignRepository,
  mockInventoryRepository,
  mockOrderRepository,
  mockUserRepository,
} from "./mock";
import type {
  AnalyticsRepository,
  CampaignRepository,
  InventoryRepository,
  OrderRepository,
  UserRepository,
} from "./types";

export const inventoryRepository: InventoryRepository =
  mockInventoryRepository;
export const orderRepository: OrderRepository = mockOrderRepository;
export const campaignRepository: CampaignRepository = mockCampaignRepository;
export const userRepository: UserRepository = mockUserRepository;
export const analyticsRepository: AnalyticsRepository =
  mockAnalyticsRepository;

export type {
  AnalyticsRepository,
  CampaignRepository,
  InventoryRepository,
  OrderRepository,
  UserRepository,
};
