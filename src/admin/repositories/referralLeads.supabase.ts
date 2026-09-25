import { supabase } from "../../supabase";
import { adminFetch } from "./apiClient";
import type { ReferralLead, ReferralLeadStatus } from "../types";
import type { Database } from "../../types/database";

// LIVE repository for the admin Partner Leads page — Pokémon / One Piece /
// video game sellers who asked to be connected with the buying partner
// (public.referral_leads). Same split as buyingLeads.supabase.ts:
//   * reads use the browser client directly (staff-only SELECT policy);
//   * the one write, status, goes through /api/admin/referral-leads/:id
//     (service_role — `authenticated` has no write grant on the table);
//   * photos live in the private sell-photos bucket, whose storage.objects
//     SELECT policy is staff-only, so signed URLs are minted from the admin's
//     own session.

const SELL_PHOTOS_BUCKET = "sell-photos";
/** Viewing photos in the drawer. */
const VIEW_LINK_TTL_SECONDS = 60 * 30;
/** Links copied for the buying partner — same lifetime as the new-lead email's. */
export const PARTNER_LINK_DAYS = 7;

type Row = Database["public"]["Tables"]["referral_leads"]["Row"];

function mapLead(row: Row): ReferralLead {
  return {
    id: row.id,
    referenceNumber: row.reference_number,
    createdAt: row.created_at,
    categories: row.categories,
    description: row.description,
    collectionSize: row.collection_size,
    handoff: row.handoff,
    firstName: row.first_name,
    lastName: row.last_name,
    email: row.email,
    phone: row.phone,
    preferredContactMethod: row.preferred_contact_method,
    location: row.location,
    photoPaths: row.photo_paths,
    sourcePath: row.source_path,
    consentToShareAt: row.consent_to_share_at,
    status: row.status as ReferralLeadStatus,
  };
}

export interface ReferralLeadsQuery {
  status?: ReferralLeadStatus | "all";
  search?: string;
}

export const referralLeadsRepository = {
  async list(query: ReferralLeadsQuery): Promise<ReferralLead[]> {
    let q = supabase
      .from("referral_leads")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(500);
    if (query.status && query.status !== "all") q = q.eq("status", query.status);

    const term = query.search?.trim();
    if (term) {
      // Strip characters that are syntax in a PostgREST or() filter.
      const like = `%${term.replace(/[%_,()*]/g, "")}%`;
      q = q.or(
        [
          `first_name.ilike.${like}`,
          `last_name.ilike.${like}`,
          `email.ilike.${like}`,
          `phone.ilike.${like}`,
          `reference_number.ilike.${like}`,
          `location.ilike.${like}`,
        ].join(","),
      );
    }

    const { data, error } = await q;
    if (error) throw new Error(error.message);
    return (data ?? []).map(mapLead);
  },

  async counts(): Promise<Record<string, number>> {
    const { data, error } = await supabase.from("referral_leads").select("status");
    if (error) throw new Error(error.message);
    const out: Record<string, number> = { all: 0 };
    for (const row of (data ?? []) as { status: string }[]) {
      out.all += 1;
      out[row.status] = (out[row.status] ?? 0) + 1;
    }
    return out;
  },

  async setStatus(id: string, status: ReferralLeadStatus): Promise<void> {
    await adminFetch(`/api/admin/referral-leads/${id}`, { method: "PATCH", body: { status } });
  },

  /** Signed URLs for a lead's photos, in the same order. Missing ones are dropped. */
  async photoUrls(paths: string[], ttlSeconds: number = VIEW_LINK_TTL_SECONDS): Promise<string[]> {
    if (paths.length === 0) return [];
    const { data, error } = await supabase.storage
      .from(SELL_PHOTOS_BUCKET)
      .createSignedUrls(paths, ttlSeconds);
    if (error || !data) return [];
    return data
      .map((entry) => (entry.error ? null : entry.signedUrl))
      .filter((url): url is string => Boolean(url));
  },
};
