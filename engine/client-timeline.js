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
 * client-timeline.js
 *
 * Step 3b of the Pathway Calculation Engine.
 *
 * Builds an ordered, gap-filled per-week timeline for a single client from raw
 * Flag System form responses. Each week in the output is a self-contained
 * record that downstream pathway evaluators (3c, 3d) can iterate over without
 * doing any date math.
 *
 * IMPORTANT — Coaching Week, not ISO week.
 * Submissions are assigned to the Coaching Week (Fri 00:00 ET → Thu 23:59:59 ET)
 * of their submission timestamp. This OVERRIDES TDD v1.0 §4.1 and Standards
 * v3.3 §4.1, which both still say "ISO week of submission timestamp". Those
 * documents will be reconciled in v3.4 after the engine is complete.
 *
 * Dependencies: coaching-week.js (must be loaded first; exposes window.CoachingWeek)
 *
 * Roster-agnostic. Caller is responsible for filtering to active clients.
 * HC Actions are NOT consumed here — they are layered in by 3e (color/black flag).
 *
 * Loading pattern: UMD. In browsers, attach this script after coaching-week.js
 * via <script src="...">. The module exposes window.ClientTimeline.
 */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./coaching-week.js'));
  } else {
    if (!root.CoachingWeek) {
      throw new Error(
        'client-timeline.js: window.CoachingWeek not found. ' +
        'Load coaching-week.js before this module.'
      );
    }
    root.ClientTimeline = factory(root.CoachingWeek);
  }
}(typeof self !== 'undefined' ? self : this, function (CoachingWeek) {
  'use strict';

  const coachingWeekOf        = CoachingWeek.coachingWeekOf;
  const coachingWeekRange     = CoachingWeek.coachingWeekRange;
  const closedCoachingWeek    = CoachingWeek.closedCoachingWeek;
  const previousCoachingWeek  = CoachingWeek.previousCoachingWeek;
  const coachingWeeksBetween  = CoachingWeek.coachingWeeksBetween;
  const compareCoachingWeeks  = CoachingWeek.compareCoachingWeeks;

  // ---------------------------------------------------------------------------
  // Constants
  // ---------------------------------------------------------------------------

  const STANDARDS = [
    { name: 'Check-In Submission',  points: 5 },
    { name: 'Training Adherence',   points: 2 },
    { name: 'Nutrition Adherence',  points: 2 },
    { name: 'Movement Target',      points: 2 },
    { name: 'Technique Feedback',   points: 1 }
  ];

  const STANDARD_NAMES = STANDARDS.map(function (s) { return s.name; });

  /**
   * Form Q4 checklist option labels. Both bare names and full form labels
   * (with parentheticals) are accepted.
   */
  const Q4_LABEL_TO_STANDARD = {
    'Check-In Submission':                              'Check-In Submission',
    'Training Adherence':                               'Training Adherence',
    'Training Adherence (≥75% of sessions)':            'Training Adherence',
    'Nutrition Adherence':                              'Nutrition Adherence',
    'Nutrition Adherence (≥5 of 7 days)':               'Nutrition Adherence',
    'Movement Target':                                  'Movement Target',
    'Technique Feedback':                               'Technique Feedback',
    'Technique Feedback (≥3 videos)':                   'Technique Feedback'
  };

  const DEFAULT_LOOKBACK_WEEKS = 16;

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  function trimOrNull(v) {
    if (v == null) return null;
    const s = String(v).trim();
    return s === '' ? null : s;
  }

  function parseYesNo(v) {
    if (v == null) return false;
    const s = String(v).trim().toLowerCase();
    return s === 'yes' || s === 'y' || s === 'true';
  }

  function parseStandardsList(v) {
    if (v == null) return [];
    const items = Array.isArray(v) ? v : String(v).split(',');
    const out = [];
    for (const item of items) {
      const trimmed = String(item).trim();
      if (trimmed === '') continue;
      const canonical = Q4_LABEL_TO_STANDARD[trimmed];
      if (canonical) out.push(canonical);
    }
    return out;
  }

  /**
   * Parse a timestamp into a Date. Accepts Date objects, ISO strings,
   * Google Sheets serial numbers, and common display strings.
   */
  function parseTimestamp(v) {
    if (v == null) return null;
    if (v instanceof Date) return isNaN(v.getTime()) ? null : v;
    if (typeof v === 'number') {
      const ms = (v - 25569) * 86400 * 1000;
      const d = new Date(ms);
      return isNaN(d.getTime()) ? null : d;
    }
    if (typeof v === 'string') {
      const d = new Date(v);
      return isNaN(d.getTime()) ? null : d;
    }
    return null;
  }

  function normalizeSubmission(row) {
    if (row == null) return null;

    if (Array.isArray(row)) {
      return {
        timestamp:           parseTimestamp(row[0]),
        client:              trimOrNull(row[1]),
        exempt:              parseYesNo(row[2]),
        exemptJustification: trimOrNull(row[3]),
        standardsCompleted:  parseStandardsList(row[4]),
        loomLink:            trimOrNull(row[5]),
        callRequested:       trimOrNull(row[6]),
        notes:               trimOrNull(row[7]),
        _raw:                row
      };
    }

    return {
      timestamp:           parseTimestamp(row.timestamp),
      client:              trimOrNull(row.client),
      exempt:              parseYesNo(row.exempt),
      exemptJustification: trimOrNull(row.exemptJustification),
      standardsCompleted:  parseStandardsList(row.standardsCompleted),
      loomLink:            trimOrNull(row.loomLink),
      callRequested:       trimOrNull(row.callRequested),
      notes:               trimOrNull(row.notes),
      _raw:                row
    };
  }

  function matchesClient(submission, clientName) {
    if (!submission || submission.client == null) return false;
    return submission.client === clientName.trim();
  }

  function deriveWeekFacts(submission) {
    const completed = new Set(submission.standardsCompleted || []);
    const failedStandards = [];
    const passedStandards = [];
    let points = 0;

    for (const std of STANDARDS) {
      if (completed.has(std.name)) {
        passedStandards.push(std.name);
      } else {
        failedStandards.push(std.name);
        points += std.points;
      }
    }

    return {
      points: points,
      failedStandards: failedStandards,
      passedStandards: passedStandards,
      callRequested: submission.callRequested,
      notes:         submission.notes,
      loomLink:      submission.loomLink
    };
  }

  function chooseCanonical(submissions) {
    return submissions.slice().sort(function (a, b) {
      const ta = a.timestamp ? a.timestamp.getTime() : -Infinity;
      const tb = b.timestamp ? b.timestamp.getTime() : -Infinity;
      return tb - ta;
    })[0];
  }

  function weekStatusOf(submissions) {
    if (submissions.length === 0) return 'missing';
    if (submissions.some(function (s) { return s.exempt === true; })) return 'exempt';
    return 'evaluable';
  }

  // ---------------------------------------------------------------------------
  // Public function
  // ---------------------------------------------------------------------------

  function buildClientTimeline(clientName, formResponses, options) {
    options = options || {};

    if (typeof clientName !== 'string' || clientName.trim() === '') {
      throw new Error('buildClientTimeline: clientName must be a non-empty string');
    }
    if (!Array.isArray(formResponses)) {
      throw new Error('buildClientTimeline: formResponses must be an array');
    }

    const currentDate   = options.currentDate || new Date();
    const lookbackWeeks = options.lookbackWeeks || DEFAULT_LOOKBACK_WEEKS;
    const trimmedName   = clientName.trim();

    // Step 1: filter and normalize
    const clientSubs = [];
    for (const row of formResponses) {
      const sub = normalizeSubmission(row);
      if (!sub) continue;
      if (!matchesClient(sub, trimmedName)) continue;
      if (!sub.timestamp) continue;
      clientSubs.push(sub);
    }

    // Step 2: bucket by Coaching Week
    const weekBuckets = new Map();
    for (const sub of clientSubs) {
      const weekId = coachingWeekOf(sub.timestamp);
      if (!weekBuckets.has(weekId)) weekBuckets.set(weekId, []);
      weekBuckets.get(weekId).push(sub);
    }

    // Step 3: resolve window
    const toWeek = options.toWeek || closedCoachingWeek(currentDate);

    let fromWeek;
    if (options.fromWeek) {
      fromWeek = options.fromWeek;
    } else if (options.fullHistory) {
      if (clientSubs.length === 0) {
        fromWeek = toWeek;
      } else {
        let earliestWeekId = null;
        for (const sub of clientSubs) {
          const wId = coachingWeekOf(sub.timestamp);
          if (earliestWeekId === null || compareCoachingWeeks(wId, earliestWeekId) < 0) {
            earliestWeekId = wId;
          }
        }
        fromWeek = earliestWeekId;
        if (compareCoachingWeeks(fromWeek, toWeek) > 0) {
          fromWeek = toWeek;
        }
      }
    } else {
      fromWeek = previousCoachingWeek(toWeek, lookbackWeeks - 1);
    }

    if (compareCoachingWeeks(fromWeek, toWeek) > 0) {
      throw new Error(
        'buildClientTimeline: fromWeek (' + fromWeek + ') is after toWeek (' + toWeek + ')'
      );
    }

    // Step 4: build records
    const weekIds = coachingWeeksBetween(fromWeek, toWeek);
    const records = [];

    for (let i = 0; i < weekIds.length; i++) {
      const weekId = weekIds[i];
      const subs = weekBuckets.get(weekId) || [];
      const status = weekStatusOf(subs);
      const range = coachingWeekRange(weekId);

      const record = {
        weekId: weekId,
        weekIndex: i,
        status: status,
        weekStart: range.start,
        weekEnd:   range.end,
        submissionCount: subs.length,
        rawSubmissions:  subs.map(function (s) { return s._raw; })
      };

      if (status === 'evaluable') {
        const evaluableSubs = subs.filter(function (s) { return !s.exempt; });
        const canonical = chooseCanonical(evaluableSubs);
        Object.assign(record, deriveWeekFacts(canonical));
      } else if (status === 'exempt') {
        const exemptSubs = subs.filter(function (s) { return s.exempt === true; });
        const canonicalExempt = chooseCanonical(exemptSubs);
        record.exemptJustification = canonicalExempt.exemptJustification;
      }

      records.push(record);
    }

    return records;
  }

  // ---------------------------------------------------------------------------
  // Public surface
  // ---------------------------------------------------------------------------

  return {
    buildClientTimeline: buildClientTimeline,
    deriveWeekFacts: deriveWeekFacts,
    weekStatusOf: weekStatusOf,
    STANDARDS: STANDARDS,
    STANDARD_NAMES: STANDARD_NAMES,
    _internal: {
      normalizeSubmission: normalizeSubmission,
      parseStandardsList: parseStandardsList,
      parseTimestamp: parseTimestamp,
      chooseCanonical: chooseCanonical
    }
  };
}));
