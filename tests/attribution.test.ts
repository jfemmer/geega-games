// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  REFERRAL_LINK_SOURCE,
  UNKNOWN_LEAD_SOURCE,
  campaignFromSearch,
  cleanCampaignToken,
  cleanHeardAbout,
  cleanLandingPath,
  cleanRefCode,
  cleanReferrerHost,
  describeLeadSource,
  externalReferrerHost,
  leadSourceBucket,
  sanitizeAttribution,
  sourceLabel,
  taggedLink,
} from "../src/store/lib/attribution";
import { ATTRIBUTION_TTL_MS, getAttribution, recordVisit } from "../src/store/lib/attributionStore";

// Where a seller came from: the tagged link or QR code, a personal referral
// code, the first page and the referring site. Cleaned in the browser and
// again on the server, so nothing odd reaches the database.

describe("cleaning", () => {
  it("turns campaign tags into simple tokens", () => {
    expect(cleanCampaignToken("  Card Show — Nov 1!  ")).toBe("card-show-nov-1");
    expect(cleanCampaignToken("estate_partner")).toBe("estate_partner");
    expect(cleanCampaignToken("<script>")).toBe("script");
    expect(cleanCampaignToken("!!!")).toBeNull();
    expect(cleanCampaignToken(42)).toBeNull();
    expect(cleanCampaignToken("a".repeat(150))).toHaveLength(100);
  });

  it("accepts only well-formed referral codes", () => {
    expect(cleanRefCode(" AbCd2345 ")).toBe("abcd2345");
    expect(cleanRefCode("short")).toBeNull();
    expect(cleanRefCode("way-too-long-for-a-code")).toBeNull();
    expect(cleanRefCode("abc'; --")).toBeNull();
  });

  it("keeps a same-site path without its query, and a plain host", () => {
    expect(cleanLandingPath("/sell-pokemon-cards?utm_source=x#top")).toBe("/sell-pokemon-cards");
    expect(cleanLandingPath("//evil.example/x")).toBeNull();
    expect(cleanLandingPath("https://evil.example")).toBeNull();
    expect(cleanReferrerHost("WWW.Google.com")).toBe("www.google.com");
    expect(cleanReferrerHost("evil.example/path")).toBeNull();
  });

  it("sanitizes a whole attribution payload into columns, dropping anything odd", () => {
    expect(
      sanitizeAttribution({
        utmSource: "Flyer",
        utmMedium: "print",
        utmCampaign: null,
        ref: "NOPE!",
        landingPath: "/sell",
        referrerHost: "l.facebook.com",
        extra: "ignored",
      }),
    ).toEqual({
      utm_source: "flyer",
      utm_medium: "print",
      utm_campaign: null,
      ref_code: null,
      landing_path: "/sell",
      referrer_host: "l.facebook.com",
    });
    expect(sanitizeAttribution("garbage")).toEqual({
      utm_source: null,
      utm_medium: null,
      utm_campaign: null,
      ref_code: null,
      landing_path: null,
      referrer_host: null,
    });
  });

  it("only accepts the listed 'how did you hear about us' answers", () => {
    expect(cleanHeardAbout("Flyer or sign")).toBe("Flyer or sign");
    expect(cleanHeardAbout("flyer or sign")).toBeNull();
    expect(cleanHeardAbout(undefined)).toBeNull();
  });
});

describe("links", () => {
  it("reads the tags from a query string", () => {
    expect(campaignFromSearch("?utm_source=Card_Show&utm_medium=qr&ref=ABCD2345&x=1")).toEqual({
      utmSource: "card_show",
      utmMedium: "qr",
      utmCampaign: null,
      ref: "abcd2345",
    });
  });

  it("ignores our own site as a referrer", () => {
    expect(externalReferrerHost("https://www.geega-games.com/shop", "geega-games.com")).toBeNull();
    expect(externalReferrerHost("https://l.facebook.com/x", "geega-games.com")).toBe("l.facebook.com");
    expect(externalReferrerHost("", "geega-games.com")).toBeNull();
    expect(externalReferrerHost("not a url", "geega-games.com")).toBeNull();
  });

  it("builds tagged links, leaving out empty tags", () => {
    expect(
      taggedLink("https://geega-games.com", "/sell-cards-and-games", {
        source: "card_show",
        medium: "qr",
        campaign: "Nov 1 Show",
        ref: "abcd2345",
      }),
    ).toBe(
      "https://geega-games.com/sell-cards-and-games?utm_source=card_show&utm_medium=qr&utm_campaign=nov-1-show&ref=abcd2345",
    );
    expect(taggedLink("https://geega-games.com", "/", { source: "", ref: "bad" })).toBe("https://geega-games.com/");
  });
});

