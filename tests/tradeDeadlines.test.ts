import { describe, expect, it } from "vitest";
import {
  addQualifyingDays,
  addQualifyingHours,
  excludedDateSet,
  formatStoreDeadline,
  inTime,
  isQualifyingDay,
  qualifyingHoursLeft,
  storeDateKey,
  storeInstant,
  storeMidnight,
} from "../src/store/lib/tradeDeadlines";

// Qualifying time (Trade Center deadlines): St. Louis time, every Sunday and
// any excluded date skipped, Saturdays counted. The examples are the ones the
// Trade Center promises customers: 48 hours to confirm, 3 days to ship.

const HOUR = 3_600_000;
/** St. Louis wall-clock time, as the UTC instant. */
const at = (y: number, m: number, d: number, h = 0, min = 0) => storeInstant(y, m, d, h, min);
const show = (ms: number) => formatStoreDeadline(ms);

describe("48 hours to confirm an approved trade", () => {
  it("Saturday 2 PM → Tuesday 2 PM (Sunday doesn't count)", () => {
    expect(addQualifyingHours(at(2026, 10, 24, 14), 48)).toBe(at(2026, 10, 27, 14));
    expect(show(addQualifyingHours(at(2026, 10, 24, 14), 48))).toBe("Tue, Oct 27, 2:00 PM CT");
  });

  it("Friday 2 PM → Monday 2 PM", () => {
    expect(addQualifyingHours(at(2026, 10, 23, 14), 48)).toBe(at(2026, 10, 26, 14));
  });

  it("Monday 2 PM → Wednesday 2 PM, and Thursday 2 PM → Saturday 2 PM (Saturdays count)", () => {
    expect(addQualifyingHours(at(2026, 10, 19, 14), 48)).toBe(at(2026, 10, 21, 14));
    expect(addQualifyingHours(at(2026, 10, 22, 14), 48)).toBe(at(2026, 10, 24, 14));
  });

  it("approved on a Sunday: the clock starts Monday at 12:00 AM, so the deadline is the end of Tuesday", () => {
    const deadline = addQualifyingHours(at(2026, 10, 25, 10, 30), 48);
    expect(deadline).toBe(at(2026, 10, 28, 0));
    // A deadline at midnight reads as the end of the day before.
    expect(show(deadline)).toBe("Tue, Oct 27, 11:59 PM CT");
    // Whenever on Sunday it was approved.
    expect(addQualifyingHours(at(2026, 10, 25, 0, 1), 48)).toBe(deadline);
    expect(addQualifyingHours(at(2026, 10, 25, 23, 59), 48)).toBe(deadline);
  });

  it("late Saturday night: the hour before midnight counts, then Monday and Tuesday", () => {
    expect(addQualifyingHours(at(2026, 10, 24, 23), 48)).toBe(at(2026, 10, 27, 23));
  });

  it("a deadline that lands at the end of a counted day is that midnight, not the next counted day", () => {
    expect(addQualifyingHours(at(2026, 10, 24, 0), 24)).toBe(at(2026, 10, 25, 0));
    expect(show(at(2026, 10, 25, 0))).toBe("Sat, Oct 24, 11:59 PM CT");
  });
});

describe("3 qualifying days to ship", () => {
  // A week with no daylight saving change.
  it.each([
    ["Monday", [2026, 10, 19], "Thursday", [2026, 10, 22]],
    ["Wednesday", [2026, 10, 21], "Saturday", [2026, 10, 24]],
    ["Thursday", [2026, 10, 22], "Monday", [2026, 10, 26]],
    ["Friday", [2026, 10, 23], "Tuesday", [2026, 10, 27]],
    ["Saturday", [2026, 10, 24], "Wednesday", [2026, 10, 28]],
  ] as const)("confirmed %s 2 PM → ship by %s 2 PM", (_from, [y, m, d], _to, [y2, m2, d2]) => {
    expect(addQualifyingDays(at(y, m, d, 14), 3)).toBe(at(y2, m2, d2, 14));
  });

  it("returning and trusted customers' 4 and 5 days skip Sunday too", () => {
    expect(addQualifyingDays(at(2026, 10, 23, 14), 4)).toBe(at(2026, 10, 28, 14));
    expect(addQualifyingDays(at(2026, 10, 23, 14), 5)).toBe(at(2026, 10, 29, 14));
  });

  it("confirmed on a Sunday: three full days from Monday", () => {
    expect(addQualifyingDays(at(2026, 10, 25, 15), 3)).toBe(at(2026, 10, 29, 0));
  });
});

