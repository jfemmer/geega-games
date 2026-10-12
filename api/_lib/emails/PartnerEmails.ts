import * as React from "react";
import { Button, Heading, Hr, Link, Section, Text } from "@react-email/components";
import { BaseLayout, brand } from "./BaseLayout.js";
import { PARTNER_STORE_STANDARDS } from "../../../src/store/lib/partnerTypes.js";

// Emails for the partner program (see src/store/lib/partnerTypes.ts):
//
//   PartnerLeadForStore            a seller's details, to the partner store
//   PartnerReferralSellerNotice    "your details went to <store>", to the seller
//   PartnerReferralCheckin         "did <store> get in touch?", a week later
//   PartnerApplicationReceived     receipt for a store or referral partner
//   PartnerApplicationAdmin        the new application, to staff
//   PartnerApproved                welcome + how it works (+ referral link)
//   ReferralRewardEarned           store credit or a referral fee, to whoever
//                                  referred a seller who sold
//
// Every seller-facing one says plainly that the store may pay Geega Games a
// referral fee and that the seller is never charged — the same words as the
// consent checkbox and the privacy policy.

// Loosely-typed createElement wrapper: React Email components type `children`
// as required, which the variadic createElement overload does not always satisfy.
const h = (
  type: unknown,
  props?: Record<string, unknown> | null,
  ...children: React.ReactNode[]
): React.ReactElement =>
  React.createElement(type as React.ElementType, props as Record<string, unknown>, ...children);

interface Branding {
  siteUrl: string;
  logoUrl: string;
  supportEmail: string;
}


// ---------------------------------------------------------------------------
// PartnerLeadForStore
// ---------------------------------------------------------------------------

export type PartnerLeadForStoreData = Branding & {
  contactName: string;
  leadReference: string;
  categoriesLabel: string;
  sellerName: string;
  sellerFirstName: string;
  email: string;
  phone: string | null;
  preferredContact: string;
  location: string | null;
  handoffLabel: string | null;
  sizeLabel: string | null;
  description: string | null;
  /** Magic submissions: a few lines about the cards ("212 cards", notable cards…). */
  cardLines: string[];
  photoUrls: string[];
  photoLinkDays: number;
  feePercentLabel: string;
};

export function partnerLeadForStoreSubject(d: PartnerLeadForStoreData): string {
  return `New lead: ${d.categoriesLabel}${d.location ? ` · ${d.location}` : ""} — ${d.leadReference}`;
}

function detailRows(d: PartnerLeadForStoreData): [string, string][] {
  const rows: [string, string | null][] = [
    ["Name", d.sellerName],
    ["Email", d.email],
    ["Phone", d.phone],
    ["Best way to reach them", d.preferredContact],
    ["Location", d.location],
    ["Meet up or ship", d.handoffLabel],
    ["How much", d.sizeLabel],
  ];
  return rows.filter((r): r is [string, string] => Boolean(r[1]));
}

export function PartnerLeadForStore(d: PartnerLeadForStoreData) {
  return h(
    BaseLayout,
    {
      previewText: `${d.sellerFirstName} would like an offer on their ${d.categoriesLabel}`,
      siteUrl: d.siteUrl,
      logoUrl: d.logoUrl,
      supportEmail: d.supportEmail,
      reasonLine: "You received this because your store is a Geega Games partner store.",
    },
    h(Heading, { key: "h1", style: h1 }, "A seller would like an offer"),
    h(
      Text,
      { key: "intro", style: p },
      `Hi ${d.contactName}, ${d.sellerFirstName} asked Geega Games to connect them with a store that buys ${d.categoriesLabel}, and agreed to have these details passed to you. They're expecting to hear from you.`,
    ),
    h(
      Section,
      { key: "details", style: box },
      ...detailRows(d).map(([label, value]) =>
        h(Text, { key: label, style: row }, h("strong", { key: "l" }, `${label}: `), value),
      ),
    ),
    d.description ? h(Text, { key: "whath", style: h2 }, "What they have") : null,
    d.description ? h(Text, { key: "what", style: { ...p, whiteSpace: "pre-wrap" } }, d.description) : null,
    d.cardLines.length > 0 ? h(Text, { key: "cardsh", style: h2 }, "Their cards") : null,
    ...d.cardLines.map((line, i) => h(Text, { key: `card${i}`, style: listItem }, `• ${line}`)),
    d.photoUrls.length > 0
      ? h(Text, { key: "photosh", style: h2 }, `Photos (links work for ${d.photoLinkDays} days)`)
      : null,
    ...d.photoUrls.map((url, i) =>
      h(Text, { key: `photo${i}`, style: listItem }, h(Link, { href: url, style: link }, `Photo ${i + 1}`)),
    ),
    h(Hr, { key: "hr", style: hr }),
    h(Text, { key: "askh", style: h2 }, "What we ask"),
    ...PARTNER_STORE_STANDARDS.map((s, i) => h(Text, { key: `std${i}`, style: listItem }, `• ${s}`)),
    h(
      Text,
      { key: "fee", style: p },
      `If you buy, the finder's fee is ${d.feePercentLabel} of what you pay the seller. Nothing is owed if you don't buy.`,
    ),
    h(
      Text,
      { key: "outcome", style: p },
      `Reply to this email when you know how it went, and mention ${d.leadReference}.`,
    ),
  );
}

