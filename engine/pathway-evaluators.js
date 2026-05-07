/**
 * Flag System Pathway Engine — Step 3d
 * Pathway Evaluators (P1, P2, P3)
 *
 * Pure evaluators that consume a client timeline (output of Step 3b)
 * and return the current state of each pathway as of the most recently
 * closed Coaching Week (or any other endIndex passed via options).
 *
 * Evaluators do NOT walk timelines themselves. That responsibility lives
 * in Step 3c (ConsecutiveEvaluable). They DO know pathway-specific logic:
 * trigger thresholds, expected actions, reset conditions, and the data
 * needed to populate Slack templates.
 *
 * What this module does NOT do:
 *   - Determine Red color (depends on callRequested signal, wired in 3e)
 *   - Determine Black flag (counter logic in 3e)
 *   - Apply shortest-timeline pathway priority (presentation concern)
 *
 * UMD pattern. Exposes window.PathwayEvaluators in the browser.
 *
 * Authoritative reference: Flag System Dashboard TDD v1.0, Section 4.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory(require("./consecutive-evaluable.js"));
  } else {
    root.PathwayEvaluators = factory(root.ConsecutiveEvaluable);
  }
})(typeof self !== "undefined" ? self : this, function (ConsecutiveEvaluable) {
  "use strict";

  if (!ConsecutiveEvaluable) {
    throw new Error(
      "PathwayEvaluators requires ConsecutiveEvaluable (Step 3c) to be loaded first"
    );
  }

  var countConsecutiveFromEnd = ConsecutiveEvaluable.countConsecutiveFromEnd;
  var takeConsecutiveFromEnd = ConsecutiveEvaluable.takeConsecutiveFromEnd;
  var lastNEvaluableMatch = ConsecutiveEvaluable.lastNEvaluableMatch;

  // ---------------------------------------------------------------------------
  // Constants
  //
  // Standard names match the WeekRecord output of Step 3b
  // (client-timeline.js). Display mapping to short names used in Slack
  // templates (e.g. "Nutrition Adherence" -> "Nutrition") is a presentation
  // concern handled in 3e / UI, not here.
  // ---------------------------------------------------------------------------
  var STANDARDS = [
    "Check-In Submission",
    "Training Adherence",
    "Nutrition Adherence",
    "Movement Target",
    "Technique Feedback"
  ];

  // Trigger thresholds per pathway (TDD v1.0 §4.2).
  // Each threshold is the streak length at which the corresponding action
  // becomes due for the most recently closed Coaching Week.
  var P1_NOTIFICATION = 1; // streak 1  -> Yellow + Notification
  var P1_WARNING = 2;      // streak 2  -> Yellow + Warning
  var P1_RED_WINDOW = 3;   // streak 3+ -> Red threshold reached

  var P2_NOTIFICATION = 2;
  var P2_WARNING = 3;
  var P2_RED_WINDOW = 4;

  var P3_NOTIFICATION = 3;
  var P3_WARNING = 4;
  var P3_RED_WINDOW = 5;

  var RESET_LENGTH = 2; // 2 consecutive evaluable clean weeks close any pathway

  // ---------------------------------------------------------------------------
  // Predicates
  // ---------------------------------------------------------------------------

  function p1Fail(wr) {
    return wr.points >= 5;
  }
  function p1Clean(wr) {
    return wr.points < 5;
  }

  function p2FailFor(standard) {
    return function (wr) {
      return wr.failedStandards.indexOf(standard) !== -1;
    };
  }
  function p2CleanFor(standard) {
    return function (wr) {
      return wr.failedStandards.indexOf(standard) === -1;
    };
  }

  function p3Fail(wr) {
    return wr.failedStandards.length > 0;
  }
  function p3Clean(wr) {
    return wr.failedStandards.length === 0;
  }

  // ---------------------------------------------------------------------------
  // Action classifier
  //
  // Maps a streakLength to the expected action for the current Coaching Week,
  // given the pathway's trigger thresholds.
  //
  // Returns null when the streak has not yet reached the Notification
  // threshold (no action due, pathway not yet active).
  // ---------------------------------------------------------------------------
  function classifyAction(streakLength, notif, warn, red) {
    if (streakLength >= red) return "RedWindow";
    if (streakLength >= warn) return "Warning";
    if (streakLength >= notif) return "Notification";
    return null;
  }

  // ---------------------------------------------------------------------------
  // Template data builder
  //
  // Returns the standards_list_recent / standards_list_previous payload used
  // by Slack templates in 3e.
  //
  // Conventions:
  //   - streakWeeks is in chronological order (oldest -> newest).
  //   - standards_list_recent  = failedStandards of the most recent streak week
  //   - standards_list_previous = failedStandards of the second-most-recent
  //                               streak week, or [] when streak length < 2
  //
  // Returns null when streak is empty (caller decides whether to set null
  // based on Notification trigger reached).
  // ---------------------------------------------------------------------------
  function buildTemplateData(streakWeeks) {
    if (!streakWeeks || streakWeeks.length === 0) {
      return null;
    }
    var lastIdx = streakWeeks.length - 1;
    var recent = streakWeeks[lastIdx].failedStandards.slice();
    var previous =
      streakWeeks.length >= 2
        ? streakWeeks[lastIdx - 1].failedStandards.slice()
        : [];
    return {
      standards_list_recent: recent,
      standards_list_previous: previous
    };
  }

  // ---------------------------------------------------------------------------
  // evaluateP1 — Acute Crisis
  //
  // Streak unit: evaluable week with points >= 5
  // Trigger:    1 streak week  -> Yellow (Notification due)
  //             2 streak weeks -> Yellow (Warning due)
  //             3+ streak weeks -> Red threshold reached (RedWindow)
  // Reset:      2 consecutive evaluable weeks with points < 5
  // ---------------------------------------------------------------------------
  function evaluateP1(timeline, options) {
    var opts = options || {};
    var streakLength = countConsecutiveFromEnd(timeline, p1Fail, opts);
    var streakWeeks =
      streakLength > 0
        ? takeConsecutiveFromEnd(timeline, p1Fail, opts)
        : [];

    var active = streakLength >= P1_NOTIFICATION;
    var expectedAction = classifyAction(
      streakLength,
      P1_NOTIFICATION,
      P1_WARNING,
      P1_RED_WINDOW
    );

    var resetReady = lastNEvaluableMatch(timeline, RESET_LENGTH, p1Clean, opts);

    var templateData = active ? buildTemplateData(streakWeeks) : null;

    return {
      pathway: "P1",
      active: active,
      streakLength: streakLength,
      weekOfPathway: streakLength,
      expectedAction: expectedAction,
      resetReady: resetReady,
      streakWeeks: streakWeeks,
      templateData: templateData
    };
  }

  // ---------------------------------------------------------------------------
  // evaluateP2 — Same Standard Fails Repeatedly
  //
  // Per-standard evaluation. Returns ARRAY (one entry per standard with
  // streakLength >= 1). Standards with no current activity are filtered out.
  //
  // Streak unit (per standard X): evaluable week where X is in failedStandards
  // Trigger:    2 streak weeks -> Yellow (Notification due)
  //             3 streak weeks -> Yellow (Warning due)
  //             4+ streak weeks -> Red threshold reached (RedWindow)
  // Reset:      2 consecutive evaluable weeks where standard X did NOT fail
  //
  // Array order matches the STANDARDS constant order (stable, deterministic).
  // ---------------------------------------------------------------------------
  function evaluateP2(timeline, options) {
    var opts = options || {};
    var results = [];

    for (var i = 0; i < STANDARDS.length; i++) {
      var standard = STANDARDS[i];
      var failPred = p2FailFor(standard);
      var streakLength = countConsecutiveFromEnd(timeline, failPred, opts);

      // Filter rule: skip standards with no current activity.
      if (streakLength < 1) {
        continue;
      }

      var streakWeeks = takeConsecutiveFromEnd(timeline, failPred, opts);
      var active = streakLength >= P2_NOTIFICATION;
      var expectedAction = classifyAction(
        streakLength,
        P2_NOTIFICATION,
        P2_WARNING,
        P2_RED_WINDOW
      );

      var resetReady = lastNEvaluableMatch(
        timeline,
        RESET_LENGTH,
        p2CleanFor(standard),
        opts
      );

      var templateData = active ? buildTemplateData(streakWeeks) : null;
      if (templateData) {
        templateData.standard = standard;
      }

      results.push({
        pathway: "P2",
        standard: standard,
        active: active,
        streakLength: streakLength,
        weekOfPathway: streakLength,
        expectedAction: expectedAction,
        resetReady: resetReady,
        streakWeeks: streakWeeks,
        templateData: templateData
      });
    }

    return results;
  }

  // ---------------------------------------------------------------------------
  // evaluateP3 — Persistent Inconsistency
  //
  // Streak unit: evaluable week where failedStandards.length > 0
  //              (any failure, regardless of which standard)
  // Trigger:    3 streak weeks -> Yellow (Notification due)
  //             4 streak weeks -> Yellow (Warning due)
  //             5+ streak weeks -> Red threshold reached (RedWindow)
  // Reset:      2 consecutive evaluable weeks with empty failedStandards
  // ---------------------------------------------------------------------------
  function evaluateP3(timeline, options) {
    var opts = options || {};
    var streakLength = countConsecutiveFromEnd(timeline, p3Fail, opts);
    var streakWeeks =
      streakLength > 0
        ? takeConsecutiveFromEnd(timeline, p3Fail, opts)
        : [];

    var active = streakLength >= P3_NOTIFICATION;
    var expectedAction = classifyAction(
      streakLength,
      P3_NOTIFICATION,
      P3_WARNING,
      P3_RED_WINDOW
    );

    var resetReady = lastNEvaluableMatch(timeline, RESET_LENGTH, p3Clean, opts);

    var templateData = active ? buildTemplateData(streakWeeks) : null;

    return {
      pathway: "P3",
      active: active,
      streakLength: streakLength,
      weekOfPathway: streakLength,
      expectedAction: expectedAction,
      resetReady: resetReady,
      streakWeeks: streakWeeks,
      templateData: templateData
    };
  }

  // ---------------------------------------------------------------------------
  // evaluateAllPathways
  //
  // Convenience umbrella. Returns the three evaluator outputs in one call,
  // sharing the same options for endIndex / maxLookback consistency.
  // ---------------------------------------------------------------------------
  function evaluateAllPathways(timeline, options) {
    return {
      p1: evaluateP1(timeline, options),
      p2: evaluateP2(timeline, options),
      p3: evaluateP3(timeline, options)
    };
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------
  return {
    STANDARDS: STANDARDS,
    evaluateP1: evaluateP1,
    evaluateP2: evaluateP2,
    evaluateP3: evaluateP3,
    evaluateAllPathways: evaluateAllPathways
  };
});
