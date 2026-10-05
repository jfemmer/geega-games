import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as React from "react";
import { render } from "@react-email/render";
import {
  ConfirmSubscription,
  confirmSubscriptionText,
} from "../api/_lib/emails/ConfirmSubscription.js";
import {
  SubscriptionConfirmed,
  subscriberShopLinks,
  subscriptionConfirmedText,
} from "../api/_lib/emails/SubscriptionConfirmed.js";

// What someone is told after joining the email list on the home page: the
// "confirm your email" message, the welcome message, and the page the
// confirmation link opens. All three used to talk about the shop's launch
// ("we'll email you the moment the shop and checkout go live") long after it
// had opened. They now say what the list is for: new arrivals, discounts and
// crazy deals — the same promise as the signup box (tests/signupForm.test.tsx).

const LAUNCH_WORDING = /launch|go(es)? live|shop opens|geega games opens|being early/i;

const base = {
  siteUrl: "https://geega-games.com",
  logoUrl: "https://geega-games.com/logo.png",
  supportEmail: "support@geega-games.com",
};

/** The words a reader sees: tags and React's comment markers removed. */
function visibleText(html: string): string {
  return html
    .replace(/<!--.*?-->/gs, "")
    .replace(/<style[\s\S]*?<\/style>/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

describe("the “confirm your email” message", () => {
  const props = { ...base, confirmUrl: "https://geega-games.com/api/confirm?token=abc", expiresInHours: 48 };

  it("says it's for the email list and what the list sends", async () => {
    const html = await render(React.createElement(ConfirmSubscription, props));
    const text = visibleText(html);
    expect(text).toContain("Confirm your email");
    expect(text).toContain("Thanks for joining the Geega Games email list.");
    expect(text).toContain("email you about new arrivals, discounts and the occasional crazy deal.");
    expect(html).toContain('href="https://geega-games.com/api/confirm?token=abc"');
    expect(text).toContain("This link expires in 48 hours.");
    expect(text).not.toMatch(LAUNCH_WORDING);
  });

  // The long link has to be allowed to break anywhere to fit a phone. The
  // same style used to be on the sentence under it, which split words in two
  // ("you ca / n safely ignore this email").
  it("lets the pasted link break mid-word, but not the sentences", async () => {
    const html = await render(React.createElement(ConfirmSubscription, props));
    const paragraphs = [...html.matchAll(/<p[^>]*style="([^"]*)"[^>]*>([\s\S]*?)<\/p>/g)];
    const styleOf = (words: string) => paragraphs.find(([, , body]) => body.includes(words))?.[1] ?? "";
    expect(styleOf("Or paste this link")).toMatch(/word-break:\s*break-all/);
    expect(styleOf("This link expires")).toMatch(/word-break:\s*normal/);
    expect(styleOf("Thanks for joining")).not.toMatch(/word-break/);
  });

  it("says the same in the plain-text version", () => {
    const text = confirmSubscriptionText(props);
    expect(text).toContain("Thanks for joining the Geega Games email list. Confirm this address and");
    expect(text).toContain("we'll email you about new arrivals, discounts and the occasional crazy deal.");
    expect(text).toContain("https://geega-games.com/api/confirm?token=abc");
    expect(text).not.toMatch(LAUNCH_WORDING);
  });
});

describe("the welcome message after confirming", () => {
  const props = { ...base, unsubscribeUrl: "https://geega-games.com/api/unsubscribe?token=xyz" };

  it("says what subscribers will hear about and links to the shop", async () => {
    const html = await render(React.createElement(SubscriptionConfirmed, props));
    const text = visibleText(html);
    expect(text).toContain("on the list");
    expect(text).toContain(
      "email you about new arrivals and restocks, discounts and sales, and the occasional crazy deal",
    );
    expect(text).toContain("something worth opening.");
    expect(text).toContain("Or browse Deals & Specials .");
    expect(text).toContain("Thanks for joining.");
    expect(text).not.toMatch(LAUNCH_WORDING);

    // "See what's new" opens the newest cards; the second link opens the deals.
    expect(html).toContain('href="https://geega-games.com/shop?sort=newest"');
    expect(html).toContain('href="https://geega-games.com/shop?deals=1"');
  });

  it("always carries a way to unsubscribe", async () => {
    const html = await render(React.createElement(SubscriptionConfirmed, props));
    expect(html).toContain('href="https://geega-games.com/api/unsubscribe?token=xyz"');
    expect(visibleText(html)).toContain("want these emails? Unsubscribe .");
  });

  it("says the same in the plain-text version", () => {
    const text = subscriptionConfirmedText(props);
    expect(text).toContain("Your email is confirmed. We'll email you about new arrivals and restocks,");
    expect(text).toContain("See what's new: https://geega-games.com/shop?sort=newest");
    expect(text).toContain("Deals & Specials: https://geega-games.com/shop?deals=1");
    expect(text).toContain("Unsubscribe: https://geega-games.com/api/unsubscribe?token=xyz");
    expect(text).not.toMatch(LAUNCH_WORDING);
  });

  it("builds its shop links from the site's own address", () => {
    expect(subscriberShopLinks("https://preview.example")).toEqual({
      newArrivals: "https://preview.example/shop?sort=newest",
      deals: "https://preview.example/shop?deals=1",
    });
  });
});

// ── The page the confirmation link opens (GET /api/confirm) ────────────────

const state: { outcome: string; fails: boolean; tokens: string[] } = {
  outcome: "confirmed",
  fails: false,
  tokens: [],
};

vi.mock("../api/_lib/subscribers.js", () => ({
  confirm: async (token: string) => {
    state.tokens.push(token);
    if (state.fails) throw new Error("database unavailable");
    return state.outcome;
  },
}));

process.env.PUBLIC_SITE_URL = "https://geega-games.com";
const { default: confirmPage } = await import("../api/confirm.ts");

async function openConfirmLink(token: string | undefined) {
  const reply = { status: 0, html: "", headers: {} as Record<string, string> };
  const res = {
    setHeader(name: string, value: string) {
      reply.headers[name.toLowerCase()] = value;
      return res;
    },
    status(code: number) {
      reply.status = code;
      return res;
    },
    send(body: string) {
      reply.html = body;
      return res;
    },
  };
  await confirmPage({ method: "GET", query: token === undefined ? {} : { token } } as never, res as never);
  return { ...reply, text: visibleText(reply.html) };
}

describe("the page a confirmation link opens", () => {
  beforeEach(() => {
    state.outcome = "confirmed";
    state.fails = false;
    state.tokens = [];
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("welcomes a new subscriber to the list", async () => {
    const page = await openConfirmLink("a-real-looking-token-123456");
    expect(state.tokens).toEqual(["a-real-looking-token-123456"]);
    expect(page.status).toBe(200);
    expect(page.headers["content-type"]).toBe("text/html; charset=utf-8");
    expect(page.text).toContain("on the list");
    expect(page.text).toContain("email you about new arrivals, discounts and the occasional crazy deal.");
    expect(page.text).toContain("Back to Geega Games");
    expect(page.text).not.toMatch(LAUNCH_WORDING);
    // Never indexed, and never shows the address.
    expect(page.html).toContain('<meta name="robots" content="noindex" />');
  });

  it("tells someone who is already on the list that nothing more is needed", async () => {
    state.outcome = "already_active";
    const page = await openConfirmLink("a-real-looking-token-123456");
    expect(page.status).toBe(200);
    expect(page.text).toContain("already subscribed");
    expect(page.text).toContain("on the list for new arrivals, discounts and crazy deals.");
    expect(page.text).not.toMatch(LAUNCH_WORDING);
  });

  it("asks for a fresh signup when the link has expired or is no good", async () => {
    state.outcome = "expired";
    const expired = await openConfirmLink("a-real-looking-token-123456");
    expect(expired.status).toBe(410);
    expect(expired.text).toContain("This link has expired");

    state.outcome = "invalid";
    const invalid = await openConfirmLink(undefined);
    expect(state.tokens.at(-1)).toBe("");
    expect(invalid.status).toBe(400);
    expect(invalid.text).toContain("Please sign up again on our site to join the email list.");
    expect(invalid.text).not.toMatch(LAUNCH_WORDING);
    expect(expired.text).not.toMatch(LAUNCH_WORDING);
  });

  it("apologises instead of crashing when something breaks", async () => {
    state.fails = true;
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const page = await openConfirmLink("a-real-looking-token-123456");
    expect(page.status).toBe(500);
    expect(page.text).toContain("We hit a snag confirming your email.");
    expect(logged).toHaveBeenCalled();
  });
});