export function partnerLeadForStoreText(d: PartnerLeadForStoreData): string {
  return [
    `A seller would like an offer — ${d.leadReference}`,
    "",
    `Hi ${d.contactName}, ${d.sellerFirstName} asked Geega Games to connect them with a store that buys ${d.categoriesLabel}, and agreed to have these details passed to you. They're expecting to hear from you.`,
    "",
    ...detailRows(d).map(([label, value]) => `${label}: ${value}`),
    ...(d.description ? ["", "What they have:", d.description] : []),
    ...(d.cardLines.length ? ["", "Their cards:", ...d.cardLines.map((l) => `- ${l}`)] : []),
    ...(d.photoUrls.length ? ["", `Photos (links work for ${d.photoLinkDays} days):`, ...d.photoUrls] : []),
    "",
    "What we ask:",
    ...PARTNER_STORE_STANDARDS.map((s) => `- ${s}`),
    "",
    `If you buy, the finder's fee is ${d.feePercentLabel} of what you pay the seller. Nothing is owed if you don't buy.`,
    `Reply to this email when you know how it went, and mention ${d.leadReference}.`,
  ].join("\n");
}

// ---------------------------------------------------------------------------
// PartnerReferralSellerNotice
// ---------------------------------------------------------------------------

export type PartnerReferralSellerNoticeData = Branding & {
  firstName: string;
  leadReference: string;
  categoriesLabel: string;
  storeName: string;
  storeLocation: string | null;
  preferredContact: string;
};

export function partnerReferralSellerNoticeSubject(d: PartnerReferralSellerNoticeData): string {
  return `${d.storeName} will contact you about an offer — ${d.leadReference}`;
}

function sellerNoticeParagraphs(d: PartnerReferralSellerNoticeData): string[] {
  const store = d.storeLocation ? `${d.storeName} (${d.storeLocation})` : d.storeName;
  return [
    `Hi ${d.firstName}, as you asked, we've passed your request to ${store}, a partner store that buys ${d.categoriesLabel}. They'll contact you by ${d.preferredContact.toLowerCase()} to talk about an offer.`,
    "You're free to say no to any offer — asking doesn't commit you to anything.",
    `If you sell to ${d.storeName}, they may pay Geega Games a referral fee. You're never charged anything.`,
    "Haven't heard from them in a few days? Reply to this email and we'll follow up.",
  ];
}

export function PartnerReferralSellerNotice(d: PartnerReferralSellerNoticeData) {
  const [p1, p2, p3, p4] = sellerNoticeParagraphs(d);
  return h(
    BaseLayout,
    {
      previewText: `${d.storeName} will contact you about your ${d.categoriesLabel}`,
      siteUrl: d.siteUrl,
      logoUrl: d.logoUrl,
      supportEmail: d.supportEmail,
      reasonLine: "You received this because you asked Geega Games to help you sell items.",
    },
    h(Heading, { key: "h1", style: h1 }, "Your request is with a partner store"),
    h(Text, { key: "p1", style: p }, p1),
    h(
      Section,
      { key: "ref", style: refBox },
      h(Text, { key: "l", style: refLabel }, "Your reference number"),
      h(Text, { key: "v", style: refValue }, d.leadReference),
    ),
    h(Text, { key: "p2", style: p }, p2),
    h(Text, { key: "p3", style: muted }, p3),
    h(Text, { key: "p4", style: p }, p4),
  );
}

export function partnerReferralSellerNoticeText(d: PartnerReferralSellerNoticeData): string {
  return [
    "Your request is with a partner store — Geega Games",
    "",
    ...sellerNoticeParagraphs(d).flatMap((para) => [para, ""]),
    `Reference number: ${d.leadReference}`,
  ].join("\n");
}

// ---------------------------------------------------------------------------
// PartnerReferralCheckin
// ---------------------------------------------------------------------------

