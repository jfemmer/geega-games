import * as React from "react";
import { getSupabaseAdmin } from "./supabaseAdmin.js";
import { notifyStaff, usd } from "./staffPush.js";
import { sendTrackedEmail, type SendEmailResult } from "./emailService.js";
import { SELL_PHOTOS_BUCKET } from "./sell.js";
import { ServerEnv } from "./env.js";
import { logoUrl, siteUrl } from "./assets.js";
import { guestTokensAvailable, signGuestToken } from "./guestAccess.js";
import {
  PartnerApplicationAdmin,
  PartnerApplicationReceived,
  PartnerApproved,
  PartnerLeadForStore,
  PartnerReferralCheckin,
  PartnerReferralSellerNotice,
  ReferralRewardEarned,
  partnerApplicationAdminSubject,
  partnerApplicationAdminText,
  partnerApplicationReceivedSubject,
  partnerApplicationReceivedText,
  partnerApprovedSubject,
  partnerApprovedText,
  partnerLeadForStoreSubject,
  partnerLeadForStoreText,
  partnerReferralCheckinSubject,
  partnerReferralCheckinText,
  partnerReferralSellerNoticeSubject,
  partnerReferralSellerNoticeText,
  referralRewardEarnedSubject,
  referralRewardEarnedText,
} from "./emails/PartnerEmails.js";
import {
  REFERRAL_CONTACT_METHODS,
  REFERRAL_HANDOFF_OPTIONS,
  REFERRAL_SIZE_OPTIONS,
  optionLabel,
  referralCategoryLabel,
} from "../../src/store/lib/referralTypes.js";
import {
  CHECKIN_ANSWERS,
  PARTNER_KINDS,
  PARTNER_PROFESSIONS,
  SELL_HUB_PATH,
  formatPercent,
  partnerCategoryLabel,
} from "../../src/store/lib/partnerTypes.js";
import {
  SELL_COLLECTION_SIZE_OPTIONS,
  SELL_TRANSACTION_PREFERENCE_OPTIONS,
} from "../../src/store/lib/sellTypes.js";

// Sending side of the partner program. Like the other email modules, every
// function takes only ids and loads everything from the database itself, and
// sendTrackedEmail's idempotency key means a retried request never sends the
// same email twice. Callers treat failures as best-effort and report them.

/** Photo links sent to a partner store are signed (the bucket is private) and expire. */
export const PARTNER_PHOTO_LINK_DAYS = 7;
/** How many of a Magic submission's cards to list for the store (most valuable first). */
const MAX_CARD_LINES = 15;

type Result = SendEmailResult | { status: "skipped"; reason: string };

function branding() {
  return { siteUrl: siteUrl(), logoUrl: logoUrl(), supportEmail: ServerEnv.replyTo() };
}

/** "A", "A and B", "A, B and C" */
export function listLabel(labels: string[]): string {
  if (labels.length <= 1) return labels.join("");
  return `${labels.slice(0, -1).join(", ")} and ${labels[labels.length - 1]}`;
}

export function partnerReferralLink(code: string): string {
  return `${siteUrl()}${SELL_HUB_PATH}?ref=${encodeURIComponent(code)}`;
}

// ---------------------------------------------------------------------------
// The lead behind a referral, whichever kind it is
// ---------------------------------------------------------------------------

export interface PartnerLeadInfo {
  kind: "referral_lead" | "sell_submission";
  id: string;
  reference: string;
  categoriesLabel: string;
  firstName: string;
  lastName: string | null;
  email: string;
  phone: string | null;
  preferredContact: string;
  location: string | null;
  handoffLabel: string | null;
  sizeLabel: string | null;
  description: string | null;
  cardLines: string[];
  photoPaths: string[];
}

