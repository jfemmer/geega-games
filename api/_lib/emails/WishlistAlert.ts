import * as React from "react";
import { Heading, Hr, Link, Text } from "@react-email/components";
import { BaseLayout, brand } from "./BaseLayout.js";

// Loosely-typed createElement wrapper: React Email components type `children`
// as required, which the variadic createElement overload does not always satisfy.
const h = (
  type: unknown,
  props?: Record<string, unknown> | null,
  ...children: React.ReactNode[]
): React.ReactElement =>
  React.createElement(
    type as React.ElementType,
    props as Record<string, unknown>,
    ...children,
  );

export type WishlistAlertItem = {
  kind: "restock" | "price_drop" | "deal";
  cardName: string;
  productUrl: string;
  priceCents: number | null;
  previousPriceCents: number | null;
};

export type WishlistAlertEmailData = {
  firstName: string | null;
  items: WishlistAlertItem[];
  wishlistUrl: string;
  settingsUrl: string;
  siteUrl: string;
  logoUrl: string;
  supportEmail: string;
};

const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;

/** One-line description of what changed for a card. */
export function wishlistAlertLine(item: WishlistAlertItem): string {
  const price = item.priceCents != null ? money(item.priceCents) : null;
  switch (item.kind) {
    case "restock":
      return price ? `Back in stock — from ${price}` : "Back in stock";
    case "deal":
      return price ? `On sale — now from ${price}` : "On sale now";
    case "price_drop":
      return price && item.previousPriceCents != null
        ? `Price drop — now from ${price} (was ${money(item.previousPriceCents)})`
        : "Price drop";
  }
}

export function wishlistAlertSubject(items: WishlistAlertItem[]): string {
  if (items.length === 1) {
    const [only] = items;
    const what =
      only.kind === "restock" ? "is back in stock" : only.kind === "deal" ? "is on sale" : "just dropped in price";
    return `${only.cardName} ${what} — Geega Games`;
  }
  return `${items.length} cards on your wishlist have updates — Geega Games`;
}

export function WishlistAlert(data: WishlistAlertEmailData) {
  const greeting = data.firstName ? `Good news, ${data.firstName}!` : "Good news!";
  return h(
    BaseLayout,
    {
      previewText: wishlistAlertSubject(data.items).replace(/ — Geega Games$/, ""),
      siteUrl: data.siteUrl,
      logoUrl: data.logoUrl,
      supportEmail: data.supportEmail,
      reasonLine:
        "You received this because wishlist alerts are on for your Geega Games account. Singles sell fast — stock isn't held until you check out.",
      footerExtra: h(
        Text,
        { style: small },
        h(Link, { href: data.settingsUrl, style: link }, "Turn off wishlist alerts"),
      ),
    },
    h(Heading, { key: "h1", style: h1 }, greeting),
    h(
      Text,
      { key: "intro", style: p },
      data.items.length === 1
        ? "A card on your wishlist just changed:"
        : "Some cards on your wishlist just changed:",
    ),
    ...data.items.map((item, i) =>
      h(
        Text,
        { key: `item-${i}`, style: row },
        h(Link, { href: item.productUrl, style: cardLink }, item.cardName),
        h("br", null),
        h("span", { style: detail }, wishlistAlertLine(item)),
      ),
    ),
    h(Hr, { key: "hr", style: hr }),
    h(
      Text,
      { key: "cta", style: p },
      h(Link, { href: data.wishlistUrl, style: link }, "See your whole wishlist →"),
    ),
  );
}

export function wishlistAlertText(d: WishlistAlertEmailData): string {
  return [
    d.firstName ? `Good news, ${d.firstName}!` : "Good news!",
    "",
    d.items.length === 1 ? "A card on your wishlist just changed:" : "Some cards on your wishlist just changed:",
    "",
    ...d.items.flatMap((item) => [`${item.cardName} — ${wishlistAlertLine(item)}`, item.productUrl, ""]),
    `Your wishlist: ${d.wishlistUrl}`,
    `Turn off wishlist alerts: ${d.settingsUrl}`,
    "",
    `Questions? ${d.supportEmail}`,
  ].join("\n");
}

const h1: React.CSSProperties = {
  color: brand.purpleDeep,
  fontSize: "22px",
  fontWeight: 600,
  margin: "0 0 8px",
};
const p: React.CSSProperties = {
  color: brand.ink,
  fontSize: "15px",
  lineHeight: "24px",
  margin: "0 0 16px",
};
const row: React.CSSProperties = {
  color: brand.ink,
  fontSize: "15px",
  lineHeight: "22px",
  margin: "0 0 14px",
};
const cardLink: React.CSSProperties = { color: brand.purple, fontWeight: 600, textDecoration: "underline" };
const detail: React.CSSProperties = { color: brand.muted, fontSize: "14px" };
const hr: React.CSSProperties = { borderColor: brand.line, margin: "16px 0" };
const link: React.CSSProperties = { color: brand.purple, fontWeight: 600, textDecoration: "underline" };
const small: React.CSSProperties = { color: brand.muted, fontSize: "13px", margin: "0" };