describe("reading it back", () => {
  it("buckets a lead by its most specific source", () => {
    expect(leadSourceBucket({ refCode: "abcd2345", utmSource: "flyer" })).toBe(REFERRAL_LINK_SOURCE);
    expect(leadSourceBucket({ utmSource: "card_show", referrerHost: "google.com" })).toBe("Card show or event");
    expect(leadSourceBucket({ utmSource: "church-bulletin" })).toBe("church-bulletin");
    expect(leadSourceBucket({ referrerHost: "www.google.co.uk" })).toBe("Google");
    expect(leadSourceBucket({ referrerHost: "m.facebook.com" })).toBe("Facebook");
    expect(leadSourceBucket({ heardAbout: "Friend or family" })).toBe("Said: Friend or family");
    expect(leadSourceBucket({})).toBe(UNKNOWN_LEAD_SOURCE);
  });

  it("describes a lead's source in plain lines", () => {
    expect(
      describeLeadSource({
        utmSource: "flyer",
        utmMedium: "print",
        utmCampaign: "laundromat",
        landingPath: "/sell-video-games",
        heardAbout: "Flyer or sign",
      }),
    ).toEqual([
      "Tagged link: Flyer or sign (print · laundromat)",
      "First page: /sell-video-games",
      "Said they heard about us from: Flyer or sign",
    ]);
    expect(describeLeadSource({})).toEqual([]);
    expect(sourceLabel(null)).toBeNull();
  });
});

describe("remembering a visit (attributionStore)", () => {
  const host = "geega-games.com";
  const t0 = Date.UTC(2026, 9, 11, 12);

  beforeEach(() => localStorage.clear());
  afterEach(() => localStorage.clear());

  it("remembers the first visit's page and referrer through ordinary page views", () => {
    recordVisit({ pathname: "/sell-pokemon-cards", search: "", referrer: "https://www.google.com/", host }, t0);
    recordVisit({ pathname: "/shop", search: "", referrer: "https://geega-games.com/x", host }, t0 + 1000);
    expect(getAttribution(t0 + 2000)).toMatchObject({
      landingPath: "/sell-pokemon-cards",
      referrerHost: "www.google.com",
      utmSource: null,
    });
  });

  it("lets the latest tagged link take the credit", () => {
    recordVisit({ pathname: "/", search: "", referrer: "https://www.google.com/", host }, t0);
    recordVisit({ pathname: "/sell-cards-and-games", search: "?utm_source=card_show&utm_medium=qr", referrer: "", host }, t0 + 1000);
    expect(getAttribution(t0 + 2000)).toMatchObject({
      utmSource: "card_show",
      utmMedium: "qr",
      landingPath: "/sell-cards-and-games",
      referrerHost: null,
    });
  });

  it("keeps a referral code alongside, replaced only by another code", () => {
    recordVisit({ pathname: "/sell-cards-and-games", search: "?ref=heirloom", referrer: "", host }, t0);
    recordVisit({ pathname: "/", search: "?utm_source=facebook", referrer: "", host }, t0 + 1000);
    expect(getAttribution(t0 + 2000)).toMatchObject({ ref: "heirloom", utmSource: "facebook" });
    recordVisit({ pathname: "/", search: "?ref=friend22", referrer: "", host }, t0 + 3000);
    expect(getAttribution(t0 + 4000)?.ref).toBe("friend22");
  });

  it("forgets after 30 days", () => {
    recordVisit({ pathname: "/sell", search: "?utm_source=flyer", referrer: "", host }, t0);
    expect(getAttribution(t0 + ATTRIBUTION_TTL_MS - 1)).not.toBeNull();
    expect(getAttribution(t0 + ATTRIBUTION_TTL_MS + 1)).toBeNull();
  });

  it("survives junk in storage", () => {
    localStorage.setItem("gg.attribution.v1", "{not json");
    expect(getAttribution(t0)).toBeNull();
    recordVisit({ pathname: "/sell", search: "", referrer: "", host }, t0);
    expect(getAttribution(t0)?.landingPath).toBe("/sell");
  });
});
