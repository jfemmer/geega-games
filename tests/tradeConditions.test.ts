import { describe, expect, it } from "vitest";
import {
  CONDITION_BY_AGE,
  conditionAgeRules,
  conditionAgeSummary,
  conditionForAge,
  printedYear,
  printingAgeYears,
} from "../src/store/lib/tradeConditions";

// A trade-in card's condition comes from its printing's age (Trade Center):
// Near Mint under 3 years old, Lightly Played 3 to 10, Moderately Played 10
// to 20, Heavily Played 20 or more. Ages count whole years to today's date
// in St. Louis; staff check the real condition when the cards arrive.

/** Monday, October 26, 2026, noon in St. Louis. */
const NOON = Date.parse("2026-10-26T17:00:00Z");

describe("a printing's age", () => {
  it("counts whole years, and a birthday only once it's reached", () => {
    expect(printingAgeYears("2023-10-26", NOON)).toBe(3);
    expect(printingAgeYears("2023-10-27", NOON)).toBe(2);
    expect(printingAgeYears("2023-11-01", NOON)).toBe(2);
    expect(printingAgeYears("1993-08-05", NOON)).toBe(33);
  });

  it("goes by the date in St. Louis, not UTC", () => {
    // 10 PM on October 26 in St. Louis is already October 27 in UTC.
    const lateEvening = Date.parse("2026-10-27T03:00:00Z");
    expect(printingAgeYears("2023-10-27", lateEvening)).toBe(2);
    expect(conditionForAge("2023-10-27", lateEvening)).toBe("NM");
    expect(conditionForAge("2023-10-27", Date.parse("2026-10-27T06:00:00Z"))).toBe("LP"); // 1 AM on the 27th
  });

  it("never goes below zero (a printing announced for later), and is unknown without a readable date", () => {
    expect(printingAgeYears("2027-02-01", NOON)).toBe(0);
    expect(printingAgeYears(null, NOON)).toBeNull();
    expect(printingAgeYears(undefined, NOON)).toBeNull();
    expect(printingAgeYears("soon", NOON)).toBeNull();
    // Scryfall's full timestamps still read.
    expect(printingAgeYears("2016-04-08T00:00:00Z", NOON)).toBe(10);
  });
});

describe("the condition a card is listed at", () => {
  it("follows the age tiers, with each boundary starting the next tier", () => {
    expect(conditionForAge("2026-10-01", NOON)).toBe("NM");
    expect(conditionForAge("2023-10-27", NOON)).toBe("NM"); // a day short of 3 years
    expect(conditionForAge("2023-10-26", NOON)).toBe("LP"); // 3 years
    expect(conditionForAge("2016-10-27", NOON)).toBe("LP"); // a day short of 10
    expect(conditionForAge("2016-10-26", NOON)).toBe("MP"); // 10 years
    expect(conditionForAge("2006-10-27", NOON)).toBe("MP"); // a day short of 20
    expect(conditionForAge("2006-10-26", NOON)).toBe("HP"); // 20 years
    expect(conditionForAge("1993-08-05", NOON)).toBe("HP");
  });

  it("lists a printing with no date as Near Mint (staff check it when it arrives)", () => {
    expect(conditionForAge(null, NOON)).toBe("NM");
    expect(conditionForAge("", NOON)).toBe("NM");
  });

  it("never lists a card as Damaged from its age alone", () => {
    expect(CONDITION_BY_AGE.map((t) => t.condition)).toEqual(["NM", "LP", "MP", "HP"]);
  });
});

describe("explaining it", () => {
  it("names the year a printing came out", () => {
    expect(printedYear("2019-05-03")).toBe("2019");
    expect(printedYear(null)).toBeNull();
    expect(printedYear("n/a")).toBeNull();
  });

  it("puts the rule in words for the trade pages", () => {
    expect(conditionAgeRules()).toEqual([
      { code: "NM", condition: "Near Mint", ages: "Under 3 years old" },
      { code: "LP", condition: "Lightly Played", ages: "3 to 10 years old" },
      { code: "MP", condition: "Moderately Played", ages: "10 to 20 years old" },
      { code: "HP", condition: "Heavily Played", ages: "20 years or older" },
    ]);
    expect(conditionAgeSummary()).toBe(
      "Near Mint under 3 years old, Lightly Played 3 to 10 years, Moderately Played 10 to 20 years, Heavily Played 20 years or older",
    );
  });
});
