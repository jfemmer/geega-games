// Human labels for the visitor-location codes Vercel's geo-IP headers give
// /api/track: ISO country codes ("US") and ISO 3166-2 subdivision codes
// without the country ("MO"). US states get their full name; elsewhere the
// raw subdivision code is shown next to the country name.

const US_STATES: Record<string, string> = {
  AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California",
  CO: "Colorado", CT: "Connecticut", DE: "Delaware", DC: "District of Columbia",
  FL: "Florida", GA: "Georgia", HI: "Hawaii", ID: "Idaho", IL: "Illinois",
  IN: "Indiana", IA: "Iowa", KS: "Kansas", KY: "Kentucky", LA: "Louisiana",
  ME: "Maine", MD: "Maryland", MA: "Massachusetts", MI: "Michigan", MN: "Minnesota",
  MS: "Mississippi", MO: "Missouri", MT: "Montana", NE: "Nebraska", NV: "Nevada",
  NH: "New Hampshire", NJ: "New Jersey", NM: "New Mexico", NY: "New York",
  NC: "North Carolina", ND: "North Dakota", OH: "Ohio", OK: "Oklahoma", OR: "Oregon",
  PA: "Pennsylvania", RI: "Rhode Island", SC: "South Carolina", SD: "South Dakota",
  TN: "Tennessee", TX: "Texas", UT: "Utah", VT: "Vermont", VA: "Virginia",
  WA: "Washington", WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming",
  PR: "Puerto Rico", GU: "Guam", VI: "U.S. Virgin Islands", AS: "American Samoa",
  MP: "Northern Mariana Islands",
};

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
  if (country === "US" && US_STATES[region]) return US_STATES[region];
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
