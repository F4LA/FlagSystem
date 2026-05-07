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
 * Dependencies: ./coaching-week.js
 *
 * Roster-agnostic. Caller is responsible for filtering to active clients.
 * HC Actions are NOT consumed here — they are layered in by 3e (color/black flag).
 */

import {
  coachingWeekOf,
  coachingWeekRange,
  closedCoachingWeek,
  previousCoachingWeek,
  nextCoachingWeek,
  coachingWeeksBetween,
  compareCoachingWeeks
} from './coaching-week.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * The 5 Minimum Standards and their failure point values (Standards v3.3).
 * Order matters for stable sorting in failedStandards / passedStandards arrays.
 */
const STANDARDS = [
  { name: 'Check-In Submission',  points: 5 },
  { name: 'Training Adherence',   points: 2 },
  { name: 'Nutrition Adherence',  points: 2 },
  { name: 'Movement Target',      points: 2 },
  { name: 'Technique Feedback',   points: 1 }
];

const STANDARD_NAMES = STANDARDS.map(s => s.name);

/**
 * Form Q4 checklist option labels. The form stores these as a comma-separated
 * string in column E of the response sheet. We match them tolerantly.
 *
 * The form labels include qualifiers (e.g. "Training Adherence (≥75% of sessions)")
 * but the standard name is the part before the parenthesis. We canonicalize.
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

/**
 * Default lookback window. Matches dashboard's 16-week data window (TDD §8.4),
 * which covers max pathway length (5w) + Black flag counter (6w) with margin.
 */
const DEFAULT_LOOKBACK_WEEKS = 16;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Normalize a single form-response row into a consistent shape, regardless of
 * whether it arrived as an object with named keys or as a positional array
 * (raw sheet row). Returns null if the row is not for this client.
 *
 * Expected named keys (preferred):
 *   timestamp | client | exempt | exemptJustification | standardsCompleted | loomLink | callRequested | notes
 *
 * Positional fallback (Google Sheets columns A-H):
 *   [Timestamp, Client, Exempt(Y/N), Exempt Justification, Standards CSV, Loom, Call Q6, Notes]
 */
