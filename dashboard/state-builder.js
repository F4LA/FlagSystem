/**
 * Flag System Dashboard — State Builder
 *
 * Iterates over the active roster, calls PathwayEngine.calculateClientState
 * for each client, and attaches the coach so downstream consumers don't
 * have to re-join.
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

  function buildAll(data, options) {
    var roster = data.roster || [];
    var formResponses = data.formResponses || [];
    var hcActions = data.hcActions || [];
    var opts = options || {};

    var lookback = opts.lookbackWeeks || (root.FlagConfig && root.FlagConfig.LOOKBACK_WEEKS) || 16;

    var states = [];
    for (var i = 0; i < roster.length; i++) {
      var entry = roster[i];
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

  root.StateBuilder = { buildAll: buildAll };
})(typeof window !== "undefined" ? window : this);
