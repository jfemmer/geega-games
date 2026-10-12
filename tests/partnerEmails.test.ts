import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import * as React from "react";
import { render } from "@react-email/render";
import { createFakeState, createFakeSupabase, fakeId, type FakeState } from "./helpers/fakeSupabase";

// The partner program's emails: what each template says (every seller-facing
// one discloses the referral fee; the store gets the standards and its fee),
// and what each sender loads and sends — to whom, from which lead, with which
// idempotency key — so a retry never emails twice.

beforeAll(() => {
  process.env.SUPABASE_URL = "https://x.invalid";
  process.env.SUPABASE_SECRET_KEY = "svc";
  process.env.EMAIL_TOKEN_SECRET = "test-secret-for-guest-tokens";
  process.env.PUBLIC_SITE_URL = "https://geega-games.com";
  process.env.SELL_LEADS_NOTIFICATION_EMAIL = "leads@example.com";
});

let state: FakeState = createFakeState();
vi.mock("../api/_lib/supabaseAdmin.js", () => ({ getSupabaseAdmin: () => createFakeSupabase(state) }));

type SentEmail = {
  emailType: string;
  idempotencyKey: string;
  to: string;
  replyTo?: string;
  subject: string;
  react: React.ReactElement;
  text: string;
};
const sent: SentEmail[] = [];
vi.mock("../api/_lib/emailService.js", () => ({
  sendTrackedEmail: vi.fn(async (args: SentEmail) => {
    sent.push(args);
    return { status: "sent", resendEmailId: "re_1", deduped: false };
  }),
}));

