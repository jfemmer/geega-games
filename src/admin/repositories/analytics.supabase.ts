// LIVE AnalyticsRepository — real aggregation over orders, order_items,
// inventory_items, inventory_movements, customers, newsletter_subscribers,
// and campaigns, via the admin_analytics_overview / admin_analytics_trends
// RPCs (see supabase/migrations/20260916010000_admin_analytics_real_data.sql).
//
// Both RPCs return jsonb shaped to match OverviewMetrics/TrendMetrics/
// TimeSeriesPoint/NamedValue/AdminActivity exactly, so this is a straight
// decode — no field renaming or shape translation.

import { supabase } from "../../supabase";
import type {
  AdminActivity,
  DateRangeKey,
  NamedValue,
  OverviewMetrics,
  SiteTraffic,
  TimeSeriesPoint,
  TrendMetrics,
} from "../types";
import type { AnalyticsRepository } from "./types";

interface OverviewRpcResult {
  metrics: OverviewMetrics;
  revenue: TimeSeriesPoint[];
  orders: TimeSeriesPoint[];
  recentActivity: AdminActivity[];
  customerActivity: AdminActivity[];
}

export const supabaseAnalyticsRepository: AnalyticsRepository = {
  async overview(range: DateRangeKey) {
    const { data, error } = await supabase.rpc("admin_analytics_overview", {
      p_range: range,
    });
    if (error) throw new Error(error.message);
    const result = data as unknown as OverviewRpcResult;
    return {
      metrics: result.metrics,
      revenue: result.revenue ?? [],
      orders: result.orders ?? [],
      recentActivity: result.recentActivity ?? [],
      customerActivity: result.customerActivity ?? [],
    };
  },

  async traffic(range: DateRangeKey): Promise<SiteTraffic> {
    const { data, error } = await supabase.rpc("admin_site_traffic", { p_range: range });
    if (error) throw new Error(error.message);
    const r = (data ?? {}) as unknown as Partial<SiteTraffic>;
    return {
      visitors: r.visitors ?? 0,
      visitorsPrev: r.visitorsPrev ?? 0,
      pageViews: r.pageViews ?? 0,
      pageViewsPrev: r.pageViewsPrev ?? 0,
      liveNow: r.liveNow ?? 0,
      series: r.series ?? [],
      topPages: r.topPages ?? [],
      referrers: r.referrers ?? [],
      devices: r.devices ?? [],
      countries: r.countries ?? [],
      // Absent until the 20260924130000 migration is applied.
      cities: r.cities ?? [],
      regions: r.regions ?? [],
      recentVisitors: r.recentVisitors ?? [],
    };
  },

  async trends(range: DateRangeKey): Promise<TrendMetrics> {
    const { data, error } = await supabase.rpc("admin_analytics_trends", {
      p_range: range,
    });
    if (error) throw new Error(error.message);
    const result = data as unknown as TrendMetrics;
    return {
      revenueSeries: result.revenueSeries ?? [],
      orderSeries: result.orderSeries ?? [],
      averageOrderValueCents: result.averageOrderValueCents ?? 0,
      unitsSold: result.unitsSold ?? 0,
      topCards: (result.topCards ?? []) as NamedValue[],
      topSets: (result.topSets ?? []) as NamedValue[],
      salesByCondition: (result.salesByCondition ?? []) as NamedValue[],
      salesByFinish: (result.salesByFinish ?? []) as NamedValue[],
      inventoryValueCents: result.inventoryValueCents ?? 0,
      estimatedCostBasisCents: result.estimatedCostBasisCents ?? 0,
      estimatedGrossMarginCents: result.estimatedGrossMarginCents ?? 0,
      lowStockCount: result.lowStockCount ?? 0,
      agingInventory: (result.agingInventory ?? []) as NamedValue[],
      newCustomers: result.newCustomers ?? 0,
      repeatCustomers: result.repeatCustomers ?? 0,
      newsletterGrowth: result.newsletterGrowth ?? [],
      campaignPerformance: (result.campaignPerformance ?? []) as NamedValue[],
    };
  },
};
