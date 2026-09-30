// USPS delivery-day arithmetic for untracked Plain White Envelope orders.
// Pure (no I/O), shared by the shipping-updates worker (when to send the
// "should have arrived" check-in) and review requests (ask after that).

const DAY_MS = 24 * 60 * 60 * 1000;
const STORE_TIME_ZONE = "America/Chicago";

/**
 * USPS First-Class Mail takes 1–5 delivery days, so this is when a PWE
 * "should have arrived" and we check in.
 */
export const PWE_ARRIVAL_MAIL_DAYS = 5;

const weekdayFormat = new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone: STORE_TIME_ZONE });

function isSunday(ms: number): boolean {
  return weekdayFormat.format(new Date(ms)) === "Sun";
}

/**
 * `days` USPS delivery days after `fromMs`, at the same time of day. Mail
 * moves Monday to Saturday, so Sundays (in St. Louis) don't count. Federal
 * holidays are ignored: at worst the check-in comes a day early.
 */
export function addMailDays(fromMs: number, days: number): number {
  let t = fromMs;
  let counted = 0;
  while (counted < days) {
    t += DAY_MS;
    if (!isSunday(t)) counted += 1;
  }
  return t;
}

/** When a Plain White Envelope that shipped at `shippedAtMs` should have arrived. */
export function pweArrivalDueAt(shippedAtMs: number): number {
  return addMailDays(shippedAtMs, PWE_ARRIVAL_MAIL_DAYS);
}
