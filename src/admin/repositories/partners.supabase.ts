import { supabase } from "../../supabase";
import { adminFetch } from "./apiClient";
import type { Database } from "../../types/database";
import type {
  CheckinAnswer,
  FeeStatus,
  Partner,
  PartnerKind,
  PartnerReferral,
  PartnerReferralOutcome,
  PartnerStatus,
  ReferralCodeOwner,
  ReferralReward,
} from "../types";
import type { LeadSourceFields } from "../../store/lib/attribution";
import type { LeadSourceKind } from "../utils/marketing";

// LIVE repositories for the partner program (admin Partners page, the "Send
// to a partner store" panel on Partner Leads and Buying Leads, referral
// rewards, and the Marketing page's lead-source counts).
//
// Same split as the other lead repositories: reads use the browser client
// (staff-only SELECT policies on every table here); every write goes through
// a service_role API endpoint (api/admin/partners, partner-referrals,
// referral-rewards), which re-checks the role and does the bookkeeping.

type PartnerRow = Database["public"]["Tables"]["partners"]["Row"];
type ReferralRow = Database["public"]["Tables"]["partner_referrals"]["Row"];
type RewardRow = Database["public"]["Tables"]["referral_rewards"]["Row"];

export type LeadKind = "referral_lead" | "sell_submission";

function mapPartner(row: PartnerRow, referralCode: string | null): Partner {
  return {
    id: row.id,
    createdAt: row.created_at,
    kind: row.kind as PartnerKind,
    status: row.status as PartnerStatus,
    businessName: row.business_name,
    contactName: row.contact_name,
    email: row.email,
    phone: row.phone,
    website: row.website,
    city: row.city,
    state: row.state,
    categories: row.categories,
    coverage: row.coverage,
    buysByMail: row.buys_by_mail,
    profession: row.profession,
    notes: row.notes,
    internalNotes: row.internal_notes,
    feePercent: Number(row.fee_percent),
    approvedAt: row.approved_at,
    agreedToStandardsAt: row.agreed_to_standards_at,
    referralCode,
    source: {
      utmSource: row.utm_source,
      utmMedium: row.utm_medium,
      utmCampaign: row.utm_campaign,
      landingPath: row.landing_path,
      referrerHost: row.referrer_host,
    },
  };
}

function mapReferral(row: ReferralRow): PartnerReferral {
  return {
    id: row.id,
    createdAt: row.created_at,
    partnerId: row.partner_id,
    referralLeadId: row.referral_lead_id,
    sellSubmissionId: row.sell_submission_id,
    leadReference: row.lead_reference,
    sentAt: row.sent_at,
    outcome: row.outcome as PartnerReferralOutcome,
    outcomeAt: row.outcome_at,
    saleAmountCents: row.sale_amount_cents,
    feePercent: Number(row.fee_percent),
    feeCents: row.fee_cents,
    feeStatus: row.fee_status as FeeStatus,
    feePaidAt: row.fee_paid_at,
    checkinSentAt: row.checkin_sent_at,
    checkinResponse: (row.checkin_response as CheckinAnswer | null) ?? null,
    checkinAmountCents: row.checkin_amount_cents,
    checkinRespondedAt: row.checkin_responded_at,
    notes: row.notes,
  };
}

function mapReward(row: RewardRow): ReferralReward {
  return {
    id: row.id,
    createdAt: row.created_at,
    referralLeadId: row.referral_lead_id,
    sellSubmissionId: row.sell_submission_id,
    leadReference: row.lead_reference,
    refCode: row.ref_code,
    userId: row.user_id,
    partnerId: row.partner_id,
    kind: row.kind === "cash" ? "cash" : "store_credit",
    amountCents: row.amount_cents,
    status: row.status === "paid" ? "paid" : "owed",
    paidAt: row.paid_at,
  };
}