export async function loadPartnerLeadInfo(
  kind: "referral_lead" | "sell_submission",
  id: string,
): Promise<PartnerLeadInfo | null> {
  const db = getSupabaseAdmin();
  if (kind === "referral_lead") {
    const { data: lead, error } = await db
      .from("referral_leads")
      .select(
        "id, reference_number, categories, description, collection_size, handoff, first_name, last_name, email, phone, preferred_contact_method, location, photo_paths",
      )
      .eq("id", id)
      .maybeSingle();
    if (error || !lead) return null;
    return {
      kind,
      id: lead.id,
      reference: lead.reference_number,
      categoriesLabel: listLabel(lead.categories.map(referralCategoryLabel)),
      firstName: lead.first_name,
      lastName: lead.last_name,
      email: lead.email,
      phone: lead.phone,
      preferredContact: optionLabel(REFERRAL_CONTACT_METHODS, lead.preferred_contact_method) ?? "Email",
      location: lead.location,
      handoffLabel: lead.handoff === "not_sure" ? null : optionLabel(REFERRAL_HANDOFF_OPTIONS, lead.handoff),
      sizeLabel: optionLabel(REFERRAL_SIZE_OPTIONS, lead.collection_size),
      description: lead.description,
      cardLines: [],
      photoPaths: lead.photo_paths,
    };
  }

  const { data: sub, error } = await db
    .from("sell_submissions")
    .select(
      "id, reference_number, first_name, last_name, email, phone, preferred_contact_method, city, state, transaction_preference, collection_size, total_cards, estimated_value_cents, valuable_cards_notes, notes",
    )
    .eq("id", id)
    .maybeSingle();
  if (error || !sub) return null;

  const [{ data: cards }, { data: photos }] = await Promise.all([
    db
      .from("sell_submission_cards")
      .select("card_name, set_code, condition, finish, quantity, scryfall_price_cents")
      .eq("submission_id", id)
      .order("scryfall_price_cents", { ascending: false, nullsFirst: false })
      .limit(MAX_CARD_LINES),
    db.from("sell_submission_photos").select("storage_path").eq("submission_id", id).limit(40),
  ]);

  const cardLines: string[] = [];
  if (sub.total_cards > 0) {
    cardLines.push(
      `${sub.total_cards} card${sub.total_cards === 1 ? "" : "s"} listed${
        sub.estimated_value_cents ? `, about ${usd(sub.estimated_value_cents)} at market prices` : ""
      }`,
    );
  }
  for (const c of cards ?? []) {
    const set = c.set_code ? ` (${c.set_code.toUpperCase()})` : "";
    const finish = c.finish && c.finish !== "nonfoil" ? `, ${c.finish}` : "";
    cardLines.push(`${c.quantity}× ${c.card_name}${set} — ${c.condition}${finish}`);
  }
  if (sub.valuable_cards_notes) cardLines.push(`Seller's notes on valuable cards: ${sub.valuable_cards_notes}`);

  const handoff =
    sub.transaction_preference === "not_sure"
      ? null
      : (SELL_TRANSACTION_PREFERENCE_OPTIONS.find((o) => o.value === sub.transaction_preference)?.label ?? null);
  return {
    kind,
    id: sub.id,
    reference: sub.reference_number,
    categoriesLabel: "Magic: The Gathering cards",
    firstName: sub.first_name,
    lastName: sub.last_name,
    email: sub.email,
    phone: sub.phone,
    preferredContact: optionLabel(REFERRAL_CONTACT_METHODS, sub.preferred_contact_method) ?? "Email",
    location: [sub.city, sub.state].filter(Boolean).join(", ") || null,
    handoffLabel: handoff,
    sizeLabel: sub.collection_size
      ? (SELL_COLLECTION_SIZE_OPTIONS.find((o) => o.value === sub.collection_size)?.label ?? null)
      : null,
    description: sub.notes,
    cardLines,
    photoPaths: (photos ?? []).map((p) => p.storage_path).filter(Boolean),
  };
}

async function signedPhotoUrls(paths: string[], days: number): Promise<string[]> {
  if (paths.length === 0) return [];
  const { data } = await getSupabaseAdmin()
    .storage.from(SELL_PHOTOS_BUCKET)
    .createSignedUrls(paths, days * 24 * 60 * 60);
  return (data ?? []).map((s) => s.signedUrl).filter((u): u is string => Boolean(u));
}

