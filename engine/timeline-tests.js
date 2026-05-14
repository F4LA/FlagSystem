/**
 * timeline-tests.js
 *
 * Test suite for client-timeline.js (Step 3b).
 *
 * UMD style — exposes window.TimelineTests with a runTimelineTests() function.
 * Depends on: window.CoachingWeek and window.ClientTimeline (must be loaded first).
 */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./client-timeline.js'));
  } else {
    if (!root.ClientTimeline) {
      throw new Error('timeline-tests.js: window.ClientTimeline not found.');
    }
    root.TimelineTests = factory(root.ClientTimeline);
  }
}(typeof self !== 'undefined' ? self : this, function (ClientTimeline) {
  'use strict';

  const buildClientTimeline = ClientTimeline.buildClientTimeline;
  const STANDARD_NAMES      = ClientTimeline.STANDARD_NAMES;

  // Mini test runner --------------------------------------------------------
  const results = { passed: 0, failed: 0, failures: [] };

  function test(name, fn) {
    try {
      fn();
      results.passed++;
      console.log('  ✓ ' + name);
    } catch (err) {
      results.failed++;
      results.failures.push({ name: name, error: err });
      console.error('  ✗ ' + name);
      console.error('    ' + err.message);
    }
  }

  function assert(cond, msg) {
    if (!cond) throw new Error(msg || 'Assertion failed');
  }

  function assertEqual(actual, expected, msg) {
    if (actual !== expected) {
      throw new Error((msg || 'Not equal') + ': expected ' +
        JSON.stringify(expected) + ', got ' + JSON.stringify(actual));
    }
  }

  function assertDeepEqual(actual, expected, msg) {
    const a = JSON.stringify(actual);
    const e = JSON.stringify(expected);
    if (a !== e) {
      throw new Error((msg || 'Not deeply equal') + ':\n  expected ' + e + '\n  got      ' + a);
    }
  }

  // Synthetic data helpers --------------------------------------------------
  // Coaching Week boundaries (ET) under Thu-Wed definition, for April-May 2026:
  //   2026-CW17: Thu Apr 16 → Wed Apr 22
  //   2026-CW18: Thu Apr 23 → Wed Apr 29
  //   2026-CW19: Thu Apr 30 → Wed May 6
  //   2026-CW20: Thu May 7  → Wed May 13

  function tsInsideWeek(year, month, day) {
    // Noon ET ≈ 16:00 UTC during EDT (May)
    return new Date(Date.UTC(year, month - 1, day, 16, 0, 0));
  }

  function sub(opts) {
    return {
      timestamp:           opts.ts,
      client:              opts.client,
      exempt:              opts.exempt || 'No',
      exemptJustification: opts.justification || '',
      standardsCompleted:  opts.standards || [],
      loomLink:            opts.loom || '',
      callRequested:       opts.call || '',
      notes:               opts.notes || ''
    };
  }

  // Mon May 11 2026, noon ET. Under Thu-Wed boundary:
  //   May 11 is in the week Thu May 7 → Wed May 13, which closes Wed May 13.
  //   ISO week of Wed May 13 2026 = CW20, so coachingWeekOf(May 11) = CW20 (in progress).
  //   closedCoachingWeek(May 11) = previousCoachingWeek(CW20) = CW19
  //     (CW19 spans Thu Apr 30 → Wed May 6).
  const CURRENT_DATE = new Date(Date.UTC(2026, 4, 11, 16, 0, 0));

  // Test suites -------------------------------------------------------------

  function suite_basicShape() {
    console.log('\n[Basic shape]');

    test('returns an array', function () {
      const out = buildClientTimeline('John Doe', [], { currentDate: CURRENT_DATE });
      assert(Array.isArray(out), 'output is not an array');
    });

    test('default lookback returns 16 weeks', function () {
      const out = buildClientTimeline('John Doe', [], { currentDate: CURRENT_DATE });
      assertEqual(out.length, 16, 'default lookback should be 16 weeks');
    });

    test('records are ordered oldest to newest', function () {
      const out = buildClientTimeline('John Doe', [], { currentDate: CURRENT_DATE });
      for (let i = 1; i < out.length; i++) {
        assert(out[i].weekId > out[i - 1].weekId || out[i].weekId.startsWith('2027'),
          'weeks not ordered at index ' + i);
      }
    });

    test('weekIndex matches array position', function () {
      const out = buildClientTimeline('John Doe', [], { currentDate: CURRENT_DATE });
      out.forEach(function (rec, i) { assertEqual(rec.weekIndex, i, 'weekIndex at ' + i); });
    });

    test('all records include weekStart and weekEnd Date objects', function () {
      const out = buildClientTimeline('John Doe', [], { currentDate: CURRENT_DATE });
      for (const rec of out) {
        assert(rec.weekStart instanceof Date, 'weekStart not a Date for ' + rec.weekId);
        assert(rec.weekEnd instanceof Date, 'weekEnd not a Date for ' + rec.weekId);
        assert(rec.weekEnd > rec.weekStart, 'weekEnd not after weekStart for ' + rec.weekId);
      }
    });
  }

  function suite_emptyAndMissing() {
    console.log('\n[Empty and missing data]');

    test('empty formResponses → all weeks status="missing"', function () {
      const out = buildClientTimeline('John Doe', [], { currentDate: CURRENT_DATE });
      for (const rec of out) {
        assertEqual(rec.status, 'missing');
        assertEqual(rec.submissionCount, 0);
        assertDeepEqual(rec.rawSubmissions, []);
      }
    });

    test('missing weeks have no points/standards fields', function () {
      const out = buildClientTimeline('John Doe', [], { currentDate: CURRENT_DATE });
      for (const rec of out) {
        assertEqual(rec.points, undefined);
        assertEqual(rec.failedStandards, undefined);
      }
    });

    test('client with no matching submissions → all missing', function () {
      const responses = [
        sub({ ts: tsInsideWeek(2026, 5, 5), client: 'Other Person', standards: STANDARD_NAMES })
      ];
      const out = buildClientTimeline('John Doe', responses, { currentDate: CURRENT_DATE });
      for (const rec of out) {
        assertEqual(rec.status, 'missing');
      }
    });
  }

  function suite_evaluableWeeks() {
    console.log('\n[Evaluable weeks]');

    test('all standards passed → points = 0, failedStandards = []', function () {
      const responses = [
        sub({ ts: tsInsideWeek(2026, 5, 5), client: 'John Doe', standards: STANDARD_NAMES })
      ];
      const out = buildClientTimeline('John Doe', responses, { currentDate: CURRENT_DATE });
      const cw19 = out.find(function (r) { return r.weekId === '2026-CW19'; });
      assert(cw19, 'CW19 not in timeline');
      assertEqual(cw19.status, 'evaluable');
      assertEqual(cw19.points, 0);
      assertDeepEqual(cw19.failedStandards, []);
      assertDeepEqual(cw19.passedStandards, STANDARD_NAMES);
    });

    test('all standards failed (empty checklist) → points = 12', function () {
      const responses = [
        sub({ ts: tsInsideWeek(2026, 5, 5), client: 'John Doe', standards: [] })
      ];
      const out = buildClientTimeline('John Doe', responses, { currentDate: CURRENT_DATE });
      const cw19 = out.find(function (r) { return r.weekId === '2026-CW19'; });
      assertEqual(cw19.points, 12);
      assertEqual(cw19.failedStandards.length, 5);
      assertDeepEqual(cw19.passedStandards, []);
    });

    test('check-in missed only → points = 5 (acute crisis trigger)', function () {
      const responses = [
        sub({
          ts: tsInsideWeek(2026, 5, 5),
          client: 'John Doe',
          standards: ['Training Adherence', 'Nutrition Adherence', 'Movement Target', 'Technique Feedback']
        })
      ];
      const out = buildClientTimeline('John Doe', responses, { currentDate: CURRENT_DATE });
      const cw19 = out.find(function (r) { return r.weekId === '2026-CW19'; });
      assertEqual(cw19.points, 5);
      assertDeepEqual(cw19.failedStandards, ['Check-In Submission']);
    });

    test('nutrition + movement failed → points = 4', function () {
      const responses = [
        sub({
          ts: tsInsideWeek(2026, 5, 5),
          client: 'John Doe',
          standards: ['Check-In Submission', 'Training Adherence', 'Technique Feedback']
        })
      ];
      const out = buildClientTimeline('John Doe', responses, { currentDate: CURRENT_DATE });
      const cw19 = out.find(function (r) { return r.weekId === '2026-CW19'; });
      assertEqual(cw19.points, 4);
      assertDeepEqual(cw19.failedStandards, ['Nutrition Adherence', 'Movement Target']);
    });

    test('Q4 with form-style labels (with parenthesis) is canonicalized', function () {
      const responses = [
        sub({
          ts: tsInsideWeek(2026, 5, 5),
          client: 'John Doe',
          standards: [
            'Check-In Submission',
            'Training Adherence (≥75% of sessions)',
            'Nutrition Adherence (≥5 of 7 days)',
            'Movement Target',
            'Technique Feedback (≥3 videos)'
          ]
        })
      ];
      const out = buildClientTimeline('John Doe', responses, { currentDate: CURRENT_DATE });
      const cw19 = out.find(function (r) { return r.weekId === '2026-CW19'; });
      assertEqual(cw19.points, 0);
      assertDeepEqual(cw19.failedStandards, []);
    });

    test('Q5 loom, Q6 call, Q7 notes propagate to record', function () {
      const responses = [
        sub({
          ts: tsInsideWeek(2026, 5, 5),
          client: 'John Doe',
          standards: STANDARD_NAMES,
          loom: 'https://loom.com/share/abc',
          call: 'Client accepted',
          notes: 'Discussed travel schedule'
        })
      ];
      const out = buildClientTimeline('John Doe', responses, { currentDate: CURRENT_DATE });
      const cw19 = out.find(function (r) { return r.weekId === '2026-CW19'; });
      assertEqual(cw19.loomLink, 'https://loom.com/share/abc');
      assertEqual(cw19.callRequested, 'Client accepted');
      assertEqual(cw19.notes, 'Discussed travel schedule');
    });

    test('empty Q6 (call) → callRequested = null', function () {
      const responses = [
        sub({ ts: tsInsideWeek(2026, 5, 5), client: 'John Doe', standards: STANDARD_NAMES })
      ];
      const out = buildClientTimeline('John Doe', responses, { currentDate: CURRENT_DATE });
      const cw19 = out.find(function (r) { return r.weekId === '2026-CW19'; });
      assertEqual(cw19.callRequested, null);
    });
  }

  function suite_exemptWeeks() {
    console.log('\n[Exempt weeks]');

    test('exempt week → status = "exempt", justification populated', function () {
      const responses = [
        sub({
          ts: tsInsideWeek(2026, 5, 5),
          client: 'John Doe',
          exempt: 'Yes',
          justification: 'Knee surgery, 3-week recovery confirmed'
        })
      ];
      const out = buildClientTimeline('John Doe', responses, { currentDate: CURRENT_DATE });
      const cw19 = out.find(function (r) { return r.weekId === '2026-CW19'; });
      assertEqual(cw19.status, 'exempt');
      assertEqual(cw19.exemptJustification, 'Knee surgery, 3-week recovery confirmed');
      assertEqual(cw19.points, undefined);
      assertEqual(cw19.failedStandards, undefined);
    });

    test('exempt overrides evaluable in same week', function () {
      const responses = [
        sub({ ts: tsInsideWeek(2026, 5, 5), client: 'John Doe', standards: [] }),
        sub({
          ts: tsInsideWeek(2026, 5, 6),
          client: 'John Doe',
          exempt: 'Yes',
          justification: 'Family emergency'
        })
      ];
      const out = buildClientTimeline('John Doe', responses, { currentDate: CURRENT_DATE });
      const cw19 = out.find(function (r) { return r.weekId === '2026-CW19'; });
      assertEqual(cw19.status, 'exempt');
      assertEqual(cw19.exemptJustification, 'Family emergency');
      assertEqual(cw19.submissionCount, 2);
    });
  }

  function suite_lastWins() {
    console.log('\n[Multiple submissions same week — last-wins]');

    test('two submissions same week → latest timestamp wins', function () {
      // Both dates inside 2026-CW19 (Thu Apr 30 → Wed May 6).
      const responses = [
        sub({ ts: tsInsideWeek(2026, 5, 4), client: 'John Doe', standards: [] }),
        sub({ ts: tsInsideWeek(2026, 5, 6), client: 'John Doe', standards: STANDARD_NAMES })
      ];
      const out = buildClientTimeline('John Doe', responses, { currentDate: CURRENT_DATE });
      const cw19 = out.find(function (r) { return r.weekId === '2026-CW19'; });
      assertEqual(cw19.status, 'evaluable');
      assertEqual(cw19.points, 0);
      assertEqual(cw19.submissionCount, 2);
      assertEqual(cw19.rawSubmissions.length, 2);
    });

    test('three submissions same week → most recent wins', function () {
      // All three dates inside 2026-CW19 (Thu Apr 30 → Wed May 6).
      const responses = [
        sub({ ts: tsInsideWeek(2026, 5, 4), client: 'John Doe', standards: [] }),
        sub({ ts: tsInsideWeek(2026, 5, 5), client: 'John Doe', standards: ['Check-In Submission'] }),
        sub({ ts: tsInsideWeek(2026, 5, 6), client: 'John Doe', standards: STANDARD_NAMES })
      ];
      const out = buildClientTimeline('John Doe', responses, { currentDate: CURRENT_DATE });
      const cw19 = out.find(function (r) { return r.weekId === '2026-CW19'; });
      assertEqual(cw19.points, 0);
      assertEqual(cw19.submissionCount, 3);
    });
  }

  function suite_weekBoundaries() {
    console.log('\n[Coaching Week boundaries — Wednesday/Thursday rollover]');

    test('Wed 11pm ET → assigned to closing week', function () {
      // Wed May 6, 11pm ET = Thu May 7, 03:00 UTC (EDT = UTC-4)
      const ts = new Date(Date.UTC(2026, 4, 7, 3, 0, 0));
      const responses = [sub({ ts: ts, client: 'John Doe', standards: STANDARD_NAMES })];
      const out = buildClientTimeline('John Doe', responses, { currentDate: CURRENT_DATE });
      const cw19 = out.find(function (r) { return r.weekId === '2026-CW19'; });
      assertEqual(cw19.status, 'evaluable', 'Wed 11pm ET should land in CW19');
    });

    test('Thu 1am ET → assigned to NEW week (CW20)', function () {
      // Thu May 7, 1am ET = Thu May 7, 05:00 UTC
      const ts = new Date(Date.UTC(2026, 4, 7, 5, 0, 0));
      const responses = [sub({ ts: ts, client: 'John Doe', standards: STANDARD_NAMES })];
      const out = buildClientTimeline('John Doe', responses, {
        currentDate: CURRENT_DATE,
        fromWeek: '2026-CW18',
        toWeek:   '2026-CW20'
      });
      const cw19 = out.find(function (r) { return r.weekId === '2026-CW19'; });
      const cw20 = out.find(function (r) { return r.weekId === '2026-CW20'; });
      assertEqual(cw19.status, 'missing');
      assertEqual(cw20.status, 'evaluable');
    });
  }

  function suite_windowing() {
    console.log('\n[Windowing options]');

    test('explicit fromWeek/toWeek limits output range', function () {
      const out = buildClientTimeline('John Doe', [], {
        currentDate: CURRENT_DATE,
        fromWeek: '2026-CW17',
        toWeek:   '2026-CW19'
      });
      assertEqual(out.length, 3);
      assertEqual(out[0].weekId, '2026-CW17');
      assertEqual(out[2].weekId, '2026-CW19');
    });

    test('custom lookbackWeeks', function () {
      const out = buildClientTimeline('John Doe', [], {
        currentDate: CURRENT_DATE,
        lookbackWeeks: 4
      });
      assertEqual(out.length, 4);
      assertEqual(out[3].weekId, '2026-CW19');
    });

    test('fullHistory with no submissions → only toWeek', function () {
      const out = buildClientTimeline('John Doe', [], {
        currentDate: CURRENT_DATE,
        fullHistory: true
      });
      assertEqual(out.length, 1);
      assertEqual(out[0].weekId, '2026-CW19');
    });

    test('fullHistory expands to earliest submission', function () {
      const responses = [
        sub({ ts: tsInsideWeek(2026, 3, 17), client: 'John Doe', standards: STANDARD_NAMES }),
        sub({ ts: tsInsideWeek(2026, 5, 5),  client: 'John Doe', standards: STANDARD_NAMES })
      ];
      const out = buildClientTimeline('John Doe', responses, {
        currentDate: CURRENT_DATE,
        fullHistory: true
      });
      assert(out.length >= 8, 'expected ~8+ weeks, got ' + out.length);
      const evaluable = out.filter(function (r) { return r.status === 'evaluable'; });
      assertEqual(evaluable.length, 2);
    });

    test('submissions outside window are dropped', function () {
      const responses = [
        sub({ ts: tsInsideWeek(2026, 5, 5),  client: 'John Doe', standards: [] }),
        sub({ ts: tsInsideWeek(2026, 1, 15), client: 'John Doe', standards: [] })
      ];
      const out = buildClientTimeline('John Doe', responses, {
        currentDate: CURRENT_DATE,
        fromWeek: '2026-CW17',
        toWeek:   '2026-CW19'
      });
      const evaluable = out.filter(function (r) { return r.status === 'evaluable'; });
      assertEqual(evaluable.length, 1);
    });

    test('fromWeek > toWeek throws', function () {
      let threw = false;
      try {
        buildClientTimeline('John Doe', [], {
          currentDate: CURRENT_DATE,
          fromWeek: '2026-CW20',
          toWeek:   '2026-CW17'
        });
      } catch (e) { threw = true; }
      assert(threw, 'should throw on inverted window');
    });
  }

  function suite_dataQualityTolerance() {
    console.log('\n[Data quality tolerance]');

    test('submission with no timestamp is dropped', function () {
      const responses = [sub({ ts: null, client: 'John Doe', standards: STANDARD_NAMES })];
      const out = buildClientTimeline('John Doe', responses, { currentDate: CURRENT_DATE });
      for (const rec of out) {
        assertEqual(rec.status, 'missing');
      }
    });

    test('positional array row is normalized correctly', function () {
      const positional = [
        tsInsideWeek(2026, 5, 5),
        'John Doe',
        'No',
        '',
        'Check-In Submission, Training Adherence, Nutrition Adherence, Movement Target, Technique Feedback',
        'https://loom.com/x',
        '',
        'note text'
      ];
      const out = buildClientTimeline('John Doe', [positional], { currentDate: CURRENT_DATE });
      const cw19 = out.find(function (r) { return r.weekId === '2026-CW19'; });
      assertEqual(cw19.status, 'evaluable');
      assertEqual(cw19.points, 0);
      assertEqual(cw19.notes, 'note text');
    });

    test('whitespace in client name does not break match', function () {
      const responses = [
        sub({ ts: tsInsideWeek(2026, 5, 5), client: 'John Doe', standards: STANDARD_NAMES })
      ];
      const out = buildClientTimeline('  John Doe  ', responses, { currentDate: CURRENT_DATE });
      const cw19 = out.find(function (r) { return r.weekId === '2026-CW19'; });
      assertEqual(cw19.status, 'evaluable');
    });

    test('case-sensitive client match (mismatched case → no match)', function () {
      const responses = [
        sub({ ts: tsInsideWeek(2026, 5, 5), client: 'john doe', standards: STANDARD_NAMES })
      ];
      const out = buildClientTimeline('John Doe', responses, { currentDate: CURRENT_DATE });
      const cw19 = out.find(function (r) { return r.weekId === '2026-CW19'; });
      assertEqual(cw19.status, 'missing');
    });

    test('throws on non-string clientName', function () {
      let threw = false;
      try { buildClientTimeline(null, []); } catch (e) { threw = true; }
      assert(threw);
    });

    test('throws on non-array formResponses', function () {
      let threw = false;
      try { buildClientTimeline('John Doe', 'not-an-array'); } catch (e) { threw = true; }
      assert(threw);
    });
  }

  function suite_endToEndScenario() {
    console.log('\n[End-to-end scenario — P2 Nutrition pattern]');

    test('Standards v3.3 example: 4 nutrition fails with exempt in middle', function () {
      // Window: 2026-CW15 (Thu Apr 2 → Wed Apr 8) to 2026-CW19 (Thu Apr 30 → Wed May 6).
      // One submission per coaching week, each landing inside its target week
      // under the Thu-Wed boundary.
      //   2026-CW15: Apr 7  (Tuesday inside Thu Apr 2 → Wed Apr 8)
      //   2026-CW16: Apr 14 (Tuesday inside Thu Apr 9 → Wed Apr 15)
      //   2026-CW17: Apr 21 (Tuesday inside Thu Apr 16 → Wed Apr 22) — exempt
      //   2026-CW18: Apr 28 (Tuesday inside Thu Apr 23 → Wed Apr 29)
      //   2026-CW19: May 5  (Tuesday inside Thu Apr 30 → Wed May 6)
      const baseStandards = ['Check-In Submission', 'Training Adherence', 'Movement Target', 'Technique Feedback'];
      const responses = [
        sub({ ts: tsInsideWeek(2026, 4, 7),  client: 'John Doe', standards: baseStandards }),
        sub({ ts: tsInsideWeek(2026, 4, 14), client: 'John Doe', standards: baseStandards }),
        sub({ ts: tsInsideWeek(2026, 4, 21), client: 'John Doe', exempt: 'Yes', justification: 'Travel' }),
        sub({ ts: tsInsideWeek(2026, 4, 28), client: 'John Doe', standards: baseStandards }),
        sub({ ts: tsInsideWeek(2026, 5, 5),  client: 'John Doe', standards: baseStandards })
      ];
      const out = buildClientTimeline('John Doe', responses, {
        currentDate: CURRENT_DATE,
        fromWeek: '2026-CW15',
        toWeek:   '2026-CW19'
      });

      assertEqual(out.length, 5);
      assertEqual(out[0].status, 'evaluable');
      assertDeepEqual(out[0].failedStandards, ['Nutrition Adherence']);
      assertEqual(out[1].status, 'evaluable');
      assertDeepEqual(out[1].failedStandards, ['Nutrition Adherence']);
      assertEqual(out[2].status, 'exempt');
      assertEqual(out[3].status, 'evaluable');
      assertDeepEqual(out[3].failedStandards, ['Nutrition Adherence']);
      assertEqual(out[4].status, 'evaluable');
      assertDeepEqual(out[4].failedStandards, ['Nutrition Adherence']);

      const evalWithNutritionFail = out.filter(function (r) {
        return r.status === 'evaluable' && r.failedStandards.indexOf('Nutrition Adherence') >= 0;
      });
      assertEqual(evalWithNutritionFail.length, 4, 'P2 should see 4 Nutrition fails');
    });
  }

  // Public runner -----------------------------------------------------------
  function runTimelineTests() {
    console.log('=== Timeline tests (Step 3b) ===');
    results.passed = 0;
    results.failed = 0;
    results.failures = [];

    suite_basicShape();
    suite_emptyAndMissing();
    suite_evaluableWeeks();
    suite_exemptWeeks();
    suite_lastWins();
    suite_weekBoundaries();
    suite_windowing();
    suite_dataQualityTolerance();
    suite_endToEndScenario();

    console.log('\n=== Summary ===');
    console.log('Passed: ' + results.passed);
    console.log('Failed: ' + results.failed);
    if (results.failed > 0) {
      console.log('\nFailures:');
      for (const f of results.failures) {
        console.log('  - ' + f.name + ': ' + f.error.message);
      }
    }
    return results;
  }

  return {
    runTimelineTests: runTimelineTests
  };
}));
