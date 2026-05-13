/**
 * Flag System Dashboard — Coach Diagnostics Aggregators (Tab 3)
 *
 * Pure aggregation functions for Tab 3: Coach Diagnostics. These functions
 * answer the three diagnostic questions Tab 3 is designed for:
 *
 *   1. Standard Failure Distribution — Which standards does this coach's
 *      clients fail most often? (Identifies coach training needs.)
 *
 *   2. Client Rotation Index — Are this coach's flags coming from many
 *      clients, or are they concentrated in a few? (Identifies whether
 *      the problem is the coach or the client mix.)
 *
 *   3. Pathway Chronicity — How long are this coach's clients staying in
 *      each pathway, and how is that trending over time? (Identifies
 *      whether the coach needs a 1:1 outside of Coach Pulse.)
 *
 * Design principles:
 *   - PURE FUNCTIONS. No DOM, no fetching, no side effects. Unit-testable.
 *   - INSTANCE COUNTING. Component 1 counts every week-failure (a client
 *     failing Nutrition 5 weeks in a row = 5 flags on Nutrition), not
 *     unique clients. Confirmed with HC, May 2026.
 *   - HISTORICAL RECONSTRUCTION. Component 3 reconstructs past pathway
 *     states by calling PathwayEngine.calculateClientState with rewound
 *     currentDate values. No persistent snapshots are needed because
 *     formResponses already contains 10+ months of migrated history.
 *   - ROSTER-DRIVEN FILTERING. The roster passed in is the post-filter
 *     roster (clients of excluded coaches already removed by
 *     state-builder). All filtering of formResponses/hcActions for a
 *     given coach happens via roster lookups, never by inferring coach
 *     from the form data itself (which doesn't carry coach info).
 *
 * Dependencies (must be loaded before this module):
 *   - PathwayEngine    (for Component 3 historical reconstruction)
 *   - PathwayEvaluators (for STANDARDS constant)
 *   - ClientTimeline   (for normalizing form responses into week records)
 *   - CoachingWeek     (for week math when computing daysBack windows)
 *
 * UMD pattern. Exposes window.CoachDiagnosticsAggregators in the browser.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory(
      require("./pathway-engine.js"),
      require("./pathway-evaluators.js"),
      require("./client-timeline.js"),
      require("./coaching-week.js")
    );
  } else {
    root.CoachDiagnosticsAggregators = factory(
      root.PathwayEngine,
      root.PathwayEvaluators,
      root.ClientTimeline,
      root.CoachingWeek
    );
  }
})(typeof self !== "undefined" ? self : this, function (
  PathwayEngine,
  PathwayEvaluators,
  ClientTimeline,
  CoachingWeek
) {
  "use strict";

  if (!PathwayEngine) {
    throw new Error("CoachDiagnosticsAggregators requires PathwayEngine");
  }
  if (!PathwayEvaluators) {
    throw new Error("CoachDiagnosticsAggregators requires PathwayEvaluators");
  }
  if (!ClientTimeline) {
    throw new Error("CoachDiagnosticsAggregators requires ClientTimeline");
  }
  if (!CoachingWeek) {
    throw new Error("CoachDiagnosticsAggregators requires CoachingWeek");
  }

  var STANDARDS = PathwayEvaluators.STANDARDS;

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  function toDate(value) {
    if (!value) return null;
    if (value instanceof Date) return isNaN(value.getTime()) ? null : value;
    var d = new Date(value);
    return isNaN(d.getTime()) ? null : d;
  }

  function normalize(s) {
    return String(s || "").trim().toLowerCase();
  }

  /**
   * Build a Set of client names assigned to the given coach in the roster.
   * Roster entries: { client, coach }. Match is case-insensitive and
   * trim-tolerant on both fields. Returns a Set of normalized client names.
   */
  function clientsForCoach(roster, coachName) {
    var target = normalize(coachName);
    var set = new Set();
    if (!Array.isArray(roster) || !target) return set;
    for (var i = 0; i < roster.length; i++) {
      var entry = roster[i];
      if (!entry) continue;
      if (normalize(entry.coach) === target) {
        set.add(normalize(entry.client));
      }
    }
    return set;
  }

  /**
   * Build a map of normalized client name -> coach name from the roster.
   * Used for "assign all historical flags to the client's CURRENT coach"
   * (option A from the TDD), which is what Tab 3 wants because the question
   * is "what is THIS coach's current diagnostic picture", not "who owned
   * the client when the flag happened".
   */
  function clientToCoachMap(roster) {
    var map = new Map();
    if (!Array.isArray(roster)) return map;
    for (var i = 0; i < roster.length; i++) {
      var entry = roster[i];
      if (!entry || !entry.client || !entry.coach) continue;
      map.set(normalize(entry.client), entry.coach);
    }
    return map;
  }

  /**
   * Convert "days back from currentDate" into a cutoff Date. Submissions
   * with timestamps strictly before the cutoff are excluded. currentDate
   * defaults to now if not provided.
   */
  function cutoffDate(daysBack, currentDate) {
    var now = toDate(currentDate) || new Date();
    var cutoff = new Date(now.getTime());
    cutoff.setDate(cutoff.getDate() - daysBack);
    return cutoff;
  }

  /**
   * Extract a normalized submission from a raw form row. Reuses the
   * canonical normalizer in client-timeline so the field shape is
   * identical to what the engine sees. Returns null if normalization
   * fails or the row is unusable.
   */
  function normalizeFormRow(row) {
    if (!ClientTimeline._internal || !ClientTimeline._internal.normalizeSubmission) {
      // Fallback: bare minimum extraction. Shouldn't happen with the
      // current build but we don't want a hard crash.
      return null;
    }
    var sub = ClientTimeline._internal.normalizeSubmission(row);
    if (!sub || !sub.timestamp || !sub.client) return null;
    return sub;
  }

  /**
   * For a single submission, return the list of standards that FAILED in
   * that submission week. Logic mirrors deriveWeekFacts in client-timeline.js:
   *   failedStandards = STANDARDS minus standardsCompleted.
   *
   * Exempt submissions return an empty list (exempt weeks don't fail
   * anything by definition).
   */
  function failedStandardsForSubmission(sub) {
    if (!sub || sub.exempt) return [];
    var completed = new Set(sub.standardsCompleted || []);
    var failed = [];
    for (var i = 0; i < STANDARDS.length; i++) {
      if (!completed.has(STANDARDS[i])) {
        failed.push(STANDARDS[i]);
      }
    }
    return failed;
  }

  // ---------------------------------------------------------------------------
  // Function 1: calculateStandardDistribution
  //
  // Counts failed-standard INSTANCES (not unique clients) across all
  // submissions from clients of the given coach, within the lookback window.
  //
  // Returns:
  //   {
  //     totalFlags: number,
  //     byStandard: [
  //       { standard, count, percentage, clients: [{ clientName, count }] },
  //       ...sorted by count descending
  //     ]
  //   }
  //
  // The `clients` array on each standard powers the Component 1 drill-down
  // (click a bar -> see which clients contributed).
  // ---------------------------------------------------------------------------
  function calculateStandardDistribution(formResponses, roster, coachName, daysBack, options) {
    var opts = options || {};
    var cutoff = cutoffDate(daysBack || 90, opts.currentDate);
    var coachClients = clientsForCoach(roster, coachName);

    // standard -> total count
    var counts = Object.create(null);
    // standard -> Map(clientName -> count)
    var clientBreakdown = Object.create(null);
    for (var s = 0; s < STANDARDS.length; s++) {
      counts[STANDARDS[s]] = 0;
      clientBreakdown[STANDARDS[s]] = new Map();
    }

    var totalFlags = 0;

    if (!Array.isArray(formResponses)) {
      return { totalFlags: 0, byStandard: emptyByStandard() };
    }

    for (var i = 0; i < formResponses.length; i++) {
      var sub = normalizeFormRow(formResponses[i]);
      if (!sub) continue;
      if (sub.timestamp.getTime() < cutoff.getTime()) continue;
      if (!coachClients.has(normalize(sub.client))) continue;

      var failed = failedStandardsForSubmission(sub);
      if (failed.length === 0) continue;

      for (var j = 0; j < failed.length; j++) {
        var std = failed[j];
        counts[std] += 1;
        totalFlags += 1;
        var cb = clientBreakdown[std];
        var key = sub.client; // preserve original casing for display
        var prior = cb.get(key) || 0;
        cb.set(key, prior + 1);
      }
    }

    var byStandard = STANDARDS.map(function (std) {
      var count = counts[std];
      var pct = totalFlags > 0 ? (count / totalFlags) * 100 : 0;
      var clientsArr = [];
      clientBreakdown[std].forEach(function (n, name) {
        clientsArr.push({ clientName: name, count: n });
      });
      clientsArr.sort(function (a, b) { return b.count - a.count; });
      return {
        standard: std,
        count: count,
        percentage: round1(pct),
        clients: clientsArr
      };
    }).sort(function (a, b) { return b.count - a.count; });

    return {
      totalFlags: totalFlags,
      byStandard: byStandard
    };
  }

  function emptyByStandard() {
    return STANDARDS.map(function (s) {
      return { standard: s, count: 0, percentage: 0, clients: [] };
    });
  }

  // ---------------------------------------------------------------------------
  // Function 2: calculateRotationIndex
  //
  // Measures whether a coach's flags are concentrated in a few clients or
  // distributed across many. Same instance-counting basis as Function 1
  // (a client failing 5 weeks = 5 flags).
  //
  // Returns:
  //   {
  //     totalFlags: number,
  //     uniqueClients: number,
  //     topContributors: [ // top 3
  //       { clientName, flagCount, percentage },
  //       ...
  //     ],
  //     concentrationScore: number,  // % of total flags from top 3
  //     concentrationLevel: "high" | "medium" | "low"
  //   }
  //
  // Thresholds (per TDD §3 Component 2):
  //   > 60%   -> high
  //   30-60%  -> medium
  //   < 30%   -> low
  // ---------------------------------------------------------------------------
  function calculateRotationIndex(formResponses, roster, coachName, daysBack, options) {
    var opts = options || {};
    var cutoff = cutoffDate(daysBack || 90, opts.currentDate);
    var coachClients = clientsForCoach(roster, coachName);

    // clientName (preserving case) -> flag count
    var perClient = new Map();
    var totalFlags = 0;

    if (Array.isArray(formResponses)) {
      for (var i = 0; i < formResponses.length; i++) {
        var sub = normalizeFormRow(formResponses[i]);
        if (!sub) continue;
        if (sub.timestamp.getTime() < cutoff.getTime()) continue;
        if (!coachClients.has(normalize(sub.client))) continue;

        var failedCount = failedStandardsForSubmission(sub).length;
        if (failedCount === 0) continue;

        var prior = perClient.get(sub.client) || 0;
        perClient.set(sub.client, prior + failedCount);
        totalFlags += failedCount;
      }
    }

    var contributors = [];
    perClient.forEach(function (count, name) {
      contributors.push({ clientName: name, flagCount: count });
    });
    contributors.sort(function (a, b) { return b.flagCount - a.flagCount; });

    var top3 = contributors.slice(0, 3).map(function (c) {
      return {
        clientName: c.clientName,
        flagCount: c.flagCount,
        percentage: totalFlags > 0 ? round1((c.flagCount / totalFlags) * 100) : 0
      };
    });

    // Compute concentrationScore from raw flag counts (not by summing
    // already-rounded percentages, which accumulates rounding drift).
    var top3Sum = top3.reduce(function (acc, c) {
      return acc + c.flagCount;
    }, 0);
    var concentrationScore = totalFlags > 0 ? round1((top3Sum / totalFlags) * 100) : 0;

    var concentrationLevel;
    if (totalFlags === 0) {
      concentrationLevel = "low";
    } else if (concentrationScore > 60) {
      concentrationLevel = "high";
    } else if (concentrationScore >= 30) {
      concentrationLevel = "medium";
    } else {
      concentrationLevel = "low";
    }

    return {
      totalFlags: totalFlags,
      uniqueClients: contributors.length,
      topContributors: top3,
      concentrationScore: concentrationScore,
      concentrationLevel: concentrationLevel
    };
  }

  // ---------------------------------------------------------------------------
  // Function 3: calculatePathwayChronicity
  //
  // Returns the current pathway distribution for the coach's clients, plus
  // (optionally) a weekly trend reconstructed from formResponses by calling
  // PathwayEngine.calculateClientState with rewound currentDate values.
  //
  // Signature:
  //   calculatePathwayChronicity(
  //     currentStates,   // output of StateBuilder.buildAll, already filtered to active roster
  //     formResponses,   // raw form rows
  //     hcActions,       // raw HC actions rows
  //     roster,          // post-filter roster
  //     coachName,
  //     opts             // { weeksBack, lookbackWeeks, currentDate }
  //   )
  //
  // Returns:
  //   {
  //     currentState: {
  //       P1: number,
  //       P2: { total: number, byStandard: [{ standard, count }] },
  //       P3: number,
  //       clientsByPathway: {
  //         P1: [clientName, ...],
  //         P2: { <standard>: [clientName, ...], ... },
  //         P3: [clientName, ...]
  //       }
  //     },
  //     trend: {
  //       weeklyActiveByPathway: [
  //         { weekOf: "YYYY-MM-DD", P1, P2, P3 },
  //         ...
  //       ],
  //       avgDuration: { P1, P2, P3 }   // in weeks
  //     },
  //     weeksAnalyzed: number,
  //     weeksAvailable: number          // weeks of trend data actually computable
  //   }
  // ---------------------------------------------------------------------------
  function calculatePathwayChronicity(currentStates, formResponses, hcActions, roster, coachName, opts) {
    opts = opts || {};
    var weeksBack = opts.weeksBack || 12;
    // Look up FlagConfig from the global scope (browser: window.FlagConfig).
    // The factory closure doesn't have access to the UMD `root` variable,
    // so we read it from the runtime global at call time.
    var globalScope = typeof window !== "undefined" ? window
                    : typeof self !== "undefined" ? self
                    : typeof global !== "undefined" ? global
                    : {};
    var lookbackWeeks =
      opts.lookbackWeeks ||
      (globalScope.FlagConfig && globalScope.FlagConfig.LOOKBACK_WEEKS) ||
      16;
    var currentDate = toDate(opts.currentDate) || new Date();

    var coachClients = clientsForCoach(roster, coachName);

    // ---------- Current state from already-built states ----------
    var current = {
      P1: 0,
      P2: { total: 0, byStandard: [] },
      P3: 0,
      clientsByPathway: { P1: [], P2: {}, P3: [] }
    };

    var p2StandardCounts = Object.create(null);

    if (Array.isArray(currentStates)) {
      for (var i = 0; i < currentStates.length; i++) {
        var st = currentStates[i];
        if (!st || !st.clientName) continue;
        if (normalize(st.coach) !== normalize(coachName)) continue;
        if (!coachClients.has(normalize(st.clientName))) continue;

        var ps = st.pathwayStates || {};
        if (ps.p1 && ps.p1.active) {
          current.P1 += 1;
          current.clientsByPathway.P1.push(st.clientName);
        }
        if (Array.isArray(ps.p2)) {
          for (var k = 0; k < ps.p2.length; k++) {
            var p2 = ps.p2[k];
            if (!p2 || !p2.active) continue;
            var standard = p2.standard;
            current.P2.total += 1;
            p2StandardCounts[standard] = (p2StandardCounts[standard] || 0) + 1;
            if (!current.clientsByPathway.P2[standard]) {
              current.clientsByPathway.P2[standard] = [];
            }
            current.clientsByPathway.P2[standard].push(st.clientName);
          }
        }
        if (ps.p3 && ps.p3.active) {
          current.P3 += 1;
          current.clientsByPathway.P3.push(st.clientName);
        }
      }
    }

    current.P2.byStandard = STANDARDS.map(function (std) {
      return { standard: std, count: p2StandardCounts[std] || 0 };
    }).filter(function (e) { return e.count > 0; })
      .sort(function (a, b) { return b.count - a.count; });

    // ---------- Trend by rewinding currentDate ----------
    //
    // For each of the past `weeksBack` weeks, build a snapshot of how many
    // of this coach's clients were in each pathway at the END of that week.
    // We rewind by 7 days per step. The most recent snapshot is the
    // closed coaching week before currentDate; older snapshots step back
    // from there.

    var trendPoints = [];
    var p1Durations = [];
    var p2Durations = [];
    var p3Durations = [];

    // Per-client pathway streak tracking across the trend window. Maps
    // clientName -> { P1: consecutiveWeeksActive, P2: ..., P3: ... }.
    // Each time we see a pathway active for a client in week W, increment;
    // when we see it inactive, push the run length into the durations
    // array (if > 0) and reset to 0.
    var streakState = Object.create(null);

    // Iterate from oldest to newest so streaks accumulate correctly.
    var snapshots = [];
    for (var w = weeksBack - 1; w >= 0; w--) {
      var snapshotDate = new Date(currentDate.getTime());
      snapshotDate.setDate(snapshotDate.getDate() - w * 7);
      snapshots.push(snapshotDate);
    }

    // Build the list of clients this coach is responsible for. Use the
    // roster (post-filter) rather than currentStates so we include clients
    // who may not have an active pathway today but were active in the past.
    var coachClientNames = [];
    if (Array.isArray(roster)) {
      for (var r = 0; r < roster.length; r++) {
        if (roster[r] && normalize(roster[r].coach) === normalize(coachName)) {
          coachClientNames.push(roster[r].client);
        }
      }
    }

    for (var s = 0; s < snapshots.length; s++) {
      var snapDate = snapshots[s];
      var weekLabel = snapshotDate_toMondayISO(snapDate);

      var point = { weekOf: weekLabel, P1: 0, P2: 0, P3: 0 };

      for (var c = 0; c < coachClientNames.length; c++) {
        var clientName = coachClientNames[c];
        var state;
        try {
          state = PathwayEngine.calculateClientState(
            clientName,
            formResponses,
            hcActions,
            { currentDate: snapDate, lookbackWeeks: lookbackWeeks }
          );
        } catch (err) {
          continue; // skip bad rows; same defensive posture as state-builder
        }

        var sps = state.pathwayStates || {};
        var inP1 = !!(sps.p1 && sps.p1.active);
        var inP2 = Array.isArray(sps.p2) && sps.p2.some(function (p) { return p && p.active; });
        var inP3 = !!(sps.p3 && sps.p3.active);

        if (inP1) point.P1 += 1;
        if (inP2) point.P2 += 1;
        if (inP3) point.P3 += 1;

        // Update streaks
        if (!streakState[clientName]) {
          streakState[clientName] = { P1: 0, P2: 0, P3: 0 };
        }
        updateStreak(streakState[clientName], "P1", inP1, p1Durations);
        updateStreak(streakState[clientName], "P2", inP2, p2Durations);
        updateStreak(streakState[clientName], "P3", inP3, p3Durations);
      }

      trendPoints.push(point);
    }

    // Flush any still-running streaks at the end of the window.
    Object.keys(streakState).forEach(function (clientName) {
      var sv = streakState[clientName];
      if (sv.P1 > 0) p1Durations.push(sv.P1);
      if (sv.P2 > 0) p2Durations.push(sv.P2);
      if (sv.P3 > 0) p3Durations.push(sv.P3);
    });

    var trend = {
      weeklyActiveByPathway: trendPoints,
      avgDuration: {
        P1: average(p1Durations),
        P2: average(p2Durations),
        P3: average(p3Durations)
      }
    };

    return {
      currentState: current,
      trend: trend,
      weeksAnalyzed: weeksBack,
      weeksAvailable: trendPoints.length
    };
  }

  // Helper: update a streak counter for one pathway, pushing run length
  // into `durations` when the streak ends.
  function updateStreak(streakObj, pathwayKey, isActiveThisWeek, durations) {
    if (isActiveThisWeek) {
      streakObj[pathwayKey] = (streakObj[pathwayKey] || 0) + 1;
    } else {
      if (streakObj[pathwayKey] > 0) {
        durations.push(streakObj[pathwayKey]);
      }
      streakObj[pathwayKey] = 0;
    }
  }

  function average(arr) {
    if (!arr || arr.length === 0) return 0;
    var sum = 0;
    for (var i = 0; i < arr.length; i++) sum += arr[i];
    return round1(sum / arr.length);
  }

  function round1(n) {
    return Math.round(n * 10) / 10;
  }

  // Format a snapshot date as the Monday of that ISO week, "YYYY-MM-DD".
  // Used as the weekOf label on each trend point.
  function snapshotDate_toMondayISO(date) {
    var d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    var dayNum = d.getUTCDay() || 7; // Sunday = 7
    d.setUTCDate(d.getUTCDate() - (dayNum - 1));
    var y = d.getUTCFullYear();
    var m = String(d.getUTCMonth() + 1).padStart(2, "0");
    var day = String(d.getUTCDate()).padStart(2, "0");
    return y + "-" + m + "-" + day;
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------
  return {
    calculateStandardDistribution: calculateStandardDistribution,
    calculateRotationIndex: calculateRotationIndex,
    calculatePathwayChronicity: calculatePathwayChronicity,
    _internal: {
      clientsForCoach: clientsForCoach,
      clientToCoachMap: clientToCoachMap,
      failedStandardsForSubmission: failedStandardsForSubmission,
      cutoffDate: cutoffDate,
      average: average,
      round1: round1
    }
  };
});
