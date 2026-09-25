// Site-wide SEO constants shared by the storefront (useSEO), the build-time
// prerender (scripts/prerender.ts) and /api/sitemap. Keep this module pure —
// no React, no DOM, no import.meta.env — so all three can import it.

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

/**
 * Site-wide business entity, emitted on every prerendered page and the SPA
 * shell. Only verified business facts: add sameAs (social profiles),
 * telephone or a contactPoint here once they're real and public.
 */
export const SITE_JSON_LD: object = {
  "@context": "https://schema.org",
  "@type": "OnlineStore",
  "@id": ORGANIZATION_ID,
  name: "Geega Games",
  description:
    "Magic: The Gathering singles shop and card buyer based in St. Louis, Missouri. Buys MTG cards and collections in person within about a 6-hour drive of St. Louis and by mail nationwide.",
  url: `${PRODUCTION_ORIGIN}/`,
  logo: `${PRODUCTION_ORIGIN}/logo.png`,
  image: `${PRODUCTION_ORIGIN}/og-image.png`,
  areaServed: serviceAreaServed(),
  knowsAbout: [
    "Magic: The Gathering",
    "MTG singles",
    "Trading card collections",
    "Trading card grading and condition",
  ],
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
