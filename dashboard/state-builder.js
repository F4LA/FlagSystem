/**
 * Flag System Dashboard — State Builder
 *
 * Iterates over the active roster, calls PathwayEngine.calculateClientState
 * for each client, and attaches the coach so downstream consumers don't
 * have to re-join.
 *
 * Coaches in EXCLUDED_COACHES are filtered out before any state is built,
 * which means their clients do not appear in Tab 1 (Friday Action Queue),
 * Tab 2 (Client Roster), Tab 3 (Coach Patterns), or Tab 4 (Black Flagged
 * Clients). Use this list to keep non-evaluable coaches (e.g. Bernardo,
 * Joey) out of the Flag System entirely.
 *
 * Output:
 *   [
 *     {
 *       ...calculateClientState result,
 *       coach: "Brent"
 *     },
 *     ...
 *   ]
 */
(function (root) {
  "use strict";

  if (!root.PathwayEngine) {
    throw new Error("state-builder.js: PathwayEngine not loaded");
  }

  // Coaches whose clients are not evaluated by the Flag System.
  // Match is case-insensitive and trim-tolerant.
  var EXCLUDED_COACHES = ["Bernardo", "Joey"];

  function isExcluded(coachName) {
    if (!coachName) return false;
    var normalized = String(coachName).toLowerCase().trim();
    for (var i = 0; i < EXCLUDED_COACHES.length; i++) {
      if (normalized === EXCLUDED_COACHES[i].toLowerCase().trim()) {
        return true;
      }
    }
    return false;
  }

  function buildAll(data, options) {
    var roster = data.roster || [];
    var formResponses = data.formResponses || [];
    var hcActions = data.hcActions || [];
    var opts = options || {};

    var lookback = opts.lookbackWeeks || (root.FlagConfig && root.FlagConfig.LOOKBACK_WEEKS) || 16;

    var states = [];
    for (var i = 0; i < roster.length; i++) {
      var entry = roster[i];

      // Skip clients whose coach is in the excluded list.
      if (isExcluded(entry.coach)) {
        continue;
      }

      try {
        var state = root.PathwayEngine.calculateClientState(
          entry.client,
          formResponses,
          hcActions,
          { lookbackWeeks: lookback, currentDate: opts.currentDate }
        );
        state.coach = entry.coach;
        states.push(state);
      } catch (err) {
        // Log and skip; do not abort the whole dashboard for one bad row.
        if (root.console && root.console.warn) {
          root.console.warn("state-builder: skipped " + entry.client + " — " + err.message);
        }
      }
    }
    return states;
  }

  root.StateBuilder = {
    buildAll: buildAll,
    EXCLUDED_COACHES: EXCLUDED_COACHES
  };
})(typeof window !== "undefined" ? window : this);
