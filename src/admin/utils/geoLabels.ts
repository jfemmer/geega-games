// Human labels for the visitor-location codes Vercel's geo-IP headers give
// /api/track: ISO country codes ("US") and ISO 3166-2 subdivision codes
// without the country ("MO"). US states get their full name; elsewhere the
// raw subdivision code is shown next to the country name.

import { usStateName } from "../../store/lib/usAddress";

const countryNames = (() => {
  try {
    return new Intl.DisplayNames(undefined, { type: "region" });
  } catch {
    return null;
  }
})();

/** "US" → "United States"; "??" or null → "Unknown". */
export function countryLabel(code: string | null): string {
  if (!code || code === "??") return "Unknown";
  try {
    return countryNames?.of(code) ?? code;
  } catch {
    return code;
  }
}

/** ("MO", "US") → "Missouri"; ("ON", "CA") → "ON, Canada". */
export function regionLabel(region: string, country: string | null): string {
  const usName = country === "US" ? usStateName(region) : null;
  if (usName) return usName;
  return country ? `${region}, ${countryLabel(country)}` : region;
}

/**
 * Most specific place we know: "Springfield, MO", "Toronto, ON, Canada",
 * "Missouri", "Canada" — or "Unknown location".
 */
export function placeLabel(
  city: string | null,
  region: string | null,
  country: string | null,
): string {
  if (city) {
    if (country === "US") return region ? `${city}, ${region}` : city;
    const tail = [region, country ? countryLabel(country) : null].filter(Boolean).join(", ");
    return tail ? `${city}, ${tail}` : city;
  }
  if (region) return regionLabel(region, country);
  if (country && country !== "??") return countryLabel(country);
  return "Unknown location";
}
