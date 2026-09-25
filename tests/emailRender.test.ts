import { describe, it, expect } from "vitest";
import { render } from "@react-email/render";
import { ConfirmSubscription } from "../api/_lib/emails/ConfirmSubscription.js";
import { SubscriptionConfirmed } from "../api/_lib/emails/SubscriptionConfirmed.js";
import { OrderConfirmation } from "../api/_lib/emails/OrderConfirmation.js";
import { SellSubmissionConfirmation } from "../api/_lib/emails/SellSubmissionConfirmation.js";
import { SellSubmissionAdminNotification } from "../api/_lib/emails/SellSubmissionAdminNotification.js";
import { OrderStatusUpdate } from "../api/_lib/emails/OrderStatusUpdate.js";
import { SellSubmissionStatusUpdate } from "../api/_lib/emails/SellSubmissionStatusUpdate.js";
import { SellSubmissionOffer } from "../api/_lib/emails/SellSubmissionOffer.js";
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

  it("SellSubmissionConfirmation renders the reference number and never promises a guaranteed offer", async () => {
    const html = await render(
      React.createElement(SellSubmissionConfirmation, {
        firstName: "Jordan",
        referenceNumber: "GG-S-100042",
        cardCount: 3,
        photoCount: 5,
        hasCollectionDescription: true,
        siteUrl: "https://geega-games.com",
        logoUrl: "https://geega-games.com/logo.png",
        supportEmail: "support@geega-games.com",
      }),
    );
    expect(html).toContain("GG-S-100042");
    expect(html).toContain("Thanks, Jordan!");
    expect(html).toContain("We received your collection");
    expect(html).not.toMatch(/instant cash|guaranteed offer|we will buy/i);
    expect(html).toContain("does not guarantee an offer");
  });

  it("SellSubmissionAdminNotification renders lead details and a link to the admin dashboard", async () => {
    const html = await render(
      React.createElement(SellSubmissionAdminNotification, {
        referenceNumber: "GG-S-100042",
        sellerName: "Jordan Vega",
        location: "Austin, TX",
        collectionSizeLabel: "1,000–5,000 cards",
        cardCount: 12,
        photoCount: 4,
        estimatedValueCents: 15000,
        adminUrl: "https://geega-games.com/admin_dashboard/buying-leads?submission=abc",
        siteUrl: "https://geega-games.com",
        logoUrl: "https://geega-games.com/logo.png",
        supportEmail: "support@geega-games.com",
      }),
    );
    expect(html).toContain("GG-S-100042");
    expect(html).toContain("Jordan Vega");
    expect(html).toContain("Austin, TX");
    expect(html).toContain("$150.00");
    expect(html).toContain("internal, not an offer");
    expect(html).toContain("https://geega-games.com/admin_dashboard/buying-leads?submission=abc");
  });

  it("OrderStatusUpdate renders tracking info for a shipped order", async () => {
    const html = await render(
      React.createElement(OrderStatusUpdate, {
        status: "shipped",
        orderNumber: "GG-ABC12345",
        firstName: "Jordan",
        isPwe: false,
        trackingCarrier: "usps",
        trackingNumber: "9400111899561234567890",
        orderUrl: "https://geega-games.com/account/orders/abc",
        siteUrl: "https://geega-games.com",
        logoUrl: "https://geega-games.com/logo.png",
        supportEmail: "support@geega-games.com",
      }),
    );
    expect(html).toContain("has shipped");
    expect(html).toContain("USPS");
    expect(html).toContain("9400111899561234567890");
    expect(html).toContain("tools.usps.com");
  });

  it("OrderStatusUpdate renders a PWE notice instead of a tracking number", async () => {
    const html = await render(
      React.createElement(OrderStatusUpdate, {
        status: "shipped",
        orderNumber: "GG-ABC12345",
        firstName: null,
        isPwe: true,
        trackingCarrier: null,
        trackingNumber: null,
        orderUrl: "https://geega-games.com/account/orders/abc",
        siteUrl: "https://geega-games.com",
        logoUrl: "https://geega-games.com/logo.png",
        supportEmail: "support@geega-games.com",
      }),
    );
    expect(html).toContain("Plain White Envelope");
    expect(html).not.toContain("Tracking number");
  });

  it("OrderStatusUpdate renders cancelled and refunded copy", async () => {
    const cancelled = await render(
      React.createElement(OrderStatusUpdate, {
        status: "cancelled",
        orderNumber: "GG-ABC12345",
        firstName: "Jordan",
        isPwe: false,
        trackingCarrier: null,
        trackingNumber: null,
        orderUrl: "https://geega-games.com/account/orders/abc",
        siteUrl: "https://geega-games.com",
        logoUrl: "https://geega-games.com/logo.png",
        supportEmail: "support@geega-games.com",
      }),
    );
    expect(cancelled).toContain("cancelled");

    const refunded = await render(
      React.createElement(OrderStatusUpdate, {
        status: "refunded",
        orderNumber: "GG-ABC12345",
        firstName: "Jordan",
        isPwe: false,
        trackingCarrier: null,
        trackingNumber: null,
        orderUrl: "https://geega-games.com/account/orders/abc",
        siteUrl: "https://geega-games.com",
        logoUrl: "https://geega-games.com/logo.png",
        supportEmail: "support@geega-games.com",
      }),
    );
    expect(refunded).toContain("refunded");
  });

  it("SellSubmissionStatusUpdate renders the PayPal / pre-payment-shipment reminder on acceptance", async () => {
    const html = await render(
      React.createElement(SellSubmissionStatusUpdate, {
        status: "accepted",
        firstName: "Jordan",
        referenceNumber: "GG-S-100042",
        siteUrl: "https://geega-games.com",
        logoUrl: "https://geega-games.com/logo.png",
        supportEmail: "support@geega-games.com",
      }),
    );
    expect(html).toContain("GG-S-100042");
    expect(html).toContain("Offer accepted");
    expect(html).toContain("PayPal Goods");
  });

  it("SellSubmissionStatusUpdate renders needs-more-photos and needs-in-person-review copy", async () => {
    const morePhotos = await render(
      React.createElement(SellSubmissionStatusUpdate, {
        status: "needs_more_photos",
        firstName: "Jordan",
        referenceNumber: "GG-S-100042",
        siteUrl: "https://geega-games.com",
        logoUrl: "https://geega-games.com/logo.png",
        supportEmail: "support@geega-games.com",
      }),
    );
    expect(morePhotos).toContain("more photos");

    const inPerson = await render(
      React.createElement(SellSubmissionStatusUpdate, {
        status: "needs_in_person_review",
        firstName: "Jordan",
        referenceNumber: "GG-S-100042",
        siteUrl: "https://geega-games.com",
        logoUrl: "https://geega-games.com/logo.png",
        supportEmail: "support@geega-games.com",
      }),
    );
    expect(inPerson).toContain("closer look");
  });

  it("SellSubmissionOffer states the actual dollar amount, unlike the generic status email", async () => {
    const html = await render(
      React.createElement(SellSubmissionOffer, {
        firstName: "Jordan",
        referenceNumber: "GG-S-100042",
        offerValueCents: 35000,
        responseUrl: "https://geega-games.com/sell/offer?ref=GG-S-100042&email=jordan%40example.com",
        siteUrl: "https://geega-games.com",
        logoUrl: "https://geega-games.com/logo.png",
        supportEmail: "support@geega-games.com",
      }),
    );
    expect(html).toContain("GG-S-100042");
    expect(html).toContain("$350.00");
    expect(html).toContain("our offer for your collection");
    expect(html).toContain("PayPal Goods");
    expect(html).toContain("Respond to this offer");
    expect(html).toContain(
      "https://geega-games.com/sell/offer?ref=GG-S-100042&amp;email=jordan%40example.com",
    );
  });

  it("SellSubmissionOfferResponse renders declined and countered confirmations to the seller", async () => {
    const { SellSubmissionOfferResponse } = await import(
      "../api/_lib/emails/SellSubmissionOfferResponse.js"
    );
    const declined = await render(
      React.createElement(SellSubmissionOfferResponse, {
        kind: "declined",
        firstName: "Jordan",
        referenceNumber: "GG-S-100042",
        offerValueCents: 35000,
        counterOfferCents: null,
        siteUrl: "https://geega-games.com",
        logoUrl: "https://geega-games.com/logo.png",
        supportEmail: "support@geega-games.com",
      }),
    );
    expect(declined).toContain("GG-S-100042");
    expect(declined).toContain("$350.00");
    expect(declined).toContain("declined our offer");

    const countered = await render(
      React.createElement(SellSubmissionOfferResponse, {
        kind: "countered",
        firstName: "Jordan",
        referenceNumber: "GG-S-100042",
        offerValueCents: 35000,
        counterOfferCents: 42000,
        siteUrl: "https://geega-games.com",
        logoUrl: "https://geega-games.com/logo.png",
        supportEmail: "support@geega-games.com",
      }),
    );
    expect(countered).toContain("$350.00");
    expect(countered).toContain("$420.00");
    expect(countered).toContain("counter-offer");
  });

  it("SellSubmissionOfferResponseAdminNotification renders all three response kinds", async () => {
    const { SellSubmissionOfferResponseAdminNotification } = await import(
      "../api/_lib/emails/SellSubmissionOfferResponseAdminNotification.js"
    );
    const accepted = await render(
      React.createElement(SellSubmissionOfferResponseAdminNotification, {
        response: "accepted",
        referenceNumber: "GG-S-100042",
        sellerName: "Jordan Vega",
        offerValueCents: 35000,
        counterOfferCents: null,
        adminUrl: "https://geega-games.com/admin_dashboard/buying-leads?submission=abc",
        siteUrl: "https://geega-games.com",
        logoUrl: "https://geega-games.com/logo.png",
        supportEmail: "support@geega-games.com",
      }),
    );
    expect(accepted).toContain("accepted your offer");
    expect(accepted).toContain("Jordan Vega");
    expect(accepted).toContain("$350.00");

    const countered = await render(
      React.createElement(SellSubmissionOfferResponseAdminNotification, {
        response: "countered",
        referenceNumber: "GG-S-100042",
        sellerName: "Jordan Vega",
        offerValueCents: 35000,
        counterOfferCents: 42000,
        adminUrl: "https://geega-games.com/admin_dashboard/buying-leads?submission=abc",
        siteUrl: "https://geega-games.com",
        logoUrl: "https://geega-games.com/logo.png",
        supportEmail: "support@geega-games.com",
      }),
    );
    expect(countered).toContain("$350.00");
    expect(countered).toContain("$420.00");
    expect(countered).toContain("counter-offer");
  });

  it("ReferralLeadAdminNotification has everything the buying partner needs, with escaped seller text", async () => {
    const { ReferralLeadAdminNotification, referralLeadAdminText } = await import(
      "../api/_lib/emails/ReferralLeadAdminNotification.js"
    );
    const data = {
      referenceNumber: "GG-R-100001",
      categoriesLabel: "Pokémon cards and Video games & consoles",
      sellerName: "Sam Lee",
      email: "sam@example.com",
      phone: "314-555-0100",
      preferredContact: "Text",
      location: "Kirkwood, MO",
      sizeLabel: "A small collection",
      handoffLabel: "Meet up in the St. Louis area",
      description: "Base Set binder <script>alert(1)</script>",
      photoUrls: ["https://x.supabase.co/storage/v1/object/sign/sell-photos/a.jpg?token=t"],
      photoLinkDays: 7,
      siteUrl: "https://geega-games.com",
      logoUrl: "https://geega-games.com/logo.png",
      supportEmail: "support@geega-games.com",
    };
    const html = await render(React.createElement(ReferralLeadAdminNotification, data));
    for (const text of ["GG-R-100001", "Sam Lee", "sam@example.com", "314-555-0100", "Kirkwood, MO", "Meet up in the St. Louis area", "Photo 1", "7 days"]) {
      expect(html).toContain(text);
    }
    expect(html).not.toContain("<script>alert(1)</script>");
    const text = referralLeadAdminText(data);
    expect(text).toContain("Base Set binder");
    expect(text).toContain(data.photoUrls[0]);
  });

  it("ReferralLeadConfirmation says the offer comes from the buying partner, not Geega Games", async () => {
    const { ReferralLeadConfirmation } = await import("../api/_lib/emails/ReferralLeadConfirmation.js");
    const html = await render(
      React.createElement(ReferralLeadConfirmation, {
        firstName: "Sam",
        referenceNumber: "GG-R-100001",
        categoriesLabel: "One Piece cards",
        preferredContact: "Email",
        siteUrl: "https://geega-games.com",
        logoUrl: "https://geega-games.com/logo.png",
        supportEmail: "support@geega-games.com",
      }),
    );
    expect(html).toContain("GG-R-100001");
    expect(html).toContain("buying partner");
    expect(html).toContain("One Piece cards");
    expect(html).toContain("https://geega-games.com/sell-my-collection");
  });
});