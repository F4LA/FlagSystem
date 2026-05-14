/**
 * ============================================================================
 * ⚠️  SHARED MODULE — READ BEFORE MODIFYING  ⚠️
 * ============================================================================
 *
 * This file is consumed externally by the Coach Pulse Dashboard
 * (repo F4LA/CoachPulse) via CDN with a pinned commit hash.
 *
 * Any modification here can break Coach Pulse if not coordinated.
 *
 * BEFORE MODIFYING THIS FILE:
 *   1. Read Engine_Change_Protocol.md in the Strong Standard project files.
 *   2. Confirm with the user that the change should apply to all consumers.
 *   3. After deploying, bump the commit hash in F4LA/CoachPulse/index.html.
 *
 * Consumers currently importing this file:
 *   - F4LA/FlagSystem (this repo)
 *   - F4LA/CoachPulse (Coach Pulse Dashboard)
 *
 * ============================================================================
 */

/**
 * coaching-week.js
 *
 * Utility module for the Strong Standard Flag System Pathway Engine.
 *
 * Defines the "Coaching Week": Friday 00:00:00 ET through Thursday 23:59:59.999 ET.
 * Each Coaching Week is labeled with the ISO 8601 week number that contains its
 * closing Thursday, formatted as "YYYY-CW##" (e.g., "2026-CW19").
 *
 * All date math is anchored to America/New_York to handle DST correctly.
 *
 * No external dependencies. Works in browser and Node.
 */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.CoachingWeek = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const TZ = 'America/New_York';

  // ---------------------------------------------------------------------------
  // Internal helpers (not exported)
  // ---------------------------------------------------------------------------

  /**
   * Returns the components of a Date as observed in America/New_York.
   * { year, month (1-12), day, hour, minute, second, weekday (0=Sun..6=Sat) }
   */
  function toET(date) {
    if (!(date instanceof Date) || isNaN(date.getTime())) {
      throw new Error('toET: invalid Date');
    }
    const fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: TZ,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      weekday: 'short',
      hour12: false
    });
    const parts = {};
    for (const p of fmt.formatToParts(date)) {
      parts[p.type] = p.value;
    }
    const weekdayMap = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
    let hour = parseInt(parts.hour, 10);
    if (hour === 24) hour = 0; // Intl quirk: midnight can format as "24"
    return {
      year: parseInt(parts.year, 10),
      month: parseInt(parts.month, 10),
      day: parseInt(parts.day, 10),
      hour: hour,
      minute: parseInt(parts.minute, 10),
      second: parseInt(parts.second, 10),
      weekday: weekdayMap[parts.weekday]
    };
  }

  /**
   * Builds a Date object representing a specific wall-clock instant in ET.
   * Accounts for DST automatically.
   */
  function fromET(year, month, day, hour, minute, second, ms) {
    hour = hour || 0;
    minute = minute || 0;
    second = second || 0;
    ms = ms || 0;

    // Start with a UTC guess, then correct for the ET offset at that instant.
    let guess = Date.UTC(year, month - 1, day, hour, minute, second, ms);
    // Iterate up to 2 times to settle DST boundaries.
    for (let i = 0; i < 2; i++) {
      const d = new Date(guess);
      const et = toET(d);
      const target = Date.UTC(year, month - 1, day, hour, minute, second, ms);
      const actual = Date.UTC(et.year, et.month - 1, et.day, et.hour, et.minute, et.second, ms);
      const diff = target - actual;
      if (diff === 0) return d;
      guess += diff;
    }
    return new Date(guess);
  }

  /**
   * ISO 8601 week number and ISO week-year for a date as observed in ET.
   * Returns { isoYear, isoWeek }.
   */
  function isoWeekOf(date) {
    const et = toET(date);
    // Use Date.UTC for the calculation since we already extracted ET components.
    const d = new Date(Date.UTC(et.year, et.month - 1, et.day));
    const dayNum = d.getUTCDay() || 7; // Sun=7, Mon=1..Sat=6
    // Move to the Thursday of the same ISO week.
    d.setUTCDate(d.getUTCDate() + 4 - dayNum);
    const isoYear = d.getUTCFullYear();
    const yearStart = new Date(Date.UTC(isoYear, 0, 1));
    const isoWeek = Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
    return { isoYear, isoWeek };
  }

  /**
   * Returns the Date (at noon ET to avoid DST edge weirdness) of the Thursday
   * belonging to the given ISO year and ISO week.
   */
  function thursdayOfIsoWeek(isoYear, isoWeek) {
    // Jan 4 is always in ISO week 1 of its ISO year.
    const jan4 = fromET(isoYear, 1, 4, 12, 0, 0, 0);
    const jan4Et = toET(jan4);
    const jan4DayNum = jan4Et.weekday === 0 ? 7 : jan4Et.weekday; // Sun=7, Mon=1..Sat=6
    // Thursday of week 1: jan4 shifted so weekday becomes 4 (Thu).
    const week1ThursdayDay = 4 - jan4DayNum + jan4Et.day;
    // Thursday of target week.
    const targetDay = week1ThursdayDay + (isoWeek - 1) * 7;
    // Build a Date by adding (targetDay - jan4Et.day) days to jan4 noon ET.
    const offsetDays = targetDay - jan4Et.day;
    const result = new Date(jan4.getTime() + offsetDays * 86400000);
    return result;
  }

  /**
   * Builds "YYYY-CW##" string.
   */
  function formatWeekId(isoYear, isoWeek) {
    const ww = isoWeek < 10 ? '0' + isoWeek : '' + isoWeek;
    return isoYear + '-CW' + ww;
  }

  /**
   * Parses "YYYY-CW##" into { isoYear, isoWeek }. Throws on malformed input.
   */
  function parseWeekId(weekId) {
    if (typeof weekId !== 'string') {
      throw new Error('parseWeekId: weekId must be a string, got ' + typeof weekId);
    }
    const m = /^(\d{4})-CW(\d{2})$/.exec(weekId);
    if (!m) {
      throw new Error('parseWeekId: malformed weekId "' + weekId + '" (expected "YYYY-CW##")');
    }
    const isoYear = parseInt(m[1], 10);
    const isoWeek = parseInt(m[2], 10);
    if (isoWeek < 1 || isoWeek > 53) {
      throw new Error('parseWeekId: week number out of range in "' + weekId + '"');
    }
    return { isoYear, isoWeek };
  }

  // ---------------------------------------------------------------------------
  // Exported functions
  // ---------------------------------------------------------------------------

  /**
   * Returns the Coaching Week identifier ("YYYY-CW##") for the given Date.
   * The Coaching Week is the Friday-to-Thursday window containing the date,
   * labeled by the ISO week of its closing Thursday.
   */
  function coachingWeekOf(date) {
    if (!(date instanceof Date) || isNaN(date.getTime())) {
      throw new Error('coachingWeekOf: invalid Date');
    }
    const et = toET(date);
    // Find the closing Thursday of the Coaching Week containing this date.
    // weekday: Sun=0, Mon=1, Tue=2, Wed=3, Thu=4, Fri=5, Sat=6
    // If today is Fri/Sat/Sun/Mon/Tue/Wed/Thu, the closing Thursday is:
    //   Fri (5)  -> +6 days
    //   Sat (6)  -> +5 days
    //   Sun (0)  -> +4 days
    //   Mon (1)  -> +3 days
    //   Tue (2)  -> +2 days
    //   Wed (3)  -> +1 day
    //   Thu (4)  -> +0 days
    const wd = et.weekday;
    const daysToThursday = (4 - wd + 7) % 7; // 0..6
    // Build a Date at noon ET on the date itself, then add daysToThursday.
    const baseNoon = fromET(et.year, et.month, et.day, 12, 0, 0, 0);
    const closingThursday = new Date(baseNoon.getTime() + daysToThursday * 86400000);
    const { isoYear, isoWeek } = isoWeekOf(closingThursday);
    return formatWeekId(isoYear, isoWeek);
  }

  /**
   * Returns { start: Date, end: Date } for the given week identifier.
   * start = Friday 00:00:00.000 ET (the day after the previous Thursday)
   * end   = Thursday 23:59:59.999 ET (the closing Thursday)
   */
  function coachingWeekRange(weekId) {
    const { isoYear, isoWeek } = parseWeekId(weekId);
    const thuNoon = thursdayOfIsoWeek(isoYear, isoWeek);
    const thuEt = toET(thuNoon);
    const end = fromET(thuEt.year, thuEt.month, thuEt.day, 23, 59, 59, 999);
    // Friday before is 6 days earlier.
    const friNoon = new Date(thuNoon.getTime() - 6 * 86400000);
    const friEt = toET(friNoon);
    const start = fromET(friEt.year, friEt.month, friEt.day, 0, 0, 0, 0);
    return { start, end };
  }

  /**
   * Convenience: returns the range directly from a Date.
   */
  function coachingWeekRangeFromDate(date) {
    return coachingWeekRange(coachingWeekOf(date));
  }

  /**
   * Returns the identifier of the Coaching Week N weeks before weekId.
   * Computed by date arithmetic (subtracting 7*N days from the closing Thursday)
   * so year and ISO-week-53 boundaries are handled naturally.
   */
  function previousCoachingWeek(weekId, n) {
    n = (n === undefined) ? 1 : n;
    if (!Number.isInteger(n) || n < 0) {
      throw new Error('previousCoachingWeek: n must be a non-negative integer');
    }
    const { isoYear, isoWeek } = parseWeekId(weekId);
    const thuNoon = thursdayOfIsoWeek(isoYear, isoWeek);
    const shifted = new Date(thuNoon.getTime() - n * 7 * 86400000);
    const iso = isoWeekOf(shifted);
    return formatWeekId(iso.isoYear, iso.isoWeek);
  }

  /**
   * Returns the identifier of the Coaching Week N weeks after weekId.
   */
  function nextCoachingWeek(weekId, n) {
    n = (n === undefined) ? 1 : n;
    if (!Number.isInteger(n) || n < 0) {
      throw new Error('nextCoachingWeek: n must be a non-negative integer');
    }
    const { isoYear, isoWeek } = parseWeekId(weekId);
    const thuNoon = thursdayOfIsoWeek(isoYear, isoWeek);
    const shifted = new Date(thuNoon.getTime() + n * 7 * 86400000);
    const iso = isoWeekOf(shifted);
    return formatWeekId(iso.isoYear, iso.isoWeek);
  }

  /**
   * Returns -1 if a < b, 0 if equal, 1 if a > b.
   */
  function compareCoachingWeeks(a, b) {
    const pa = parseWeekId(a);
    const pb = parseWeekId(b);
    if (pa.isoYear !== pb.isoYear) return pa.isoYear < pb.isoYear ? -1 : 1;
    if (pa.isoWeek !== pb.isoWeek) return pa.isoWeek < pb.isoWeek ? -1 : 1;
    return 0;
  }

  /**
   * Returns an ordered array of identifiers from start to end, inclusive.
   * Throws if start > end.
   */
  function coachingWeeksBetween(startWeekId, endWeekId) {
    const cmp = compareCoachingWeeks(startWeekId, endWeekId);
    if (cmp > 0) {
      throw new Error(
        'coachingWeeksBetween: start "' + startWeekId +
        '" is after end "' + endWeekId + '"'
      );
    }
    const result = [startWeekId];
    if (cmp === 0) return result;
    let current = startWeekId;
    // Safety bound: 600 weeks ≈ 11.5 years, more than enough for this system.
    for (let i = 0; i < 600; i++) {
      current = nextCoachingWeek(current, 1);
      result.push(current);
      if (current === endWeekId) return result;
    }
    throw new Error('coachingWeeksBetween: range exceeds 600 weeks (safety bound)');
  }

  /**
   * Returns the identifier of the Coaching Week currently in progress at currentDate.
   * Alias for coachingWeekOf.
   */
  function currentCoachingWeek(currentDate) {
    return coachingWeekOf(currentDate);
  }

  /**
   * Returns the identifier of the most recently CLOSED Coaching Week as of currentDate.
   * A Coaching Week closes at Thursday 23:59:59.999 ET.
   * If currentDate falls inside an open week, returns the previous week.
   * If currentDate is exactly at or after Friday 00:00 ET (start of new week),
   * the just-ended week (Thursday before) is the closed one.
   */
  function closedCoachingWeek(currentDate) {
    const currentWeek = coachingWeekOf(currentDate);
    const range = coachingWeekRange(currentWeek);
    // If currentDate is exactly at end (Thursday 23:59:59.999), this week
    // has just closed. Otherwise current week is still open, so closed = previous.
    if (currentDate.getTime() >= range.end.getTime()) {
      return currentWeek;
    }
    return previousCoachingWeek(currentWeek, 1);
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  return {
    coachingWeekOf,
    coachingWeekRange,
    coachingWeekRangeFromDate,
    previousCoachingWeek,
    nextCoachingWeek,
    coachingWeeksBetween,
    currentCoachingWeek,
    closedCoachingWeek,
    compareCoachingWeeks,
    // Exposed for testing only:
    _internal: {
      toET,
      fromET,
      isoWeekOf,
      thursdayOfIsoWeek,
      parseWeekId,
      formatWeekId
    }
  };
}));
