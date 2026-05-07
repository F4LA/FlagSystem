/**
 * timeline-tests.js
 *
 * Test suite for client-timeline.js (Step 3b).
 *
 * Self-contained: defines its own test runner so it works in both browser
 * console and Node. To integrate with the existing tests.html page, append
 * the runTimelineTests() call to the existing test runner.
 *
 * Run in browser console:
 *   import('./timeline-tests.js').then(m => m.runTimelineTests());
 *
 * Run in Node (with --experimental-vm-modules or after building):
 *   node --input-type=module -e "import('./engine/timeline-tests.js').then(m => m.runTimelineTests())"
 */

import { buildClientTimeline, STANDARD_NAMES } from './client-timeline.js';

// ---------------------------------------------------------------------------
// Mini test runner
// ---------------------------------------------------------------------------

const results = { passed: 0, failed: 0, failures: [] };

function test(name, fn) {
  try {
    fn();
    results.passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    results.failed++;
    results.failures.push({ name, error: err });
    console.error(`  ✗ ${name}`);
    console.error(`    ${err.message}`);
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'Assertion failed');
}

function assertEqual(actual, expected, msg) {
  if (actual !== expected) {
    throw new Error(`${msg || 'Not equal'}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function assertDeepEqual(actual, expected, msg) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) {
    throw new Error(`${msg || 'Not deeply equal'}:\n  expected ${e}\n  got      ${a}`);
  }
}

// ---------------------------------------------------------------------------
// Synthetic data helpers
// ---------------------------------------------------------------------------

// Reference dates anchored to ET. We pick dates in May 2026 because:
//   - DST is active (no ambiguity)
//   - Weekday alignment is straightforward
//
// Coaching Week boundaries (ET):
//   2026-CW17: Fri Apr 24 → Thu Apr 30
//   2026-CW18: Fri May 01 → Thu May 07
//   2026-CW19: Fri May 08 → Thu May 14
//   2026-CW20: Fri May 15 → Thu May 21
//   2026-CW21: Fri May 22 → Thu May 28

// Helper: timestamp clearly inside a given Coaching Week (Tuesday noon ET)
function tsInsideWeek(year, month, day) {
  // Construct a UTC time that is noon ET regardless of DST.
  // May is EDT (UTC-4), so noon ET = 16:00 UTC.
  return new Date(Date.UTC(year, month - 1, day, 16, 0, 0));
}

// Build a form-response object using named keys
function sub({ ts, client, exempt = 'No', justification = '', standards = [], loom = '', call = '', notes = '' }) {
  return {
    timestamp:           ts,
    client:              client,
    exempt:              exempt,
    exemptJustification: justification,
    standardsCompleted:  standards,
    loomLink:            loom,
    callRequested:       call,
    notes:               notes
  };
}

// Currentish date used for default windowing in tests
const CURRENT_DATE = new Date(Date.UTC(2026, 4, 11, 16, 0, 0)); // Mon May 11 2026, noon ET
// closedCoachingWeek(May 11) → 2026-CW19 (Fri May 8 → Thu May 14 is current; closed = CW19? )
// Actually: May 11 is Monday, inside 2026-CW20 (Fri May 8 → Thu May 14).
// Wait — I need to recompute.
//   ISO week of May 14, 2026 (Thursday): that's the closing Thursday of CW20.
//   So Mon May 11 is INSIDE CW20 (in progress).
//   closedCoachingWeek(May 11) = CW19 (Fri May 1 → Thu May 7).

// I'll use that anchoring. CW19 = Fri May 1 → Thu May 7 (closed at the test's "now").

// ---------------------------------------------------------------------------
// Test suites
// ---------------------------------------------------------------------------

function suite_basicShape() {
  console.log('\n[Basic shape]');

  test('returns an array', () => {
    const out = buildClientTimeline('John Doe', [], { currentDate: CURRENT_DATE });
    assert(Array.isArray(out), 'output is not an array');
  });

  test('default lookback returns 16 weeks', () => {
    const out = buildClientTimeline('John Doe', [], { currentDate: CURRENT_DATE });
    assertEqual(out.length, 16, 'default lookback should be 16 weeks');
  });

  test('records are ordered oldest to newest', () => {
    const out = buildClientTimeline('John Doe', [], { currentDate: CURRENT_DATE });
    for (let i = 1; i < out.length; i++) {
      assert(out[i].weekId > out[i - 1].weekId || out[i].weekId.startsWith('2027'),
        `weeks not ordered at index ${i}: ${out[i - 1].weekId} → ${out[i].weekId}`);
    }
  });

  test('weekIndex matches array position', () => {
    const out = buildClientTimeline('John Doe', [], { currentDate: CURRENT_DATE });
    out.forEach((rec, i) => assertEqual(rec.weekIndex, i, `weekIndex at ${i}`));
  });

  test('all records include weekStart and weekEnd Date objects', () => {
    const out = buildClientTimeline('John Doe', [], { currentDate: CURRENT_DATE });
    for (const rec of out) {
      assert(rec.weekStart instanceof Date, `weekStart not a Date for ${rec.weekId}`);
      assert(rec.weekEnd instanceof Date, `weekEnd not a Date for ${rec.weekId}`);
      assert(rec.weekEnd > rec.weekStart, `weekEnd not after weekStart for ${rec.weekId}`);
    }
  });
}

function suite_emptyAndMissing() {
  console.log('\n[Empty and missing data]');

  test('empty formResponses → all weeks status="missing"', () => {
    const out = buildClientTimeline('John Doe', [], { currentDate: CURRENT_DATE });
    for (const rec of out) {
      assertEqual(rec.status, 'missing', `expected missing for ${rec.weekId}`);
      assertEqual(rec.submissionCount, 0, 'submissionCount should be 0');
      assertDeepEqual(rec.rawSubmissions, [], 'rawSubmissions should be empty');
    }
  });

  test('missing weeks have no points/standards fields', () => {
    const out = buildClientTimeline('John Doe', [], { currentDate: CURRENT_DATE });
    for (const rec of out) {
      assertEqual(rec.points, undefined, 'missing weeks should not have points');
      assertEqual(rec.failedStandards, undefined, 'missing weeks should not have failedStandards');
    }
  });

  test('client with no matching submissions → all missing', () => {
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

  test('all standards passed → points = 0, failedStandards = []', () => {
    const responses = [
      sub({
        ts: tsInsideWeek(2026, 5, 5),  // Tue May 5 → CW19
        client: 'John Doe',
        standards: STANDARD_NAMES
      })
    ];
    const out = buildClientTimeline('John Doe', responses, { currentDate: CURRENT_DATE });
    const cw19 = out.find(r => r.weekId === '2026-CW19');
    assert(cw19, 'CW19 not in timeline');
    assertEqual(cw19.status, 'evaluable');
    assertEqual(cw19.points, 0);
    assertDeepEqual(cw19.failedStandards, []);
    assertDeepEqual(cw19.passedStandards, STANDARD_NAMES);
  });

  test('all standards failed (empty checklist) → points = 12', () => {
    const responses = [
      sub({
        ts: tsInsideWeek(2026, 5, 5),
        client: 'John Doe',
        standards: []
      })
    ];
    const out = buildClientTimeline('John Doe', responses, { currentDate: CURRENT_DATE });
    const cw19 = out.find(r => r.weekId === '2026-CW19');
    assertEqual(cw19.points, 12);
    assertEqual(cw19.failedStandards.length, 5);
    assertDeepEqual(cw19.passedStandards, []);
  });

  test('check-in missed only → points = 5 (acute crisis trigger)', () => {
    const responses = [
      sub({
        ts: tsInsideWeek(2026, 5, 5),
        client: 'John Doe',
        standards: ['Training Adherence', 'Nutrition Adherence', 'Movement Target', 'Technique Feedback']
      })
    ];
    const out = buildClientTimeline('John Doe', responses, { currentDate: CURRENT_DATE });
    const cw19 = out.find(r => r.weekId === '2026-CW19');
    assertEqual(cw19.points, 5);
    assertDeepEqual(cw19.failedStandards, ['Check-In Submission']);
  });

  test('nutrition + movement failed → points = 4', () => {
    const responses = [
      sub({
        ts: tsInsideWeek(2026, 5, 5),
        client: 'John Doe',
        standards: ['Check-In Submission', 'Training Adherence', 'Technique Feedback']
      })
    ];
    const out = buildClientTimeline('John Doe', responses, { currentDate: CURRENT_DATE });
    const cw19 = out.find(r => r.weekId === '2026-CW19');
    assertEqual(cw19.points, 4);
    assertDeepEqual(cw19.failedStandards, ['Nutrition Adherence', 'Movement Target']);
  });

  test('Q4 with form-style labels (with parenthesis) is canonicalized', () => {
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
    const cw19 = out.find(r => r.weekId === '2026-CW19');
    assertEqual(cw19.points, 0, 'all 5 standards should be canonicalized as passed');
    assertDeepEqual(cw19.failedStandards, []);
  });

  test('Q5 loom, Q6 call, Q7 notes propagate to record', () => {
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
    const cw19 = out.find(r => r.weekId === '2026-CW19');
    assertEqual(cw19.loomLink, 'https://loom.com/share/abc');
    assertEqual(cw19.callRequested, 'Client accepted');
    assertEqual(cw19.notes, 'Discussed travel schedule');
  });

  test('empty Q6 (call) → callRequested = null', () => {
    const responses = [
      sub({ ts: tsInsideWeek(2026, 5, 5), client: 'John Doe', standards: STANDARD_NAMES })
    ];
    const out = buildClientTimeline('John Doe', responses, { currentDate: CURRENT_DATE });
    const cw19 = out.find(r => r.weekId === '2026-CW19');
    assertEqual(cw19.callRequested, null);
  });
}

function suite_exemptWeeks() {
  console.log('\n[Exempt weeks]');

  test('exempt week → status = "exempt", justification populated', () => {
    const responses = [
      sub({
        ts: tsInsideWeek(2026, 5, 5),
        client: 'John Doe',
        exempt: 'Yes',
        justification: 'Knee surgery, 3-week recovery confirmed'
      })
    ];
    const out = buildClientTimeline('John Doe', responses, { currentDate: CURRENT_DATE });
    const cw19 = out.find(r => r.weekId === '2026-CW19');
    assertEqual(cw19.status, 'exempt');
    assertEqual(cw19.exemptJustification, 'Knee surgery, 3-week recovery confirmed');
    assertEqual(cw19.points, undefined, 'exempt weeks should not have points');
    assertEqual(cw19.failedStandards, undefined, 'exempt weeks should not have failedStandards');
  });

  test('exempt overrides evaluable in same week', () => {
    const responses = [
      sub({
        ts: tsInsideWeek(2026, 5, 5),
        client: 'John Doe',
        standards: []  // all failed
      }),
      sub({
        ts: tsInsideWeek(2026, 5, 6),
        client: 'John Doe',
        exempt: 'Yes',
        justification: 'Family emergency'
      })
    ];
    const out = buildClientTimeline('John Doe', responses, { currentDate: CURRENT_DATE });
    const cw19 = out.find(r => r.weekId === '2026-CW19');
    assertEqual(cw19.status, 'exempt', 'exempt should win over evaluable');
    assertEqual(cw19.exemptJustification, 'Family emergency');
    assertEqual(cw19.submissionCount, 2);
  });
}

function suite_lastWins() {
  console.log('\n[Multiple submissions same week — last-wins]');

  test('two submissions same week → latest timestamp wins', () => {
    const responses = [
      sub({
        ts: tsInsideWeek(2026, 5, 5),  // Tue May 5
        client: 'John Doe',
        standards: []  // all failed
      }),
      sub({
        ts: tsInsideWeek(2026, 5, 7),  // Thu May 7 (later, still CW19)
        client: 'John Doe',
        standards: STANDARD_NAMES  // all passed (correction)
      })
    ];
    const out = buildClientTimeline('John Doe', responses, { currentDate: CURRENT_DATE });
    const cw19 = out.find(r => r.weekId === '2026-CW19');
    assertEqual(cw19.status, 'evaluable');
    assertEqual(cw19.points, 0, 'latest submission (corrected) should win');
    assertEqual(cw19.submissionCount, 2, 'both submissions counted');
    assertEqual(cw19.rawSubmissions.length, 2, 'both raw submissions preserved');
  });

  test('three submissions same week → most recent wins', () => {
    const responses = [
      sub({ ts: tsInsideWeek(2026, 5, 5), client: 'John Doe', standards: [] }),
      sub({ ts: tsInsideWeek(2026, 5, 6), client: 'John Doe', standards: ['Check-In Submission'] }),
      sub({ ts: tsInsideWeek(2026, 5, 7), client: 'John Doe', standards: STANDARD_NAMES })
    ];
    const out = buildClientTimeline('John Doe', responses, { currentDate: CURRENT_DATE });
    const cw19 = out.find(r => r.weekId === '2026-CW19');
    assertEqual(cw19.points, 0);
    assertEqual(cw19.submissionCount, 3);
  });
}

function suite_weekBoundaries() {
  console.log('\n[Coaching Week boundaries — Friday/Thursday rollover]');

  test('Thu 11pm ET → assigned to closing week', () => {
    // Thu May 7, 11pm ET (UTC-4 in May) = Fri May 8, 03:00 UTC
    const ts = new Date(Date.UTC(2026, 4, 8, 3, 0, 0));
    const responses = [
      sub({ ts, client: 'John Doe', standards: STANDARD_NAMES })
    ];
    const out = buildClientTimeline('John Doe', responses, { currentDate: CURRENT_DATE });
    const cw19 = out.find(r => r.weekId === '2026-CW19');
    assertEqual(cw19.status, 'evaluable', 'Thu 11pm ET should land in CW19');
  });

  test('Fri 1am ET → assigned to NEW week (CW20)', () => {
    // Fri May 8, 1am ET (UTC-4 in May) = Fri May 8, 05:00 UTC
    const ts = new Date(Date.UTC(2026, 4, 8, 5, 0, 0));
    const responses = [
      sub({ ts, client: 'John Doe', standards: STANDARD_NAMES })
    ];
    // Use full window from CW18 to CW20 to include both
    const out = buildClientTimeline('John Doe', responses, {
      currentDate: CURRENT_DATE,
      fromWeek: '2026-CW18',
      toWeek:   '2026-CW20'
    });
    const cw19 = out.find(r => r.weekId === '2026-CW19');
    const cw20 = out.find(r => r.weekId === '2026-CW20');
    assertEqual(cw19.status, 'missing', 'Fri 1am ET is NOT in CW19');
    assertEqual(cw20.status, 'evaluable', 'Fri 1am ET IS in CW20');
  });
}

function suite_windowing() {
  console.log('\n[Windowing options]');

  test('explicit fromWeek/toWeek limits output range', () => {
    const out = buildClientTimeline('John Doe', [], {
      currentDate: CURRENT_DATE,
      fromWeek: '2026-CW17',
      toWeek:   '2026-CW19'
    });
    assertEqual(out.length, 3);
    assertEqual(out[0].weekId, '2026-CW17');
    assertEqual(out[2].weekId, '2026-CW19');
  });

  test('custom lookbackWeeks', () => {
    const out = buildClientTimeline('John Doe', [], {
      currentDate: CURRENT_DATE,
      lookbackWeeks: 4
    });
    assertEqual(out.length, 4);
    assertEqual(out[3].weekId, '2026-CW19');  // most recent closed
  });

  test('fullHistory with no submissions → only toWeek', () => {
    const out = buildClientTimeline('John Doe', [], {
      currentDate: CURRENT_DATE,
      fullHistory: true
    });
    assertEqual(out.length, 1, 'fullHistory + no subs should yield 1 week');
    assertEqual(out[0].weekId, '2026-CW19');
  });

  test('fullHistory expands to earliest submission', () => {
    const responses = [
      sub({ ts: tsInsideWeek(2026, 3, 17), client: 'John Doe', standards: STANDARD_NAMES }),  // CW12-ish
      sub({ ts: tsInsideWeek(2026, 5, 5),  client: 'John Doe', standards: STANDARD_NAMES })   // CW19
    ];
    const out = buildClientTimeline('John Doe', responses, {
      currentDate: CURRENT_DATE,
      fullHistory: true
    });
    assert(out.length >= 8, `expected ~8+ weeks, got ${out.length}`);
    // First week should match earliest submission's week
    const evaluable = out.filter(r => r.status === 'evaluable');
    assertEqual(evaluable.length, 2, 'two evaluable weeks expected');
  });

  test('submissions outside window are dropped', () => {
    const responses = [
      sub({ ts: tsInsideWeek(2026, 5, 5),  client: 'John Doe', standards: [] }),  // CW19, IN window
      sub({ ts: tsInsideWeek(2026, 1, 15), client: 'John Doe', standards: [] })   // CW3-ish, OUT
    ];
    const out = buildClientTimeline('John Doe', responses, {
      currentDate: CURRENT_DATE,
      fromWeek: '2026-CW17',
      toWeek:   '2026-CW19'
    });
    const evaluable = out.filter(r => r.status === 'evaluable');
    assertEqual(evaluable.length, 1, 'only in-window submission counts');
  });

  test('fromWeek > toWeek throws', () => {
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

  test('submission with no timestamp is dropped', () => {
    const responses = [
      sub({ ts: null, client: 'John Doe', standards: STANDARD_NAMES })
    ];
    const out = buildClientTimeline('John Doe', responses, { currentDate: CURRENT_DATE });
    for (const rec of out) {
      assertEqual(rec.status, 'missing');
    }
  });

  test('positional array row is normalized correctly', () => {
    const positional = [
      tsInsideWeek(2026, 5, 5),  // A: timestamp
      'John Doe',                 // B: client
      'No',                       // C: exempt
      '',                         // D: justification
      'Check-In Submission, Training Adherence, Nutrition Adherence, Movement Target, Technique Feedback', // E
      'https://loom.com/x',       // F
      '',                         // G
      'note text'                 // H
    ];
    const out = buildClientTimeline('John Doe', [positional], { currentDate: CURRENT_DATE });
    const cw19 = out.find(r => r.weekId === '2026-CW19');
    assertEqual(cw19.status, 'evaluable');
    assertEqual(cw19.points, 0);
    assertEqual(cw19.notes, 'note text');
  });

  test('whitespace in client name does not break match', () => {
    const responses = [
      sub({ ts: tsInsideWeek(2026, 5, 5), client: 'John Doe', standards: STANDARD_NAMES })
    ];
    const out = buildClientTimeline('  John Doe  ', responses, { currentDate: CURRENT_DATE });
    const cw19 = out.find(r => r.weekId === '2026-CW19');
    assertEqual(cw19.status, 'evaluable');
  });

  test('case-sensitive client match (mismatched case → no match)', () => {
    const responses = [
      sub({ ts: tsInsideWeek(2026, 5, 5), client: 'john doe', standards: STANDARD_NAMES })
    ];
    const out = buildClientTimeline('John Doe', responses, { currentDate: CURRENT_DATE });
    const cw19 = out.find(r => r.weekId === '2026-CW19');
    assertEqual(cw19.status, 'missing', 'lowercase should not match capitalized');
  });

  test('throws on non-string clientName', () => {
    let threw = false;
    try { buildClientTimeline(null, []); } catch (e) { threw = true; }
    assert(threw, 'should throw on null clientName');
  });

  test('throws on non-array formResponses', () => {
    let threw = false;
    try { buildClientTimeline('John Doe', 'not-an-array'); } catch (e) { threw = true; }
    assert(threw, 'should throw on non-array formResponses');
  });
}

function suite_endToEndScenario() {
  console.log('\n[End-to-end scenario — P2 Nutrition pattern]');

  test('Standards v3.3 example: 4 nutrition fails with exempt in middle', () => {
    // Week 1 nut fails / Week 2 nut fails / Week 3 exempt / Week 4 nut fails / Week 5 nut fails
    // Maps to CW15..CW19 in our test calendar
    const baseStandards = ['Check-In Submission', 'Training Adherence', 'Movement Target', 'Technique Feedback'];
    const responses = [
      sub({ ts: tsInsideWeek(2026, 4, 7),  client: 'John Doe', standards: baseStandards }),  // CW15 (Apr 3-9)
      sub({ ts: tsInsideWeek(2026, 4, 14), client: 'John Doe', standards: baseStandards }),  // CW16 (Apr 10-16)
      sub({ ts: tsInsideWeek(2026, 4, 21), client: 'John Doe', exempt: 'Yes', justification: 'Travel' }), // CW17
      sub({ ts: tsInsideWeek(2026, 4, 28), client: 'John Doe', standards: baseStandards }),  // CW18
      sub({ ts: tsInsideWeek(2026, 5, 5),  client: 'John Doe', standards: baseStandards })   // CW19
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

    // Sanity for downstream P2: 4 evaluable Nutrition fails with one exempt skipped in the middle.
    const evalWithNutritionFail = out.filter(r =>
      r.status === 'evaluable' && r.failedStandards.includes('Nutrition Adherence')
    );
    assertEqual(evalWithNutritionFail.length, 4, 'P2 should see 4 Nutrition fails');
  });
}

// ---------------------------------------------------------------------------
// Public runner
// ---------------------------------------------------------------------------

export function runTimelineTests() {
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
  console.log(`Passed: ${results.passed}`);
  console.log(`Failed: ${results.failed}`);
  if (results.failed > 0) {
    console.log('\nFailures:');
    for (const f of results.failures) {
      console.log(`  - ${f.name}: ${f.error.message}`);
    }
  }
  return results;
}

// Auto-run if loaded directly in browser
if (typeof window !== 'undefined' && window.location && window.location.search.includes('autorun')) {
  runTimelineTests();
}
