// Seller guides at /guides/:slug. Metadata lives here (pure data, shared
// with the sitemap and prerender); the article bodies are React components
// in src/store/pages/GuidePages.tsx, keyed by the same slug.
//
// Bump `updated` whenever a guide's content materially changes — it feeds
// the sitemap's <lastmod> and the Article structured data.

/** Which sell page a guide leads to: Magic (we buy) or a partner-referral category. */
export type GuideTopic = "mtg" | "pokemon" | "video_games";

export interface GuideMeta {
  slug: string;
  topic: GuideTopic;
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
    topic: "mtg",
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
    topic: "mtg",
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
    topic: "mtg",
    heading: "How to sell bulk Magic: The Gathering cards",
    title: "How to Sell Bulk Magic Cards (MTG Bulk Guide) | Geega Games",
    description:
      "What counts as bulk in Magic: The Gathering, which commons and uncommons are worth pulling first, how to count and ship bulk, and the easiest ways to sell it.",
    summary:
      "What \"bulk\" means, the cards worth pulling out before you sell it by the thousand, and how to count, pack and ship a big box of commons.",
    published: "2026-09-25",
    updated: "2026-09-25",
  },
  {
    slug: "where-to-sell-magic-cards",
    topic: "mtg",
    heading: "Where to sell Magic: The Gathering cards",
    title: "Where to Sell Magic Cards: Every Option Compared | Geega Games",
    description:
      "TCGplayer, eBay, buylists, local game stores or a collection buyer? The real 2026 fees, how much work each takes, and which fits what you're selling.",
    summary:
      "TCGplayer vs. eBay vs. buylists vs. a local store vs. a collection buyer — the actual fees, the work involved, and which option fits what you have.",
    published: "2026-09-25",
    updated: "2026-09-25",
  },
  {
    slug: "are-my-old-pokemon-cards-worth-anything",
    topic: "pokemon",
    heading: "Are my old Pokémon cards worth anything?",
    title: "Are My Old Pokémon Cards Worth Anything? | Geega Games",
    description:
      "How to tell if old Pokémon cards are valuable: 1st Edition stamps, shadowless Base Set, holos, secret rares, Japanese cards, condition, spotting fakes and checking prices.",
    summary:
      "Found a stack of Pokémon cards from years ago? What to look for — 1st Edition, shadowless, holos, secret rares — how to spot fakes, and how to check real prices.",
    published: "2026-09-25",
    updated: "2026-09-25",
  },
  {
    slug: "are-my-old-video-games-worth-money",
    topic: "video_games",
    heading: "Are my old video games worth money?",
    title: "Are My Old Video Games Worth Money? | Geega Games",
    description:
      "What makes old video games valuable: loose vs. complete-in-box vs. sealed, rare late releases, label and box condition, reproductions, and how to check real prices.",
    summary:
      "Boxes of old games and consoles? What actually makes them valuable — complete-in-box, sealed, rare late releases — and how to check what they're worth.",
    published: "2026-09-25",
    updated: "2026-09-25",
  },
];

export function guidesFor(topic: GuideTopic): GuideMeta[] {
  return GUIDES.filter((g) => g.topic === topic);
}

export function findGuide(slug: string): GuideMeta | undefined {
  return GUIDES.find((g) => g.slug === slug);
}

export function guidePath(slug: string): string {
  return `/guides/${slug}`;
}