function normalizeSubmission(row) {
  if (row == null) return null;

  // Positional sheet row (array)
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

  // Object with named keys
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

/**
 * Parse Q4 (Standards completed this week) which is stored as a comma-separated
 * list in the sheet, or may arrive as an array. Returns canonicalized standard
 * names. Empty input means "all failed" per form spec.
 */
function parseStandardsList(v) {
  if (v == null) return [];
  const items = Array.isArray(v)
    ? v
    : String(v).split(',');
  const out = [];
  for (const item of items) {
    const trimmed = String(item).trim();
    if (trimmed === '') continue;
    const canonical = Q4_LABEL_TO_STANDARD[trimmed];
    if (canonical) {
      out.push(canonical);
    }
    // Unknown labels are silently dropped. The dashboard surfaces data quality
    // issues elsewhere; the timeline builder is not the right layer to throw.
  }
  return out;
}

/**
 * Parse a timestamp into a Date. Accepts:
 *   - Date objects (passed through)
 *   - ISO strings
 *   - Google Sheets serial numbers (days since 1899-12-30)
 *   - Common sheet display strings ("5/7/2026 14:30:00")
 * Returns null on failure.
 */
function parseTimestamp(v) {
  if (v == null) return null;
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v;

  if (typeof v === 'number') {
    // Google Sheets serial: days since 1899-12-30 UTC
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

/**
 * Match a submission's client field against the requested client name.
 * Trim + case-sensitive (per Form & Sheet Reference: dropdown is populated
 * from roster, so spelling is guaranteed identical).
 */
function matchesClient(submission, clientName) {
  if (!submission || submission.client == null) return false;
  return submission.client === clientName.trim();
}

/**
 * Derive the per-week facts from a single (already-chosen) submission.
 * Used when a week is evaluable. Returns the subset of WeekRecord fields that
 * depend on submission content.
 */
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
    points,
    failedStandards,
    passedStandards,
    callRequested: submission.callRequested,
    notes:         submission.notes,
    loomLink:      submission.loomLink
  };
}

/**
 * Choose the canonical submission for a week when multiple exist.
 * Last-wins rule: the submission with the latest timestamp.
 * Submissions without a parseable timestamp are pushed to the bottom.
 */
function chooseCanonical(submissions) {
  return submissions.slice().sort((a, b) => {
    const ta = a.timestamp ? a.timestamp.getTime() : -Infinity;
    const tb = b.timestamp ? b.timestamp.getTime() : -Infinity;
    return tb - ta;  // descending
  })[0];
}

/**
 * Determine the status of a week given its submissions.
 *   - Any exempt submission → "exempt"   (exempt overrides everything)
 *   - One or more non-exempt submissions → "evaluable"
 *   - Zero submissions → "missing"
 */
function weekStatusOf(submissions) {
  if (submissions.length === 0) return 'missing';
  if (submissions.some(s => s.exempt === true)) return 'exempt';
  return 'evaluable';
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Build an ordered, gap-filled timeline of WeekRecords for a single client.
 *
 * @param {string} clientName - Full name as stored in the form (e.g. "John Doe")
 * @param {Array}  formResponses - Array of raw or normalized form-response rows
 * @param {object} [options]
 * @param {string} [options.fromWeek]    - Coaching Week ID, e.g. "2026-CW10"
 * @param {string} [options.toWeek]      - Coaching Week ID, e.g. "2026-CW17"
 * @param {Date}   [options.currentDate] - Defaults to new Date()
 * @param {boolean}[options.fullHistory] - If true, fromWeek = earliest submission
 * @param {number} [options.lookbackWeeks] - Override default 16-week window
 *
 * @returns {Array<WeekRecord>} ordered oldest → newest, no gaps
 *
 * Behavior:
 *   - Defaults: toWeek = closedCoachingWeek(currentDate),
 *               fromWeek = previousCoachingWeek(toWeek, lookbackWeeks - 1)
 *   - fullHistory=true: fromWeek = Coaching Week of earliest matching submission
 *     (or toWeek if no submissions exist)
 *   - Multiple submissions in same week: last-wins (latest timestamp), all
 *     submissions preserved in rawSubmissions
 *   - Exempt overrides evaluable in the same week
 *   - Submissions outside [fromWeek, toWeek] are dropped
 *   - Submissions with unparseable timestamps are dropped
 */
export function buildClientTimeline(clientName, formResponses, options = {}) {
  if (typeof clientName !== 'string' || clientName.trim() === '') {
    throw new Error('buildClientTimeline: clientName must be a non-empty string');
  }
  if (!Array.isArray(formResponses)) {
    throw new Error('buildClientTimeline: formResponses must be an array');
  }

  const currentDate    = options.currentDate || new Date();
  const lookbackWeeks  = options.lookbackWeeks || DEFAULT_LOOKBACK_WEEKS;
  const trimmedName    = clientName.trim();

  // Step 1: filter and normalize submissions for this client
  const clientSubs = [];
  for (const row of formResponses) {
    const sub = normalizeSubmission(row);
    if (!sub) continue;
    if (!matchesClient(sub, trimmedName)) continue;
    if (!sub.timestamp) continue;  // can't assign to a week without a timestamp
    clientSubs.push(sub);
  }

  // Step 2: assign each submission to its Coaching Week, bucketed
  const weekBuckets = new Map();  // weekId → [submission, ...]
  for (const sub of clientSubs) {
    const weekId = coachingWeekOf(sub.timestamp);
    if (!weekBuckets.has(weekId)) weekBuckets.set(weekId, []);
    weekBuckets.get(weekId).push(sub);
  }

  // Step 3: resolve window [fromWeek, toWeek]
  const toWeek = options.toWeek || closedCoachingWeek(currentDate);

  let fromWeek;
  if (options.fromWeek) {
    fromWeek = options.fromWeek;
  } else if (options.fullHistory) {
    if (clientSubs.length === 0) {
      fromWeek = toWeek;
    } else {
      // Earliest submission's week
      let earliestWeekId = null;
      for (const sub of clientSubs) {
        const wId = coachingWeekOf(sub.timestamp);
        if (earliestWeekId === null || compareCoachingWeeks(wId, earliestWeekId) < 0) {
          earliestWeekId = wId;
        }
      }
      fromWeek = earliestWeekId;
      // Don't extend past toWeek
      if (compareCoachingWeeks(fromWeek, toWeek) > 0) {
        fromWeek = toWeek;
      }
    }
  } else {
    // Default: lookbackWeeks ending at toWeek (inclusive)
    fromWeek = previousCoachingWeek(toWeek, lookbackWeeks - 1);
  }

  // Validate window
  if (compareCoachingWeeks(fromWeek, toWeek) > 0) {
    throw new Error(
      `buildClientTimeline: fromWeek (${fromWeek}) is after toWeek (${toWeek})`
    );
  }

  // Step 4: enumerate every week in window and build records
  const weekIds = coachingWeeksBetween(fromWeek, toWeek);
  const records = [];

  for (let i = 0; i < weekIds.length; i++) {
    const weekId = weekIds[i];
    const subs = weekBuckets.get(weekId) || [];
    const status = weekStatusOf(subs);
    const range = coachingWeekRange(weekId);

    const record = {
      weekId,
      weekIndex: i,
      status,
      weekStart: range.start,
      weekEnd:   range.end,
      submissionCount: subs.length,
      rawSubmissions:  subs.map(s => s._raw)
    };

    if (status === 'evaluable') {
      const canonical = chooseCanonical(subs.filter(s => !s.exempt));
      Object.assign(record, deriveWeekFacts(canonical));
    } else if (status === 'exempt') {
      // If multiple exempt rows exist, take the latest one's justification
      const exemptSubs = subs.filter(s => s.exempt === true);
      const canonicalExempt = chooseCanonical(exemptSubs);
      record.exemptJustification = canonicalExempt.exemptJustification;
    }
    // 'missing' status: no extra fields populated

    records.push(record);
  }

  return records;
}

// Re-export helpers in case downstream layers want to reuse them
// (e.g. P2 evaluator may want deriveWeekFacts for hypothetical re-scoring).
export { deriveWeekFacts, weekStatusOf, STANDARDS, STANDARD_NAMES };