export type PartnerReferralCheckinData = Branding & {
  firstName: string;
  leadReference: string;
  storeName: string;
  /** One link per answer, in CHECKIN_ANSWERS order. */
  answers: { label: string; url: string }[];
};

export function partnerReferralCheckinSubject(d: PartnerReferralCheckinData): string {
  return `Did ${d.storeName} get in touch? — ${d.leadReference}`;
}

export function PartnerReferralCheckin(d: PartnerReferralCheckinData) {
  return h(
    BaseLayout,
    {
      previewText: `A quick question about your request ${d.leadReference}`,
      siteUrl: d.siteUrl,
      logoUrl: d.logoUrl,
      supportEmail: d.supportEmail,
      reasonLine: "You received this because you asked Geega Games to help you sell items.",
    },
    h(Heading, { key: "h1", style: h1 }, `Did ${d.storeName} get in touch?`),
    h(
      Text,
      { key: "p1", style: p },
      `Hi ${d.firstName}, about a week ago we passed your request to ${d.storeName}. How did it go? One tap tells us:`,
    ),
    ...d.answers.map((a, i) =>
      h(
        Section,
        { key: `a${i}`, style: { margin: "0 0 10px" } },
        h(Button, { href: a.url, style: i === 0 ? primaryButton : secondaryButton }, a.label),
      ),
    ),
    h(
      Text,
      { key: "p2", style: muted },
      "Your answer helps us make sure our partner stores reply quickly and treat sellers fairly. If they never got in touch, we'll follow up.",
    ),
  );
}

export function partnerReferralCheckinText(d: PartnerReferralCheckinData): string {
  return [
    `Did ${d.storeName} get in touch? — Geega Games`,
    "",
    `Hi ${d.firstName}, about a week ago we passed your request (${d.leadReference}) to ${d.storeName}. How did it go?`,
    "",
    ...d.answers.flatMap((a) => [`${a.label}:`, a.url, ""]),
    "Your answer helps us make sure our partner stores reply quickly and treat sellers fairly.",
  ].join("\n");
}

// ---------------------------------------------------------------------------
// PartnerApplicationReceived
// ---------------------------------------------------------------------------

export type PartnerApplicationReceivedData = Branding & {
  contactName: string;
  businessName: string;
  kind: "store" | "referrer";
  /** "Pokémon cards, video games" (stores) or "Estate sale company" (referral partners). */
  summary: string | null;
};

export function partnerApplicationReceivedSubject(d: PartnerApplicationReceivedData): string {
  return d.kind === "store"
    ? "We got your partner store application — Geega Games"
    : "We got your referral partner application — Geega Games";
}

function applicationParagraphs(d: PartnerApplicationReceivedData): string[] {
  const what = d.kind === "store" ? "partner store" : "referral partner";
  return [
    `Thanks, ${d.contactName}! We got your application for ${d.businessName} to become a Geega Games ${what}.`,
    d.summary ? `You told us: ${d.summary}.` : "",
    "We read every application ourselves and will be in touch by email. If anything changes in the meantime, just reply to this email.",
  ].filter(Boolean);
}

export function PartnerApplicationReceived(d: PartnerApplicationReceivedData) {
  return h(
    BaseLayout,
    {
      previewText: `Thanks for applying, ${d.contactName}`,
      siteUrl: d.siteUrl,
      logoUrl: d.logoUrl,
      supportEmail: d.supportEmail,
      reasonLine: "You received this because you applied to the Geega Games partner program.",
    },
    h(Heading, { key: "h1", style: h1 }, "Application received"),
    ...applicationParagraphs(d).map((para, i) => h(Text, { key: `p${i}`, style: p }, para)),
  );
}

export function partnerApplicationReceivedText(d: PartnerApplicationReceivedData): string {
  return ["Application received — Geega Games", "", ...applicationParagraphs(d).flatMap((x) => [x, ""])].join("\n");
}

// ---------------------------------------------------------------------------
// PartnerApplicationAdmin
// ---------------------------------------------------------------------------

export type PartnerApplicationAdminData = Branding & {
  kindLabel: string;
  businessName: string;
  rows: [string, string][];
  notes: string | null;
  adminUrl: string;
};

export function partnerApplicationAdminSubject(d: PartnerApplicationAdminData): string {
  return `New ${d.kindLabel.toLowerCase()} application: ${d.businessName}`;
}

