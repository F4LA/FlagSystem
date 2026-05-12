/**
 * Flag System Pathway Engine — Step 3e-1
 * Color Deriver
 *
 * Pure module that turns pathway state (from Step 3d) plus the client timeline
 * (from Step 3b) plus HC Actions rows into a Green/Yellow/Red color for each
 * pathway, and resolves the client's overall color using shortest-timeline
 * priority.
 *
 * Scope:
 *   - Per-pathway color derivation (P1, each active P2 standard, P3)
 *   - Overall color resolution + dominant pathway
 *   - Manual Override handling
 *   - Post-Red detection (minimal: enough to suppress reset-to-Green when
 *     the pathway is still under HC tracking)
 *
 * Out of scope (handled in later sub-steps):
 *   - Black Flag counter (3e-2)
 *   - Full Post-Red state machine (3e-3)
 *   - Public calculateClientState API (3e-3)
 *
 * UMD pattern. Exposes window.ColorDeriver in the browser.
 *
 * Locked decisions in scope (recorded in Step 3e design chat):
 *   - Red trigger: any non-empty callRequested on the most recent streak week
 *     (Client accepted / Client declined / Client did not respond /
 *      Escalated to HC) flips a RedWindow pathway from Yellow to Red.
 *   - HC Actions tagging in Post-Red: row's Pathway column carries the
 *     original pathway code (P1 / P2 / P3). Post-Red is identified by the
 *     actionType, not by the Pathway column. For P2, the Standard column
 *     identifies which standard the Post-Red attaches to.
 *   - Manual Overrides win over automatic logic until new evaluable data
 *     post-dates the override.
 *   - Manual Override: Color Change uses Notes column with format
 *     "force:Green" | "force:Yellow" | "force:Red".
 *
 * Authoritative reference:
 *   - Flag System Dashboard TDD v1.0, Sections 4 and 5
 *   - Overview Flag System & Minimum Standards v3.3
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.ColorDeriver = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // ---------------------------------------------------------------------------
  // Constants
  // ---------------------------------------------------------------------------

  var COLORS = { GREEN: "Green", YELLOW: "Yellow", RED: "Red" };

  var COLOR_SEVERITY = { Green: 0, Yellow: 1, Red: 2 };

  var PATHWAY_PRIORITY = { P1: 1, P2: 2, P3: 3 };

  // Action types that indicate an active Post-Red phase for the pathway
  // identified by the row. As long as one of these is the latest non-closing
  // action for a given pathway/standard combo, the pathway is still being
  // tracked by HC and a reset should not flip the color to Green.
  var POST_RED_OPEN_ACTIONS = [
    "Coach Call Outcome: Did Not Resolve",
    "Coach Call Outcome: Client No Response",
    "Coach Call Outcome: Client Declined",
    "HC Email: Sent",
    "HC Email: Follow-up",
    "HC Call: Scheduled",
    "HC Call: Did Not Resolve"
  ];

  // Action types that close the Post-Red phase for the pathway.
  var POST_RED_CLOSE_ACTIONS = [
    "Coach Call Outcome: Resolved",
    "HC Call: Resolved",
    "Manual Override: Pathway Closed",
    "Manual Override: Black Flag Removed",
    "Black Flag: Triggered"
  ];

  var MANUAL_OVERRIDE_CLOSE = "Manual Override: Pathway Closed";
  var MANUAL_OVERRIDE_COLOR = "Manual Override: Color Change";

  var CALL_REQUESTED_TRIGGERS = [
    "Client accepted",
    "Client declined",
    "Client did not respond",
    "Escalated to HC"
  ];

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  function isCallRequestedRedTrigger(value) {
    if (value === null || value === undefined) return false;
    if (typeof value !== "string") return false;
    var trimmed = value.trim();
    if (trimmed === "") return false;
    // Accept any non-empty string but normalize against the known list for
    // robustness. Free-typed values would still count as "the coach asked",
    // which matches the operational rule (Q6 was filled in).
    return CALL_REQUESTED_TRIGGERS.indexOf(trimmed) !== -1 || trimmed.length > 0;
  }

  function lastEvaluableIndex(timeline) {
    if (!Array.isArray(timeline)) return -1;
    for (var i = timeline.length - 1; i >= 0; i--) {
      if (timeline[i] && timeline[i].status === "evaluable") return i;
    }
    return -1;
  }

  function lastEvaluableWeekId(timeline) {
    var idx = lastEvaluableIndex(timeline);
    return idx === -1 ? null : timeline[idx].weekId;
  }

  function lastEvaluableTimestamp(timeline) {
    var idx = lastEvaluableIndex(timeline);
    if (idx === -1) return null;
    var wr = timeline[idx];
    // weekEnd is preferred (end of Coaching Week). Fall back to weekStart.
    return wr.weekEnd || wr.weekStart || null;
  }

  function toDate(value) {
    if (!value) return null;
    if (value instanceof Date) return isNaN(value.getTime()) ? null : value;
    var d = new Date(value);
    return isNaN(d.getTime()) ? null : d;
  }

  // Filter HC Actions to those relevant to a specific pathway code on this
  // client. For P2, additionally filter by standard. The caller should have
  // already filtered to a single client.
  function actionsForPathway(actions, pathwayCode, standard) {
    if (!Array.isArray(actions)) return [];
    return actions.filter(function (row) {
      if (!row) return false;
      if (row.pathway !== pathwayCode) return false;
      if (pathwayCode === "P2") {
        // P2 needs standard match. Standard on the row may be a short name
        // ("Nutrition") or long name ("Nutrition Adherence"); we accept both.
        if (!standard) return true;
        return matchesStandard(row.standard, standard);
      }
      return true;
    });
  }

  // Standard name matching: tolerates short ("Nutrition") and long
  // ("Nutrition Adherence") forms. Case-insensitive. Returns true when the
  // row's standard refers to the same standard as the pathway state.
  function matchesStandard(rowStandard, pathwayStandard) {
    if (!rowStandard || !pathwayStandard) return false;
    var rs = String(rowStandard).trim().toLowerCase();
    var ps = String(pathwayStandard).trim().toLowerCase();
    if (rs === ps) return true;
    // Strip common suffixes from the long form for comparison.
    var psShort = ps
      .replace(/\s+adherence$/, "")
      .replace(/\s+submission$/, "")
      .replace(/\s+target$/, "")
      .replace(/\s+feedback$/, "");
    var rsShort = rs
      .replace(/\s+adherence$/, "")
      .replace(/\s+submission$/, "")
      .replace(/\s+target$/, "")
      .replace(/\s+feedback$/, "");
    // "Check-in" in form/sheet vs "Check-In" in timeline: case-insensitive
    // already handled. Hyphen variants:
    var psNorm = psShort.replace(/-/g, "");
    var rsNorm = rsShort.replace(/-/g, "");
    return psNorm === rsNorm;
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

  // ---------------------------------------------------------------------------
  // Post-Red detection
  //
  // Returns true if there is an OPEN post-red action for this pathway that
  // has not been closed by a subsequent closing action. This is the minimal
  // signal needed by 3e-1 to suppress reset-to-Green. Full Post-Red state
  // (which substate, follow-up due date, etc.) is computed in 3e-3.
  // ---------------------------------------------------------------------------
  function hasActivePostRed(actions, pathwayCode, standard) {
    var relevant = actionsForPathway(actions, pathwayCode, standard);
    if (relevant.length === 0) return false;

    var sorted = sortActionsChronological(relevant);
    // Walk in reverse; the most recent open/close action wins.
    for (var i = sorted.length - 1; i >= 0; i--) {
      var at = sorted[i].actionType;
      if (POST_RED_CLOSE_ACTIONS.indexOf(at) !== -1) return false;
      if (POST_RED_OPEN_ACTIONS.indexOf(at) !== -1) return true;
    }
    return false;
  }

  // ---------------------------------------------------------------------------
  // Manual Override resolution
  //
  // Returns the active override for a pathway, or null. An override is
  // "active" if it is the most recent override of its kind AND there is no
  // evaluable timeline data after the override timestamp.
  //
  // The override carries:
  //   - kind: "close" | "color"
  //   - forcedColor: "Green" | "Yellow" | "Red" (only for "color")
  // ---------------------------------------------------------------------------
  function resolveOverride(actions, pathwayCode, standard, lastEvalTs) {
    var relevant = actionsForPathway(actions, pathwayCode, standard).filter(function (row) {
      return (
        row.actionType === MANUAL_OVERRIDE_CLOSE ||
        row.actionType === MANUAL_OVERRIDE_COLOR
      );
    });
    if (relevant.length === 0) return null;

    var sorted = sortActionsChronological(relevant);
    var latest = sorted[sorted.length - 1];
    var overrideTs = toDate(latest.timestamp);
    if (!overrideTs) return null;

    // Override is invalidated if new evaluable data exists after it.
    if (lastEvalTs) {
      var evalTs = toDate(lastEvalTs);
      if (evalTs && evalTs.getTime() > overrideTs.getTime()) {
        return null;
      }
    }

    if (latest.actionType === MANUAL_OVERRIDE_CLOSE) {
      return { kind: "close", forcedColor: COLORS.GREEN };
    }
    // Color change: parse Notes for "force:<Color>"
    var notes = latest.notes ? String(latest.notes).trim() : "";
    var match = notes.match(/^force:(green|yellow|red)$/i);
    if (!match) {
      // Malformed override. Ignore rather than crash.
      return null;
    }
    var color = match[1].toLowerCase();
    var forced =
      color === "green" ? COLORS.GREEN :
      color === "yellow" ? COLORS.YELLOW :
      COLORS.RED;
    return { kind: "color", forcedColor: forced };
  }

  // ---------------------------------------------------------------------------
  // Per-pathway color derivation
  // ---------------------------------------------------------------------------

  function colorForPathwayState(state, timeline, actions, pathwayCode, standard) {
    var lastEvalTs = lastEvaluableTimestamp(timeline);

    // 1. Manual override wins (if active).
    var override = resolveOverride(actions, pathwayCode, standard, lastEvalTs);
    if (override) {
      return {
        color: override.forcedColor,
        reason: "override",
        override: override
      };
    }

    // 2. Active Post-Red is sticky: it holds the pathway above Green even
    //    if the streak has cleared. This handles the case where the coach
    //    call happened, did not resolve, and HC is now following up
    //    directly. The pathway needs to stay visible until Post-Red closes.
    var postRedActive = hasActivePostRed(actions, pathwayCode, standard);

    // 3. Pathway not active AND no Post-Red -> Green.
    if (!state.active && !postRedActive) {
      return { color: COLORS.GREEN, reason: "not-active" };
    }

    // 4. Pathway not active BUT Post-Red still open -> keep visibility.
    //    Color reflects the Post-Red phase, not the (now empty) streak.
    if (!state.active && postRedActive) {
      return { color: COLORS.YELLOW, reason: "post-red-tracking" };
    }

    // 5. Reset ready -> Green, unless Post-Red still tracking this pathway.
    //    Note: in practice resetReady flips at the same time as active flips
    //    to false, so this branch mostly triggers when there is a partial
    //    reset signal mid-streak. Kept for explicit clarity.
    if (state.resetReady && !postRedActive) {
      return { color: COLORS.GREEN, reason: "reset" };
    }

    // 6. RedWindow + coach asked for call -> Red.
    if (state.expectedAction === "RedWindow") {
      var streakWeeks = state.streakWeeks || [];
      var mostRecent = streakWeeks.length > 0 ? streakWeeks[streakWeeks.length - 1] : null;
      var callValue = mostRecent ? mostRecent.callRequested : null;
      if (isCallRequestedRedTrigger(callValue)) {
        return { color: COLORS.RED, reason: "red-window-call-asked" };
      }
      return { color: COLORS.YELLOW, reason: "red-window-awaiting-call" };
    }

    // 7. Notification or Warning -> Yellow.
    if (state.expectedAction === "Notification" || state.expectedAction === "Warning") {
      return { color: COLORS.YELLOW, reason: state.expectedAction.toLowerCase() };
    }

    // 8. Active but no expected action (shouldn't happen if 3d is consistent):
    // treat as Green for safety.
    return { color: COLORS.GREEN, reason: "no-action-due" };
  }

  // ---------------------------------------------------------------------------
  // derivePathwayColors — public
  //
  // Input:
  //   pathwayStates: { p1: P1State, p2: P2State[], p3: P3State }
  //                  (output of PathwayEvaluators.evaluateAllPathways)
  //   timeline:      WeekRecord[] (output of ClientTimeline.buildClientTimeline)
  //   actions:       HC Actions rows filtered to this client (array)
  //   options:       reserved for future use
  //
  // Output:
  //   {
  //     p1: { ...P1State, color, colorReason },
  //     p2: [{ ...P2State, color, colorReason }, ...],
  //     p3: { ...P3State, color, colorReason }
  //   }
  // ---------------------------------------------------------------------------
  function derivePathwayColors(pathwayStates, timeline, actions, options) {
    if (!pathwayStates || typeof pathwayStates !== "object") {
      throw new TypeError("derivePathwayColors: pathwayStates required");
    }
    if (!Array.isArray(timeline)) {
      throw new TypeError("derivePathwayColors: timeline must be an array");
    }
    actions = Array.isArray(actions) ? actions : [];

    var p1 = pathwayStates.p1;
    var p3 = pathwayStates.p3;
    var p2Arr = Array.isArray(pathwayStates.p2) ? pathwayStates.p2 : [];

    var p1Color = p1
      ? colorForPathwayState(p1, timeline, actions, "P1", null)
      : { color: COLORS.GREEN, reason: "no-state" };

    var p3Color = p3
      ? colorForPathwayState(p3, timeline, actions, "P3", null)
      : { color: COLORS.GREEN, reason: "no-state" };

    var p2Colored = p2Arr.map(function (p2state) {
      var res = colorForPathwayState(p2state, timeline, actions, "P2", p2state.standard);
      return Object.assign({}, p2state, {
        color: res.color,
        colorReason: res.reason
      });
    });

    return {
      p1: Object.assign({}, p1 || {}, { color: p1Color.color, colorReason: p1Color.reason }),
      p2: p2Colored,
      p3: Object.assign({}, p3 || {}, { color: p3Color.color, colorReason: p3Color.reason })
    };
  }

  // ---------------------------------------------------------------------------
  // resolveOverallColor — public
  //
  // Takes the output of derivePathwayColors and returns:
  //   {
  //     color: "Green"|"Yellow"|"Red",
  //     dominantPathway: "P1"|"P2:<standard>"|"P3"|null
  //   }
  //
  // Resolution rule:
  //   1. Take the highest severity color across all pathways.
  //   2. Among pathways tied at that color, dominant = shortest timeline
  //      (P1 > P2 > P3).
  //   3. Within P2, if multiple standards tie at the same color, dominant
  //      = the one whose streak started earliest (longest streakLength).
  //      If still tied, alphabetic by standard name for determinism.
  //   4. Green overall -> dominantPathway = null.
  // ---------------------------------------------------------------------------
  function resolveOverallColor(coloredStates) {
    if (!coloredStates || typeof coloredStates !== "object") {
      throw new TypeError("resolveOverallColor: coloredStates required");
    }

    // Build a flat list of (color, pathwayKey, pathwayCode, streakLength, standard)
    var candidates = [];

    if (coloredStates.p1 && coloredStates.p1.color) {
      candidates.push({
        color: coloredStates.p1.color,
        pathwayCode: "P1",
        key: "P1",
        streakLength: coloredStates.p1.streakLength || 0,
        standard: null
      });
    }

    (coloredStates.p2 || []).forEach(function (p2) {
      if (p2 && p2.color) {
        candidates.push({
          color: p2.color,
          pathwayCode: "P2",
          key: "P2:" + p2.standard,
          streakLength: p2.streakLength || 0,
          standard: p2.standard
        });
      }
    });

    if (coloredStates.p3 && coloredStates.p3.color) {
      candidates.push({
        color: coloredStates.p3.color,
        pathwayCode: "P3",
        key: "P3",
        streakLength: coloredStates.p3.streakLength || 0,
        standard: null
      });
    }

    if (candidates.length === 0) {
      return { color: COLORS.GREEN, dominantPathway: null };
    }

    // Find highest severity color.
    var maxSeverity = 0;
    candidates.forEach(function (c) {
      var sev = COLOR_SEVERITY[c.color];
      if (sev > maxSeverity) maxSeverity = sev;
    });

    var overallColor =
      maxSeverity === 2 ? COLORS.RED :
      maxSeverity === 1 ? COLORS.YELLOW :
      COLORS.GREEN;

    if (overallColor === COLORS.GREEN) {
      return { color: COLORS.GREEN, dominantPathway: null };
    }

    // Filter to ties at max severity.
    var tied = candidates.filter(function (c) {
      return COLOR_SEVERITY[c.color] === maxSeverity;
    });

    // Sort by shortest-timeline priority, then by streakLength desc (older
    // streak wins), then alphabetic by standard for determinism.
    tied.sort(function (a, b) {
      var pa = PATHWAY_PRIORITY[a.pathwayCode];
      var pb = PATHWAY_PRIORITY[b.pathwayCode];
      if (pa !== pb) return pa - pb;
      if (a.streakLength !== b.streakLength) return b.streakLength - a.streakLength;
      var sa = a.standard || "";
      var sb = b.standard || "";
      return sa < sb ? -1 : sa > sb ? 1 : 0;
    });

    return {
      color: overallColor,
      dominantPathway: tied[0].key
    };
  }

  // ---------------------------------------------------------------------------
  // Public surface
  // ---------------------------------------------------------------------------

  return {
    derivePathwayColors: derivePathwayColors,
    resolveOverallColor: resolveOverallColor,
    // Internal helpers exposed for testing only.
    _internal: {
      colorForPathwayState: colorForPathwayState,
      hasActivePostRed: hasActivePostRed,
      resolveOverride: resolveOverride,
      isCallRequestedRedTrigger: isCallRequestedRedTrigger,
      matchesStandard: matchesStandard,
      lastEvaluableTimestamp: lastEvaluableTimestamp,
      COLORS: COLORS,
      COLOR_SEVERITY: COLOR_SEVERITY,
      PATHWAY_PRIORITY: PATHWAY_PRIORITY,
      POST_RED_OPEN_ACTIONS: POST_RED_OPEN_ACTIONS,
      POST_RED_CLOSE_ACTIONS: POST_RED_CLOSE_ACTIONS
    }
  };
});
