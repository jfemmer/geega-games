import { describe, expect, it } from "vitest";
import { countryLabel, placeLabel, regionLabel } from "../src/admin/utils/geoLabels";

describe("visitor location labels", () => {
  it("names US states in full and keeps other regions with their country", () => {
    expect(regionLabel("MO", "US")).toBe("Missouri");
    expect(regionLabel("ON", "CA")).toBe("ON, Canada");
    expect(regionLabel("XX", null)).toBe("XX");
  });

  it("uses the most specific place available", () => {
    expect(placeLabel("Springfield", "MO", "US")).toBe("Springfield, MO");
    expect(placeLabel("Toronto", "ON", "CA")).toBe("Toronto, ON, Canada");
    expect(placeLabel(null, "MO", "US")).toBe("Missouri");
    expect(placeLabel(null, null, "CA")).toBe("Canada");
    expect(placeLabel(null, null, null)).toBe("Unknown location");
    expect(countryLabel("??")).toBe("Unknown");
  });
});