export function PartnerApplicationAdmin(d: PartnerApplicationAdminData) {
  return h(
    BaseLayout,
    {
      previewText: `${d.businessName} applied to be a ${d.kindLabel.toLowerCase()}`,
      siteUrl: d.siteUrl,
      logoUrl: d.logoUrl,
      supportEmail: d.supportEmail,
    },
    h(Heading, { key: "h1", style: h1 }, `New ${d.kindLabel.toLowerCase()} application`),
    h(
      Section,
      { key: "details", style: box },
      ...d.rows.map(([label, value]) =>
        h(Text, { key: label, style: row }, h("strong", { key: "l" }, `${label}: `), value),
      ),
    ),
    d.notes ? h(Text, { key: "notesh", style: h2 }, "Anything else") : null,
    d.notes ? h(Text, { key: "notes", style: { ...p, whiteSpace: "pre-wrap" } }, d.notes) : null,
    h(
      Section,
      { key: "cta", style: { margin: "8px 0 0" } },
      h(Button, { href: d.adminUrl, style: primaryButton }, "Review in the dashboard"),
    ),
  );
}

export function partnerApplicationAdminText(d: PartnerApplicationAdminData): string {
  return [
    `New ${d.kindLabel.toLowerCase()} application: ${d.businessName}`,
    "",
    ...d.rows.map(([label, value]) => `${label}: ${value}`),
    ...(d.notes ? ["", "Anything else:", d.notes] : []),
    "",
    `Review: ${d.adminUrl}`,
  ].join("\n");
}

// ---------------------------------------------------------------------------
// PartnerApproved
// ---------------------------------------------------------------------------

export type PartnerApprovedData = Branding & {
  contactName: string;
  businessName: string;
  kind: "store" | "referrer";
  feePercentLabel: string;
  /** Stores: "Pokémon cards and video games". */
  categoriesLabel: string | null;
  /** Referral partners: their personal link. */
  referralLink: string | null;
};

export function partnerApprovedSubject(d: PartnerApprovedData): string {
  return d.kind === "store" ? "You're a Geega Games partner store" : "Your Geega Games referral link";
}

function approvedParagraphs(d: PartnerApprovedData): { heading: string; paras: string[]; bullets: string[] } {
  if (d.kind === "store") {
    return {
      heading: "Welcome aboard",
      paras: [
        `Hi ${d.contactName}, ${d.businessName} is now a Geega Games partner store. When a seller near you asks for an offer${d.categoriesLabel ? ` on ${d.categoriesLabel}` : ""}, we'll email you their details, photos and the best way to reach them. Each lead goes to one store only.`,
        `The finder's fee is ${d.feePercentLabel} of what you pay the seller, and only when you buy. We'll send a statement for any fees owed.`,
        "What we ask:",
      ],
      bullets: [...PARTNER_STORE_STANDARDS],
    };
  }
  return {
    heading: "Here's your referral link",
    paras: [
      `Hi ${d.contactName}, thanks for partnering with Geega Games. When a client needs to sell cards or video games, send them to the link below. It lets them ask for a free, no-obligation offer, and tells us they came from ${d.businessName}.`,
      `When someone you send sells — to us or to one of our partner stores — we pay you ${d.feePercentLabel} of the sale. We'll let you know when a referral sells.`,
      "Please ask your client before sharing their details with anyone. The easiest way is to give them the link and let them fill it in themselves.",
    ],
    bullets: [],
  };
}

export function PartnerApproved(d: PartnerApprovedData) {
  const { heading, paras, bullets } = approvedParagraphs(d);
  return h(
    BaseLayout,
    {
      previewText: d.kind === "store" ? "How leads will reach you" : "Your personal referral link",
      siteUrl: d.siteUrl,
      logoUrl: d.logoUrl,
      supportEmail: d.supportEmail,
      reasonLine: "You received this because you applied to the Geega Games partner program.",
    },
    h(Heading, { key: "h1", style: h1 }, heading),
    ...paras.map((para, i) => h(Text, { key: `p${i}`, style: p }, para)),
    ...bullets.map((b, i) => h(Text, { key: `b${i}`, style: listItem }, `• ${b}`)),
    d.referralLink
      ? h(
          Section,
          { key: "link", style: refBox },
          h(Text, { key: "l", style: refLabel }, "Your referral link"),
          h(Text, { key: "v", style: { ...refValue, fontSize: "16px" } }, h(Link, { href: d.referralLink, style: link }, d.referralLink)),
        )
      : null,
    h(Text, { key: "q", style: muted }, "Questions? Just reply to this email."),
  );
}

export function partnerApprovedText(d: PartnerApprovedData): string {
  const { heading, paras, bullets } = approvedParagraphs(d);
  return [
    `${heading} — Geega Games`,
    "",
    ...paras.flatMap((x) => [x, ""]),
    ...bullets.map((b) => `- ${b}`),
    ...(d.referralLink ? ["", `Your referral link: ${d.referralLink}`] : []),
    "",
    "Questions? Just reply to this email.",
  ].join("\n");
}

