/**
 * Flag System Pathway Engine — Step 3c
 * Consecutive Evaluable Helper
 *
 * Pure helpers for walking sequences of consecutive evaluable weeks
 * while skipping exempt and missing weeks.
 *
 * Sits on top of the timeline produced by client-timeline.js (Step 3b).
 * Used by the P1, P2, P3 evaluators (Step 3d) and the Black flag counter (Step 3e).
 *
 * UMD pattern. Exposes window.ConsecutiveEvaluable in the browser.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.ConsecutiveEvaluable = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // ---------------------------------------------------------------------------
  // filterEvaluable
  //
  // Returns only the WeekRecords whose status is "evaluable", preserving order.
  // This is the primitive every other helper in this module is built on.
  // ---------------------------------------------------------------------------
  function filterEvaluable(timeline) {
    if (!Array.isArray(timeline)) {
      throw new TypeError("filterEvaluable: timeline must be an array");
    }
    return timeline.filter(function (wr) {
      return wr && wr.status === "evaluable";
    });
  }

  // ---------------------------------------------------------------------------
  // resolveEndIndex
  //
  // Internal helper. Resolves the endIndex option:
  //   - undefined or null  -> last index of timeline
  //   - integer in range   -> that index
  //   - out of range       -> throws
  //
  // endIndex semantics: position in the FULL timeline (including exempt and
  // missing weeks), not in the filtered evaluable subset.
  // ---------------------------------------------------------------------------
  function resolveEndIndex(timeline, endIndex) {
    if (endIndex === undefined || endIndex === null) {
      return timeline.length - 1;
    }
    if (!Number.isInteger(endIndex)) {
      throw new TypeError("endIndex must be an integer");
    }
    if (endIndex < 0 || endIndex >= timeline.length) {
      throw new RangeError(
        "endIndex " + endIndex + " out of range for timeline length " + timeline.length
      );
    }
    return endIndex;
  }

  // ---------------------------------------------------------------------------
  // walkBackEvaluable
  //
  // Internal generator-like helper. Yields evaluable WeekRecords from
  // timeline[endIndex] walking backwards toward index 0, skipping exempt
  // and missing. Stops when:
  //   - it has yielded `maxLookback` evaluable weeks, OR
  //   - it runs out of timeline.
  //
  // Returns an array of evaluable WeekRecords in walk order
  // (most recent first).
  // ---------------------------------------------------------------------------
  function walkBackEvaluable(timeline, endIndex, maxLookback) {
    var collected = [];
    for (var i = endIndex; i >= 0 && collected.length < maxLookback; i--) {
      var wr = timeline[i];
      if (wr && wr.status === "evaluable") {
        collected.push(wr);
      }
    }
    return collected;
  }

  // ---------------------------------------------------------------------------
  // countConsecutiveFromEnd
  //
  // Walks backward from endIndex (default: end of timeline), skipping exempt
  // and missing weeks. Counts how many consecutive evaluable weeks satisfy
  // the predicate. Stops at the first evaluable week that fails the predicate.
  //
  // Exempt and missing weeks NEVER break the streak and are NEVER counted.
  //
  // options:
  //   - endIndex     (default: timeline.length - 1) index in full timeline to start from
  //   - maxLookback  (default: timeline.length)     safety cap on evaluable weeks scanned
  // ---------------------------------------------------------------------------
  function countConsecutiveFromEnd(timeline, predicate, options) {
    if (!Array.isArray(timeline)) {
      throw new TypeError("countConsecutiveFromEnd: timeline must be an array");
    }
    if (typeof predicate !== "function") {
      throw new TypeError("countConsecutiveFromEnd: predicate must be a function");
    }
    if (timeline.length === 0) {
      return 0;
    }

    var opts = options || {};
    var endIndex = resolveEndIndex(timeline, opts.endIndex);
    var maxLookback = opts.maxLookback === undefined ? timeline.length : opts.maxLookback;

    var count = 0;
    for (var i = endIndex; i >= 0 && count < maxLookback; i--) {
      var wr = timeline[i];
      if (!wr || wr.status !== "evaluable") {
        continue; // skip exempt and missing
      }
      if (predicate(wr)) {
        count++;
      } else {
        break; // first evaluable week that fails -> streak ends
      }
    }
    return count;
  }

  // ---------------------------------------------------------------------------
  // takeConsecutiveFromEnd
  //
  // Same walk as countConsecutiveFromEnd, but returns the actual WeekRecords
  // of the streak in chronological order (oldest -> newest).
  //
  // Useful for evaluators that need to inspect the streak content
  // (e.g. populating standards_list_recent / standards_list_previous in
  // Slack templates).
  // ---------------------------------------------------------------------------
  function takeConsecutiveFromEnd(timeline, predicate, options) {
    if (!Array.isArray(timeline)) {
      throw new TypeError("takeConsecutiveFromEnd: timeline must be an array");
    }
    if (typeof predicate !== "function") {
      throw new TypeError("takeConsecutiveFromEnd: predicate must be a function");
    }
    if (timeline.length === 0) {
      return [];
    }

    var opts = options || {};
    var endIndex = resolveEndIndex(timeline, opts.endIndex);
    var maxLookback = opts.maxLookback === undefined ? timeline.length : opts.maxLookback;

    // collected[0] is most recent, collected[1] is the one before, etc.
    var collected = [];
    for (var i = endIndex; i >= 0 && collected.length < maxLookback; i--) {
      var wr = timeline[i];
      if (!wr || wr.status !== "evaluable") {
        continue;
      }
      if (predicate(wr)) {
        collected.push(wr);
      } else {
        break;
      }
    }
    // Return chronological order: oldest -> newest
    return collected.reverse();
  }

  // ---------------------------------------------------------------------------
  // lastNEvaluableMatch
  //
  // Returns true if and only if the LAST n evaluable weeks (skipping exempt
  // and missing) all satisfy the predicate.
  //
  // If there are fewer than n evaluable weeks available in the lookback,
  // returns false. This matches reset-rule semantics: "2 consecutive clean
  // weeks" cannot be satisfied if the client only has 1 evaluable week.
  // ---------------------------------------------------------------------------
  function lastNEvaluableMatch(timeline, n, predicate, options) {
    if (!Array.isArray(timeline)) {
      throw new TypeError("lastNEvaluableMatch: timeline must be an array");
    }
    if (!Number.isInteger(n) || n < 1) {
      throw new TypeError("lastNEvaluableMatch: n must be a positive integer");
    }
    if (typeof predicate !== "function") {
      throw new TypeError("lastNEvaluableMatch: predicate must be a function");
    }
    if (timeline.length === 0) {
      return false;
    }

    var opts = options || {};
    var endIndex = resolveEndIndex(timeline, opts.endIndex);

    // Take the most recent n evaluable weeks (regardless of predicate),
    // then check that all satisfy the predicate.
    var lastN = walkBackEvaluable(timeline, endIndex, n);
    if (lastN.length < n) {
      return false; // not enough evaluable weeks
    }
    for (var i = 0; i < lastN.length; i++) {
      if (!predicate(lastN[i])) {
        return false;
      }
    }
    return true;
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------
  return {
    filterEvaluable: filterEvaluable,
    countConsecutiveFromEnd: countConsecutiveFromEnd,
    takeConsecutiveFromEnd: takeConsecutiveFromEnd,
    lastNEvaluableMatch: lastNEvaluableMatch
  };
});