async function loadReferral(referralId: string) {
  const db = getSupabaseAdmin();
  const { data: referral, error } = await db
    .from("partner_referrals")
    .select("id, partner_id, referral_lead_id, sell_submission_id, lead_reference, fee_percent, outcome")
    .eq("id", referralId)
    .maybeSingle();
  if (error || !referral) return null;
  const { data: partner } = await db
    .from("partners")
    .select("id, business_name, contact_name, email, city, state")
    .eq("id", referral.partner_id)
    .maybeSingle();
  if (!partner) return null;
  const leadKind = referral.referral_lead_id ? "referral_lead" : referral.sell_submission_id ? "sell_submission" : null;
  const leadId = referral.referral_lead_id ?? referral.sell_submission_id;
  const lead = leadKind && leadId ? await loadPartnerLeadInfo(leadKind, leadId) : null;
  return { referral, partner, lead };
}

async function settle(send: () => Promise<Result>, label: string): Promise<Result> {
  try {
    return await send();
  } catch (err) {
    console.error(`[partnerEmails] ${label} failed:`, err);
    return { status: "failed", error: err instanceof Error ? err.message : String(err), deduped: false };
  }
}

// ---------------------------------------------------------------------------
// A lead sent to a store
// ---------------------------------------------------------------------------

export async function sendLeadToPartnerEmails(referralId: string): Promise<{ store: Result; seller: Result }> {
  const loaded = await loadReferral(referralId);
  if (!loaded || !loaded.lead) {
    const skipped: Result = { status: "skipped", reason: "referral-or-lead-not-found" };
    return { store: skipped, seller: skipped };
  }
  const { referral, partner, lead } = loaded;
  const photoUrls = await signedPhotoUrls(lead.photoPaths, PARTNER_PHOTO_LINK_DAYS);

  const store = await settle(() => {
    const data = {
      ...branding(),
      contactName: partner.contact_name,
      leadReference: referral.lead_reference,
      categoriesLabel: lead.categoriesLabel,
      sellerName: [lead.firstName, lead.lastName].filter(Boolean).join(" "),
      sellerFirstName: lead.firstName,
      email: lead.email,
      phone: lead.phone,
      preferredContact: lead.preferredContact,
      location: lead.location,
      handoffLabel: lead.handoffLabel,
      sizeLabel: lead.sizeLabel,
      description: lead.description,
      cardLines: lead.cardLines,
      photoUrls,
      photoLinkDays: PARTNER_PHOTO_LINK_DAYS,
      feePercentLabel: formatPercent(Number(referral.fee_percent)),
    };
    return sendTrackedEmail({
      emailType: "partner_lead_for_store",
      idempotencyKey: `partner-lead-store-${referral.id}`,
      to: partner.email,
      from: ServerEnv.fromOrders(),
      replyTo: ServerEnv.replyTo(),
      subject: partnerLeadForStoreSubject(data),
      react: React.createElement(PartnerLeadForStore, data),
      text: partnerLeadForStoreText(data),
    });
  }, "store email");

  const seller = await settle(() => {
    const data = {
      ...branding(),
      firstName: lead.firstName,
      leadReference: referral.lead_reference,
      categoriesLabel: lead.categoriesLabel,
      storeName: partner.business_name,
      storeLocation: [partner.city, partner.state].filter(Boolean).join(", ") || null,
      preferredContact: lead.preferredContact,
    };
    return sendTrackedEmail({
      emailType: "partner_referral_seller_notice",
      idempotencyKey: `partner-referral-seller-${referral.id}`,
      to: lead.email,
      from: ServerEnv.fromOrders(),
      replyTo: ServerEnv.replyTo(),
      subject: partnerReferralSellerNoticeSubject(data),
      react: React.createElement(PartnerReferralSellerNotice, data),
      text: partnerReferralSellerNoticeText(data),
    });
  }, "seller notice");

  return { store, seller };
}

export function checkinUrl(referralId: string, answer: string): string {
  const token = signGuestToken("checkin", referralId);
  const params = new URLSearchParams({ r: referralId, a: answer, t: token });
  return `${siteUrl()}/api/partner-referrals/checkin?${params.toString()}`;
}

