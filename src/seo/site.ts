// Site-wide SEO constants shared by the storefront (useSEO), the build-time
// prerender (scripts/prerender.ts) and /api/sitemap. Keep this module pure —
// no React, no DOM, no import.meta.env — so all three can import it.

import { SHIPPING } from "../store/lib/money.js";
import { SHIPPING_DAYS, SHIPS_WITHIN_BUSINESS_DAYS } from "../store/lib/storePolicies.js";

/** Canonical production origin. Canonical URLs and the sitemap always use this. */
export const PRODUCTION_ORIGIN = "https://geega-games.com";

/**
 * What a page without its own useSEO call shows (login, checkout, account…),
 * and what the neutral SPA shell ships with before JavaScript runs. The
 * homepage uses these too, so the brand title is stated in one place.
 */
export const DEFAULT_SEO = {
  title: "Geega Games | Buy & Sell Magic: The Gathering Cards — St. Louis",
  description:
    "Buy Magic: The Gathering singles online and sell your MTG cards or whole collection to Geega Games. Based in St. Louis: we meet up locally, travel about 6 hours for collections, and buy by mail nationwide.",
} as const;

/**
 * The share-preview image for any page that doesn't name its own
 * (public/og-image.png). Card pages use the card's picture instead.
 */
export const DEFAULT_OG_IMAGE: { url: string; width: number; height: number; alt?: string } = {
  url: `${PRODUCTION_ORIGIN}/og-image.png`,
  width: 1200,
  height: 630,
};

// ---- Service area -----------------------------------------------------------
// Geega Games has no public storefront. Sellers can meet up in person in the
// St. Louis area, the owner travels up to about a 6-hour drive from St. Louis
// to buy collections in person, and anyone in the US can ship cards in.
//
// SERVICE_STATES is a defensible, clearly approximate list of states that are
// substantially within that drive. Visible copy always says "about a 6-hour
// drive", never a mileage figure; SERVICE_RADIUS_METERS is only used in the
// GeoCircle schema. The regional pages in sellAreas.ts must stay inside it.

export const HUB_CITY = "St. Louis";
export const HUB_STATE = "Missouri";
export const HUB_COORDINATES = { latitude: 38.627, longitude: -90.1994 } as const;
export const MAX_DRIVE_HOURS = 6;
// ~350 miles — a rough "6 hours at realistic highway speeds including stops".
export const SERVICE_RADIUS_METERS = 563000;
export const SERVICE_STATES = [
  "Missouri",
  "Illinois",
  "Kentucky",
  "Indiana",
  "Tennessee",
  "Arkansas",
  "Kansas",
  "Iowa",
  "Oklahoma",
] as const;

export function serviceAreaServed(): object[] {
  return [
    {
      "@type": "GeoCircle",
      geoMidpoint: { "@type": "GeoCoordinates", ...HUB_COORDINATES },
      geoRadius: SERVICE_RADIUS_METERS,
    },
    { "@type": "City", name: HUB_CITY, containedInPlace: { "@type": "State", name: HUB_STATE } },
    ...SERVICE_STATES.map((name) => ({ "@type": "State", name })),
  ];
}

/** Referenced by every page's structured data as the business entity. */
export const ORGANIZATION_ID = `${PRODUCTION_ORIGIN}/#organization`;

/** The business's legal entity, as stated in the Terms of Service. */
export const LEGAL_NAME = "Geega Games LLC";

/**
 * Tells search engines (and the AI answers built on them) that Geega Games is
 * not the similarly-named streamer "GEEGA" — Google's AI Overview has
 * summarized the site as "operated by the content creator GEEGA" before.
 * schema.org's disambiguatingDescription exists for exactly this. Mirrored in
 * visible text on /about.
 */
export const DISAMBIGUATING_DESCRIPTION =
  'Geega Games is an independently owned trading card business in St. Louis, Missouri (Geega Games LLC). It is not affiliated with, operated by or endorsed by any streamer, content creator or influencer, including anyone using the name "Geega" or "GEEGA".';

/**
 * Other places the business verifiably exists, for entity matching (SAME_AS
 * below). Only real, public profiles the business controls — add social pages
 * here once they're confirmed.
 */
export const TCGPLAYER_SELLER_URL = "https://www.tcgplayer.com/sellers/Geega-Games/2a2a200d";

/**
 * The Google Business Profile, from the owner (2026-09-26). The Maps URL uses
 * the profile's CID, decoded from the review link below (g.page/r/<id>
 * encodes it), so it's a stable link to the listing rather than a share link.
 */
export const GOOGLE_MAPS_URL = "https://www.google.com/maps?cid=18163581768949483792";
/**
 * Opens Google's "write a review" box for the profile. Linked from the reviews
 * section and the review-request emails (api/_lib/reviewRequests.ts).
 */
export const GOOGLE_REVIEW_URL = "https://g.page/r/CRDJ_lJiARL8EBM/review";

export const SAME_AS: string[] = [GOOGLE_MAPS_URL, TCGPLAYER_SELLER_URL];

export const PUBLIC_EMAIL = "support@geega-games.com";

// ---- Shipping and returns, for search engines -------------------------------
// Google reads a store's shipping rates, handling time and return policy from
// its Organization markup and shows them with its products ("Free shipping",
// "$1.50 shipping"):
//   https://developers.google.com/search/docs/appearance/structured-data/shipping-policy
//   https://developers.google.com/search/docs/appearance/structured-data/return-policy
// Built from the same constants checkout and the policy pages use
// (src/store/lib/money.ts, src/store/lib/storePolicies.ts), so they can't
// disagree. Settings entered in Merchant Center or Search Console take
// precedence over this markup; keep them the same.

