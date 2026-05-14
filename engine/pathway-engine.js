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
 * Flag System Pathway Engine — Step 3e-2 + 3e-3
 * Black Flag Tracker + Integrated calculateClientState
 *
 * 3e-2: calculateBlackFlagStatus
 *   Counts active Black flags for a client by walking HC Actions
 *   chronologically. A Black flag is opened by "Black Flag: Triggered"
 *   and closed by either:
 *     (a) An HC Actions row with actionType "Black Flag: Removed" or
 *         "Manual Override: Black Flag Removed" AFTER the trigger, OR
 *     (b) Automatic removal: 6 consecutive evaluable Green weeks after
 *         the trigger week.
 *   "Green" week predicate: status === "evaluable" && points === 0
 *     && failedStandards.length === 0.
 *   Exempt and Missing Data weeks are skipped (neither counted nor
 *   breaking the streak). Uses ConsecutiveEvaluable from 3c.
 *
 * 3e-3: calculateClientState
 *   Single public API the dashboard calls per client. Orchestrates:
 *     buildClientTimeline (3b)
 *     -> evaluateAllPathways (3d)
 *     -> derivePathwayColors + resolveOverallColor (3e-1)
 *     -> calculateBlackFlagStatus (3e-2)
 *
 * UMD pattern. Exposes window.PathwayEngine.
 *
 * Authoritative reference:
 *   - Overview Flag System & Minimum Standards v3.3 §4.6
 *   - Flag System Dashboard TDD v1.0 §4.6
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory(
      require("./consecutive-evaluable.js"),
      require("./client-timeline.js"),
      require("./pathway-evaluators.js"),
      require("./color-deriver.js")
    );
  } else {
    root.PathwayEngine = factory(
      root.ConsecutiveEvaluable,
      root.ClientTimeline,
      root.PathwayEvaluators,
      root.ColorDeriver
    );
  }
})(typeof self !== "undefined" ? self : this, function (
  ConsecutiveEvaluable,
  ClientTimeline,
  PathwayEvaluators,
  ColorDeriver
) {
  "use strict";

  if (!ConsecutiveEvaluable) {
    throw new Error("PathwayEngine requires ConsecutiveEvaluable (3c)");
  }
  if (!ClientTimeline) {
    throw new Error("PathwayEngine requires ClientTimeline (3b)");
  }
  if (!PathwayEvaluators) {
    throw new Error("PathwayEngine requires PathwayEvaluators (3d)");
  }
  if (!ColorDeriver) {
    throw new Error("PathwayEngine requires ColorDeriver (3e-1)");
  }

  // ---------------------------------------------------------------------------
  // Constants
  // ---------------------------------------------------------------------------

  var BLACK_FLAG_TRIGGER = "Black Flag: Triggered";
  var BLACK_FLAG_REMOVE_ACTIONS = [
    "Black Flag: Removed",
    "Manual Override: Black Flag Removed"
  ];
  var GREEN_STREAK_REQUIRED = 6;

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  function toDate(value) {
    if (!value) return null;
    if (value instanceof Date) return isNaN(value.getTime()) ? null : value;
    var d = new Date(value);
    return isNaN(d.getTime()) ? null : d;
  }

  function sortActionsChronological(actions) {
    return actions.slice().sort(function (a, b) {
      var ta = toDate(a.timestamp);
      var tb = toDate(b.timestamp);
      var na = ta ? ta.getTime() : 0;
      var nb = tb ? tb.getTime() : 0;
      return na - nb;
    });
  }

  // Filter HC Actions to a single client. Tolerates either a `clientName`
  // field or a `client` field on the row (caller may have parsed either).
  function actionsForClient(actions, clientName) {
    if (!Array.isArray(actions) || !clientName) return [];
    var target = String(clientName).trim().toLowerCase();
    return actions.filter(function (row) {
      if (!row) return false;
      var c = row.clientName || row.client || "";
      return String(c).trim().toLowerCase() === target;
    });
  }

  function isGreenWeek(wr) {
    return (
      wr &&
      wr.status === "evaluable" &&
      wr.points === 0 &&
      Array.isArray(wr.failedStandards) &&
      wr.failedStandards.length === 0
    );
  }

  // Locate the timeline index whose Coaching Week corresponds to the
  // trigger action's timestamp. The trigger week itself is excluded from
  // the green-streak count (we start counting from the week AFTER).
  //
  // Strategy: find the smallest index whose weekRange.end is >= trigger
  // timestamp, then use the NEXT index as the start of the streak window.
  // If no week strictly after the trigger exists, the trigger is "current"
  // and the streak is 0.
  function indexAfterTrigger(timeline, triggerTimestamp) {
    var triggerDate = toDate(triggerTimestamp);
    if (!triggerDate || !Array.isArray(timeline) || timeline.length === 0) {
      return -1;
    }
    var t = triggerDate.getTime();
    // Find the week containing the trigger (or the first week ending
    // strictly after the trigger).
    for (var i = 0; i < timeline.length; i++) {
      var wr = timeline[i];
      var endVal = wr ? toDate(wr.weekEnd) : null;
      if (endVal && endVal.getTime() >= t) {
        // This week contains the trigger (or starts after). The streak
        // window begins at i + 1.
        return i + 1 <= timeline.length - 1 ? i + 1 : -1;
      }
    }
    return -1;
  }

  // Count consecutive evaluable Green weeks within timeline[startIndex..endIdx]
  // walking forward from startIndex. Exempt and missing weeks are skipped
  // (neither counted nor breaking the streak). The first evaluable
  // non-green week breaks the streak.
  //
  // We delegate to ConsecutiveEvaluable.countConsecutiveFromEnd by passing
  // an endIndex pinned to endIdx; that helper walks BACKWARD. So we need
  // forward walking here, implemented directly. Kept consistent with the
  // exempt/missing skip semantics from 3c.
  function countGreenForward(timeline, startIndex, endIdx) {
    if (startIndex < 0 || startIndex > endIdx) return 0;
    var count = 0;
    for (var i = startIndex; i <= endIdx; i++) {
      var wr = timeline[i];
      if (!wr) continue;
      if (wr.status !== "evaluable") continue; // skip exempt + missing
      if (isGreenWeek(wr)) {
        count++;
        if (count >= GREEN_STREAK_REQUIRED) return count;
      } else {
        break;
      }
    }
    return count;
  }

  // Return the weekId at which the 6th consecutive green week landed for
  // a given trigger, if the streak completed; otherwise null.
  function findAutoResetWeekId(timeline, triggerTimestamp, endIdx) {
    var startIndex = indexAfterTrigger(timeline, triggerTimestamp);
    if (startIndex < 0 || startIndex > endIdx) return null;
    var count = 0;
    for (var i = startIndex; i <= endIdx; i++) {
      var wr = timeline[i];
      if (!wr) continue;
      if (wr.status !== "evaluable") continue;
      if (isGreenWeek(wr)) {
        count++;
        if (count >= GREEN_STREAK_REQUIRED) {
          return wr.weekId || null;
        }
      } else {
        return null; // streak broken before completing
      }
    }
    return null; // not enough weeks yet
  }

  // ---------------------------------------------------------------------------
  // 3e-2: calculateBlackFlagStatus
  //
  // Walks HC Actions chronologically. Each "Black Flag: Triggered" row
  // opens a flag. Each subsequent "Black Flag: Removed" or "Manual Override:
  // Black Flag Removed" closes the OLDEST currently-open flag. After
  // walking the explicit close actions, any remaining open flags are
  // checked for auto-removal via 6 consecutive evaluable green weeks
  // after their trigger week.
  // ---------------------------------------------------------------------------
  function calculateBlackFlagStatus(clientName, timeline, hcActions) {
    var actions = actionsForClient(hcActions, clientName);
    var sorted = sortActionsChronological(actions);

    // Open queue holds triggers that have not yet been closed by an
    // explicit removal action. Each entry: { actionId, timestamp, weekId? }
    var openQueue = [];
    var lastTriggeredAt = null;
    var lastResetAt = null; // weekId of the most recent auto-removal completion

    for (var i = 0; i < sorted.length; i++) {
      var row = sorted[i];
      var at = row.actionType;
      if (at === BLACK_FLAG_TRIGGER) {
        openQueue.push({
          actionId: row.actionId || row.id || null,
          timestamp: row.timestamp
        });
        // Track most recent trigger weekId (use the action's coaching week
        // if available; otherwise resolve via timeline).
        lastTriggeredAt = row.weekId || resolveTriggerWeekId(timeline, row.timestamp);
      } else if (BLACK_FLAG_REMOVE_ACTIONS.indexOf(at) !== -1) {
        // Explicit removal: close oldest open flag.
        if (openQueue.length > 0) {
          openQueue.shift();
        }
      }
    }

    // Auto-removal check for any remaining open triggers. Walk in order
    // (oldest first). If a trigger's window has completed 6 consecutive
    // green evaluable weeks, mark it auto-removed.
    var endIdx = Array.isArray(timeline) ? timeline.length - 1 : -1;
    var stillOpen = [];
    var consecutiveGreenForLatest = 0;

    for (var j = 0; j < openQueue.length; j++) {
      var trigger = openQueue[j];
      var resetWeekId = findAutoResetWeekId(timeline, trigger.timestamp, endIdx);
      if (resetWeekId !== null) {
        // Auto-removed.
        lastResetAt = resetWeekId;
      } else {
        stillOpen.push(trigger);
      }
    }

    // For the most-recently-opened still-active trigger, expose the
    // current count of consecutive green weeks (helpful for dashboard
    // progress display).
    if (stillOpen.length > 0) {
      var latest = stillOpen[stillOpen.length - 1];
      var startIndex = indexAfterTrigger(timeline, latest.timestamp);
      consecutiveGreenForLatest =
        startIndex >= 0 ? countGreenForward(timeline, startIndex, endIdx) : 0;
    }

    return {
      count: stillOpen.length,
      active: stillOpen.length > 0,
      lastTriggeredAt: lastTriggeredAt,
      lastResetAt: lastResetAt,
      consecutiveGreenWeeks: consecutiveGreenForLatest,
      sourceRows: stillOpen.map(function (t) {
        return t.actionId;
      })
    };
  }

  // Map a trigger timestamp to the weekId of the Coaching Week that
  // contains it. Used when the HC Action row doesn't carry a weekId.
  function resolveTriggerWeekId(timeline, triggerTimestamp) {
    var triggerDate = toDate(triggerTimestamp);
    if (!triggerDate || !Array.isArray(timeline)) return null;
    var t = triggerDate.getTime();
    for (var i = 0; i < timeline.length; i++) {
      var wr = timeline[i];
      if (!wr) continue;
      var start = toDate(wr.weekStart);
      var end = toDate(wr.weekEnd);
      if (!start || !end) continue;
      if (t >= start.getTime() && t <= end.getTime()) {
        return wr.weekId || null;
      }
    }
    return null;
  }

  // ---------------------------------------------------------------------------
  // 3e-3: calculateClientState
  //
  // Single public API the dashboard calls per client. Orchestrates the
  // full pipeline and returns one ClientState object.
  // ---------------------------------------------------------------------------
  function calculateClientState(clientName, formResponses, hcActions, options) {
    if (!clientName) {
      throw new TypeError("calculateClientState: clientName required");
    }
    if (!Array.isArray(formResponses)) {
      throw new TypeError("calculateClientState: formResponses must be an array");
    }
    var opts = options || {};

    // 1. Build timeline. ClientTimeline.buildClientTimeline filters by
    //    client internally (column B). We pass the client name through
    //    so the existing 3b implementation handles row filtering.
    var timeline = ClientTimeline.buildClientTimeline(clientName, formResponses, {
      currentDate: opts.currentDate,
      lookbackWeeks: opts.lookbackWeeks
    });

    // Resolve endIndex (defaults to end of timeline).
    var endIdx;
    if (opts.endIndex !== undefined && opts.endIndex !== null) {
      endIdx = opts.endIndex;
    } else {
      endIdx = timeline.length > 0 ? timeline.length - 1 : -1;
    }

    var evalOptions = {};
    if (opts.endIndex !== undefined && opts.endIndex !== null) {
      evalOptions.endIndex = opts.endIndex;
    }

    // 2. Filter HC Actions to this client (Black flag tracker also does
    //    this internally; pass full array through).
    var clientActions = actionsForClient(hcActions, clientName);

    // 3. Evaluate pathways.
    var pathwayStates =
      timeline.length > 0
        ? PathwayEvaluators.evaluateAllPathways(timeline, evalOptions)
        : {
            p1: { pathway: "P1", active: false, streakLength: 0, expectedAction: null, resetReady: false, streakWeeks: [], templateData: null },
            p2: [],
            p3: { pathway: "P3", active: false, streakLength: 0, expectedAction: null, resetReady: false, streakWeeks: [], templateData: null }
          };

    // 4. Derive colors.
    var coloredStates = ColorDeriver.derivePathwayColors(
      pathwayStates,
      timeline,
      clientActions
    );

    // 5. Resolve overall color.
    var resolved = ColorDeriver.resolveOverallColor(coloredStates);

    // 6. Black flag status. Pass through the full hcActions list; the
    //    tracker filters by client internally (so unit tests and the
    //    dashboard can pass either pre-filtered or full lists).
    var blackFlags = calculateBlackFlagStatus(clientName, timeline, hcActions);

    // 7. Last evaluable week (most recent evaluable week at or before
    //    endIdx).
    var lastEvaluableWeek = null;
    for (var i = endIdx; i >= 0; i--) {
      var wr = timeline[i];
      if (wr && wr.status === "evaluable") {
        lastEvaluableWeek = wr;
        break;
      }
    }

    var evaluatedAtWeek =
      endIdx >= 0 && timeline[endIdx] ? timeline[endIdx].weekId : null;

    return {
      clientName: clientName,
      evaluatedAtWeek: evaluatedAtWeek,
      color: resolved.color,
      dominantPathway: resolved.dominantPathway,
      pathwayStates: coloredStates,
      blackFlags: blackFlags,
      lastEvaluableWeek: lastEvaluableWeek
    };
  }

  // ---------------------------------------------------------------------------
  // Public surface
  // ---------------------------------------------------------------------------
  return {
    calculateBlackFlagStatus: calculateBlackFlagStatus,
    calculateClientState: calculateClientState,
    _internal: {
      isGreenWeek: isGreenWeek,
      countGreenForward: countGreenForward,
      findAutoResetWeekId: findAutoResetWeekId,
      indexAfterTrigger: indexAfterTrigger,
      resolveTriggerWeekId: resolveTriggerWeekId,
      GREEN_STREAK_REQUIRED: GREEN_STREAK_REQUIRED
    }
  };
});
