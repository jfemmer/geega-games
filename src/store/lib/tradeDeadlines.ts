// Trade deadlines in qualifying time (Trade Center: confirming an approved
// trade, shipping cards in, extensions).
//
// Qualifying time runs in St. Louis (America/Chicago): every Sunday, from
// 12:00 AM Sunday to 12:00 AM Monday, doesn't count, and nor do any extra
// dates staff exclude (trade_settings.excluded_dates). Every other day counts
// in full, Saturdays included. So 48 qualifying hours from Saturday 2:00 PM
// end Tuesday 2:00 PM, and 3 qualifying days from Friday 2:00 PM end Tuesday
// 2:00 PM. This is not a Monday–Friday business-day calendar.
//
// Days are taken from the St. Louis calendar, so daylight saving changes
// (which in the US always fall on a Sunday, at 2:00 AM) never move a
// deadline: an excluded day is skipped whatever its length, and a counted
// day contributes its real length.
//
// The server works each deadline out once, from here, and stores it; the
// expiry job, reminders and the pages all read the stored deadline (the
// countdown customers see is information only).
//
// Pure module: no React, browser, Node or Supabase imports.

export const STORE_TIME_ZONE = "America/Chicago";
const HOUR_MS = 3_600_000;
/** More than a year of excluded days means the settings are wrong. */
const MAX_DAYS_SCANNED = 4000;

const DATE_KEY = /^(\d{4})-(\d{2})-(\d{2})$/;

let dateFormatter: Intl.DateTimeFormat | null = null;
let wallFormatter: Intl.DateTimeFormat | null = null;

function parts(formatter: Intl.DateTimeFormat, ms: number): Record<string, number> {
  const out: Record<string, number> = {};
  for (const p of formatter.formatToParts(new Date(ms))) {
    if (p.type !== "literal") out[p.type] = Number(p.value);
  }
  return out;
}

/** "2026-10-25": the St. Louis calendar date `ms` falls on. */
export function storeDateKey(ms: number): string {
  dateFormatter ??= new Intl.DateTimeFormat("en-US", {
    timeZone: STORE_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const p = parts(dateFormatter, ms);
  return `${String(p.year).padStart(4, "0")}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

function keyParts(key: string): [number, number, number] {
  const m = DATE_KEY.exec(key);
  if (!m) throw new Error(`Not a date: ${key}`);
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

/** The calendar date after `key` (plain date arithmetic, no time zone). */
export function nextDateKey(key: string): string {
  const [y, m, d] = keyParts(key);
  const next = new Date(Date.UTC(y, m - 1, d + 1));
  return next.toISOString().slice(0, 10);
}

/** 0 for Sunday … 6 for Saturday. */
export function weekdayOfKey(key: string): number {
  const [y, m, d] = keyParts(key);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** The UTC instant of a wall-clock time in St. Louis. */
export function storeInstant(year: number, month: number, day: number, hour = 0, minute = 0, second = 0): number {
  wallFormatter ??= new Intl.DateTimeFormat("en-US", {
    timeZone: STORE_TIME_ZONE,
    hourCycle: "h23",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
  });
  const target = Date.UTC(year, month - 1, day, hour, minute, second);
  // St. Louis is 5 or 6 hours behind UTC: correct a first guess by the
  // offset there, then once more in case the guess crossed a change.
  let guess = target;
  for (let i = 0; i < 2; i += 1) {
    const p = parts(wallFormatter, guess);
    const wall = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
    guess += target - wall;
  }
  return guess;
}

/** 12:00 AM in St. Louis at the start of the date `key`. */
export function storeMidnight(key: string): number {
  const [y, m, d] = keyParts(key);
  return storeInstant(y, m, d);
}

/** Excluded dates as a set of "YYYY-MM-DD" keys (anything else is ignored). */
export function excludedDateSet(dates: Iterable<string> | null | undefined): Set<string> {
  const out = new Set<string>();
  for (const raw of dates ?? []) {
    const key = String(raw).slice(0, 10);
    if (DATE_KEY.test(key)) out.add(key);
  }
  return out;
}

/** A day that counts: not a Sunday, and not an excluded date. */
export function isQualifyingDay(key: string, excluded: ReadonlySet<string>): boolean {
  return weekdayOfKey(key) !== 0 && !excluded.has(key);
}

/**
 * The instant `hours` of qualifying time after `fromMs`. Starting on a day
 * that doesn't count (approval on a Sunday) starts the clock at 12:00 AM on
 * the next day that does. A deadline that lands exactly at the end of a
 * counted day is that midnight.
 */
export function addQualifyingHours(fromMs: number, hours: number, excludedDates?: Iterable<string> | null): number {
  if (!Number.isFinite(fromMs)) throw new Error("A deadline needs a start time.");
  if (!Number.isFinite(hours) || hours < 0) throw new Error("Hours must be zero or more.");
  const excluded = excludedDateSet(excludedDates);
  let remaining = Math.round(hours * HOUR_MS);
  let t = fromMs;
  let key = storeDateKey(t);
  for (let i = 0; i < MAX_DAYS_SCANNED; i += 1) {
    const next = nextDateKey(key);
    const dayEnd = storeMidnight(next);
    if (isQualifyingDay(key, excluded)) {
      const available = dayEnd - t;
      if (remaining <= available) return t + remaining;
      remaining -= available;
    }
    t = dayEnd;
    key = next;
  }
  throw new Error("Too many excluded days to work out a deadline.");
}

/** `days` qualifying 24-hour days after `fromMs` (the shipping window). */
export function addQualifyingDays(fromMs: number, days: number, excludedDates?: Iterable<string> | null): number {
  return addQualifyingHours(fromMs, days * 24, excludedDates);
}

/** Qualifying hours left until `deadlineMs` (0 once it has passed). */
export function qualifyingHoursLeft(nowMs: number, deadlineMs: number, excludedDates?: Iterable<string> | null): number {
  if (deadlineMs <= nowMs) return 0;
  const excluded = excludedDateSet(excludedDates);
  let total = 0;
  let t = nowMs;
  let key = storeDateKey(t);
  for (let i = 0; i < MAX_DAYS_SCANNED && t < deadlineMs; i += 1) {
    const next = nextDateKey(key);
    const dayEnd = Math.min(storeMidnight(next), deadlineMs);
    if (isQualifyingDay(key, excluded)) total += dayEnd - t;
    t = dayEnd;
    key = next;
  }
  return total / HOUR_MS;
}

/**
 * Whether something done at `atMs` was in time for `deadlineMs`. The
 * deadline itself still counts: confirming at exactly the deadline is on time.
 */
export function inTime(atMs: number, deadlineMs: number): boolean {
  return atMs <= deadlineMs;
}

/** "Tue, Oct 27, 2:00 PM CT". A deadline at midnight reads as the end of the day before. */
export function formatStoreDeadline(iso: string | number): string {
  const ms = typeof iso === "number" ? iso : Date.parse(iso);
  const atMidnight = storeMidnight(storeDateKey(ms)) === ms;
  const shown = atMidnight ? ms - 60_000 : ms;
  return `${new Date(shown).toLocaleString("en-US", {
    timeZone: STORE_TIME_ZONE,
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  })} CT`;
}
