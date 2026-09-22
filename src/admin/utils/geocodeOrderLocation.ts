// Resolves a paid order's shipping city/state/zip to approximate map
// coordinates, for plotting on the Order Geography map.
//
// Checkout collects ship_city/ship_state/ship_postal_code as free text with
// no validation (no dropdown, no autocomplete, no regex) — so a customer can
// type "St. Louis" / "Missouri" / "63101", "st louis" / "MO" / "", or a typo.
// A 5-digit zip is the most reliable signal when present (no name-matching
// ambiguity), so it's tried first; city+state name matching is the fallback.
// Locations that resolve neither way are left off the map — they still count
// in the state/city tables below, which don't need coordinates.

type LatLon = [number, number];

const US_STATE_NAME_TO_ABBR: Record<string, string> = {
  alabama: "AL",
  alaska: "AK",
  arizona: "AZ",
  arkansas: "AR",
  california: "CA",
  colorado: "CO",
  connecticut: "CT",
  delaware: "DE",
  florida: "FL",
  georgia: "GA",
  hawaii: "HI",
  idaho: "ID",
  illinois: "IL",
  indiana: "IN",
  iowa: "IA",
  kansas: "KS",
  kentucky: "KY",
  louisiana: "LA",
  maine: "ME",
  maryland: "MD",
  massachusetts: "MA",
  michigan: "MI",
  minnesota: "MN",
  mississippi: "MS",
  missouri: "MO",
  montana: "MT",
  nebraska: "NE",
  nevada: "NV",
  "new hampshire": "NH",
  "new jersey": "NJ",
  "new mexico": "NM",
  "new york": "NY",
  "north carolina": "NC",
  "north dakota": "ND",
  ohio: "OH",
  oklahoma: "OK",
  oregon: "OR",
  pennsylvania: "PA",
  "rhode island": "RI",
  "south carolina": "SC",
  "south dakota": "SD",
  tennessee: "TN",
  texas: "TX",
  utah: "UT",
  vermont: "VT",
  virginia: "VA",
  washington: "WA",
  "west virginia": "WV",
  wisconsin: "WI",
  wyoming: "WY",
  "district of columbia": "DC",
};

const VALID_STATE_ABBRS = new Set(Object.values(US_STATE_NAME_TO_ABBR));

/** "Missouri" -> "MO", "mo" -> "MO", "Missour" (typo) -> null. */
function normalizeStateAbbr(state: string): string | null {
  const trimmed = state.trim();
  if (trimmed.length === 2 && VALID_STATE_ABBRS.has(trimmed.toUpperCase())) {
    return trimmed.toUpperCase();
  }
  return US_STATE_NAME_TO_ABBR[trimmed.toLowerCase()] ?? null;
}

/** Matches the normalization baked into public/geo/us-cities.json's keys. */
export function normalizeCityKey(city: string): string {
  return city
    .toLowerCase()
    .trim()
    .replace(/^st\.?\s+/, "saint ")
    .replace(/^ft\.?\s+/, "fort ")
    .replace(/^mt\.?\s+/, "mount ")
    .replace(/[^a-z0-9 ]/g, "")
    .replace(/\s+/g, " ");
}

let zipMapPromise: Promise<Record<string, LatLon>> | null = null;
let cityMapPromise: Promise<Record<string, LatLon>> | null = null;

function loadZipMap(): Promise<Record<string, LatLon>> {
  if (!zipMapPromise) {
    zipMapPromise = fetch("/geo/us-zips.json").then((r) => r.json());
  }
  return zipMapPromise;
}

function loadCityMap(): Promise<Record<string, LatLon>> {
  if (!cityMapPromise) {
    cityMapPromise = fetch("/geo/us-cities.json").then((r) => r.json());
  }
  return cityMapPromise;
}

export interface GeocodableLocation {
  shipCity: string;
  shipState: string;
  samplePostalCode: string | null;
}

export async function geocodeOrderLocation(loc: GeocodableLocation): Promise<LatLon | null> {
  const zip = loc.samplePostalCode?.trim();
  if (zip && /^\d{5}$/.test(zip)) {
    const zipMap = await loadZipMap();
    const hit = zipMap[zip];
    if (hit) return hit;
  }

  const abbr = normalizeStateAbbr(loc.shipState);
  if (!abbr) return null;
  const cityMap = await loadCityMap();
  return cityMap[`${normalizeCityKey(loc.shipCity)}|${abbr}`] ?? null;
}
