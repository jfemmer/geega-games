// Central place for business + policy links used in the footer and metadata.
//
// IMPORTANT: These are intentionally placeholders. Do NOT treat any value here
// as a real published policy until you (the owner) fill it in. Links that are
// not ready are rendered as clearly-labeled "coming soon" items rather than
// dead links or invented content.

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
  // Set this to a real, monitored inbox before launch, then it will render.
  // Leave empty to hide the support line entirely (no fake address shown).
  supportEmail: (import.meta.env.VITE_SUPPORT_EMAIL as string | undefined) ?? "",
} as const;

// Footer link groups. Fill in hrefs as real pages/policies are published.
export const FOOTER_GROUPS: { title: string; links: FooterLink[] }[] = [
  {
    title: "Shop",
    links: [
      { label: "Browse catalog", href: "#catalog" },
      { label: "Get the launch notice", href: "#launch" },
    ],
  },
  {
    title: "Help",
    links: [
      { label: "Contact" }, // add href when a contact page/inbox exists
      { label: "Shipping" },
      { label: "Returns & refunds" },
      { label: "Card-condition guide" },
    ],
  },
  {
    title: "Legal",
    links: [
      { label: "Privacy policy" },
      { label: "Terms of service" },
    ],
  },
];
