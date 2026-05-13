/**
 * Flag System Dashboard — Slack Templates (v2: multi-pathway support)
 *
 * v1 templates from TDD §6.2 are preserved for single-pathway actions.
 * v2 adds multi-pathway templates per the operational rule update of
 * May 2026 (see queue-builder.js header for the rule).
 *
 * Public API:
 *   buildSlackMessage(action)
 *     action: ConsolidatedClientAction from queue-builder
 *       { client, level, warnings, notifications, ... }
 *     returns: { text, variant }
 *
 * Variant categories:
 *   Single-pathway:
 *     P1-Notification-A/B/C, P1-Warning-SameType, P1-Warning-DiffType
 *     P2-Notification, P2-Warning
 *     P3-Notification, P3-Warning
 *
 *   Multi-pathway (new):
 *     Multi-Warning           (multiple Warnings, no Notifications)
 *     Multi-Warning-Plus-Notif (Warnings + Notifications as heads-up)
 *     Multi-Notification      (multiple Notifications, no Warnings)
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

  function shortName(longName) { return SHORT[longName] || longName; }

  function formatList(items) {
    if (!items || items.length === 0) return "";
    if (items.length === 1) return items[0];
    if (items.length === 2) return items[0] + " and " + items[1];
    return items.slice(0, -1).join(", ") + ", and " + items[items.length - 1];
  }

  function formatStandardsList(names, excludeCheckin) {
    var filtered = (names || []).filter(function (n) {
      return !(excludeCheckin && n === CHECKIN);
    });
    return formatList(filtered.map(shortName));
  }

  function classifyP1Week(failedStandards) {
    var list = failedStandards || [];
    var hasCheckin = list.indexOf(CHECKIN) !== -1;
    var others = list.filter(function (n) { return n !== CHECKIN; });
    if (hasCheckin && others.length === 0) return "checkin-only";
    if (!hasCheckin) return "non-checkin";
    return "checkin-plus";
  }

  function describeP1Week(failedStandards) {
    var kind = classifyP1Week(failedStandards);
    if (kind === "checkin-only") return "missed the check-in";
    if (kind === "non-checkin") return "failed " + formatStandardsList(failedStandards, false);
    return "missed the check-in and failed " + formatStandardsList(failedStandards, true);
  }

  // =========================================================================
  // SINGLE-PATHWAY TEMPLATES (TDD §6.2 verbatim, preserved from v1)
  // =========================================================================

  function p1Notification(d) {
    var kind = classifyP1Week(d.standards_list_recent);
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

  function p1Warning(d) {
    var recent = d.standards_list_recent || [];
    var previous = d.standards_list_previous || [];
    var kindRecent = classifyP1Week(recent);
    var kindPrev = classifyP1Week(previous);
    var name = d.client_name;

    var sameType = (kindRecent === kindPrev);
    if (sameType && kindRecent !== "checkin-only") {
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
        clause = "Missed the check-in and failed " + formatStandardsList(recent, true) + " again.";
      }
      return {
        variant: "P1-Warning-SameType",
        text:
          "*" + name + "* " + name + " had a second consecutive 5+ points acute crisis week. " +
          clause + " If it happens again this week, ask for a direct call on the next check-in."
      };
    }
    return {
      variant: "P1-Warning-DiffType",
      text:
        "*" + name + "* " + name + " had a second consecutive 5+ points acute crisis week. " +
        "Last week: " + describeP1Week(recent) + ". " +
        "The week before: " + describeP1Week(previous) + ". " +
        "If it happens again this week, ask for a direct call on the next check-in."
    };
  }

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
        "*" + name + "* " + name + " has now missed " + s + " " + (d.streakLength || 3) + " weeks straight. " +
        "If it happens again this week, ask for a direct call on the next check-in."
    };
  }

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
        "*" + name + "* " + name + " has now had " + (d.streakLength || 4) + " weeks straight with something failing. " +
        "If it continues this week, ask for a direct call on the next check-in."
    };
  }

  // =========================================================================
  // MULTI-PATHWAY TEMPLATES (new, per operational rule update)
  // =========================================================================

  // Describe a single pathway as a bullet line.
  function bulletForWarning(entry) {
    var n = entry.streakLength || 0;
    if (entry.pathway === "P1") {
      var recent = (entry.templateData && entry.templateData.standards_list_recent) || [];
      return "Second consecutive acute crisis week (" + describeP1Week(recent) + ")";
    }
    if (entry.pathway === "P2") {
      return "Has now missed " + shortName(entry.standard) + " " + n + " weeks straight";
    }
    if (entry.pathway === "P3") {
      return "Has now had " + n + " weeks straight with something failing (different things each week)";
    }
    return entry.pathway;
  }

  function bulletForNotification(entry) {
    if (entry.pathway === "P1") {
      var recent = (entry.templateData && entry.templateData.standards_list_recent) || [];
      return "Had a 5+ point acute crisis last week (" + describeP1Week(recent) + ")";
    }
    if (entry.pathway === "P2") {
      return "Has missed " + shortName(entry.standard) + " 2 weeks in a row";
    }
    if (entry.pathway === "P3") {
      return "Inconsistent for 3 weeks straight (different things failing each week)";
    }
    return entry.pathway;
  }

  // Multi-Warning: multiple Warnings, NO Notifications.
  function multiWarning(action) {
    var name = action.client;
    var bullets = action.warnings.map(function (w) {
      return "• " + bulletForWarning(w);
    });
    var focusList = action.warnings.map(function (w) {
      if (w.pathway === "P2") return shortName(w.standard);
      if (w.pathway === "P3") return "the overall inconsistency pattern";
      if (w.pathway === "P1") return "the acute crisis";
      return w.pathway;
    });
    var focus = formatList(focusList);
    var text =
      "*" + name + "* Heads up — multiple things happening with " + name + " at the same time:\n" +
      bullets.join("\n") + "\n\n" +
      "Ask for a direct call on the next check-in. In the call, touch on all of these: " + focus + ".";
    return { variant: "Multi-Warning", text: text };
  }

  // Multi-Warning-Plus-Notif: Warnings as focus, Notifications as heads-up.
  function multiWarningPlusNotif(action) {
    var name = action.client;
    var warningBullets = action.warnings.map(function (w) {
      return "• " + bulletForWarning(w);
    });
    var notifBullets = action.notifications.map(function (n) {
      return "• " + bulletForNotification(n);
    });
    var focusList = action.warnings.map(function (w) {
      if (w.pathway === "P2") return shortName(w.standard);
      if (w.pathway === "P3") return "the overall inconsistency pattern";
      if (w.pathway === "P1") return "the acute crisis";
      return w.pathway;
    });
    var focus = formatList(focusList);

    var headsUpList = action.notifications.map(function (n) {
      if (n.pathway === "P2") return shortName(n.standard);
      if (n.pathway === "P3") return "the broader consistency pattern";
      if (n.pathway === "P1") return "the recent acute crisis";
      return n.pathway;
    });
    var headsUp = formatList(headsUpList);

    var warningHeader = action.warnings.length > 1
      ? "Main topics for the call:"
      : "Main topic for the call:";
    var notifHeader = action.notifications.length > 1
      ? "While you're at it, also heads up on these:"
      : "While you're at it, also heads up:";

    var text =
      "*" + name + "* Ask for a direct call on the next check-in with " + name + ".\n\n" +
      warningHeader + "\n" +
      warningBullets.join("\n") + "\n\n" +
      "Focus the call on " + focus + ". " +
      notifHeader + "\n" +
      notifBullets.join("\n") + "\n\n" +
      "Touch on " + headsUp + " during the call too (ask the 4 questions about it/them if there's time).";
    return { variant: "Multi-Warning-Plus-Notif", text: text };
  }

  // Multi-Notification: multiple Notifications, NO Warnings.
  function multiNotification(action) {
    var name = action.client;
    var bullets = action.notifications.map(function (n) {
      return "• " + bulletForNotification(n);
    });
    var topicList = action.notifications.map(function (n) {
      if (n.pathway === "P2") return shortName(n.standard);
      if (n.pathway === "P3") return "the overall consistency pattern";
      if (n.pathway === "P1") return "the acute crisis";
      return n.pathway;
    });
    var topics = formatList(topicList);
    var text =
      "*" + name + "* Heads up — a few things happening with " + name + " at the same time:\n" +
      bullets.join("\n") + "\n\n" +
      "If any of these happen again this week, do a call-out on the next check-in about " + topics +
      " (ask the 4 questions to understand what's going on).";
    return { variant: "Multi-Notification", text: text };
  }

  // =========================================================================
  // DISPATCHER
  // =========================================================================

  function buildSlackMessage(action) {
    if (!action || !action.client) {
      throw new Error("buildSlackMessage: action.client required");
    }

    var W = action.warnings || [];
    var N = action.notifications || [];
    var totalPathways = W.length + N.length;

    // ----- Single-pathway path (preserve TDD §6.2 wording exactly) -----
    if (totalPathways === 1) {
      var only = W[0] || N[0];
      var isWarning = W.length === 1;
      var d = {
        client_name: action.client,
        pathway: only.pathway,
        standard: only.standard,
        streakLength: only.streakLength,
        standards_list_recent: (only.templateData && only.templateData.standards_list_recent) || [],
        standards_list_previous: (only.templateData && only.templateData.standards_list_previous) || []
      };
      if (only.pathway === "P1") return isWarning ? p1Warning(d) : p1Notification(d);
      if (only.pathway === "P2") return isWarning ? p2Warning(d) : p2Notification(d);
      if (only.pathway === "P3") return isWarning ? p3Warning(d) : p3Notification(d);
      throw new Error("buildSlackMessage: unknown pathway " + only.pathway);
    }

    // ----- Multi-pathway path -----
    if (W.length > 0 && N.length === 0) return multiWarning(action);
    if (W.length > 0 && N.length > 0) return multiWarningPlusNotif(action);
    if (W.length === 0 && N.length > 0) return multiNotification(action);

    throw new Error("buildSlackMessage: no warnings or notifications");
  }

  // Acknowledgment template stays untouched (one-off, not pathway-driven).
  function acknowledgment(clientName) {
    return {
      variant: "Acknowledgment",
      text:
        "*" + clientName + "* Quick heads up — " + clientName +
        " is improving since the call (problem area is back on track). " +
        "No action needed, just keeping you in the loop. Good work on that conversation."
    };
  }

  root.SlackTemplates = {
    buildSlackMessage: buildSlackMessage,
    acknowledgment: acknowledgment,
    _internal: {
      shortName: shortName,
      formatStandardsList: formatStandardsList,
      classifyP1Week: classifyP1Week,
      describeP1Week: describeP1Week,
      bulletForWarning: bulletForWarning,
      bulletForNotification: bulletForNotification,
      p1Notification: p1Notification,
      p1Warning: p1Warning,
      p2Notification: p2Notification,
      p2Warning: p2Warning,
      p3Notification: p3Notification,
      p3Warning: p3Warning,
      multiWarning: multiWarning,
      multiWarningPlusNotif: multiWarningPlusNotif,
      multiNotification: multiNotification
    }
  };
})(typeof window !== "undefined" ? window : this);
