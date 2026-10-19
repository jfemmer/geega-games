import { describe, expect, it, vi } from "vitest";
import {
  PARTNER_CATEGORIES,
  defaultFeePercent,
  feeCents,
  formatPercent,
  leadPartnerCategories,
  partnerBuysAny,
} from "../src/store/lib/partnerTypes";
import { REFERRAL_CATEGORIES } from "../src/store/lib/referralTypes";
import { REFERRAL_PAGES } from "../src/seo/referralPages";
import {
  MARKETING_PAGES,
  daysAgoIso,
  marketingLink,
  marketingPage,
  printedAddress,
  qrFileName,
  summarizeLeadSources,
} from "../src/admin/utils/marketing";
import { cleanWebsite, ensurePartnerReferralCode, newReferralCode, partnerFieldsFromInput } from "../api/_lib/partners";

// The partner program's pure rules: fees, categories, the admin's field
// cleaning and referral codes, and the Marketing page's links, flyer copy and
// lead-source counts.

describe("fees and categories", () => {
  it("works out a fee in cents, rounding half up", () => {
    expect(feeCents(123456, 8)).toBe(9876);
    expect(feeCents(50000, 3)).toBe(1500);
    expect(feeCents(1250, 7.5)).toBe(94);
    expect(feeCents(0, 8)).toBe(0);
    expect(feeCents(10000, 0)).toBe(0);
    expect(feeCents(Number.NaN, 8)).toBe(0);
  });

  it("formats percentages without trailing zeros", () => {
    expect(formatPercent(8)).toBe("8%");
    expect(formatPercent(7.5)).toBe("7.5%");
    expect(formatPercent(7.125)).toBe("7.13%");
  });

  it("starts stores at 8% and referral partners at 3%", () => {
    expect(defaultFeePercent("store")).toBe(8);
    expect(defaultFeePercent("referrer")).toBe(3);
  });

  it("offers stores Magic, every seller-page category and 'other card games' — nothing we don't have pages for", () => {
    expect(PARTNER_CATEGORIES.map((c) => c.value)).toEqual(["magic", "pokemon", "one_piece", "video_games", "other_tcg"]);
    expect(REFERRAL_CATEGORIES.map((c) => c.value)).toEqual(REFERRAL_PAGES.map((p) => p.category));
  });

  it("matches a lead to stores that buy what it has", () => {
    expect(leadPartnerCategories({ kind: "sell_submission" })).toEqual(["magic"]);
    expect(leadPartnerCategories({ kind: "referral_lead", categories: ["pokemon", "yugioh"] })).toEqual(["pokemon"]);
    expect(partnerBuysAny(["pokemon", "magic"], ["video_games", "pokemon"])).toBe(true);
    expect(partnerBuysAny(["magic"], ["video_games"])).toBe(false);
  });
});