const dollars = (cents: number): number => Number((cents / 100).toFixed(2));

const SHIPS_TO = { "@type": "DefinedRegion", addressCountry: "US" };

/** Orders go out within SHIPS_WITHIN_BUSINESS_DAYS, Monday to Saturday. No transit time is promised on the site, so none is stated here. */
const HANDLING_TIME = {
  "@type": "ServicePeriod",
  businessDays: {
    "@type": "OpeningHoursSpecification",
    dayOfWeek: SHIPPING_DAYS.map((day) => `https://schema.org/${day}`),
  },
  duration: { "@type": "QuantitativeValue", minValue: 0, maxValue: SHIPS_WITHIN_BUSINESS_DAYS, unitCode: "DAY" },
};

/** Card subtotals below the free-shipping line, and at or above it. */
const BELOW_FREE_SHIPPING = {
  "@type": "MonetaryAmount",
  minValue: 0,
  maxValue: dollars(SHIPPING.freeShippingThresholdCents - 1),
  currency: "USD",
};
const FREE_SHIPPING_FROM = {
  "@type": "MonetaryAmount",
  minValue: dollars(SHIPPING.freeShippingThresholdCents),
  currency: "USD",
};

const rate = (cents: number) => ({ "@type": "MonetaryAmount", value: dollars(cents), currency: "USD" });

/**
 * The two ways an order ships (checkout_place_order_core decides the charge):
 * a plain white envelope, offered below the free-shipping line, and tracked
 * shipping, which is free at or above it. Google shows the lowest rate that
 * applies to a product's price.
 */
export const SHIPPING_SERVICES_JSON_LD: object[] = [
  {
    "@type": "ShippingService",
    name: "Plain white envelope (untracked)",
    handlingTime: HANDLING_TIME,
    shippingConditions: {
      "@type": "ShippingConditions",
      shippingDestination: SHIPS_TO,
      orderValue: BELOW_FREE_SHIPPING,
      shippingRate: rate(SHIPPING.pweCents),
    },
  },
  {
    "@type": "ShippingService",
    name: "Tracked shipping",
    handlingTime: HANDLING_TIME,
    shippingConditions: [
      {
        "@type": "ShippingConditions",
        shippingDestination: SHIPS_TO,
        orderValue: BELOW_FREE_SHIPPING,
        shippingRate: rate(SHIPPING.trackedCents),
      },
      {
        "@type": "ShippingConditions",
        shippingDestination: SHIPS_TO,
        orderValue: FREE_SHIPPING_FROM,
        shippingRate: rate(0),
      },
    ],
  },
];

/**
 * Returns are for our mistakes only (wrong condition, wrong or missing card,
 * damage in transit), which none of the markup's return categories can say
 * without overstating it — so the policy is given as a link to the page that
 * explains it, the form Google accepts for that.
 */
export const RETURN_POLICY_JSON_LD: object = {
  "@type": "MerchantReturnPolicy",
  merchantReturnLink: `${PRODUCTION_ORIGIN}/returns`,
};

/**
 * Site-wide business entity, emitted on every prerendered page and the SPA
 * shell. Only verified business facts: add telephone once it's real and
 * public.
 */
export const SITE_JSON_LD: object = {
  "@context": "https://schema.org",
  "@type": "OnlineStore",
  "@id": ORGANIZATION_ID,
  name: "Geega Games",
  legalName: LEGAL_NAME,
  description:
    "Magic: The Gathering singles shop and card buyer based in St. Louis, Missouri. Sells singles online and at local events, and buys MTG cards and collections at meetups around St. Louis, within about a 6-hour drive, and by mail nationwide.",
  disambiguatingDescription: DISAMBIGUATING_DESCRIPTION,
  url: `${PRODUCTION_ORIGIN}/`,
  logo: `${PRODUCTION_ORIGIN}/logo.png`,
  image: `${PRODUCTION_ORIGIN}/og-image.png`,
  email: PUBLIC_EMAIL,
  sameAs: SAME_AS,
  areaServed: serviceAreaServed(),
  knowsAbout: [
    "Magic: The Gathering",
    "MTG singles",
    "Trading card collections",
    "Trading card grading and condition",
  ],
  hasShippingService: SHIPPING_SERVICES_JSON_LD,
  hasMerchantReturnPolicy: RETURN_POLICY_JSON_LD,
};

/**
 * Google reads the site name shown in results from WebSite markup on the
 * homepage: https://developers.google.com/search/docs/appearance/site-names
 */
export const WEBSITE_JSON_LD: object = {
  "@context": "https://schema.org",
  "@type": "WebSite",
  "@id": `${PRODUCTION_ORIGIN}/#website`,
  name: "Geega Games",
  url: `${PRODUCTION_ORIGIN}/`,
  publisher: { "@id": ORGANIZATION_ID },
};

export function absoluteUrl(path: string, origin: string = PRODUCTION_ORIGIN): string {
  return `${origin.replace(/\/+$/, "")}${path}`;
}

export function breadcrumbJsonLd(items: { name: string; path: string }[]): object {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: item.name,
      item: absoluteUrl(item.path),
    })),
  };
}

export function faqJsonLd(items: { question: string; answer: string }[]): object {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: items.map((item) => ({
      "@type": "Question",
      name: item.question,
      acceptedAnswer: { "@type": "Answer", text: item.answer },
    })),
  };
}
