// Seller guides at /guides/:slug. Metadata lives here (pure data, shared
// with the sitemap and prerender); the article bodies are React components
// in src/store/pages/guides/GuidePages.tsx, keyed by the same slug.
//
// Bump `updated` whenever a guide's content materially changes — it feeds
// the sitemap's <lastmod> and the Article structured data.

export interface GuideMeta {
  slug: string;
  /** On-page H1. */
  heading: string;
  /** <title>, kept under ~60 characters where possible. */
  title: string;
  description: string;
  /** One or two sentences for the /guides index. */
  summary: string;
  /** ISO dates (YYYY-MM-DD). */
  published: string;
  updated: string;
}

export const GUIDES: GuideMeta[] = [
  {
    slug: "how-much-is-my-mtg-collection-worth",
    heading: "How much is my Magic: The Gathering collection worth?",
    title: "How Much Is My MTG Collection Worth? | Geega Games",
    description:
      "How to tell if your Magic: The Gathering cards are valuable: set symbols, rarity, old cards, the Reserved List, condition, and how to look up real prices before you sell.",
    summary:
      "A plain-English walkthrough for sizing up a collection: which cards are worth a closer look, how to spot old and valuable printings, and how to check prices.",
    published: "2026-09-25",
    updated: "2026-09-25",
  },
  {
    slug: "inherited-magic-card-collection",
    heading: "Inherited a Magic: The Gathering collection? Start here",
    title: "Inherited a Magic: The Gathering Collection? | Geega Games",
    description:
      "What to do with an inherited or estate Magic: The Gathering card collection: how to protect it, what not to throw away, how to get a fair offer, and how to avoid common mistakes.",
    summary:
      "Found boxes of Magic cards in an estate, attic or closet? What to do first, what never to throw away, and how to sell without getting taken advantage of.",
    published: "2026-09-25",
    updated: "2026-09-25",
  },
  {
    slug: "how-to-sell-bulk-magic-cards",
    heading: "How to sell bulk Magic: The Gathering cards",
    title: "How to Sell Bulk Magic Cards (MTG Bulk Guide) | Geega Games",
    description:
      "What counts as bulk in Magic: The Gathering, which commons and uncommons are worth pulling first, how to count and ship bulk, and the easiest ways to sell it.",
    summary:
      "What \"bulk\" means, the cards worth pulling out before you sell it by the thousand, and how to count, pack and ship a big box of commons.",
    published: "2026-09-25",
    updated: "2026-09-25",
  },
];

export function findGuide(slug: string): GuideMeta | undefined {
  return GUIDES.find((g) => g.slug === slug);
}

export function guidePath(slug: string): string {
  return `/guides/${slug}`;
}
