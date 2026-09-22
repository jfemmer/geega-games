// LIVE InsightsRepository — sourcing signals (admin_sourcing_signals RPC),
// order geography (admin_order_geography RPC), and market research notes
// (direct RLS-scoped CRUD on market_research_notes, the same "plain table +
// RLS" pattern customer_wishlist_items uses — no server-side logic needed
// for a straightforward owner-authored notes table).

import { supabase } from "../../supabase";
import type { MarketResearchNote } from "../types";
import type { InsightsRepository } from "./types";

interface SourcingSignalRow {
  oracle_id: string;
  card_name: string;
  wishlist_count: number;
  stock_alert_count: number;
  total_demand: number;
  currently_in_stock: boolean;
  in_stock_quantity: number;
}

interface OrderGeographyDbRow {
  ship_state: string;
  ship_city: string;
  order_count: number;
  total_revenue_cents: number;
  first_order_at: string;
  last_order_at: string;
  sample_postal_code: string | null;
}

interface MarketResearchNoteRow {
  id: string;
  region_label: string;
  state: string | null;
  competitor_count: number | null;
  population: number | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

function mapNote(row: MarketResearchNoteRow): MarketResearchNote {
  return {
    id: row.id,
    regionLabel: row.region_label,
    state: row.state,
    competitorCount: row.competitor_count,
    population: row.population,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export const supabaseInsightsRepository: InsightsRepository = {
  async sourcingSignals() {
    const { data, error } = await supabase.rpc("admin_sourcing_signals");
    if (error) throw new Error(error.message);
    return ((data ?? []) as SourcingSignalRow[]).map((r) => ({
      oracleId: r.oracle_id,
      cardName: r.card_name,
      wishlistCount: r.wishlist_count,
      stockAlertCount: r.stock_alert_count,
      totalDemand: r.total_demand,
      currentlyInStock: r.currently_in_stock,
      inStockQuantity: r.in_stock_quantity,
    }));
  },

  async orderGeography() {
    const { data, error } = await supabase.rpc("admin_order_geography");
    if (error) throw new Error(error.message);
    return ((data ?? []) as OrderGeographyDbRow[]).map((r) => ({
      shipState: r.ship_state,
      shipCity: r.ship_city,
      orderCount: r.order_count,
      totalRevenueCents: r.total_revenue_cents,
      firstOrderAt: r.first_order_at,
      lastOrderAt: r.last_order_at,
      samplePostalCode: r.sample_postal_code,
    }));
  },

  async listMarketResearchNotes() {
    const { data, error } = await supabase
      .from("market_research_notes")
      .select("id, region_label, state, competitor_count, population, notes, created_at, updated_at")
      .order("region_label", { ascending: true });
    if (error) throw new Error(error.message);
    return ((data ?? []) as MarketResearchNoteRow[]).map(mapNote);
  },

  async saveMarketResearchNote(id, input) {
    const payload = {
      region_label: input.regionLabel,
      state: input.state,
      competitor_count: input.competitorCount,
      population: input.population,
      notes: input.notes,
      updated_at: new Date().toISOString(),
    };
    if (id) {
      const { data, error } = await supabase
        .from("market_research_notes")
        .update(payload)
        .eq("id", id)
        .select("id, region_label, state, competitor_count, population, notes, created_at, updated_at")
        .single();
      if (error) throw new Error(error.message);
      return mapNote(data as MarketResearchNoteRow);
    }
    const { data: userData } = await supabase.auth.getUser();
    const { data, error } = await supabase
      .from("market_research_notes")
      .insert({ ...payload, created_by: userData.user?.id ?? null })
      .select("id, region_label, state, competitor_count, population, notes, created_at, updated_at")
      .single();
    if (error) throw new Error(error.message);
    return mapNote(data as MarketResearchNoteRow);
  },

  async deleteMarketResearchNote(id) {
    const { error } = await supabase.from("market_research_notes").delete().eq("id", id);
    if (error) throw new Error(error.message);
  },
};
