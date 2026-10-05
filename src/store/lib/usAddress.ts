// Where we ship: the United States only.
//
// "The United States" here means every address the US Postal Service treats
// as domestic: the 50 states, Washington, D.C., the five US territories and
// military mail (APO/FPO/DPO). Nothing else can be ordered to.
//
// This is the one copy of that rule for the app. It is used by:
//   - the checkout and saved-address forms (state list, ZIP check, messages);
//   - /api/checkout/create-payment-intent, which refuses any other address
//     before it creates an order or holds stock;
//   - the admin's order map and visitor labels (state names and codes).
// The database has the last word: checkout_place_order_core refuses a non-US
// address whoever calls it, and a constraint on orders keeps one from being
// stored (supabase/migrations/20261005150000_us_shipping_only.sql).
// tests/usAddress.test.ts fails if the lists there and the lists here differ.
//
// Pure module (no browser or Node APIs): safe to import from api/.

export type UsRegionGroup = "state" | "territory" | "military";

export interface UsRegion {
  /** USPS two-letter code, as printed on a label: "MO". */
  code: string;
  name: string;
  group: UsRegionGroup;
  /** Other spellings people (and address lookups) use for it. */
  aliases?: readonly string[];
}

export const US_REGIONS: readonly UsRegion[] = [
  { code: "AL", name: "Alabama", group: "state" },
  { code: "AK", name: "Alaska", group: "state" },
  { code: "AZ", name: "Arizona", group: "state" },
  { code: "AR", name: "Arkansas", group: "state" },
  { code: "CA", name: "California", group: "state" },
  { code: "CO", name: "Colorado", group: "state" },
  { code: "CT", name: "Connecticut", group: "state" },
  { code: "DE", name: "Delaware", group: "state" },
  { code: "DC", name: "District of Columbia", group: "state", aliases: ["Washington DC"] },
  { code: "FL", name: "Florida", group: "state" },
  { code: "GA", name: "Georgia", group: "state" },
  { code: "HI", name: "Hawaii", group: "state" },
  { code: "ID", name: "Idaho", group: "state" },
  { code: "IL", name: "Illinois", group: "state" },
  { code: "IN", name: "Indiana", group: "state" },
  { code: "IA", name: "Iowa", group: "state" },
  { code: "KS", name: "Kansas", group: "state" },
  { code: "KY", name: "Kentucky", group: "state" },
  { code: "LA", name: "Louisiana", group: "state" },
  { code: "ME", name: "Maine", group: "state" },
  { code: "MD", name: "Maryland", group: "state" },
  { code: "MA", name: "Massachusetts", group: "state" },
  { code: "MI", name: "Michigan", group: "state" },
  { code: "MN", name: "Minnesota", group: "state" },
  { code: "MS", name: "Mississippi", group: "state" },
  { code: "MO", name: "Missouri", group: "state" },
  { code: "MT", name: "Montana", group: "state" },
  { code: "NE", name: "Nebraska", group: "state" },
  { code: "NV", name: "Nevada", group: "state" },
  { code: "NH", name: "New Hampshire", group: "state" },
  { code: "NJ", name: "New Jersey", group: "state" },
  { code: "NM", name: "New Mexico", group: "state" },
  { code: "NY", name: "New York", group: "state" },
  { code: "NC", name: "North Carolina", group: "state" },
  { code: "ND", name: "North Dakota", group: "state" },
  { code: "OH", name: "Ohio", group: "state" },
  { code: "OK", name: "Oklahoma", group: "state" },
  { code: "OR", name: "Oregon", group: "state" },
  { code: "PA", name: "Pennsylvania", group: "state" },
  { code: "RI", name: "Rhode Island", group: "state" },
  { code: "SC", name: "South Carolina", group: "state" },
  { code: "SD", name: "South Dakota", group: "state" },
  { code: "TN", name: "Tennessee", group: "state" },
  { code: "TX", name: "Texas", group: "state" },
  { code: "UT", name: "Utah", group: "state" },
  { code: "VT", name: "Vermont", group: "state" },
  { code: "VA", name: "Virginia", group: "state" },
  { code: "WA", name: "Washington", group: "state" },
  { code: "WV", name: "West Virginia", group: "state" },
  { code: "WI", name: "Wisconsin", group: "state" },
  { code: "WY", name: "Wyoming", group: "state" },
  { code: "AS", name: "American Samoa", group: "territory" },
  { code: "GU", name: "Guam", group: "territory" },
  {
    code: "MP",
    name: "Northern Mariana Islands",
    group: "territory",
    aliases: ["Commonwealth of the Northern Mariana Islands"],
  },
  { code: "PR", name: "Puerto Rico", group: "territory" },
  {
    code: "VI",
    name: "U.S. Virgin Islands",
    group: "territory",
    aliases: ["Virgin Islands", "United States Virgin Islands"],
  },
  { code: "AA", name: "Armed Forces Americas", group: "military" },
  { code: "AE", name: "Armed Forces Europe", group: "military" },
  { code: "AP", name: "Armed Forces Pacific", group: "military" },
];

/** The only country an order ships to, as stored on orders and addresses. */
export const SHIP_TO_COUNTRY = "US";

/** How the country is written when the customer needn't (and can't) choose. */
export const SHIP_TO_COUNTRY_NAME = "United States";

/** One sentence saying where we ship, for the checkout form and the shipping page. */
export const SHIPS_TO_SUMMARY =
  "We ship within the United States only: all 50 states, Washington, D.C., US territories and military (APO/FPO/DPO) addresses.";

