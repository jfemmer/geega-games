import { CONDITION_NAMES, type CardConditionCode } from "./tradeCenter.js";
import { storeDateKey } from "./tradeDeadlines.js";

// How a trade-in card's condition is set (Trade Center): from how long ago
// its printing came out, since nobody can see the card until it arrives.
// Staff check every card's real condition when the package arrives, and its
// value can go up or down then. The browser shows the condition; the server
// sets it from the printing's Scryfall release date, whatever the browser
// sends.
//
//   printed under 3 years ago    Near Mint
//   3 to 10 years ago            Lightly Played
//   10 to 20 years ago           Moderately Played
//   20 or more years ago         Heavily Played
//
// Pure module: no React, browser, Node or Supabase imports.

export interface ConditionAgeTier {
  /** Printed fewer than this many years ago; null for anything older. */
  underYears: number | null;
  condition: CardConditionCode;
}

export const CONDITION_BY_AGE: readonly ConditionAgeTier[] = [
  { underYears: 3, condition: "NM" },
  { underYears: 10, condition: "LP" },
  { underYears: 20, condition: "MP" },
  { underYears: null, condition: "HP" },
];

/** Whole years from a "YYYY-MM-DD" release date to today in St. Louis, or null when there's no readable date. */
export function printingAgeYears(releasedAt: string | null | undefined, nowMs: number = Date.now()): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(releasedAt ?? "");
  if (!m) return null;
  const [ty, tm, td] = storeDateKey(nowMs).split("-").map(Number);
  const ry = Number(m[1]);
  const rm = Number(m[2]);
  const rd = Number(m[3]);
  let years = ty - ry;
  if (tm < rm || (tm === rm && td < rd)) years -= 1;
  return Math.max(years, 0);
}

/** The condition a trade-in card is listed at, from its printing's age. A printing with no date counts as new. */
export function conditionForAge(releasedAt: string | null | undefined, nowMs: number = Date.now()): CardConditionCode {
  const years = printingAgeYears(releasedAt, nowMs);
  if (years === null) return CONDITION_BY_AGE[0].condition;
  const tier = CONDITION_BY_AGE.find((t) => t.underYears === null || years < t.underYears);
  return (tier ?? CONDITION_BY_AGE[CONDITION_BY_AGE.length - 1]).condition;
}

/** The year a printing came out ("2019"), or null. */
export function printedYear(releasedAt: string | null | undefined): string | null {
  const m = /^(\d{4})-/.exec(releasedAt ?? "");
  return m ? m[1] : null;
}

/** Each tier in words: { condition: "Near Mint", ages: "Under 3 years old" }, … */
export function conditionAgeRules(): { code: CardConditionCode; condition: string; ages: string }[] {
  return CONDITION_BY_AGE.map((t, i) => {
    const from = i === 0 ? null : CONDITION_BY_AGE[i - 1].underYears;
    const ages =
      from === null
        ? `Under ${t.underYears} years old`
        : t.underYears === null
          ? `${from} years or older`
          : `${from} to ${t.underYears} years old`;
    return { code: t.condition, condition: CONDITION_NAMES[t.condition], ages };
  });
}

/** The rule in one line: "Near Mint under 3 years old, Lightly Played 3 to 10 years, …". */
export function conditionAgeSummary(): string {
  return CONDITION_BY_AGE.map((t, i) => {
    const from = i === 0 ? null : CONDITION_BY_AGE[i - 1].underYears;
    const name = CONDITION_NAMES[t.condition];
    if (from === null) return `${name} under ${t.underYears} years old`;
    if (t.underYears === null) return `${name} ${from} years or older`;
    return `${name} ${from} to ${t.underYears} years`;
  }).join(", ");
}
