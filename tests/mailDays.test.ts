import { describe, expect, it } from "vitest";
import { addMailDays, pweArrivalDueAt } from "../api/_lib/mailDays.js";
import { shippedOrderDueAt } from "../api/_lib/reviewRequests.js";

// Mail moves Monday–Saturday, so a Plain White Envelope's "should have
// arrived" date skips Sundays (St. Louis time).

const DAY = 24 * 60 * 60 * 1000;
// Noon in St. Louis (17:00 UTC during daylight time).
const at = (isoDate: string) => Date.parse(`${isoDate}T17:00:00Z`);

describe("mail days", () => {
  it("skips Sundays", () => {
    // Fri Oct 2, 2026 + 1 mail day = Sat Oct 3; + 2 = Mon Oct 5 (Sunday skipped).
    expect(addMailDays(at("2026-10-02"), 1)).toBe(at("2026-10-03"));
    expect(addMailDays(at("2026-10-02"), 2)).toBe(at("2026-10-05"));
  });

  it("puts the PWE check-in five mail days after shipping", () => {
    // Shipped Monday → Saturday. Shipped Friday → the next Thursday.
    expect(pweArrivalDueAt(at("2026-10-05"))).toBe(at("2026-10-10"));
    expect(pweArrivalDueAt(at("2026-10-02"))).toBe(at("2026-10-08"));
  });
});

describe("review request timing for shipped orders", () => {
  it("asks a PWE customer two days after the arrival check-in", () => {
    const shipped = at("2026-10-02");
    expect(
      shippedOrderDueAt({ shipped_at: new Date(shipped).toISOString(), delivered_at: null, shipping_method: "pwe" }),
    ).toBe(at("2026-10-08") + 2 * DAY);
  });

  it("still asks two days after delivery, or a week after shipping otherwise", () => {
    const shipped = new Date(at("2026-10-02")).toISOString();
    const delivered = new Date(at("2026-10-05")).toISOString();
    expect(shippedOrderDueAt({ shipped_at: shipped, delivered_at: delivered, shipping_method: "tracked" })).toBe(
      at("2026-10-05") + 2 * DAY,
    );
    expect(shippedOrderDueAt({ shipped_at: shipped, delivered_at: null, shipping_method: "tracked" })).toBe(
      at("2026-10-02") + 7 * DAY,
    );
  });
});
