import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { renderSeoHead } from "../src/seo/head";
import { RETURN_POLICY_JSON_LD, SHIPPING_SERVICES_JSON_LD, SITE_JSON_LD } from "../src/seo/site";
import { SHIPPING } from "../src/store/lib/money";
import { SHIPPING_DAYS, SHIPS_WITHIN_BUSINESS_DAYS } from "../src/store/lib/storePolicies";

// What the site tells search engines about the store as a whole — shipping,
// returns — and the icon and logo files every page loads.

type Node = Record<string, unknown>;
const services = SHIPPING_SERVICES_JSON_LD as Node[];
const conditions = (service: Node) =>
  (Array.isArray(service.shippingConditions) ? service.shippingConditions : [service.shippingConditions]) as Node[];

describe("shipping and returns, as search engines read them", () => {
  it("are part of the business's markup, which every page carries", () => {
    expect(SITE_JSON_LD).toMatchObject({
      "@type": "OnlineStore",
      hasShippingService: SHIPPING_SERVICES_JSON_LD,
      hasMerchantReturnPolicy: RETURN_POLICY_JSON_LD,
    });
    expect(renderSeoHead(null)).toContain('"hasShippingService":[{"@type":"ShippingService"');
  });

  it("charge what checkout charges: an envelope or tracked below the free-shipping line, free tracked at or above it", () => {
    expect(SHIPPING).toMatchObject({ pweCents: 150, trackedCents: 550, freeShippingThresholdCents: 7500 });
    const [envelope, tracked] = services;
    expect(envelope.name).toBe("Plain white envelope (untracked)");
    expect(conditions(envelope)).toEqual([
      {
        "@type": "ShippingConditions",
        shippingDestination: { "@type": "DefinedRegion", addressCountry: "US" },
        orderValue: { "@type": "MonetaryAmount", minValue: 0, maxValue: 74.99, currency: "USD" },
        shippingRate: { "@type": "MonetaryAmount", value: 1.5, currency: "USD" },
      },
    ]);
    expect(tracked.name).toBe("Tracked shipping");
    expect(conditions(tracked).map((c) => [c.orderValue, (c.shippingRate as Node).value])).toEqual([
      [{ "@type": "MonetaryAmount", minValue: 0, maxValue: 74.99, currency: "USD" }, 5.5],
      [{ "@type": "MonetaryAmount", minValue: 75, currency: "USD" }, 0],
    ]);
  });

  it("only ever ship within the United States", () => {
    for (const service of services) {
      for (const condition of conditions(service)) {
        expect(condition.shippingDestination).toEqual({ "@type": "DefinedRegion", addressCountry: "US" });
      }
    }
  });

  it("promise the handling time the shipping page states, and no delivery time it doesn't", () => {
    expect(SHIPS_WITHIN_BUSINESS_DAYS).toBe(2);
    for (const service of services) {
      expect(service.handlingTime).toEqual({
        "@type": "ServicePeriod",
        businessDays: {
          "@type": "OpeningHoursSpecification",
          dayOfWeek: SHIPPING_DAYS.map((day) => `https://schema.org/${day}`),
        },
        duration: { "@type": "QuantitativeValue", minValue: 0, maxValue: 2, unitCode: "DAY" },
      });
      expect(JSON.stringify(service)).not.toContain("transitTime");
    }
    expect(SHIPPING_DAYS).not.toContain("Sunday");
  });

  it("point to the returns page instead of claiming a return window: returns are for our mistakes only", () => {
    expect(RETURN_POLICY_JSON_LD).toEqual({
      "@type": "MerchantReturnPolicy",
      merchantReturnLink: "https://geega-games.com/returns",
    });
  });
});

// ---- Icons and logo ------------------------------------------------------------

const root = new URL("../", import.meta.url);
const file = (path: string) => readFileSync(new URL(path, root));

/** A PNG's pixel size, from its header. */
function pngSize(bytes: Buffer): { width: number; height: number } {
  expect([...bytes.subarray(1, 4)].map((b) => String.fromCharCode(b)).join("")).toBe("PNG");
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

describe("the site's icons", () => {
  const html = readFileSync(new URL("index.html", root), "utf8");
  const icons = [...html.matchAll(/<link rel="icon" type="image\/png" sizes="(\d+)x(\d+)" href="([^"]+)" \/>/g)];

  it("are PNGs of the sizes they claim — a format Google shows in results, unlike SVG", () => {
    expect(icons.map((m) => m[3])).toEqual([
      "/favicon-192.png",
      "/favicon-96.png",
      "/favicon.png",
      "/favicon-32.png",
      "/favicon-16.png",
    ]);
    for (const [, width, height, href] of icons) {
      expect(pngSize(file(`public${href}`)), href).toEqual({ width: Number(width), height: Number(height) });
    }
    // Google prefers an icon larger than 48x48.
    expect(Number(icons[0][1])).toBeGreaterThan(48);
  });

  it("don't include the 3.8 MB SVG any more", () => {
    expect(html).not.toContain("favicon.svg");
    expect(existsSync(new URL("public/favicon.svg", root))).toBe(false);
  });

  it("are light", () => {
    for (const [, , , href] of icons) expect(file(`public${href}`).length, href).toBeLessThan(80_000);
    expect(file("public/favicon.ico").length).toBeLessThan(20_000);
  });
});

describe("the logo", () => {
  it("is a few dozen kilobytes, not 1.7 MB: it is on every page, in emails, and in the business markup", () => {
    const logo = file("public/logo.png");
    expect(logo.length).toBeLessThan(150_000);
    const { width, height } = pngSize(logo);
    // Sharp at three times its largest size (160 pixels wide in emails).
    expect(width).toBeGreaterThanOrEqual(480);
    // Google wants the business logo at least 112 pixels square.
    expect(Math.min(width, height)).toBeGreaterThanOrEqual(112);
    expect(SITE_JSON_LD).toMatchObject({ logo: "https://geega-games.com/logo.png" });
  });
});