const pushes: { key: string; title: string; url: string }[] = [];
vi.mock("../api/_lib/staffPush.js", () => ({
  notifyStaff: vi.fn(async (n: { key: string; title: string; url: string }) => {
    pushes.push(n);
  }),
  usd: (cents: number) => (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" }),
}));

const emails = await import("../api/_lib/emails/PartnerEmails.ts");
const senders = await import("../api/_lib/partnerEmails.ts");
const { verifyGuestToken } = await import("../api/_lib/guestAccess.ts");
const { PARTNER_STORE_STANDARDS } = await import("../src/store/lib/partnerTypes.ts");

const branding = {
  siteUrl: "https://geega-games.com",
  logoUrl: "https://geega-games.com/logo.png",
  supportEmail: "support@geega-games.com",
};

/** Rendered HTML with entities decoded enough to search plain words. */
async function html(element: React.ReactElement): Promise<string> {
  return (await render(element)).replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&");
}

beforeEach(() => {
  state = createFakeState();
  sent.length = 0;
  pushes.length = 0;
});

describe("partner email templates", () => {
  it("PartnerLeadForStore gives the store the seller's details, the standards and its fee", async () => {
    const data = {
      ...branding,
      contactName: "Pat",
      leadReference: "GG-R-100001",
      categoriesLabel: "Pokémon cards",
      sellerName: "Sam Rivera",
      sellerFirstName: "Sam",
      email: "sam@example.com",
      phone: "314-555-0123",
      preferredContact: "Text",
      location: "Kirkwood, MO",
      handoffLabel: "Meet up in person",
      sizeLabel: "A binder or box",
      description: "Base Set binder and two sealed boxes.",
      cardLines: [],
      photoUrls: ["https://signed.example/a.jpg"],
      photoLinkDays: 7,
      feePercentLabel: "8%",
    };
    const out = await html(React.createElement(emails.PartnerLeadForStore, data));
    expect(out).toContain("Sam Rivera");
    expect(out).toContain("sam@example.com");
    expect(out).toContain("agreed to have these details passed to you");
    expect(out).toContain("Photos (links work for 7 days)");
    expect(out).toContain("https://signed.example/a.jpg");
    for (const standard of PARTNER_STORE_STANDARDS) expect(out).toContain(standard);
    expect(out).toContain("the finder's fee is 8% of what you pay the seller");
    expect(emails.partnerLeadForStoreSubject(data)).toBe("New lead: Pokémon cards · Kirkwood, MO — GG-R-100001");
    const text = emails.partnerLeadForStoreText(data);
    expect(text).toContain("Nothing is owed if you don't buy.");
  });

  it("PartnerReferralSellerNotice names the store and discloses the referral fee", async () => {
    const data = {
      ...branding,
      firstName: "Sam",
      leadReference: "GG-R-100001",
      categoriesLabel: "Pokémon cards",
      storeName: "Gateway Games",
      storeLocation: "Kirkwood, MO",
      preferredContact: "Text",
    };
    const out = await html(React.createElement(emails.PartnerReferralSellerNotice, data));
    expect(out).toContain("Gateway Games (Kirkwood, MO)");
    expect(out).toContain("they may pay Geega Games a referral fee");
    expect(out).toContain("You're never charged anything");
    expect(out).toContain("free to say no to any offer");
    expect(emails.partnerReferralSellerNoticeText(data)).toContain("may pay Geega Games a referral fee");
  });

  it("PartnerReferralCheckin offers one button per answer", async () => {
    const data = {
      ...branding,
      firstName: "Sam",
      leadReference: "GG-R-100001",
      storeName: "Gateway Games",
      answers: [
        { label: "Yes, I sold to them", url: "https://geega-games.com/api/partner-referrals/checkin?a=sold" },
        { label: "They never got in touch", url: "https://geega-games.com/api/partner-referrals/checkin?a=not_contacted" },
      ],
    };
    const out = await html(React.createElement(emails.PartnerReferralCheckin, data));
    expect(out).toContain("Did Gateway Games get in touch?");
    expect(out).toContain("checkin?a=sold");
    expect(out).toContain("checkin?a=not_contacted");
  });

  it("PartnerApproved: a store gets its fee and the standards; a referral partner gets its link", async () => {
    const store = await html(
      React.createElement(emails.PartnerApproved, {
        ...branding,
        contactName: "Pat",
        businessName: "Gateway Games",
        kind: "store",
        feePercentLabel: "8%",
        categoriesLabel: "Pokémon cards and video games",
        referralLink: null,
      }),
    );
    expect(store).toContain("Gateway Games is now a Geega Games partner store");
    expect(store).toContain("8% of what you pay the seller, and only when you buy");
    for (const standard of PARTNER_STORE_STANDARDS) expect(store).toContain(standard);

    const referrer = await html(
      React.createElement(emails.PartnerApproved, {
        ...branding,
        contactName: "Jo",
        businessName: "Heirloom Estate Sales",
        kind: "referrer",
        feePercentLabel: "3%",
        categoriesLabel: null,
        referralLink: "https://geega-games.com/sell-cards-and-games?ref=heirloom",
      }),
    );
    expect(referrer).toContain("https://geega-games.com/sell-cards-and-games?ref=heirloom");
    expect(referrer).toContain("we pay you 3% of the sale");
    expect(referrer).toContain("Please ask your client before sharing their details");
  });

  it("ReferralRewardEarned says what was earned and never names the seller", async () => {
    const credit = { ...branding, firstName: "Alex", kind: "store_credit" as const, amountLabel: "$10.00" };
    expect(emails.referralRewardEarnedSubject(credit)).toBe("You earned $10.00 in store credit");
    const out = await html(React.createElement(emails.ReferralRewardEarned, credit));
    expect(out).toContain("added $10.00 in store credit");
    const cash = { ...branding, firstName: null, kind: "cash" as const, amountLabel: "$15.00" };
    expect(emails.referralRewardEarnedText(cash)).toContain("Your referral fee is $15.00");
  });
});

describe("partner email senders", () => {
  let store: Record<string, unknown>;

  beforeEach(() => {
    store = {
      id: fakeId(),
      kind: "store",
      status: "active",
      business_name: "Gateway Games",
      contact_name: "Pat",
      email: "pat@gateway.example",
      city: "Kirkwood",
      state: "MO",
      categories: ["pokemon", "magic"],
      fee_percent: 8,
    };
    state.tables.partners = [store];
  });

  function addReferral(row: Record<string, unknown>) {
    const referral = {
      id: fakeId(),
      partner_id: store.id,
      referral_lead_id: null,
      sell_submission_id: null,
      lead_reference: "GG-R-100001",
      fee_percent: 8,
      outcome: "pending",
      ...row,
    };
    (state.tables.partner_referrals ??= []).push(referral);
    return referral;
  }

  it("sends a partner lead to the store (with signed photo links) and tells the seller the store's name", async () => {
    const lead = {
      id: fakeId(),
      reference_number: "GG-R-100001",
      categories: ["pokemon", "video_games"],
      description: "Base Set binder",
      collection_size: "small",
      handoff: "local",
      first_name: "Sam",
      last_name: "Rivera",
      email: "sam@example.com",
      phone: null,
      preferred_contact_method: "email",
      location: "Kirkwood, MO",
      photo_paths: ["drafts/abc/1.jpg"],
    };
    state.tables.referral_leads = [lead];
    const referral = addReferral({ referral_lead_id: lead.id });

    const result = await senders.sendLeadToPartnerEmails(referral.id as string);
    expect(result.store.status).toBe("sent");
    expect(result.seller.status).toBe("sent");
    const [toStore, toSeller] = sent;
    expect(toStore).toMatchObject({
      emailType: "partner_lead_for_store",
      idempotencyKey: `partner-lead-store-${referral.id}`,
      to: "pat@gateway.example",
    });
    expect(toStore.text).toContain("Pokémon cards and Video games & consoles");
    expect(toStore.text).toContain("https://signed.example/drafts/abc/1.jpg");
    expect(toSeller).toMatchObject({
      emailType: "partner_referral_seller_notice",
      idempotencyKey: `partner-referral-seller-${referral.id}`,
      to: "sam@example.com",
      subject: "Gateway Games will contact you about an offer — GG-R-100001",
    });
    expect(toSeller.text).toContain("Gateway Games (Kirkwood, MO)");
  });

  it("describes a Magic submission to the store with its most valuable cards", async () => {
    const sub = {
      id: fakeId(),
      reference_number: "GG-S-100050",
      first_name: "Lee",
      last_name: null,
      email: "lee@example.com",
      phone: null,
      preferred_contact_method: "email",
      city: "Belleville",
      state: "IL",
      transaction_preference: "ship",
      collection_size: null,
      total_cards: 212,
      estimated_value_cents: 45000,
      valuable_cards_notes: null,
      notes: "Mostly old border cards.",
    };
    state.tables.sell_submissions = [sub];
    state.tables.sell_submission_cards = [
      { submission_id: sub.id, card_name: "Sol Ring", set_code: "c21", condition: "NM", finish: "nonfoil", quantity: 1, scryfall_price_cents: 150 },
      { submission_id: sub.id, card_name: "The One Ring", set_code: "ltr", condition: "LP", finish: "foil", quantity: 1, scryfall_price_cents: 9000 },
    ];
    state.tables.sell_submission_photos = [];
    const referral = addReferral({ sell_submission_id: sub.id, lead_reference: "GG-S-100050" });

    await senders.sendLeadToPartnerEmails(referral.id as string);
    const toStore = sent[0];
    expect(toStore.subject).toBe("New lead: Magic: The Gathering cards · Belleville, IL — GG-S-100050");
    expect(toStore.text).toContain("212 cards listed, about $450.00 at market prices");
    // Most valuable first.
    expect(toStore.text.indexOf("The One Ring (LTR) — LP, foil")).toBeLessThan(toStore.text.indexOf("Sol Ring (C21) — NM"));
  });

  it("skips quietly when the lead behind a referral was deleted", async () => {
    const referral = addReferral({});
    const result = await senders.sendLeadToPartnerEmails(referral.id as string);
    expect(result.store.status).toBe("skipped");
    expect(sent).toEqual([]);
  });

  it("checks in with signed one-tap answers, and only while the outcome is unknown", async () => {
    const lead = {
      id: fakeId(),
      reference_number: "GG-R-100001",
      categories: ["pokemon"],
      description: "Binder",
      collection_size: "small",
      handoff: "either",
      first_name: "Sam",
      last_name: null,
      email: "sam@example.com",
      phone: null,
      preferred_contact_method: "email",
      location: null,
      photo_paths: [],
    };
    state.tables.referral_leads = [lead];
    const referral = addReferral({ referral_lead_id: lead.id });

    expect((await senders.sendPartnerReferralCheckin(referral.id as string)).status).toBe("sent");
    const email = sent[0];
    expect(email).toMatchObject({ idempotencyKey: `partner-referral-checkin-${referral.id}`, to: "sam@example.com" });
    const links = email.text.match(/https:\/\/geega-games\.com\/api\/partner-referrals\/checkin\?\S+/g) ?? [];
    expect(links.length).toBe(3);
    for (const link of links) {
      const params = new URL(link).searchParams;
      expect(params.get("r")).toBe(referral.id);
      expect(verifyGuestToken("checkin", params.get("r"), params.get("t"))).toBe(true);
    }

    referral.outcome = "sold";
    expect((await senders.sendPartnerReferralCheckin(referral.id as string)).status).toBe("skipped");
    expect(sent).toHaveLength(1);
  });

  it("tells staff about a new application (push + email they can reply to) and thanks the applicant", async () => {
    const applicant = {
      id: fakeId(),
      kind: "store",
      status: "applied",
      business_name: "Gateway Games",
      contact_name: "Pat",
      email: "pat@gateway.example",
      phone: null,
      website: null,
      city: "Kirkwood",
      state: "MO",
      categories: ["pokemon", "video_games"],
      coverage: "St. Louis County",
      buys_by_mail: true,
      profession: null,
      notes: "We buy daily.",
      fee_percent: 8,
    };
    state.tables.partners = [applicant];
    const result = await senders.sendPartnerApplicationEmails(applicant.id);
    expect(result.admin.status).toBe("sent");
    expect(pushes[0]).toMatchObject({ title: "New partner store application", url: `/admin_dashboard/partners?partner=${applicant.id}` });
    const [toStaff, toApplicant] = sent;
    expect(toStaff).toMatchObject({ to: "leads@example.com", replyTo: "pat@gateway.example" });
    expect(toStaff.text).toContain("Buys: Pokémon cards and Video games & consoles");
    expect(toStaff.text).toContain("Buys by mail: Yes");
    expect(toApplicant).toMatchObject({ to: "pat@gateway.example", idempotencyKey: `partner-application-received-${applicant.id}` });
  });

  it("only welcomes a referral partner once they have a link", async () => {
    const referrer = {
      id: fakeId(),
      kind: "referrer",
      status: "active",
      business_name: "Heirloom Estate Sales",
      contact_name: "Jo",
      email: "jo@heirloom.example",
      categories: [],
      profession: "estate_sale",
      fee_percent: 3,
    };
    state.tables.partners = [referrer];
    expect((await senders.sendPartnerApprovedEmail(referrer.id)).status).toBe("skipped");
    state.tables.referral_codes = [{ code: "heirloom", partner_id: referrer.id }];
    expect((await senders.sendPartnerApprovedEmail(referrer.id)).status).toBe("sent");
    expect(sent[0].text).toContain("https://geega-games.com/sell-cards-and-games?ref=heirloom");
  });

  it("emails a customer their store credit reward by first name", async () => {
    state.users["cust-1"] = { id: "cust-1", email: "friend@example.com" };
    state.tables.profiles = [{ id: "cust-1", first_name: "Alex" }];
    state.tables.referral_rewards = [{ id: "rw-1", kind: "store_credit", amount_cents: 1000, user_id: "cust-1", partner_id: null }];
    expect((await senders.sendReferralRewardEmail("rw-1")).status).toBe("sent");
    expect(sent[0]).toMatchObject({ to: "friend@example.com", subject: "You earned $10.00 in store credit" });
    expect(sent[0].text).toContain("Hi Alex,");
  });
});
