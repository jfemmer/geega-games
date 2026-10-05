// Resolves a paid order's shipping city/state/zip to approximate map
// coordinates, for plotting on the Order Geography map.
//
// Checkout now only accepts a US state and ZIP (src/store/lib/usAddress.ts)
// and stores the state as its code, but earlier orders hold whatever was
// typed: "St. Louis" / "Missouri" / "63101", "st louis" / "MO" / "". A
// 5-digit zip is the most reliable signal when present (no name-matching
// ambiguity), so it's tried first; city+state name matching is the fallback.
// Locations that resolve neither way are left off the map — they still count
// in the state/city tables below, which don't need coordinates.

import { usStateCode } from "../../store/lib/usAddress";

type LatLon = [number, number];

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
  // "63011" or "63011-1234": the first five digits are the ZIP the map knows.
  const zip = /^\d{5}(?=$|-\d{4}$)/.exec(loc.samplePostalCode?.trim() ?? "")?.[0];
  if (zip) {
    const zipMap = await loadZipMap();
    const hit = zipMap[zip];
    if (hit) return hit;
  }

  const abbr = usStateCode(loc.shipState);
  if (!abbr) return null;
  const cityMap = await loadCityMap();
  return cityMap[`${normalizeCityKey(loc.shipCity)}|${abbr}`] ?? null;
}