/** The fields an admin can set on a partner (camelCase, as the API takes them). */
export interface PartnerFieldsInput {
  businessName?: string;
  contactName?: string;
  email?: string;
  phone?: string | null;
  website?: string | null;
  city?: string | null;
  state?: string | null;
  categories?: string[];
  coverage?: string | null;
  buysByMail?: boolean;
  profession?: string | null;
  feePercent?: number;
  internalNotes?: string | null;
}

export const partnersRepository = {
  async list(): Promise<Partner[]> {
    const [{ data, error }, { data: codes, error: codesErr }] = await Promise.all([
      supabase.from("partners").select("*").order("created_at", { ascending: false }).limit(500),
      supabase.from("referral_codes").select("code, partner_id").not("partner_id", "is", null),
    ]);
    if (error) throw new Error(error.message);
    if (codesErr) throw new Error(codesErr.message);
    const codeByPartner = new Map((codes ?? []).map((c) => [c.partner_id as string, c.code]));
    return ((data ?? []) as PartnerRow[]).map((row) => mapPartner(row, codeByPartner.get(row.id) ?? null));
  },

  async create(kind: PartnerKind, fields: PartnerFieldsInput, sendWelcome: boolean): Promise<{ id: string }> {
    return adminFetch<{ id: string }>("/api/admin/partners", {
      method: "POST",
      body: { kind, ...fields, sendWelcome },
    });
  },

  async update(id: string, fields: PartnerFieldsInput): Promise<void> {
    await adminFetch(`/api/admin/partners/${id}`, { method: "PATCH", body: { action: "update", fields } });
  },

  async act(
    id: string,
    action: "approve" | "decline" | "pause" | "activate",
    opts: { sendWelcome?: boolean } = {},
  ): Promise<{ referralCode: string | null; welcome: string | null }> {
    return adminFetch(`/api/admin/partners/${id}`, { method: "PATCH", body: { action, ...opts } });
  },

  async remove(id: string): Promise<void> {
    await adminFetch(`/api/admin/partners/${id}`, { method: "DELETE" });
  },
};

export const partnerReferralsRepository = {
  /** Every lead ever sent to stores (newest first) — for fee totals. */
  async all(): Promise<PartnerReferral[]> {
    const { data, error } = await supabase
      .from("partner_referrals")
      .select("*")
      .order("sent_at", { ascending: false })
      .limit(2000);
    if (error) throw new Error(error.message);
    return ((data ?? []) as ReferralRow[]).map(mapReferral);
  },

  async forLead(kind: LeadKind, leadId: string): Promise<PartnerReferral[]> {
    const { data, error } = await supabase
      .from("partner_referrals")
      .select("*")
      .eq(kind === "referral_lead" ? "referral_lead_id" : "sell_submission_id", leadId)
      .order("sent_at", { ascending: false });
    if (error) throw new Error(error.message);
    return ((data ?? []) as ReferralRow[]).map(mapReferral);
  },

  async send(
    kind: LeadKind,
    leadId: string,
    partnerId: string,
  ): Promise<{ referralId: string; emails: { store: string; seller: string } }> {
    return adminFetch("/api/admin/partner-referrals", {
      method: "POST",
      body: { leadType: kind, leadId, partnerId },
    });
  },

  async update(
    id: string,
    patch: {
      outcome?: PartnerReferralOutcome;
      saleAmountCents?: number | null;
      feeStatus?: FeeStatus;
      notes?: string | null;
    },
  ): Promise<void> {
    await adminFetch(`/api/admin/partner-referrals/${id}`, { method: "PATCH", body: patch });
  },
};

