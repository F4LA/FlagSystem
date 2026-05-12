/**
 * Flag System Dashboard — Slack Templates
 *
 * TDD v1.0 §6.2 templates verbatim. Variant selection for P1 based on
 * which standards failed in the most recent (and previous, for Warning)
 * streak week.
 *
 * Variants:
 *   P1 Notification — Variant A: most recent week missed Check-In only
 *   P1 Notification — Variant B: rough week, no Check-In miss
 *   P1 Notification — Variant C: Check-In + other standards same week
 *   P1 Warning      — Same Type: both weeks the same description
 *   P1 Warning      — Different Types: weeks differ
 *
 * Input contract:
 *   buildSlackMessage(actionType, templateData, options)
 *     actionType: "Slack: Notification" | "Slack: Warning" | "Slack: Acknowledgment"
 *     templateData: {
 *       client_name: string,
 *       pathway: "P1" | "P2" | "P3",
 *       standard: string (P2 only, long form like "Nutrition Adherence"),
 *       standards_list_recent: string[] (long form names),
 *       standards_list_previous: string[] (long form names)
 *     }
 *
 *   Returns: { text: string, variant: string }  // variant for telemetry
 */
(function (root) {
  "use strict";

  var SHORT = (root.FlagConfig && root.FlagConfig.STANDARD_SHORT_NAMES) || {
    "Check-In Submission": "Check-In",
    "Training Adherence": "Training",
    "Nutrition Adherence": "Nutrition",
    "Movement Target": "Movement",
    "Technique Feedback": "Technique"
  };

  var CHECKIN = "Check-In Submission";

  function shortName(longName) {
    return SHORT[longName] || longName;
  }

  // Build a human list of short names, excluding Check-In if requested.
  function formatStandardsList(names, excludeCheckin) {
    var filtered = (names || []).filter(function (n) {
      return !(excludeCheckin && n === CHECKIN);
    });
    var shorts = filtered.map(shortName);
    if (shorts.length === 0) return "";
    if (shorts.length === 1) return shorts[0];
    if (shorts.length === 2) return shorts[0] + " and " + shorts[1];
    return shorts.slice(0, -1).join(", ") + ", and " + shorts[shorts.length - 1];
  }

  // Classify a single streak week's pattern for P1 description.
  // Returns one of: "checkin-only", "non-checkin", "checkin-plus".
  function classifyWeek(failedStandards) {
    var list = failedStandards || [];
    var hasCheckin = list.indexOf(CHECKIN) !== -1;
    var others = list.filter(function (n) { return n !== CHECKIN; });
    if (hasCheckin && others.length === 0) return "checkin-only";
    if (!hasCheckin) return "non-checkin";
    return "checkin-plus";
  }

  // Build the human description of a single P1 streak week for Warning
  // (different-type variant).
  function describeWeek(failedStandards) {
    var kind = classifyWeek(failedStandards);
    if (kind === "checkin-only") {
      return "missed the check-in";
    }
    if (kind === "non-checkin") {
      return "failed " + formatStandardsList(failedStandards, false);
    }
    // checkin-plus
    return "missed the check-in and failed " + formatStandardsList(failedStandards, true);
  }

  // ---------- P1 Notification ----------
  function p1Notification(d) {
    var kind = classifyWeek(d.standards_list_recent);
    var name = d.client_name;
    if (kind === "checkin-only") {
      return {
        variant: "P1-Notification-A",
        text:
          "*" + name + "* Heads up — " + name +
          " missed the check-in last week (5+ points acute crisis). " +
          "If it happens again this week, do a call-out about it on the next check-in " +
          "(ask the 4 questions to understand what's going on)."
      };
    }
    if (kind === "non-checkin") {
      return {
        variant: "P1-Notification-B",
        text:
          "*" + name + "* Heads up — " + name +
          " had a 5+ points acute crisis last week (failed " +
          formatStandardsList(d.standards_list_recent, false) + "). " +
          "If it happens again this week, do a call-out about the pattern on the next check-in " +
          "(ask the 4 questions to understand what's going on)."
      };
    }
    // checkin-plus
    return {
      variant: "P1-Notification-C",
      text:
        "*" + name + "* Heads up — " + name +
        " had a 5+ points acute crisis last week (missed the check-in and failed " +
        formatStandardsList(d.standards_list_recent, true) + "). " +
        "If it happens again this week, do a call-out about the pattern on the next check-in " +
        "(ask the 4 questions to understand what's going on)."
    };
  }

  // ---------- P1 Warning ----------
  function p1Warning(d) {
    var recent = d.standards_list_recent || [];
    var previous = d.standards_list_previous || [];
    var kindRecent = classifyWeek(recent);
    var kindPrev = classifyWeek(previous);
    var name = d.client_name;

    // Same-type heuristic: same classification AND, for non-checkin variants,
    // same set of failed standards.
    var sameType = (kindRecent === kindPrev);
    if (sameType && kindRecent !== "checkin-only") {
      // Compare the standard sets (excluding Check-In) to be conservative.
      var recentSet = recent.filter(function (n) { return n !== CHECKIN; }).sort().join("|");
      var prevSet = previous.filter(function (n) { return n !== CHECKIN; }).sort().join("|");
      sameType = (recentSet === prevSet);
    }

    if (sameType) {
      var clause;
      if (kindRecent === "checkin-only") {
        clause = "Missed the check-in two weeks in a row.";
      } else if (kindRecent === "non-checkin") {
        clause = "Failed " + formatStandardsList(recent, false) + " again.";
      } else {
        // checkin-plus same: missed check-in + same other standards
        clause = "Missed the check-in and failed " + formatStandardsList(recent, true) + " again.";
      }
      return {
        variant: "P1-Warning-SameType",
        text:
          "*" + name + "* " + name + " had a second consecutive 5+ points acute crisis week. " +
          clause + " If it happens again this week, ask for a direct call on the next check-in."
      };
    }

    // Different types
    return {
      variant: "P1-Warning-DiffType",
      text:
        "*" + name + "* " + name + " had a second consecutive 5+ points acute crisis week. " +
        "Last week: " + describeWeek(recent) + ". " +
        "The week before: " + describeWeek(previous) + ". " +
        "If it happens again this week, ask for a direct call on the next check-in."
    };
  }

  // ---------- P2 ----------
  function p2Notification(d) {
    var s = shortName(d.standard);
    var name = d.client_name;
    return {
      variant: "P2-Notification",
      text:
        "*" + name + "* " + name + " has missed the " + s + " target 2 weeks in a row. " +
        "If it happens again this week, do a call-out specifically about " + s +
        " on the next check-in (ask the 4 questions to understand what's blocking)."
    };
  }
  function p2Warning(d) {
    var s = shortName(d.standard);
    var name = d.client_name;
    return {
      variant: "P2-Warning",
      text:
        "*" + name + "* " + name + " has now missed " + s + " 3 weeks straight. " +
        "If it happens again this week, ask for a direct call on the next check-in."
    };
  }

  // ---------- P3 ----------
  function p3Notification(d) {
    var name = d.client_name;
    return {
      variant: "P3-Notification",
      text:
        "*" + name + "* " + name + " has been inconsistent for 3 weeks straight " +
        "(different things failing each week, no clean week yet). " +
        "If it happens again this week, do a call-out about the overall inconsistency on the next check-in."
    };
  }
  function p3Warning(d) {
    var name = d.client_name;
    return {
      variant: "P3-Warning",
      text:
        "*" + name + "* " + name + " has now had 4 weeks straight with something failing. " +
        "If it continues this week, ask for a direct call on the next check-in."
    };
  }

  // ---------- Acknowledgment ----------
  function acknowledgment(d) {
    var name = d.client_name;
    return {
      variant: "Acknowledgment",
      text:
        "*" + name + "* Quick heads up — " + name +
        " is improving since the call (problem area is back on track). " +
        "No action needed, just keeping you in the loop. Good work on that conversation."
    };
  }

  // ---------- Dispatcher ----------
  function buildSlackMessage(actionType, d) {
    if (!d || !d.client_name) {
      throw new Error("buildSlackMessage: client_name required");
    }
    var pathway = d.pathway;

    if (actionType === "Slack: Acknowledgment") {
      return acknowledgment(d);
    }

    if (actionType === "Slack: Notification") {
      if (pathway === "P1") return p1Notification(d);
      if (pathway === "P2") return p2Notification(d);
      if (pathway === "P3") return p3Notification(d);
    }
    if (actionType === "Slack: Warning") {
      if (pathway === "P1") return p1Warning(d);
      if (pathway === "P2") return p2Warning(d);
      if (pathway === "P3") return p3Warning(d);
    }

    throw new Error("buildSlackMessage: unsupported combo " + actionType + " / " + pathway);
  }

  root.SlackTemplates = {
    buildSlackMessage: buildSlackMessage,
    _internal: {
      classifyWeek: classifyWeek,
      describeWeek: describeWeek,
      formatStandardsList: formatStandardsList,
      shortName: shortName
    }
  };
})(typeof window !== "undefined" ? window : this);
