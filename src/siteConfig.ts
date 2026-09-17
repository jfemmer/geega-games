// Central place for business + policy links used in the footer and metadata.
//
// The storefront is live — checkout, accounts, and the shop catalog all
// work today. Links here should point at real pages; a link with no href
// renders as a clearly-labeled "coming soon" item rather than a dead link
// or invented content, for anything not actually published yet (e.g. a
// finalized return-window policy).

export type FooterLink = {
  label: string;
  href?: string; // when undefined -> rendered as "coming soon", not clickable
};

export const SITE = {
  name: "Geega Games",
  // Set VITE_PUBLIC_SITE_URL in your env; falls back to the production domain.
  url:
    (import.meta.env.VITE_PUBLIC_SITE_URL as string | undefined) ??
    "https://geega-games.com",
  tagline: "Magic: The Gathering singles",
  // Matches the default used on the storefront's other support-contact
  // surfaces (see SUPPORT_EMAIL in store/pages/StaticPages.tsx) so the
  // footer doesn't disagree with every other page about whether a support
  // inbox exists. Override via VITE_SUPPORT_EMAIL if it ever changes.
  supportEmail:
    (import.meta.env.VITE_SUPPORT_EMAIL as string | undefined) ?? "support@geega-games.com",
} as const;

// Footer link groups. Fill in hrefs as real pages/policies are published.
export const FOOTER_GROUPS: { title: string; links: FooterLink[] }[] = [
  {
    title: "Shop",
    links: [
      { label: "Browse catalog", href: "/shop" },
      { label: "Sell your cards", href: "/sell-my-collection" },
    ],
  },
  {
    title: "Help",
    links: [
      { label: "Contact", href: "/contact" },
      { label: "Shipping", href: "/shipping" },
      { label: "Returns & refunds", href: "/returns" },
      { label: "Card-condition guide", href: "/condition-guide" },
    ],
  },
  {
    title: "Legal",
    links: [
      { label: "Privacy policy", href: "/privacy" },
      { label: "Terms of service", href: "/terms" },
    ],
  },
];