export const referralRewardsRepository = {
  async forLead(kind: LeadKind, leadId: string): Promise<ReferralReward | null> {
    const { data, error } = await supabase
      .from("referral_rewards")
      .select("*")
      .eq(kind === "referral_lead" ? "referral_lead_id" : "sell_submission_id", leadId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return data ? mapReward(data as RewardRow) : null;
  },

  async forPartner(partnerId: string): Promise<ReferralReward[]> {
    const { data, error } = await supabase
      .from("referral_rewards")
      .select("*")
      .eq("partner_id", partnerId)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return ((data ?? []) as RewardRow[]).map(mapReward);
  },

  async grant(kind: LeadKind, leadId: string): Promise<{ kind: string; amountCents: number }> {
    return adminFetch("/api/admin/referral-rewards", { method: "POST", body: { leadType: kind, leadId } });
  },

  async markPaid(rewardId: string): Promise<void> {
    await adminFetch(`/api/admin/referral-rewards?id=${encodeURIComponent(rewardId)}`, {
      method: "PATCH",
      body: { status: "paid" },
    });
  },

  /** Who a referral code belongs to, for showing staff who referred a seller. */
  async codeOwner(code: string): Promise<ReferralCodeOwner | null> {
    const { data, error } = await supabase
      .from("referral_codes")
      .select("code, user_id, partner_id")
      .eq("code", code)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) return null;
    if (data.partner_id) {
      const { data: partner } = await supabase
        .from("partners")
        .select("business_name, email")
        .eq("id", data.partner_id)
        .maybeSingle();
      return {
        code: data.code,
        userId: null,
        partnerId: data.partner_id,
        label: `${partner?.business_name ?? "Referral partner"} (referral partner)`,
        email: partner?.email ?? null,
      };
    }
    const { data: customer } = await supabase
      .from("customers")
      .select("first_name, last_name, email")
      .eq("auth_user_id", data.user_id as string)
      .maybeSingle();
    const name = [customer?.first_name, customer?.last_name].filter(Boolean).join(" ");
    return {
      code: data.code,
      userId: data.user_id,
      partnerId: null,
      label: `${name || customer?.email || "A customer"} (customer)`,
      email: (customer?.email as string | undefined) ?? null,
    };
  },
};

/** One lead's source, for the Marketing page's counts. */
export interface LeadSourceRow extends LeadSourceFields {
  kind: LeadSourceKind;
  createdAt: string;
}

export const leadSourcesRepository = {
  async since(sinceIso: string): Promise<LeadSourceRow[]> {
    const [referral, sell, partners] = await Promise.all([
      supabase
        .from("referral_leads")
        .select("created_at, utm_source, utm_medium, utm_campaign, ref_code, landing_path, referrer_host, referral_source")
        .gte("created_at", sinceIso)
        .limit(5000),
      supabase
        .from("sell_submissions")
        .select("created_at, utm_source, utm_medium, utm_campaign, ref_code, landing_path, referrer_host, referral_source")
        .gte("created_at", sinceIso)
        .limit(5000),
      supabase
        .from("partners")
        .select("created_at, utm_source, utm_medium, utm_campaign, landing_path, referrer_host")
        .gte("created_at", sinceIso)
        .limit(1000),
    ]);
    const firstError = referral.error ?? sell.error ?? partners.error;
    if (firstError) throw new Error(firstError.message);
    type Row = {
      created_at: string;
      utm_source: string | null;
      utm_medium: string | null;
      utm_campaign: string | null;
      ref_code?: string | null;
      landing_path: string | null;
      referrer_host: string | null;
      referral_source?: string | null;
    };
    const map = (kind: LeadSourceRow["kind"]) => (r: Row): LeadSourceRow => ({
      kind,
      createdAt: r.created_at,
      utmSource: r.utm_source,
      utmMedium: r.utm_medium,
      utmCampaign: r.utm_campaign,
      refCode: r.ref_code ?? null,
      landingPath: r.landing_path,
      referrerHost: r.referrer_host,
      heardAbout: r.referral_source ?? null,
    });
    return [
      ...((referral.data ?? []) as Row[]).map(map("partner_lead")),
      ...((sell.data ?? []) as Row[]).map(map("buying_lead")),
      ...((partners.data ?? []) as Row[]).map(map("partner_application")),
    ];
  },
};