describe("daylight saving time (the changes fall on Sundays, which never count)", () => {
  it("fall back, Nov 1 2026: Saturday 2 PM → Tuesday 2 PM on the clock, 73 real hours later", () => {
    const from = at(2026, 10, 31, 14);
    const deadline = addQualifyingHours(from, 48);
    expect(deadline).toBe(at(2026, 11, 3, 14));
    expect(show(deadline)).toBe("Tue, Nov 3, 2:00 PM CT");
    // Saturday's 10 hours + Sunday's 25 (skipped) + Monday's 24 + Tuesday's 14.
    expect((deadline - from) / HOUR).toBe(73);
    expect(qualifyingHoursLeft(from, deadline)).toBe(48);
  });

  it("fall back: shipping windows across that Sunday end at 2 PM on the clock", () => {
    expect(addQualifyingDays(at(2026, 10, 29, 14), 3)).toBe(at(2026, 11, 2, 14)); // Thursday → Monday
    expect(addQualifyingDays(at(2026, 10, 30, 14), 3)).toBe(at(2026, 11, 3, 14)); // Friday → Tuesday
    expect(addQualifyingDays(at(2026, 10, 31, 14), 3)).toBe(at(2026, 11, 4, 14)); // Saturday → Wednesday
  });

  it("spring forward, Mar 8 2026: Saturday 2 PM → Tuesday 2 PM on the clock, 71 real hours later", () => {
    const from = at(2026, 3, 7, 14);
    const deadline = addQualifyingHours(from, 48);
    expect(deadline).toBe(at(2026, 3, 10, 14));
    expect(show(deadline)).toBe("Tue, Mar 10, 2:00 PM CT");
    expect((deadline - from) / HOUR).toBe(71);
    expect(qualifyingHoursLeft(from, deadline)).toBe(48);
  });

  it("St. Louis dates and midnights stay right on both sides of a change", () => {
    expect(storeDateKey(at(2026, 10, 31, 23, 30))).toBe("2026-10-31"); // already Sunday in UTC
    expect(storeDateKey(at(2026, 11, 1, 23, 30))).toBe("2026-11-01");
    // Sunday Nov 1 is 25 hours long, Sunday Mar 8 is 23.
    expect((storeMidnight("2026-11-02") - storeMidnight("2026-11-01")) / HOUR).toBe(25);
    expect((storeMidnight("2026-03-09") - storeMidnight("2026-03-08")) / HOUR).toBe(23);
  });
});

describe("the deadline itself", () => {
  const deadline = at(2026, 10, 27, 14);

  it("confirming exactly at the deadline is in time; a millisecond later isn't", () => {
    expect(inTime(deadline, deadline)).toBe(true);
    expect(inTime(deadline - 1, deadline)).toBe(true);
    expect(inTime(deadline + 1, deadline)).toBe(false);
  });

  it("counts down only qualifying hours, to zero at the deadline", () => {
    expect(qualifyingHoursLeft(at(2026, 10, 24, 14), deadline)).toBe(48);
    // Sunday noon: Sunday doesn't count, so 24 (Monday) + 14 (Tuesday) are left.
    expect(qualifyingHoursLeft(at(2026, 10, 25, 12), deadline)).toBe(38);
    expect(qualifyingHoursLeft(deadline - 1000, deadline)).toBeCloseTo(1 / 3600, 10);
    expect(qualifyingHoursLeft(deadline, deadline)).toBe(0);
    expect(qualifyingHoursLeft(deadline + HOUR, deadline)).toBe(0);
  });
});

describe("days staff exclude", () => {
  it("skips an excluded weekday: Thanksgiving, Thursday Nov 26 2026", () => {
    const thanksgiving = ["2026-11-26"];
    expect(addQualifyingHours(at(2026, 11, 25, 14), 48, thanksgiving)).toBe(at(2026, 11, 28, 14));
    expect(addQualifyingDays(at(2026, 11, 24, 14), 3, thanksgiving)).toBe(at(2026, 11, 28, 14));
    // Without it, Wednesday 2 PM → Friday 2 PM.
    expect(addQualifyingHours(at(2026, 11, 25, 14), 48)).toBe(at(2026, 11, 27, 14));
  });

  it("an excluded day next to a Sunday: Christmas on Friday, Dec 25 2026", () => {
    // Thursday's 10 hours, Saturday's 24, Monday's 14.
    expect(addQualifyingHours(at(2026, 12, 24, 14), 48, ["2026-12-25"])).toBe(at(2026, 12, 28, 14));
  });

  it("starting on an excluded day starts the clock at the next counted midnight", () => {
    // Friday and Saturday in full: the end of Saturday.
    expect(addQualifyingHours(at(2026, 11, 26, 9), 48, ["2026-11-26"])).toBe(at(2026, 11, 29, 0));
  });

  it("reads the stored list: dates or timestamps, junk ignored", () => {
    const set = excludedDateSet(["2026-12-25", "2026-11-26T00:00:00Z", "soon", "", "2026-1-5"]);
    expect([...set].sort()).toEqual(["2026-11-26", "2026-12-25"]);
    expect(isQualifyingDay("2026-11-26", set)).toBe(false);
    expect(isQualifyingDay("2026-10-25", set)).toBe(false); // a Sunday
    expect(isQualifyingDay("2026-10-24", set)).toBe(true); // a Saturday
  });
});

describe("guards", () => {
  it("refuses a missing start or negative hours", () => {
    expect(() => addQualifyingHours(Number.NaN, 48)).toThrow();
    expect(() => addQualifyingHours(Date.now(), -1)).toThrow();
  });

  it("zero hours from a counted moment is that moment", () => {
    const from = at(2026, 10, 24, 14);
    expect(addQualifyingHours(from, 0)).toBe(from);
  });
});
