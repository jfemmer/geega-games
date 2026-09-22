import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { geocodeOrderLocation, normalizeCityKey } from "../src/admin/utils/geocodeOrderLocation";

const FAKE_ZIPS: Record<string, [number, number]> = {
  "63101": [38.635, -90.191],
  "10001": [40.748, -73.997],
};

const FAKE_CITIES: Record<string, [number, number]> = {
  "saint louis|MO": [38.64, -90.285],
  "new york|NY": [40.71, -74.01],
};

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string) => {
      const body = url.includes("us-zips") ? FAKE_ZIPS : FAKE_CITIES;
      return Promise.resolve({ json: () => Promise.resolve(body) } as Response);
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("geocodeOrderLocation", () => {
  it("prefers a valid zip over city/state text", async () => {
    const result = await geocodeOrderLocation({
      shipCity: "Somewhere Else Entirely",
      shipState: "Nowhere",
      samplePostalCode: "63101",
    });
    expect(result).toEqual([38.635, -90.191]);
  });

  it("falls back to city+state, normalizing 'St.' and a full state name", async () => {
    const result = await geocodeOrderLocation({
      shipCity: "St. Louis",
      shipState: "Missouri",
      samplePostalCode: null,
    });
    expect(result).toEqual([38.64, -90.285]);
  });

  it("falls back to city+state when the zip isn't in the lookup", async () => {
    const result = await geocodeOrderLocation({
      shipCity: "New York",
      shipState: "NY",
      samplePostalCode: "99999",
    });
    expect(result).toEqual([40.71, -74.01]);
  });

  it("ignores a malformed zip and still resolves via city/state", async () => {
    const result = await geocodeOrderLocation({
      shipCity: "new york",
      shipState: "ny",
      samplePostalCode: "not-a-zip",
    });
    expect(result).toEqual([40.71, -74.01]);
  });

  it("returns null when neither zip nor city/state resolve", async () => {
    const result = await geocodeOrderLocation({
      shipCity: "Definitely Not A Real Town",
      shipState: "Missouri",
      samplePostalCode: null,
    });
    expect(result).toBeNull();
  });

  it("returns null for an unrecognized state", async () => {
    const result = await geocodeOrderLocation({
      shipCity: "St. Louis",
      shipState: "Not A State",
      samplePostalCode: null,
    });
    expect(result).toBeNull();
  });
});

describe("normalizeCityKey", () => {
  it("expands common abbreviations and strips punctuation", () => {
    expect(normalizeCityKey("St. Louis")).toBe("saint louis");
    expect(normalizeCityKey("Ft. Worth")).toBe("fort worth");
    expect(normalizeCityKey("Mt. Vernon")).toBe("mount vernon");
    expect(normalizeCityKey("  New York  ")).toBe("new york");
  });
});