describe("admin partner fields (api/_lib/partners)", () => {
  it("turns a bare domain into a website and rejects anything else", () => {
    expect(cleanWebsite("gateway.example")).toBe("https://gateway.example/");
    expect(cleanWebsite("http://gateway.example/shop")).toBe("http://gateway.example/shop");
    expect(cleanWebsite("javascript:alert(1)")).toBeNull();
    expect(cleanWebsite("localhost")).toBeNull();
    expect(cleanWebsite("")).toBeNull();
  });

  it("returns only the fields sent, cleaned, and refuses to blank required ones", () => {
    expect(partnerFieldsFromInput({ phone: " 314-555-0100 ", state: "Illinois", feePercent: "7.555" }, "store")).toEqual({
      phone: "314-555-0100",
      state: "IL",
      fee_percent: 7.56,
    });
    expect(() => partnerFieldsFromInput({ businessName: "" }, "store")).toThrow(/can't be empty/);
    expect(() => partnerFieldsFromInput({ email: "nope" }, "store")).toThrow(/valid email/);
    expect(() => partnerFieldsFromInput({ feePercent: 51 }, "store")).toThrow(/between 0% and 50%/);
    expect(() => partnerFieldsFromInput({ categories: ["yugioh"] }, "store")).toThrow(/at least one/);
    expect(partnerFieldsFromInput({ categories: [] }, "referrer")).toEqual({ categories: [] });
    expect(() => partnerFieldsFromInput({ profession: "astronaut" }, "referrer")).toThrow(/profession/);
  });

  it("makes 8-character codes without look-alike characters", () => {
    for (let i = 0; i < 200; i++) expect(newReferralCode()).toMatch(/^[abcdefghjkmnpqrstuvwxyz23456789]{8}$/);
  });

  it("gives a partner one code, trying again if a code is taken", async () => {
    const inserts: string[] = [];
    let existing: string | null = null;
    const admin = {
      from: () => ({
        select: () => ({
          eq: () => ({ maybeSingle: async () => ({ data: existing ? { code: existing } : null, error: null }) }),
        }),
        insert: vi.fn(async (row: { code: string }) => {
          inserts.push(row.code);
          // The first code is taken by someone else.
          if (inserts.length === 1) return { error: { code: "23505", message: "duplicate" } };
          existing = row.code;
          return { error: null };
        }),
      }),
    };
    const code = await ensurePartnerReferralCode(admin as never, "p1");
    expect(inserts).toHaveLength(2);
    expect(code).toBe(inserts[1]);
    // Asking again returns the same code without making another.
    expect(await ensurePartnerReferralCode(admin as never, "p1")).toBe(code);
    expect(inserts).toHaveLength(2);
  });
});

describe("Marketing page data (src/admin/utils/marketing)", () => {
  it("links to every seller page, the partner pages and the home page", () => {
    const paths = MARKETING_PAGES.map((p) => p.path);
    for (const page of REFERRAL_PAGES) expect(paths).toContain(page.path);
    for (const path of ["/sell-cards-and-games", "/sell-my-collection", "/sell-magic-cards/st-louis", "/for-stores", "/referral-partners", "/"]) {
      expect(paths).toContain(path);
    }
    expect(new Set(MARKETING_PAGES.map((p) => p.key)).size).toBe(MARKETING_PAGES.length);
    expect(marketingPage("nope").key).toBe("hub");
  });

  it("follows the seller copy rules on every flyer", () => {
    for (const page of MARKETING_PAGES) {
      const words = [page.copy.headline, page.copy.sub, ...page.copy.points, page.copy.cta, page.copy.finePrint ?? ""].join(" ");
      // No payout, price or speed promises, and the retired partner line.
      expect(words, page.key).not.toMatch(/very competitively|top dollar|best price|highest|cash today|same.day|fast cash/i);
      // The yard sale sign isn't seller copy: it's printed for one sale and names its minimum card price.
      if (page.key !== "yard_sale") expect(words, page.key).not.toMatch(/\$\d/);
      // Nothing we don't take.
      expect(words, page.key).not.toMatch(/Yu-Gi-Oh|Lorcana|sports cards/i);
      expect(page.copy.points.length, page.key).toBeGreaterThanOrEqual(3);
      expect(page.copy.points.length, page.key).toBeLessThanOrEqual(4);
    }
  });

  it("discloses the referral fee on every flyer that sends sellers to a partner store", () => {
    const partnerFlyers = MARKETING_PAGES.filter((p) => p.key === "hub" || REFERRAL_PAGES.some((r) => r.category === p.key));
    expect(partnerFlyers.length).toBe(REFERRAL_PAGES.length + 1);
    for (const page of partnerFlyers) {
      expect(page.copy.finePrint, page.key).toMatch(/may pay Geega Games a referral fee/);
      expect(page.copy.finePrint, page.key).toMatch(/never charged/);
    }
    // A partner-store flyer never says Geega Games buys the thing.
    for (const page of MARKETING_PAGES.filter((p) => REFERRAL_PAGES.some((r) => r.category === p.key))) {
      expect(page.copy.finePrint, page.key).toMatch(/doesn't buy/);
    }
  });

  it("names every seller-page category on the hub flyer", () => {
    const sub = marketingPage("hub").copy.sub.toLowerCase();
    for (const page of REFERRAL_PAGES) expect(sub).toContain(page.noun.replace(/ cards$/, "").toLowerCase());
  });

  it("prints a typeable address (a referral code stays on it, tracking tags don't)", () => {
    expect(printedAddress("/sell-cards-and-games")).toBe("geega-games.com/sell-cards-and-games");
    expect(printedAddress("/")).toBe("geega-games.com");
    expect(printedAddress("/sell-cards-and-games", "HEIRLOOM")).toBe("geega-games.com/sell-cards-and-games?ref=heirloom");
    expect(printedAddress("/sell-cards-and-games", "bad code")).toBe("geega-games.com/sell-cards-and-games");
  });

  it("always links to the live site", () => {
    expect(marketingLink("/sell-video-games", { source: "flyer", medium: "print" })).toBe(
      "https://geega-games.com/sell-video-games?utm_source=flyer&utm_medium=print",
    );
  });

  it("names QR downloads after what they're for", () => {
    expect(qrFileName(["hub", "card_show", "Nov 1 Show", null])).toBe("geega-qr-hub-card_show-nov-1-show");
    expect(qrFileName([])).toBe("geega-qr");
  });

  it("counts leads by source, most first, with campaigns, and 'Direct or unknown' last", () => {
    const rows = [
      { kind: "buying_lead" as const, utmSource: "card_show", utmCampaign: "nov-1" },
      { kind: "partner_lead" as const, utmSource: "card_show", utmCampaign: "nov-1" },
      { kind: "buying_lead" as const, utmSource: "card_show", utmCampaign: "nov-15" },
      { kind: "buying_lead" as const },
      { kind: "buying_lead" as const },
      { kind: "buying_lead" as const },
      { kind: "buying_lead" as const },
      { kind: "partner_application" as const, referrerHost: "www.google.com" },
      { kind: "partner_lead" as const, refCode: "heirloom", utmSource: "flyer" },
    ];
    const summary = summarizeLeadSources(rows);
    expect(summary.map((s) => s.source)).toEqual(["Card show or event", "Google", "Referral link", "Direct or unknown"]);
    expect(summary[0]).toMatchObject({
      buyingLeads: 2,
      partnerLeads: 1,
      partnerApplications: 0,
      total: 3,
      campaigns: [
        { campaign: "nov-1", count: 2 },
        { campaign: "nov-15", count: 1 },
      ],
    });
    expect(summary[3]).toMatchObject({ source: "Direct or unknown", total: 4 });
    expect(summarizeLeadSources([])).toEqual([]);
  });

  it("works out the start of a 'last N days' window", () => {
    expect(daysAgoIso(30, Date.UTC(2026, 9, 31))).toBe("2026-10-01T00:00:00.000Z");
  });
});
