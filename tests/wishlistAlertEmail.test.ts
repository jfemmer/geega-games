import { describe, it, expect } from "vitest";
import { render } from "@react-email/render";
import * as React from "react";
import {
  WishlistAlert,
  wishlistAlertLine,
  wishlistAlertSubject,
  wishlistAlertText,
  type WishlistAlertItem,
} from "../api/_lib/emails/WishlistAlert.js";

const restock: WishlistAlertItem = {
  kind: "restock",
  cardName: "Orcish Bowmasters",
  productUrl: "https://geega-games.com/shop/card/orcish-bowmasters",
  priceCents: 3499,
  previousPriceCents: null,
};
const drop: WishlistAlertItem = {
  kind: "price_drop",
  cardName: "Rhystic Study",
  productUrl: "https://geega-games.com/shop/card/rhystic-study",
  priceCents: 2500,
  previousPriceCents: 3000,
};

const base = {
  firstName: "Sam",
  wishlistUrl: "https://geega-games.com/account/wishlist",
  settingsUrl: "https://geega-games.com/account/notifications",
  siteUrl: "https://geega-games.com",
  logoUrl: "https://geega-games.com/logo.png",
  supportEmail: "support@geega-games.com",
};

describe("wishlist alert email", () => {
  it("describes each kind of change", () => {
    expect(wishlistAlertLine(restock)).toBe("Back in stock — from $34.99");
    expect(wishlistAlertLine(drop)).toBe("Price drop — now from $25.00 (was $30.00)");
    expect(wishlistAlertLine({ ...restock, kind: "deal", priceCents: 1000 })).toBe("On sale — now from $10.00");
  });

  it("uses a card-specific subject for one card and a count for several", () => {
    expect(wishlistAlertSubject([restock])).toBe("Orcish Bowmasters is back in stock — Geega Games");
    expect(wishlistAlertSubject([drop])).toBe("Rhystic Study just dropped in price — Geega Games");
    expect(wishlistAlertSubject([restock, drop])).toBe("2 cards on your wishlist have updates — Geega Games");
  });

  it("renders every card, the wishlist link and the opt-out link", async () => {
    const data = { ...base, items: [restock, drop] };
    const html = await render(React.createElement(WishlistAlert, data));
    expect(html).toContain("Good news, Sam!");
    expect(html).toContain("Orcish Bowmasters");
    expect(html).toContain("Rhystic Study");
    expect(html).toContain(base.wishlistUrl);
    expect(html).toContain(base.settingsUrl);
    const text = wishlistAlertText(data);
    expect(text).toContain(restock.productUrl);
    expect(text).toContain("Turn off wishlist alerts");
  });
});