/** Shown when an address is in another country. */
export const US_ONLY_MESSAGE = "Sorry, we only ship to addresses in the United States.";
/** Shown when the state is missing or isn't one we ship to. */
export const US_STATE_MESSAGE = "Please choose a US state or territory.";
/** Shown when the ZIP code isn't a US ZIP. */
export const US_ZIP_MESSAGE = "Please enter a 5-digit ZIP code.";

/**
 * One spelling for comparing place names: upper case, no periods or commas,
 * single spaces. "Washington, D.C." → "WASHINGTON DC". The database's
 * us_state_code() does the same.
 */
function placeKey(value: unknown): string {
  return typeof value === "string"
    ? value.replace(/[.,]/g, "").replace(/\s+/g, " ").trim().toUpperCase()
    : "";
}

const CODE_BY_KEY: ReadonlyMap<string, string> = new Map(
  US_REGIONS.flatMap((region) =>
    [region.code, region.name, ...(region.aliases ?? [])].map((spelling) => [placeKey(spelling), region.code] as const),
  ),
);

const NAME_BY_CODE: ReadonlyMap<string, string> = new Map(US_REGIONS.map((region) => [region.code, region.name]));

/** "Missouri", " mo ", "MO" → "MO". Not a US state, territory or military region → null. */
export function usStateCode(value: unknown): string | null {
  return CODE_BY_KEY.get(placeKey(value)) ?? null;
}

/** "MO" or "missouri" → "Missouri"; anything else → null. */
export function usStateName(value: unknown): string | null {
  const code = usStateCode(value);
  return code ? (NAME_BY_CODE.get(code) ?? null) : null;
}

/**
 * How the United States is written as a country, compared the way place
 * names are (upper case, no periods: "U.S.A." is "USA"). A blank counts too:
 * our forms have no country field, and the database column defaults to 'US'.
 * The database's is_us_country() has the same list.
 */
export const US_COUNTRY_SPELLINGS: readonly string[] = ["", "US", "USA", "UNITED STATES", "UNITED STATES OF AMERICA"];

const US_COUNTRY_KEYS: ReadonlySet<string> = new Set(US_COUNTRY_SPELLINGS);

// The territories have country codes of their own, and address lookups use
// them: Google gives Puerto Rico as the country "PR". To the Postal Service
// those are US addresses whose *state* is the territory.
const TERRITORY_BY_COUNTRY_KEY: ReadonlyMap<string, string> = new Map(
  US_REGIONS.filter((region) => region.group === "territory").flatMap((region) =>
    [region.code, region.name, ...(region.aliases ?? [])].map((spelling) => [placeKey(spelling), region.code] as const),
  ),
);

/** "63101", "63101-1234", "631011234", "63101 1234" → "63101" / "63101-1234"; else null. */
export function usZip(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const zip = value.trim();
  if (/^\d{5}$/.test(zip)) return zip;
  const plusFour = /^(\d{5})[- ]?(\d{4})$/.exec(zip);
  return plusFour ? `${plusFour[1]}-${plusFour[2]}` : null;
}

/** Is this country the United States, or one of its territories? */
export function isUsCountry(country: unknown): boolean {
  const key = placeKey(country);
  return US_COUNTRY_KEYS.has(key) || TERRITORY_BY_COUNTRY_KEY.has(key);
}

/**
 * The state code for an address whose country may be a territory's own:
 * ("San Juan", "PR") → "PR"; ("Missouri", "US") → "MO"; not in the US → null.
 */
export function usStateFor(state: unknown, country: unknown): string | null {
  const key = placeKey(country);
  const territory = TERRITORY_BY_COUNTRY_KEY.get(key);
  if (territory) return territory;
  return US_COUNTRY_KEYS.has(key) ? usStateCode(state) : null;
}

export type UsAddressField = "country" | "state" | "postalCode";

export type UsAddressCheck =
  | { ok: true; state: string; postalCode: string; country: typeof SHIP_TO_COUNTRY }
  | { ok: false; field: UsAddressField; message: string };

/**
 * Is this somewhere we ship? If so, gives the state code and ZIP the way they
 * are stored and printed ("MO", "63011" or "63011-1234", country "US"); if
 * not, says which part is wrong in words a customer can act on.
 *
 * It checks that the address is *written* as a US address. It can't know the
 * street exists, and a package forwarder's US address is a US address.
 */
export function checkUsAddress(address: { state?: unknown; postalCode?: unknown; country?: unknown }): UsAddressCheck {
  if (!isUsCountry(address.country)) {
    return { ok: false, field: "country", message: US_ONLY_MESSAGE };
  }
  const state = usStateFor(address.state, address.country);
  if (!state) return { ok: false, field: "state", message: US_STATE_MESSAGE };
  const postalCode = usZip(address.postalCode);
  if (!postalCode) return { ok: false, field: "postalCode", message: US_ZIP_MESSAGE };
  return { ok: true, state, postalCode, country: SHIP_TO_COUNTRY };
}

/**
 * The region codes that keep an address lookup to places we ship (Google's
 * `includedRegionCodes`): the US and its territories, which Google lists as
 * countries of their own.
 */
export const US_LOOKUP_REGION_CODES: readonly string[] = [
  "us",
  ...US_REGIONS.filter((region) => region.group === "territory").map((region) => region.code.toLowerCase()),
];
