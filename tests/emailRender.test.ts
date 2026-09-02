import { describe, it, expect } from "vitest";
import { render } from "@react-email/render";
import { ConfirmSubscription } from "../api/_lib/emails/ConfirmSubscription.js";
import { SubscriptionConfirmed } from "../api/_lib/emails/SubscriptionConfirmed.js";
import { OrderConfirmation } from "../api/_lib/emails/OrderConfirmation.js";
import * as React from "react";

describe("email templates render to HTML", () => {
  it("ConfirmSubscription renders with the confirm URL", async () => {
    const html = await render(
      React.createElement(ConfirmSubscription, {
        confirmUrl: "https://geega-games.com/api/confirm?token=abc",
        siteUrl: "https://geega-games.com",
        logoUrl: "https://geega-games.com/logo.png",
        supportEmail: "support@geega-games.com",
        expiresInHours: 48,
      }),
    );
    expect(html).toContain("Confirm your email");
    expect(html).toContain("https://geega-games.com/api/confirm?token=abc");
    expect(html).toContain("<html");
  });

  it("SubscriptionConfirmed renders with unsubscribe link", async () => {
    const html = await render(
      React.createElement(SubscriptionConfirmed, {
        siteUrl: "https://geega-games.com",
        logoUrl: "https://geega-games.com/logo.png",
        supportEmail: "support@geega-games.com",
        unsubscribeUrl: "https://geega-games.com/api/unsubscribe?token=xyz",
      }),
    );
    expect(html).toContain("on the list");
    expect(html).toContain("https://geega-games.com/api/unsubscribe?token=xyz");
  });

  it("OrderConfirmation renders items and totals", async () => {
    const html = await render(
      React.createElement(OrderConfirmation, {
        orderNumber: "GG-ABC12345",
        firstName: "Jordan",
        createdAtISO: new Date("2026-01-15").toISOString(),
        paymentStatus: "paid",
        items: [
          {
            card_name: "Lightning Bolt",
            set_name: "M10",
            condition: "NM",
            finish: "foil",
            quantity: 2,
            unit_price_cents: 500,
            line_total_cents: 1000,
          },
        ],
        subtotalCents: 1000,
        shippingCents: 100,
        discountCents: 0,
        taxCents: 0,
        totalCents: 1100,
        ship: {
          recipient: "Jordan",
          line1: "1 Main St",
          line2: null,
          city: "Town",
          state: "CA",
          postalCode: "90001",
          country: "US",
        },
        siteUrl: "https://geega-games.com",
        logoUrl: "https://geega-games.com/logo.png",
        supportEmail: "support@geega-games.com",
      }),
    );
    expect(html).toContain("GG-ABC12345");
    expect(html).toContain("Lightning Bolt");
    expect(html).toContain("Thanks, Jordan!");
    expect(html).toContain("$11.00"); // total
    expect(html).toContain("1 Main St");
  });
});