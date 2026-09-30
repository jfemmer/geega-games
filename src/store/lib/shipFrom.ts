// The store's return address: the sender on every postage label bought
// through EasyPost (api/_lib/easypost.ts) and on the Plain White Envelope
// labels and envelopes printed from the admin Orders page. One copy for both,
// so a move only needs changing here. Pure module (no browser or Node APIs).

export const SHIP_FROM = {
  name: "Geega Games",
  street1: "390 Newbury Dr.",
  street2: null as string | null,
  city: "Ballwin",
  state: "MO",
  zip: "63011",
  country: "US",
} as const;

/** The return address as printed lines: name, street, "City, ST ZIP". */
export function shipFromLines(): string[] {
  return [
    SHIP_FROM.name,
    SHIP_FROM.street1,
    SHIP_FROM.street2,
    `${SHIP_FROM.city}, ${SHIP_FROM.state} ${SHIP_FROM.zip}`,
  ].filter((line): line is string => Boolean(line));
}
