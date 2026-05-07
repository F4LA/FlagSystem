/**
 * tests.js — synthetic test suite for coaching-week.js
 * Runs in Node and in the browser (loaded by tests.html).
 */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    const CW = require('./coaching-week.js');
    module.exports = factory(CW);
  } else {
    root.CoachingWeekTests = factory(root.CoachingWeek);
  }
}(typeof self !== 'undefined' ? self : this, function (CW) {
  'use strict';

  const tests = [];
  function test(name, fn) { tests.push({ name, fn }); }

  function eq(actual, expected, label) {
    const a = JSON.stringify(actual);
    const e = JSON.stringify(expected);
    if (a !== e) {
      throw new Error((label ? label + ': ' : '') + 'expected ' + e + ', got ' + a);
    }
  }

  function assert(cond, label) {
    if (!cond) throw new Error((label || 'assertion') + ' failed');
  }

  function throws(fn, label) {
    let threw = false;
    try { fn(); } catch (e) { threw = true; }
    if (!threw) throw new Error((label || 'expected throw') + ' did not throw');
  }

  // Build a Date representing a specific wall-clock instant in ET.
  function ET(year, month, day, hour, minute, second, ms) {
    return CW._internal.fromET(year, month, day, hour || 0, minute || 0, second || 0, ms || 0);
  }

  // ---------------------------------------------------------------------------
  // Basic mapping: a known mid-week date
  // ---------------------------------------------------------------------------

  test('Tuesday 2026-05-05 ET maps to 2026-CW19', function () {
    // Tue May 5 2026 is in the Friday May 1 -> Thursday May 7 window.
    // Thu May 7 2026 falls in ISO week 19 of 2026.
    const d = ET(2026, 5, 5, 10, 0, 0);
    eq(CW.coachingWeekOf(d), '2026-CW19');
  });

  test('coachingWeekRange("2026-CW19") returns Fri May 1 00:00 ET to Thu May 7 23:59:59.999 ET', function () {
    const r = CW.coachingWeekRange('2026-CW19');
    const startEt = CW._internal.toET(r.start);
    const endEt = CW._internal.toET(r.end);
    eq([startEt.year, startEt.month, startEt.day, startEt.hour, startEt.minute, startEt.second, startEt.weekday],
       [2026, 5, 1, 0, 0, 0, 5], 'start');
    eq([endEt.year, endEt.month, endEt.day, endEt.hour, endEt.minute, endEt.second, endEt.weekday],
       [2026, 5, 7, 23, 59, 59, 4], 'end');
  });

  test('coachingWeekRangeFromDate composes correctly', function () {
    const d = ET(2026, 5, 5, 10, 0, 0);
    const direct = CW.coachingWeekRange(CW.coachingWeekOf(d));
    const composed = CW.coachingWeekRangeFromDate(d);
    eq(composed.start.getTime(), direct.start.getTime(), 'start');
    eq(composed.end.getTime(), direct.end.getTime(), 'end');
  });

  test('Round-trip: any date inside its range', function () {
    const samples = [
      ET(2026, 5, 1, 0, 0, 0),      // Friday start
      ET(2026, 5, 4, 12, 0, 0),     // Monday noon
      ET(2026, 5, 7, 23, 59, 59),   // Thursday last second
      ET(2025, 12, 31, 15, 0, 0),
      ET(2027, 1, 1, 8, 0, 0),
      ET(2024, 7, 4, 9, 0, 0),
    ];
    for (const s of samples) {
      const r = CW.coachingWeekRangeFromDate(s);
      assert(s.getTime() >= r.start.getTime() && s.getTime() <= r.end.getTime(),
        'round-trip for ' + s.toISOString());
    }
  });

  // ---------------------------------------------------------------------------
  // Friday/Thursday rollover
  // ---------------------------------------------------------------------------

  test('Thursday 2026-05-07 23:59:59 ET is in 2026-CW19', function () {
    const d = ET(2026, 5, 7, 23, 59, 59);
    eq(CW.coachingWeekOf(d), '2026-CW19');
  });

  test('Friday 2026-05-08 00:00:00 ET is in 2026-CW20 (new week)', function () {
    const d = ET(2026, 5, 8, 0, 0, 0);
    eq(CW.coachingWeekOf(d), '2026-CW20');
  });

  test('Same instant in PT (Thursday evening) still resolves via ET anchoring', function () {
    // Thu May 7 2026 21:00 PT = Fri May 8 2026 00:00 ET
    // PT is UTC-7 in May (PDT). So this instant is 2026-05-08T04:00:00Z.
    const instant = new Date(Date.UTC(2026, 4, 8, 4, 0, 0));
    eq(CW.coachingWeekOf(instant), '2026-CW20');
  });

  // ---------------------------------------------------------------------------
  // Year boundary
  // ---------------------------------------------------------------------------

  test('Dec 30 2025 (Tue) is in ISO week 1 of 2026 -> labeled 2026-CW01', function () {
    // Tue Dec 30 2025 is in ISO week 2026-W01 (closing Thursday is Jan 1 2026).
    const d = ET(2025, 12, 30, 12, 0, 0);
    eq(CW.coachingWeekOf(d), '2026-CW01');
  });

  test('Jan 1 2026 (Thu) is closing day of 2026-CW01', function () {
    const d = ET(2026, 1, 1, 18, 0, 0);
    eq(CW.coachingWeekOf(d), '2026-CW01');
  });

  test('Jan 2 2026 (Fri) starts 2026-CW02', function () {
    const d = ET(2026, 1, 2, 0, 0, 0);
    eq(CW.coachingWeekOf(d), '2026-CW02');
  });

  test('Range of 2026-CW01 spans Dec 26 2025 to Jan 1 2026 ET', function () {
    const r = CW.coachingWeekRange('2026-CW01');
    const s = CW._internal.toET(r.start);
    const e = CW._internal.toET(r.end);
    eq([s.year, s.month, s.day, s.weekday], [2025, 12, 26, 5], 'start (Friday)');
    eq([e.year, e.month, e.day, e.weekday], [2026, 1, 1, 4], 'end (Thursday)');
  });

  // ---------------------------------------------------------------------------
  // ISO week 53
  // ---------------------------------------------------------------------------

  test('2026-CW53 is valid (2026 has 53 ISO weeks)', function () {
    const r = CW.coachingWeekRange('2026-CW53');
    const e = CW._internal.toET(r.end);
    // Closing Thursday of 2026-W53 is Dec 31 2026.
    eq([e.year, e.month, e.day, e.weekday], [2026, 12, 31, 4]);
  });

  test('nextCoachingWeek("2026-CW53") = "2027-CW01"', function () {
    eq(CW.nextCoachingWeek('2026-CW53'), '2027-CW01');
  });

  test('nextCoachingWeek("2024-CW52") = "2025-CW01" (2024 has 52 weeks)', function () {
    eq(CW.nextCoachingWeek('2024-CW52'), '2025-CW01');
  });

  test('previousCoachingWeek("2027-CW01") = "2026-CW53"', function () {
    eq(CW.previousCoachingWeek('2027-CW01'), '2026-CW53');
  });

  test('previousCoachingWeek("2026-CW01") = "2025-CW52"', function () {
    eq(CW.previousCoachingWeek('2026-CW01'), '2025-CW52');
  });

  test('previousCoachingWeek with n > 1', function () {
    eq(CW.previousCoachingWeek('2026-CW05', 4), '2026-CW01');
    eq(CW.previousCoachingWeek('2026-CW02', 5), '2025-CW49');
  });

  test('nextCoachingWeek with n > 1', function () {
    eq(CW.nextCoachingWeek('2026-CW48', 5), '2026-CW53');
    eq(CW.nextCoachingWeek('2026-CW48', 6), '2027-CW01');
    eq(CW.nextCoachingWeek('2026-CW01', 0), '2026-CW01');
  });

  // ---------------------------------------------------------------------------
  // coachingWeeksBetween
  // ---------------------------------------------------------------------------

  test('coachingWeeksBetween same week returns array of 1', function () {
    eq(CW.coachingWeeksBetween('2026-CW19', '2026-CW19'), ['2026-CW19']);
  });

  test('coachingWeeksBetween adjacent weeks returns 2 in order', function () {
    eq(CW.coachingWeeksBetween('2026-CW19', '2026-CW20'), ['2026-CW19', '2026-CW20']);
  });

  test('coachingWeeksBetween 4-week range', function () {
    eq(CW.coachingWeeksBetween('2026-CW15', '2026-CW18'),
       ['2026-CW15', '2026-CW16', '2026-CW17', '2026-CW18']);
  });

  test('coachingWeeksBetween crossing year boundary (2026-CW52 to 2027-CW02)', function () {
    eq(CW.coachingWeeksBetween('2026-CW52', '2027-CW02'),
       ['2026-CW52', '2026-CW53', '2027-CW01', '2027-CW02']);
  });

  test('coachingWeeksBetween throws on reversed input', function () {
    throws(function () { CW.coachingWeeksBetween('2026-CW20', '2026-CW19'); }, 'reversed range');
    throws(function () { CW.coachingWeeksBetween('2027-CW01', '2026-CW53'); }, 'reversed across year');
  });

  // ---------------------------------------------------------------------------
  // compareCoachingWeeks
  // ---------------------------------------------------------------------------

  test('compareCoachingWeeks returns -1, 0, 1', function () {
    eq(CW.compareCoachingWeeks('2026-CW10', '2026-CW10'), 0);
    eq(CW.compareCoachingWeeks('2026-CW10', '2026-CW11'), -1);
    eq(CW.compareCoachingWeeks('2026-CW11', '2026-CW10'), 1);
    eq(CW.compareCoachingWeeks('2025-CW52', '2026-CW01'), -1);
    eq(CW.compareCoachingWeeks('2026-CW53', '2027-CW01'), -1);
  });

  // ---------------------------------------------------------------------------
  // currentCoachingWeek and closedCoachingWeek
  // ---------------------------------------------------------------------------

  test('currentCoachingWeek mid-week (Tue) returns the in-progress week', function () {
    const d = ET(2026, 5, 5, 10, 0, 0); // Tuesday in 2026-CW19
    eq(CW.currentCoachingWeek(d), '2026-CW19');
  });

  test('closedCoachingWeek mid-week returns previous week', function () {
    const d = ET(2026, 5, 5, 10, 0, 0); // Tue in CW19, current week still open
    eq(CW.closedCoachingWeek(d), '2026-CW18');
  });

  test('closedCoachingWeek on Friday morning returns just-closed week', function () {
    // Fri May 8 2026 09:00 ET. CW20 just started; CW19 closed Thursday night.
    const d = ET(2026, 5, 8, 9, 0, 0);
    eq(CW.closedCoachingWeek(d), '2026-CW19');
  });

  test('closedCoachingWeek at Friday 00:00:01 ET returns just-closed week', function () {
    const d = ET(2026, 5, 8, 0, 0, 1);
    eq(CW.closedCoachingWeek(d), '2026-CW19');
  });

  test('closedCoachingWeek on Thursday 23:59:00 ET returns previous (current still open)', function () {
    const d = ET(2026, 5, 7, 23, 59, 0);
    eq(CW.closedCoachingWeek(d), '2026-CW18');
  });

  test('closedCoachingWeek at Thursday 23:59:59.999 ET returns the week that just closed', function () {
    const d = ET(2026, 5, 7, 23, 59, 59, 999);
    eq(CW.closedCoachingWeek(d), '2026-CW19');
  });

  // ---------------------------------------------------------------------------
  // DST transitions (ET)
  // ---------------------------------------------------------------------------

  test('Spring forward 2026 (Mar 8): coaching week range still spans Fri 00:00 to Thu 23:59:59 ET', function () {
    // Mar 8 2026 (Sun) is the spring-forward day in ET. It falls in the
    // Friday Mar 6 -> Thursday Mar 12 coaching week (closing Thu Mar 12 is in ISO week 11).
    const d = ET(2026, 3, 8, 4, 0, 0); // Sunday after spring forward
    const wkId = CW.coachingWeekOf(d);
    eq(wkId, '2026-CW11');
    const r = CW.coachingWeekRange(wkId);
    const s = CW._internal.toET(r.start);
    const e = CW._internal.toET(r.end);
    eq([s.year, s.month, s.day, s.hour, s.minute, s.second, s.weekday], [2026, 3, 6, 0, 0, 0, 5], 'spring start');
    eq([e.year, e.month, e.day, e.hour, e.minute, e.second, e.weekday], [2026, 3, 12, 23, 59, 59, 4], 'spring end');
  });

  test('Fall back 2026 (Nov 1): coaching week range still spans Fri 00:00 to Thu 23:59:59 ET', function () {
    // Nov 1 2026 (Sun) is fall-back day. Coaching week is Fri Oct 30 -> Thu Nov 5.
    const d = ET(2026, 11, 1, 12, 0, 0);
    const wkId = CW.coachingWeekOf(d);
    eq(wkId, '2026-CW45');
    const r = CW.coachingWeekRange(wkId);
    const s = CW._internal.toET(r.start);
    const e = CW._internal.toET(r.end);
    eq([s.year, s.month, s.day, s.hour, s.minute, s.second, s.weekday], [2026, 10, 30, 0, 0, 0, 5], 'fall start');
    eq([e.year, e.month, e.day, e.hour, e.minute, e.second, e.weekday], [2026, 11, 5, 23, 59, 59, 4], 'fall end');
  });

  // ---------------------------------------------------------------------------
  // Malformed input
  // ---------------------------------------------------------------------------

  test('parseWeekId rejects malformed input', function () {
    throws(function () { CW.coachingWeekRange('2026-W19'); }, 'no CW prefix');
    throws(function () { CW.coachingWeekRange('2026-CW9'); }, 'single-digit week');
    throws(function () { CW.coachingWeekRange('26-CW09'); }, 'short year');
    throws(function () { CW.coachingWeekRange(''); }, 'empty');
    throws(function () { CW.coachingWeekRange('2026-CW00'); }, 'week 0');
    throws(function () { CW.coachingWeekRange('2026-CW54'); }, 'week 54');
  });

  test('coachingWeekOf rejects invalid Date', function () {
    throws(function () { CW.coachingWeekOf(new Date('invalid')); }, 'invalid date');
    throws(function () { CW.coachingWeekOf('2026-05-05'); }, 'string instead of Date');
  });

  test('previousCoachingWeek/nextCoachingWeek reject invalid n', function () {
    throws(function () { CW.previousCoachingWeek('2026-CW19', -1); }, 'negative n');
    throws(function () { CW.previousCoachingWeek('2026-CW19', 1.5); }, 'non-integer n');
    throws(function () { CW.nextCoachingWeek('2026-CW19', -1); }, 'negative n');
  });

  // ---------------------------------------------------------------------------
  // Runner
  // ---------------------------------------------------------------------------

  function run() {
    const results = [];
    let passed = 0, failed = 0;
    for (const t of tests) {
      try {
        t.fn();
        results.push({ name: t.name, ok: true });
        passed++;
      } catch (e) {
        results.push({ name: t.name, ok: false, error: e.message });
        failed++;
      }
    }
    return { passed, failed, total: tests.length, results };
  }

  return { run, tests };
}));
