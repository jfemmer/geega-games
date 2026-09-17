import { describe, expect, it } from "vitest";
import {
  conditionDefaultExplanation,
  conditionNeedsPhotos,
  defaultConditionForReleaseDate,
} from "../src/store/lib/sellTypes";

describe("defaultConditionForReleaseDate", () => {
  it("defaults cards from 2005 or earlier to Heavily Played", () => {
    expect(defaultConditionForReleaseDate("2005-10-01")).toBe("HP");
    expect(defaultConditionForReleaseDate("1994-08-05")).toBe("HP");
  });

  it("defaults cards from 2006-2015 to Moderately Played", () => {
    expect(defaultConditionForReleaseDate("2006-01-01")).toBe("MP");
    expect(defaultConditionForReleaseDate("2015-12-31")).toBe("MP");
  });

  it("defaults everything from 2016 onward to Lightly Played", () => {
    expect(defaultConditionForReleaseDate("2016-01-01")).toBe("LP");
    expect(defaultConditionForReleaseDate("2024-06-14")).toBe("LP");
  });

  it("defaults an unknown release date to Lightly Played", () => {
    expect(defaultConditionForReleaseDate(null)).toBe("LP");
  });
});

describe("conditionDefaultExplanation", () => {
  it("explains the Heavily Played and Moderately Played defaults", () => {
    expect(conditionDefaultExplanation("HP")).toMatch(/2005 or earlier/);
    expect(conditionDefaultExplanation("MP")).toMatch(/2006–2015/);
  });

  it("has no explanation for the Lightly Played default", () => {
    expect(conditionDefaultExplanation("LP")).toBeNull();
  });
});

describe("conditionNeedsPhotos", () => {
  it("always requires photos for Near Mint, regardless of the default", () => {
    expect(conditionNeedsPhotos("NM", "HP")).toBe(true);
    expect(conditionNeedsPhotos("NM", "LP")).toBe(true);
  });

  it("requires photos when the claimed condition is better than the default", () => {
    expect(conditionNeedsPhotos("LP", "HP")).toBe(true);
    expect(conditionNeedsPhotos("MP", "HP")).toBe(true);
  });

  it("does not require photos when matching or worse than the default", () => {
    expect(conditionNeedsPhotos("HP", "HP")).toBe(false);
    expect(conditionNeedsPhotos("DMG", "HP")).toBe(false);
    expect(conditionNeedsPhotos("MP", "LP")).toBe(false);
  });

  it("never requires photos for an unset/'Unsure' condition", () => {
    expect(conditionNeedsPhotos(null, "HP")).toBe(false);
  });
});