// ---------------------------------------------------------------------------
// ReferralRewardEarned
// ---------------------------------------------------------------------------

export type ReferralRewardEarnedData = Branding & {
  firstName: string | null;
  kind: "store_credit" | "cash";
  amountLabel: string;
};

export function referralRewardEarnedSubject(d: ReferralRewardEarnedData): string {
  return d.kind === "store_credit"
    ? `You earned ${d.amountLabel} in store credit`
    : `A referral sold — you've earned ${d.amountLabel}`;
}

function rewardParagraphs(d: ReferralRewardEarnedData): string[] {
  const hi = d.firstName ? `Hi ${d.firstName}, ` : "";
  return d.kind === "store_credit"
    ? [
        `${hi}someone you sent our way just sold their collection, so we've added ${d.amountLabel} in store credit to your Geega Games account. To use it, sign in and tick "Apply store credit" at checkout.`,
        "Thanks for spreading the word. Your referral link keeps working, so share it with anyone else who has cards or video games to sell.",
      ]
    : [
        `${hi}someone you sent our way just sold their collection. Your referral fee is ${d.amountLabel}, and we'll be in touch about paying it.`,
        "Thank you for the referral.",
      ];
}

export function ReferralRewardEarned(d: ReferralRewardEarnedData) {
  return h(
    BaseLayout,
    {
      previewText: referralRewardEarnedSubject(d),
      siteUrl: d.siteUrl,
      logoUrl: d.logoUrl,
      supportEmail: d.supportEmail,
      reasonLine: "You received this because someone you referred to Geega Games sold their collection.",
    },
    h(Heading, { key: "h1", style: h1 }, d.kind === "store_credit" ? "You earned store credit" : "A referral sold"),
    ...rewardParagraphs(d).map((para, i) => h(Text, { key: `p${i}`, style: p }, para)),
    d.kind === "store_credit"
      ? h(
          Section,
          { key: "cta", style: { margin: "8px 0 0" } },
          h(Button, { href: `${d.siteUrl}/shop`, style: primaryButton }, "Shop singles"),
        )
      : null,
  );
}

export function referralRewardEarnedText(d: ReferralRewardEarnedData): string {
  return [`${referralRewardEarnedSubject(d)} — Geega Games`, "", ...rewardParagraphs(d).flatMap((x) => [x, ""])].join(
    "\n",
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const h1: React.CSSProperties = { color: brand.purpleDeep, fontSize: "22px", fontWeight: 600, margin: "0 0 8px" };
const h2: React.CSSProperties = { color: brand.purpleDeep, fontSize: "16px", fontWeight: 600, margin: "18px 0 6px" };
const p: React.CSSProperties = { color: brand.ink, fontSize: "15px", lineHeight: "24px", margin: "0 0 16px" };
const muted: React.CSSProperties = { ...p, color: brand.muted, fontSize: "14px", lineHeight: "22px" };
const row: React.CSSProperties = { color: brand.ink, fontSize: "14px", lineHeight: "22px", margin: "0 0 4px" };
const listItem: React.CSSProperties = { color: brand.ink, fontSize: "14px", lineHeight: "22px", margin: "0 0 6px" };
const box: React.CSSProperties = {
  backgroundColor: brand.parchment,
  borderRadius: "10px",
  padding: "14px 18px",
  margin: "8px 0 16px",
};
const refBox: React.CSSProperties = { ...box, textAlign: "center" };
const refLabel: React.CSSProperties = {
  color: brand.muted,
  fontSize: "11px",
  textTransform: "uppercase",
  letterSpacing: "0.04em",
  margin: "0 0 4px",
};
const refValue: React.CSSProperties = {
  color: brand.purpleDeep,
  fontSize: "22px",
  fontWeight: 700,
  margin: 0,
  letterSpacing: "0.02em",
};
const link: React.CSSProperties = { color: brand.purple, textDecoration: "underline" };
const hr: React.CSSProperties = { borderColor: brand.line, margin: "16px 0" };
const primaryButton: React.CSSProperties = {
  backgroundColor: brand.purple,
  color: "#ffffff",
  borderRadius: "10px",
  padding: "12px 20px",
  fontSize: "15px",
  fontWeight: 600,
  textDecoration: "none",
  display: "inline-block",
};
const secondaryButton: React.CSSProperties = {
  ...primaryButton,
  backgroundColor: "#ffffff",
  color: brand.purpleDeep,
  border: `1px solid ${brand.line}`,
};
