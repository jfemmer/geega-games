import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ALL_SITE_LOGOS, STANDARD_LOGO, siteLogoSrc, storeMonth } from "../src/store/lib/siteLogo";

// The storefront swaps in a seasonal logo by month, in St. Louis time.

const root = new URL("../", import.meta.url);
const file = (path: string) => readFileSync(new URL(path, root));

function pngSize(bytes: Buffer): { width: number; height: number } {
  expect(bytes.subarray(1, 4).toString("ascii")).toBe("PNG");
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

describe("the seasonal logo", () => {
  it("switches to the October logo at midnight on Oct 1 in St. Louis, not UTC", () => {
    // 11:59 pm Sep 30 in St. Louis is already Oct 1 in UTC.
    expect(siteLogoSrc(new Date("2026-10-01T04:59:00Z"))).toBe(STANDARD_LOGO);
    expect(siteLogoSrc(new Date("2026-10-01T05:00:00Z"))).toBe("/logo-october.png");
  });

  it("stays through Halloween night and switches back at midnight on Nov 1 in St. Louis", () => {
    expect(siteLogoSrc(new Date("2026-11-01T04:59:00Z"))).toBe("/logo-october.png");
    expect(siteLogoSrc(new Date("2026-11-01T05:00:00Z"))).toBe(STANDARD_LOGO);
  });

  it("comes back every October without a code change", () => {
    expect(siteLogoSrc(new Date("2027-10-15T17:00:00Z"))).toBe("/logo-october.png");
    expect(siteLogoSrc(new Date("2030-10-15T17:00:00Z"))).toBe("/logo-october.png");
    expect(siteLogoSrc(new Date("2027-03-15T17:00:00Z"))).toBe(STANDARD_LOGO);
  });

  it("shows the Christmas logo from Dec 1 through Christmas Day in St. Louis (standard time, UTC-6)", () => {
    expect(siteLogoSrc(new Date("2026-12-01T05:59:00Z"))).toBe(STANDARD_LOGO);
    expect(siteLogoSrc(new Date("2026-12-01T06:00:00Z"))).toBe("/logo-christmas.png");
    expect(siteLogoSrc(new Date("2026-12-15T18:00:00Z"))).toBe("/logo-christmas.png");
    // 11:59 pm on Christmas Day is still Christmas; Dec 26 is back to standard.
    expect(siteLogoSrc(new Date("2026-12-26T05:59:00Z"))).toBe("/logo-christmas.png");
    expect(siteLogoSrc(new Date("2026-12-26T06:00:00Z"))).toBe(STANDARD_LOGO);
    expect(siteLogoSrc(new Date("2026-12-31T18:00:00Z"))).toBe(STANDARD_LOGO);
    expect(siteLogoSrc(new Date("2027-12-10T18:00:00Z"))).toBe("/logo-christmas.png");
  });

  it("shows the standard logo the rest of November", () => {
    expect(siteLogoSrc(new Date("2026-11-30T18:00:00Z"))).toBe(STANDARD_LOGO);
  });

  it("reads the month in store time across the daylight-saving change", () => {
    // Nov 1, 2026 is still daylight time; Dec 1 is standard time (UTC-6).
    expect(storeMonth(new Date("2026-12-01T05:30:00Z"))).toBe(11);
    expect(storeMonth(new Date("2026-12-01T06:00:00Z"))).toBe(12);
  });

  it("has every logo file in public/, the same shape as the standard logo so the header never shifts", () => {
    const standard = pngSize(file(`public${STANDARD_LOGO}`));
    for (const src of ALL_SITE_LOGOS) {
      const bytes = file(`public${src}`);
      expect(pngSize(bytes), src).toEqual(standard);
      expect(bytes.length, src).toBeLessThan(150_000);
    }
  });
});
