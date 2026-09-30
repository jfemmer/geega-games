import { describe, expect, it } from "vitest";
import * as React from "react";
import { render } from "@react-email/render";
import {
  OrderStatusUpdate,
  orderStatusUpdateSubject,
  orderStatusUpdateText,
  type OrderStatusEmailData,
} from "../api/_lib/emails/OrderStatusUpdate.js";
import { orderNextSteps } from "../api/_lib/emails/OrderConfirmation.js";
import { formatShipDate } from "../api/_lib/orderStatusEmail.js";

// The customer emails for a shipment: packed → shipped → delivered (tracked)
// or the arrival check-in (Plain White Envelope, which has no tracking).

const base: OrderStatusEmailData = {
  status: "packed",
  orderNumber: "GG-ABC12345",
  firstName: "Jordan",
  isPwe: false,
  trackingCarrier: null,
  trackingNumber: null,
  orderUrl: "https://geega-games.com/account/orders/abc",
  siteUrl: "https://geega-games.com",
  logoUrl: "https://geega-games.com/logo.png",
  supportEmail: "support@geega-games.com",
};

async function html(data: OrderStatusEmailData) {
  return render(React.createElement(OrderStatusUpdate, data));
}

describe("order update emails", () => {
  it("tells a tracked customer their order is packed and tracking comes next", async () => {
    const out = await html({ ...base, status: "packed" });
    expect(orderStatusUpdateSubject({ ...base, status: "packed" })).toBe("Your order GG-ABC12345 is packed");
    expect(out).toContain("Your order is packed!");
    expect(out).toContain("tracking number as soon as it ships");
    expect(out).not.toContain("Plain White Envelope");
  });

  it("tells a PWE customer there's no tracking when it's packed", async () => {
    const text = orderStatusUpdateText({ ...base, status: "packed", isPwe: true });
    expect(text).toContain("Plain White Envelope");
    expect(text).toContain("doesn't have tracking");
    expect(text).not.toContain("tracking number as soon as it ships");
  });

  it("promises the PWE check-in in the shipped email", async () => {
    const out = await html({ ...base, status: "shipped", isPwe: true });
    expect(out).toContain("does not include tracking");
    expect(out).toContain("check in after it");
  });

  it("repeats the carrier and tracking link in the delivered email", async () => {
    const data = {
      ...base,
      status: "delivered" as const,
      trackingCarrier: "USPS",
      trackingNumber: "9400111899561234567890",
    };
    const out = await html(data);
    expect(orderStatusUpdateSubject(data)).toBe("Your order GG-ABC12345 has been delivered");
    expect(out).toContain("marked this order as delivered");
    expect(out).toContain("9400111899561234567890");
    expect(out).toContain("tools.usps.com");
    expect(orderStatusUpdateText(data)).toContain("Track: https://tools.usps.com");
  });

  it("checks in on a PWE order without claiming it was delivered", async () => {
    const data = { ...base, status: "arrival_check" as const, isPwe: true, shippedOn: "Monday, October 5" };
    const out = await html(data);
    expect(orderStatusUpdateSubject(data)).toBe("Has your order GG-ABC12345 arrived?");
    expect(out).toContain("should have arrived");
    expect(out).toContain("Monday, October 5");
    expect(out).toContain("reply to this email");
    expect(out).not.toContain("has been delivered");
    // No tracking box on a check-in.
    expect(out).not.toContain("Tracking number");
  });
});

describe("order confirmation next steps", () => {
  it("matches how the order ships", () => {
    expect(orderNextSteps({ channel: "online", shippingMethod: "tracked" })).toContain(
      "when your order is packed and again when it ships, with your tracking number",
    );
    const pwe = orderNextSteps({ channel: "online", shippingMethod: "pwe" }) ?? "";
    expect(pwe).toContain("no tracking");
    expect(pwe).toContain("check in");
    expect(orderNextSteps({ channel: "online", shippingMethod: null })).toContain("as your order moves along");
  });

  it("says nothing about shipping for an in-person sale", () => {
    expect(orderNextSteps({ channel: "pos", shippingMethod: null })).toBeNull();
  });
});

describe("formatShipDate", () => {
  it("writes the ship date the way the store sees it (St. Louis time)", () => {
    // 02:00 UTC on Oct 6 is still the evening of Oct 5 in St. Louis.
    expect(formatShipDate("2026-10-06T02:00:00Z")).toBe("Monday, October 5");
    expect(formatShipDate(null)).toBeNull();
    expect(formatShipDate("not a date")).toBeNull();
  });
});
