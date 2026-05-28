/**
 * Flag System Dashboard — Slack Templates (v3: v3.5 overview update)
 *
 * v1 templates from TDD §6.2 — single-pathway actions.
 * v2 added multi-pathway templates (May 2026).
 * v3 updates all templates per Overview v3.5 (May 2026):
 *   - Terminology: "5+ points acute crisis" → "major issue (missed check-in
 *     entirely, or multiple standards failed at once)"
 *   - Call-out position: "on the next check-in" → "at the end of your next
 *     Loom feedback" (coach covers technical feedback first, call-out last)
 *   - 4 questions embedded verbatim in every template (no longer a reference)
 *   - Mini-scripts added:
 *       Notifications → "How to close the Loom" script
 *       Warnings      → "How to ask for the call in the Loom" script
 *                     + "When the call happens — opener" script
 *   - New dynamic variables resolved in-module:
 *       description_w1/w2/w3  — per-week narrative for P3 Notification
 *       weekly_breakdown       — multi-week narrative for P3 Warning
 *       *_natural variants     — conversational list phrasing for scripts
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
 *   Multi-pathway:
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

  // Describe a P3 week in natural language for scripts.
  // streakWeek is a WeekRecord with .failedStandards array.
  function describeP3Week(streakWeek) {
    if (!streakWeek || !streakWeek.failedStandards || streakWeek.failedStandards.length === 0) {
      return "something slipped";
    }
    return formatStandardsList(streakWeek.failedStandards, false) + " slipped";
  }

  // Build the weekly_breakdown narrative for P3 Warning.
  // streakWeeks is in chronological order (oldest first).
  // e.g. "Week 1: Training slipped. Week 2: Nutrition slipped. Week 3: Training and Movement slipped."
  function buildWeeklyBreakdown(streakWeeks) {
    if (!streakWeeks || streakWeeks.length === 0) return "something different each week";
    return streakWeeks.map(function (w, i) {
      return "Week " + (i + 1) + ": " + describeP3Week(w);
    }).join(". ");
  }

  // The 4 questions, formatted for inline use in Slack messages.
  var FOUR_QUESTIONS =
    "Ask these 4 questions to understand what's going on:\n" +
    "1. Is the target I set not realistic for your current life, or have your goals shifted?\n" +
    "2. Have you been deprioritizing this lately?\n" +
    "3. Do you need me to give you specific strategies to make this easier?\n" +
    "4. Or is there something else happening that I should know about?";

  // =========================================================================
  // SINGLE-PATHWAY TEMPLATES
  // =========================================================================

  function p1Notification(d) {
    var kind = classifyP1Week(d.standards_list_recent);
    var name = d.client_name;

    if (kind === "checkin-only") {
      return {
        variant: "P1-Notification-A",
        text:
          "*" + name + "* Heads up — " + name +
          " missed the check-in last week. " +
          "If it happens again this week, do a call-out about it at the end of your next Loom feedback. " +
          "Cover the regular check-in feedback first, then close the Loom with the call-out. " +
          FOUR_QUESTIONS + "\n\n" +
          "*How to close the Loom:*\n" +
          "_\"Before I wrap up, I want to bring something up with you. " +
          "You missed your check-in last week, and I want to understand what's going on before we keep going. " +
          "Maybe the timing doesn't work anymore, maybe something pulled your focus, " +
          "maybe you need a different setup from me to make this easier. " +
          "Or maybe there's something else happening I don't know about. " +
          "Reply to this Loom and let me know what feels closest, and from there we adjust.\"_"
      };
    }

    if (kind === "non-checkin") {
      var standards = formatStandardsList(d.standards_list_recent, false);
      return {
        variant: "P1-Notification-B",
        text:
          "*" + name + "* Heads up — " + name +
          " had a major issue last week (multiple standards failed at once: " + standards + "). " +
          "If it happens again this week, do a call-out about the pattern at the end of your next Loom feedback. " +
          "Cover the regular check-in feedback first, then close the Loom with the call-out. " +
          FOUR_QUESTIONS + "\n\n" +
          "*How to close the Loom:*\n" +
          "_\"Before I wrap up, I want to bring something up with you. " +
          "Last week was a rough one — " + standards + " all slipped at the same time — " +
          "and I want to understand what's going on before we keep pushing the same plan. " +
          "Maybe what I'm asking from you isn't realistic with what's on your plate right now, " +
          "maybe it's a priority thing, maybe you need different tools from me. " +
          "Or maybe there's something else happening I don't know about. " +
          "Reply to this Loom and let me know what feels closest, and from there we adjust.\"_"
      };
    }

    // checkin-plus
    var othersStr = formatStandardsList(d.standards_list_recent, true);
    return {
      variant: "P1-Notification-C",
      text:
        "*" + name + "* Heads up — " + name +
        " had a major issue last week (missed the check-in AND failed " + othersStr + "). " +
        "If it happens again this week, do a call-out about the pattern at the end of your next Loom feedback. " +
        "Cover the regular check-in feedback first, then close the Loom with the call-out. " +
        FOUR_QUESTIONS + "\n\n" +
        "*How to close the Loom:*\n" +
        "_\"Before I wrap up, I want to bring something up with you. " +
        "Last week was a rough one — you missed your check-in and " + othersStr + " also slipped — " +
        "and I want to understand what's going on before we keep pushing the same plan. " +
        "Maybe what I'm asking from you isn't realistic with what's on your plate right now, " +
        "maybe it's a priority thing, maybe you need different tools from me. " +
        "Or maybe there's something else happening I don't know about. " +
        "Reply to this Loom and let me know what feels closest, and from there we adjust.\"_"
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

    var fourQsScript =
      "Then walk through these 4 questions naturally:\n" +
      "1. Is the target I set not realistic for your current life, or have your goals shifted?\n" +
      "2. Have you been deprioritizing this lately?\n" +
      "3. Do you need me to give you specific strategies to make this easier?\n" +
      "4. Or is there something else happening that I should know about?";

    if (sameType) {
      var clause;
      var openerDetail;
      if (kindRecent === "checkin-only") {
        clause = "Missed the check-in two weeks in a row.";
        openerDetail = "missed your check-in two weeks in a row";
      } else if (kindRecent === "non-checkin") {
        var s = formatStandardsList(recent, false);
        clause = "Failed " + s + " again.";
        openerDetail = s + " slipped two weeks in a row";
      } else {
        var s2 = formatStandardsList(recent, true);
        clause = "Missed the check-in and failed " + s2 + " again.";
        openerDetail = "missed the check-in and " + s2 + " slipped again";
      }
      return {
        variant: "P1-Warning-SameType",
        text:
          "*" + name + "* " + name + " had a second major issue week in a row. " +
          clause + " " +
          "If it happens again this week, ask for a direct call at the end of your next Loom feedback. " +
          "Cover the regular check-in feedback first, then close the Loom by asking for the call.\n\n" +
          "*How to ask for the call in the Loom:*\n" +
          "_\"Before I wrap up, I need to bring something up with you. " +
          "This is the second week in a row this has happened, and at this point I don't want to keep pushing " +
          "the same plan without understanding what's really going on. " +
          "I'd like to get on a call with you this week so we can figure this out together. " +
          "Reply to this Loom letting me know if you're up for it, and if yes I'll send you my calendar link.\"_\n\n" +
          "*When the call happens — opener:*\n" +
          "_\"Hey " + name + ", good to see you, thanks for making space for this. " +
          "How's your week going so far?\"_ [let them answer] " +
          "_\"So, I want to tell you why I asked for the call. " +
          "This is the second week in a row " + openerDetail + ", " +
          "and before I keep pushing the same plan I wanted to sit down with you and understand what's actually going on.\"_\n" +
          fourQsScript
      };
    }

    // Different type each week
    var descRecent = describeP1Week(recent);
    var descPrev = describeP1Week(previous);
    return {
      variant: "P1-Warning-DiffType",
      text:
        "*" + name + "* " + name + " had a second major issue week in a row. " +
        "Last week: " + descRecent + ". The week before: " + descPrev + ". " +
        "If it happens again this week, ask for a direct call at the end of your next Loom feedback. " +
        "Cover the regular check-in feedback first, then close the Loom by asking for the call.\n\n" +
        "*How to ask for the call in the Loom:*\n" +
        "_\"Before I wrap up, I need to bring something up with you. " +
        "The last two weeks have both been rough but in different ways, " +
        "and at this point I don't want to keep guessing what's going on. " +
        "I'd like to get on a call with you this week so we can figure this out together. " +
        "Reply to this Loom letting me know if you're up for it, and if yes I'll send you my calendar link.\"_\n\n" +
        "*When the call happens — opener:*\n" +
        "_\"Hey " + name + ", good to see you, thanks for making space for this. " +
        "How's your week going so far?\"_ [let them answer] " +
        "_\"So, I want to tell you why I asked for the call. " +
        "The last two weeks have both been tough but in different ways — " +
        "the week before last " + descPrev + ", and last week " + descRecent + " — " +
        "and before I keep pushing I wanted to sit down with you and understand what's actually going on.\"_\n" +
        fourQsScript
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
        " at the end of your next Loom feedback. " +
        "Cover the regular check-in feedback first, then close the Loom with the call-out. " +
        FOUR_QUESTIONS + "\n\n" +
        "*How to close the Loom:*\n" +
        "_\"Before I wrap up, I want to bring something up with you. " +
        "You've missed your " + s + " target two weeks in a row now, " +
        "and I want to understand what's blocking you before we keep going. " +
        "Maybe the target I set isn't realistic with your life right now, " +
        "maybe it's been hard to prioritize, maybe you need different strategies from me. " +
        "Or maybe there's something else happening I don't know about. " +
        "Reply to this Loom and let me know what feels closest, and from there we adjust.\"_"
    };
  }

  function p2Warning(d) {
    var s = shortName(d.standard);
    var streak = d.streakLength || 3;
    var name = d.client_name;
    return {
      variant: "P2-Warning",
      text:
        "*" + name + "* " + name + " has now missed " + s + " " + streak + " weeks straight. " +
        "If it happens again this week, ask for a direct call at the end of your next Loom feedback. " +
        "Cover the regular check-in feedback first, then close the Loom by asking for the call.\n\n" +
        "*How to ask for the call in the Loom:*\n" +
        "_\"Before I wrap up, I need to bring something up with you. " +
        "We've now had " + streak + " weeks straight where " + s + " hasn't landed, " +
        "and at this point I don't want to keep adjusting the same target without understanding " +
        "what's really going on. " +
        "I'd like to get on a call with you this week so we can figure this out together. " +
        "Reply to this Loom letting me know if you're up for it, and if yes I'll send you my calendar link.\"_\n\n" +
        "*When the call happens — opener:*\n" +
        "_\"Hey " + name + ", good to see you, thanks for making space for this. " +
        "How's your week going so far?\"_ [let them answer] " +
        "_\"So, I want to tell you why I asked for the call. " +
        "We've had " + streak + " weeks in a row where " + s + " hasn't landed, " +
        "and before I keep pushing the same plan I wanted to sit down with you and understand " +
        "what's really going on.\"_\n" +
        "Then walk through these 4 questions naturally:\n" +
        "1. Is the target I set not realistic for your current life, or have your goals shifted?\n" +
        "2. Have you been deprioritizing this lately?\n" +
        "3. Do you need me to give you specific strategies to make this easier?\n" +
        "4. Or is there something else happening that I should know about?"
    };
  }

  function p3Notification(d) {
    var name = d.client_name;
    // Build per-week descriptions from streakWeeks (chronological, oldest first).
    // At Notification threshold, streakLength === 3, so streakWeeks has exactly 3 entries.
    var weeks = d.streakWeeks || [];
    var w1 = weeks.length >= 1 ? describeP3Week(weeks[0]) : "something slipped";
    var w2 = weeks.length >= 2 ? describeP3Week(weeks[1]) : "something slipped";
    var w3 = weeks.length >= 3 ? describeP3Week(weeks[2]) : "something slipped";
    return {
      variant: "P3-Notification",
      text:
        "*" + name + "* " + name +
        " has been inconsistent for 3 weeks straight — different things failing each week, no clean week yet. " +
        "If it happens again this week, do a call-out about the overall inconsistency at the end of your next Loom feedback. " +
        "Cover the regular check-in feedback first, then close the Loom with the call-out. " +
        FOUR_QUESTIONS + "\n\n" +
        "*How to close the Loom:*\n" +
        "_\"Before I wrap up, I want to bring something up with you. " +
        "The last three weeks have all had something slip — " +
        w1 + ", then " + w2 + ", then " + w3 + " — " +
        "and I want to understand what's going on before we keep going. " +
        "Maybe the overall plan isn't realistic with your life right now, " +
        "maybe it's been hard to prioritize, maybe you need a different approach from me. " +
        "Or maybe there's something else happening I don't know about. " +
        "Reply to this Loom and let me know what feels closest, and from there we adjust.\"_"
    };
  }

  function p3Warning(d) {
    var streak = d.streakLength || 4;
    var name = d.client_name;
    var breakdown = buildWeeklyBreakdown(d.streakWeeks);
    return {
      variant: "P3-Warning",
      text:
        "*" + name + "* " + name + " has now had " + streak + " weeks straight with something failing. " +
        "If it continues this week, ask for a direct call at the end of your next Loom feedback. " +
        "Cover the regular check-in feedback first, then close the Loom by asking for the call.\n\n" +
        "*How to ask for the call in the Loom:*\n" +
        "_\"Before I wrap up, I need to bring something up with you. " +
        "We've now had " + streak + " weeks in a row where something has slipped — not always the same thing — " +
        "and at this point I don't want to keep guessing what's going on. " +
        "I'd like to get on a call with you this week so we can figure this out together. " +
        "Reply to this Loom letting me know if you're up for it, and if yes I'll send you my calendar link.\"_\n\n" +
        "*When the call happens — opener:*\n" +
        "_\"Hey " + name + ", good to see you, thanks for making space for this. " +
        "How's your week going so far?\"_ [let them answer] " +
        "_\"So, I want to tell you why I asked for the call. " +
        "We've had " + streak + " weeks in a row where something has slipped each week — " +
        breakdown + " — " +
        "and before I keep pushing I wanted to sit down with you and understand what's actually going on.\"_\n" +
        "Then walk through these 4 questions naturally:\n" +
        "1. Is the target I set not realistic for your current life, or have your goals shifted?\n" +
        "2. Have you been deprioritizing this lately?\n" +
        "3. Do you need me to give you specific strategies to make this easier?\n" +
        "4. Or is there something else happening that I should know about?"
    };
  }

  // =========================================================================
  // MULTI-PATHWAY TEMPLATES
  // =========================================================================

  function bulletForWarning(entry) {
    var n = entry.streakLength || 0;
    if (entry.pathway === "P1") {
      var recent = (entry.templateData && entry.templateData.standards_list_recent) || [];
      return "Second consecutive major issue week (" + describeP1Week(recent) + ")";
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
      return "Had a major issue last week (" + describeP1Week(recent) + ")";
    }
    if (entry.pathway === "P2") {
      return "Has missed " + shortName(entry.standard) + " 2 weeks in a row";
    }
    if (entry.pathway === "P3") {
      return "Inconsistent for 3 weeks straight (different things failing each week)";
    }
    return entry.pathway;
  }

  function buildFocusListNatural(warnings) {
    var items = warnings.map(function (w) {
      if (w.pathway === "P2") return shortName(w.standard);
      if (w.pathway === "P3") return "the overall inconsistency pattern";
      if (w.pathway === "P1") return "the recent major issue weeks";
      return w.pathway;
    });
    return formatList(items);
  }

  function buildHeadsUpListNatural(notifications) {
    var items = notifications.map(function (n) {
      if (n.pathway === "P2") return shortName(n.standard);
      if (n.pathway === "P3") return "the broader consistency pattern";
      if (n.pathway === "P1") return "the recent major issue week";
      return n.pathway;
    });
    return formatList(items);
  }

  function buildTopicsListNatural(notifications) {
    var items = notifications.map(function (n) {
      if (n.pathway === "P2") return shortName(n.standard);
      if (n.pathway === "P3") return "the overall consistency pattern";
      if (n.pathway === "P1") return "the recent major issue";
      return n.pathway;
    });
    return formatList(items);
  }

  var FOUR_QS_NATURAL =
    "Then walk through these 4 questions naturally:\n" +
    "1. Is the target I set not realistic for your current life, or have your goals shifted?\n" +
    "2. Have you been deprioritizing this lately?\n" +
    "3. Do you need me to give you specific strategies to make this easier?\n" +
    "4. Or is there something else happening that I should know about?";

  // Multi-Warning: multiple Warnings, NO Notifications.
  function multiWarning(action) {
    var name = action.client;
    var bullets = action.warnings.map(function (w) {
      return "• " + bulletForWarning(w);
    });
    var focusNatural = buildFocusListNatural(action.warnings);
    var text =
      "*" + name + "* Heads up — multiple things happening with " + name + " at the same time:\n" +
      bullets.join("\n") + "\n\n" +
      "Ask for a direct call at the end of your next Loom feedback. " +
      "Cover the regular check-in feedback first, then close the Loom by asking for the call.\n\n" +
      "*How to ask for the call in the Loom:*\n" +
      "_\"Before I wrap up, I need to bring something up with you. " +
      "There are a few things going on right now at the same time that I'm concerned about, " +
      "and at this point I don't want to keep pushing the same plan without understanding what's really going on. " +
      "I'd like to get on a call with you this week so we can figure this out together. " +
      "Reply to this Loom letting me know if you're up for it, and if yes I'll send you my calendar link.\"_\n\n" +
      "*When the call happens — opener:*\n" +
      "_\"Hey " + name + ", good to see you, thanks for making space for this. " +
      "How's your week going so far?\"_ [let them answer] " +
      "_\"So, I want to tell you why I asked for the call. " +
      "There's a few things going on at the same time that I want to talk through with you — " +
      focusNatural + " — " +
      "and before I keep adjusting the plan I wanted to sit down with you and understand what's really going on.\"_\n" +
      FOUR_QS_NATURAL;
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
    var focusNatural = buildFocusListNatural(action.warnings);
    var headsUpNatural = buildHeadsUpListNatural(action.notifications);

    var warningHeader = action.warnings.length > 1
      ? "Main topics for the call:"
      : "Main topic for the call:";
    var notifHeader = action.notifications.length > 1
      ? "While you're at it, also heads up on these:"
      : "While you're at it, also heads up:";

    var text =
      "*" + name + "* Ask for a direct call at the end of your next Loom feedback with " + name + ". " +
      "Cover the regular check-in feedback first, then close the Loom by asking for the call.\n\n" +
      warningHeader + "\n" +
      warningBullets.join("\n") + "\n\n" +
      notifHeader + "\n" +
      notifBullets.join("\n") + "\n\n" +
      "*How to ask for the call in the Loom:*\n" +
      "_\"Before I wrap up, I need to bring something up with you. " +
      "There are a few things going on right now that I'm concerned about, " +
      "and at this point I don't want to keep pushing the same plan without understanding what's really going on. " +
      "I'd like to get on a call with you this week so we can figure this out together. " +
      "Reply to this Loom letting me know if you're up for it, and if yes I'll send you my calendar link.\"_\n\n" +
      "*When the call happens — opener:*\n" +
      "_\"Hey " + name + ", good to see you, thanks for making space for this. " +
      "How's your week going so far?\"_ [let them answer] " +
      "_\"So, I want to tell you why I asked for the call. " +
      "The main thing on my mind is " + focusNatural + " — that's what I really want to dig into with you today. " +
      "There's also a couple of other patterns I've been noticing — " + headsUpNatural + " — " +
      "that I want to mention, but the priority is " + focusNatural + ".\"_\n" +
      FOUR_QS_NATURAL + " (primarily about the main focus)";
    return { variant: "Multi-Warning-Plus-Notif", text: text };
  }

  // Multi-Notification: multiple Notifications, NO Warnings.
  function multiNotification(action) {
    var name = action.client;
    var bullets = action.notifications.map(function (n) {
      return "• " + bulletForNotification(n);
    });
    var topicsNatural = buildTopicsListNatural(action.notifications);
    var text =
      "*" + name + "* Heads up — a few things happening with " + name + " at the same time:\n" +
      bullets.join("\n") + "\n\n" +
      "If any of these happen again this week, do a call-out at the end of your next Loom feedback about " +
      topicsNatural + ". " +
      "Cover the regular check-in feedback first, then close the Loom with the call-out. " +
      FOUR_QUESTIONS + "\n\n" +
      "*How to close the Loom:*\n" +
      "_\"Before I wrap up, I want to bring something up with you. " +
      "The last couple of weeks I've been noticing a few different things slipping at the same time — " +
      topicsNatural + " — " +
      "and I want to understand what's going on before we keep going. " +
      "Maybe the plan isn't realistic with your life right now, " +
      "maybe some of this has been hard to prioritize, maybe you need a different approach from me. " +
      "Or maybe there's something else happening I don't know about. " +
      "Reply to this Loom and let me know what feels closest, and from there we adjust.\"_";
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

    // ----- Single-pathway path -----
    if (totalPathways === 1) {
      var only = W[0] || N[0];
      var isWarning = W.length === 1;
      var d = {
        client_name: action.client,
        pathway: only.pathway,
        standard: only.standard,
        streakLength: only.streakLength,
        streakWeeks: only.streakWeeks || [],
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

  // Acknowledgment template — unchanged.
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
      describeP3Week: describeP3Week,
      buildWeeklyBreakdown: buildWeeklyBreakdown,
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
