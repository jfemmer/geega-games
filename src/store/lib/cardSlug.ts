// Shared slug helper for individual card detail pages (/shop/card/:slug).
// The SQL side (public.slugify_card_name, used by get_card_detail) applies
// the IDENTICAL transform when resolving a slug back to a card — the two
// must never drift apart, or links generated here would 404 against the RPC.
export function slugifyCardName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function cardDetailPath(name: string): string {
  return `/shop/card/${slugifyCardName(name)}`;
}