/** "Did <store> get in touch?" — sent once, a week after the lead went out. */
export async function sendPartnerReferralCheckin(referralId: string): Promise<Result> {
  if (!guestTokensAvailable()) return { status: "skipped", reason: "tokens-not-configured" };
  const loaded = await loadReferral(referralId);
  if (!loaded || !loaded.lead) return { status: "skipped", reason: "referral-or-lead-not-found" };
  const { referral, partner, lead } = loaded;
  if (referral.outcome !== "pending") return { status: "skipped", reason: "outcome-already-known" };

  const data = {
    ...branding(),
    firstName: lead.firstName,
    leadReference: referral.lead_reference,
    storeName: partner.business_name,
    answers: CHECKIN_ANSWERS.map((a) => ({ label: a.label, url: checkinUrl(referral.id, a.value) })),
  };
  return sendTrackedEmail({
    emailType: "partner_referral_checkin",
    idempotencyKey: `partner-referral-checkin-${referral.id}`,
    to: lead.email,
    from: ServerEnv.fromOrders(),
    replyTo: ServerEnv.replyTo(),
    subject: partnerReferralCheckinSubject(data),
    react: React.createElement(PartnerReferralCheckin, data),
    text: partnerReferralCheckinText(data),
  });
}

// ---------------------------------------------------------------------------
// Partner applications
// ---------------------------------------------------------------------------

async function loadPartner(partnerId: string) {
  const { data, error } = await getSupabaseAdmin()
    .from("partners")
    .select(
      "id, kind, status, business_name, contact_name, email, phone, website, city, state, categories, coverage, buys_by_mail, profession, notes, fee_percent",
    )
    .eq("id", partnerId)
    .maybeSingle();
  return error ? null : data;
}

function partnerSummary(partner: NonNullable<Awaited<ReturnType<typeof loadPartner>>>): string | null {
  if (partner.kind === "store") {
    return partner.categories.length ? `you buy ${listLabel(partner.categories.map(partnerCategoryLabel))}` : null;
  }
  const profession = PARTNER_PROFESSIONS.find((p) => p.value === partner.profession)?.label;
  return profession ? `you're a ${profession.toLowerCase()}` : null;
}

export async function sendPartnerApplicationEmails(partnerId: string): Promise<{ admin: Result; applicant: Result }> {
  const partner = await loadPartner(partnerId);
  if (!partner) {
    const skipped: Result = { status: "skipped", reason: "partner-not-found" };
    return { admin: skipped, applicant: skipped };
  }
  const kindLabel = PARTNER_KINDS.find((k) => k.value === partner.kind)?.label ?? "Partner";
  const where = [partner.city, partner.state].filter(Boolean).join(", ");
  const adminPath = `/admin_dashboard/partners?partner=${partner.id}`;

  await notifyStaff({
    key: `partner_application:${partner.id}`,
    kind: "partner_lead",
    title: `New ${kindLabel.toLowerCase()} application`,
    body: [partner.business_name, where || null].filter(Boolean).join(" · "),
    url: adminPath,
    tag: `partner_application:${partner.id}`,
  });

  const rows: [string, string | null][] = [
    ["Business", partner.business_name],
    ["Contact", partner.contact_name],
    ["Email", partner.email],
    ["Phone", partner.phone],
    ["Website", partner.website],
    ["Location", where || null],
    [
      partner.kind === "store" ? "Buys" : "Works as",
      partner.kind === "store"
        ? listLabel(partner.categories.map(partnerCategoryLabel)) || null
        : (PARTNER_PROFESSIONS.find((p) => p.value === partner.profession)?.label ?? null),
    ],
    ["Where they meet sellers", partner.kind === "store" ? partner.coverage : null],
    ["Buys by mail", partner.kind === "store" ? (partner.buys_by_mail ? "Yes" : "No") : null],
  ];

  const admin = await settle(() => {
    const data = {
      ...branding(),
      kindLabel,
      businessName: partner.business_name,
      rows: rows.filter((r): r is [string, string] => Boolean(r[1])),
      notes: partner.notes,
      adminUrl: `${siteUrl()}${adminPath}`,
    };
    return sendTrackedEmail({
      emailType: "partner_application_admin",
      idempotencyKey: `partner-application-admin-${partner.id}`,
      to: ServerEnv.sellLeadsNotificationEmail(),
      from: ServerEnv.fromOrders(),
      replyTo: partner.email,
      subject: partnerApplicationAdminSubject(data),
      react: React.createElement(PartnerApplicationAdmin, data),
      text: partnerApplicationAdminText(data),
    });
  }, "application admin email");

  const applicant = await settle(() => {
    const data = {
      ...branding(),
      contactName: partner.contact_name,
      businessName: partner.business_name,
      kind: partner.kind as "store" | "referrer",
      summary: partnerSummary(partner),
    };
    return sendTrackedEmail({
      emailType: "partner_application_received",
      idempotencyKey: `partner-application-received-${partner.id}`,
      to: partner.email,
      from: ServerEnv.fromOrders(),
      replyTo: ServerEnv.replyTo(),
      subject: partnerApplicationReceivedSubject(data),
      react: React.createElement(PartnerApplicationReceived, data),
      text: partnerApplicationReceivedText(data),
    });
  }, "application receipt");

  return { admin, applicant };
}

