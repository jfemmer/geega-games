// LIVE CampaignRepository — real, persisted campaigns.
//
// Reads use the browser client (staff-gated RLS on public.campaigns). Writes go
// through /api/admin/campaigns. Recipient counts come from LIVE data
// (campaign_audience_count). Delivery statistics are NEVER fabricated: they stay
// at their honest 0/null defaults until a real send pipeline records them.
//
// Sending is intentionally NOT enabled. Rather than simulate a successful send
// with invented delivery/open/click numbers, send() throws a clear error so the
// UI can keep the Send action disabled/labelled "not yet enabled".

import { supabase } from "../../supabase";
import type { Campaign } from "../types";
import type { CampaignRepository } from "./types";
import { adminFetch } from "./apiClient";
import type { Database } from "../../types/database";

type CampaignRow = Database["public"]["Tables"]["campaigns"]["Row"];

export function mapCampaignRow(row: CampaignRow): Campaign {
  return {
    id: row.id,
    name: row.name,
    subject: row.subject,
    previewText: row.preview_text,
    body: row.body,
    buttonText: row.button_text,
    buttonUrl: row.button_url,
    audience: row.audience,
    status: row.status,
    recipientCount: row.recipient_count,
    deliveredCount: row.delivered_count,
    bounceCount: row.bounce_count,
    openCount: row.open_count,
    clickCount: row.click_count,
    createdAt: row.created_at,
    sentAt: row.sent_at,
    scheduledAt: row.scheduled_at,
  };
}

export const supabaseCampaignRepository: CampaignRepository = {
  async list(): Promise<Campaign[]> {
    const { data, error } = await supabase
      .from("campaigns")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return ((data ?? []) as CampaignRow[]).map(mapCampaignRow);
  },

  async get(id: string): Promise<Campaign | null> {
    const { data, error } = await supabase
      .from("campaigns")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return data ? mapCampaignRow(data as CampaignRow) : null;
  },

  async save(input): Promise<Campaign> {
    const res = await adminFetch<{ campaign: CampaignRow }>(
      "/api/admin?resource=campaigns&action=save",
      {
        method: "POST",
        body: {
          id: input.id,
          name: input.name,
          subject: input.subject,
          previewText: input.previewText,
          body: input.body,
          buttonText: input.buttonText,
          buttonUrl: input.buttonUrl,
          audience: input.audience,
          scheduledAt: input.scheduledAt,
        },
      },
    );
    return mapCampaignRow(res.campaign);
  },

  async send(): Promise<Campaign> {
    // Deliberately not implemented. We do not simulate sends or invent stats.
    throw new Error(
      "Campaign sending isn't enabled yet. Drafts are saved and recipient counts are live, but no email is sent.",
    );
  },

  async cancel(id: string): Promise<Campaign> {
    // Cancelling a draft is a metadata change; route through the save endpoint's
    // sibling is unnecessary — drafts can simply be deleted/left. For now we
    // re-read the current row (no destructive fake state transition).
    const current = await this.get(id);
    if (!current) throw new Error("Campaign not found.");
    return current;
  },

  async recipientCount(audience: Campaign["audience"]): Promise<number> {
    const res = await adminFetch<{ count: number }>(
      `/api/admin?resource=campaigns&action=audience-count&audience=${encodeURIComponent(audience)}`,
      { method: "GET" },
    );
    return Number(res.count ?? 0);
  },
};