/** Welcome email, sent once when an application is approved. */
export async function sendPartnerApprovedEmail(partnerId: string): Promise<Result> {
  const partner = await loadPartner(partnerId);
  if (!partner) return { status: "skipped", reason: "partner-not-found" };
  let referralLink: string | null = null;
  if (partner.kind === "referrer") {
    const { data: code } = await getSupabaseAdmin()
      .from("referral_codes")
      .select("code")
      .eq("partner_id", partner.id)
      .maybeSingle();
    if (!code) return { status: "skipped", reason: "no-referral-code" };
    referralLink = partnerReferralLink(code.code);
  }
  const data = {
    ...branding(),
    contactName: partner.contact_name,
    businessName: partner.business_name,
    kind: partner.kind as "store" | "referrer",
    feePercentLabel: formatPercent(Number(partner.fee_percent)),
    categoriesLabel:
      partner.kind === "store" && partner.categories.length
        ? listLabel(partner.categories.map(partnerCategoryLabel))
        : null,
    referralLink,
  };
  return settle(
    () =>
      sendTrackedEmail({
        emailType: "partner_approved",
        idempotencyKey: `partner-approved-${partner.id}`,
        to: partner.email,
        from: ServerEnv.fromOrders(),
        replyTo: ServerEnv.replyTo(),
        subject: partnerApprovedSubject(data),
        react: React.createElement(PartnerApproved, data),
        text: partnerApprovedText(data),
      }),
    "approval email",
  );
}

// ---------------------------------------------------------------------------
// Referral rewards
// ---------------------------------------------------------------------------

/** Tells a referrer they've earned a reward. Never names the seller. */
export async function sendReferralRewardEmail(rewardId: string): Promise<Result> {
  const db = getSupabaseAdmin();
  const { data: reward, error } = await db
    .from("referral_rewards")
    .select("id, kind, amount_cents, user_id, partner_id")
    .eq("id", rewardId)
    .maybeSingle();
  if (error || !reward) return { status: "skipped", reason: "reward-not-found" };

  let to: string | null = null;
  let firstName: string | null = null;
  if (reward.user_id) {
    const { data: user } = await db.auth.admin.getUserById(reward.user_id);
    to = user?.user?.email ?? null;
    const { data: profile } = await db.from("profiles").select("first_name").eq("id", reward.user_id).maybeSingle();
    firstName = profile?.first_name ?? null;
  } else if (reward.partner_id) {
    const { data: partner } = await db
      .from("partners")
      .select("email, contact_name")
      .eq("id", reward.partner_id)
      .maybeSingle();
    to = partner?.email ?? null;
    firstName = partner?.contact_name ?? null;
  }
  if (!to) return { status: "skipped", reason: "no-recipient" };

  const data = {
    ...branding(),
    firstName,
    kind: reward.kind as "store_credit" | "cash",
    amountLabel: usd(reward.amount_cents),
  };
  return settle(
    () =>
      sendTrackedEmail({
        emailType: "referral_reward_earned",
        idempotencyKey: `referral-reward-earned-${reward.id}`,
        to: to as string,
        from: ServerEnv.fromOrders(),
        replyTo: ServerEnv.replyTo(),
        subject: referralRewardEarnedSubject(data),
        react: React.createElement(ReferralRewardEarned, data),
        text: referralRewardEarnedText(data),
      }),
    "reward email",
  );
}
