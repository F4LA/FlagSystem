/**
 * Flag System Dashboard — Queue Builder
 *
 * Slices the full client-state list and the HC Actions log into the
 * three sections of Tab 1 (Friday Action Queue), per TDD v1.0 §5.1.
 *
 * Sections:
 *   COACHES: pathway-driven actions to deliver to coaches via Slack.
 *     Each entry = one pathway state needing Notification, Warning, or
 *     a RedWindow case that still needs a Slack from HC.
 *     Grouped by coach. Ordered Red → Yellow Warning → Yellow Notification.
 *
 *   DIRECT CLIENT ACTIONS: Post-Red flow items.
 *     Clients with an open Post-Red action chain (HC email/call pending).
 *
 *   COMPLETED THIS WEEK: read-only list of HC Actions logged in the
 *     current ISO week.
 */
(function (root) {
  "use strict";

  // ---------- ISO week helpers ----------
  function isoWeekKey(date) {
    // Returns "YYYY-Www" per ISO 8601.
    var d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    // Thursday in current week determines the year.
    var dayNum = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - dayNum);
    var yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    var weekNum = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
    return d.getUTCFullYear() + "-W" + (weekNum < 10 ? "0" + weekNum : weekNum);
  }

  // Severity rank for ordering inside a coach group.
  // Lower number = more urgent (sorted ascending).
  function severityRank(pathwayEntry) {
    // Red first
    if (pathwayEntry.color === "Red") return 0;
    // Yellow Warning
    if (pathwayEntry.colorReason === "warning") return 1;
    // Yellow RedWindow awaiting call (treat as Warning-level urgency)
    if (pathwayEntry.colorReason === "red-window-awaiting-call") return 1;
    // Yellow Notification
    if (pathwayEntry.colorReason === "notification") return 2;
    return 3;
  }

  // Decide the Slack action type to log when HC clicks "Mark sent".
  function slackActionTypeFor(pathwayEntry) {
    if (pathwayEntry.colorReason === "warning") return "Slack: Warning";
    if (pathwayEntry.colorReason === "notification") return "Slack: Notification";
    if (pathwayEntry.colorReason === "red-window-call-asked") return "Slack: Warning";
    if (pathwayEntry.colorReason === "red-window-awaiting-call") return "Slack: Warning";
    return "Slack: Notification";
  }

  // Display label for the action type column in the row.
  function actionLabelFor(pathwayEntry) {
    if (pathwayEntry.color === "Red") return "Slack: Warning (Red)";
    if (pathwayEntry.colorReason === "warning") return "Slack: Warning";
    if (pathwayEntry.colorReason === "red-window-awaiting-call") return "Slack: Warning";
    if (pathwayEntry.colorReason === "notification") return "Slack: Notification";
    return null;
  }

  function pathwayLabel(entry) {
    // Examples: "P1 Week 2", "P2 Nutrition Week 3", "P3 Week 4"
    var weekN = entry.streakLength || entry.weekOfPathway || 0;
    if (entry.pathway === "P2") {
      var short = (root.FlagConfig && root.FlagConfig.STANDARD_SHORT_NAMES) || {};
      var s = short[entry.standard] || entry.standard;
      return "P2 " + s + " Week " + weekN;
    }
    return entry.pathway + " Week " + weekN;
  }

  // Extract every pathway state that needs a coach-facing Slack right now.
  // Yields one entry per pathway (P1, each active P2, P3) per client.
  function collectCoachActions(state) {
    var out = [];
    var ps = state.pathwayStates || {};

    function consider(entry) {
      if (!entry || !entry.active) {
        // Post-Red tracking (active=false but colorReason=post-red-tracking)
        // is handled in collectDirectClientActions, not here.
        return;
      }
      if (entry.color === "Green") return;
      // Skip RedWindow cases where coach already asked for call — handled
      // via Post-Red Resolution Path (Direct Client Actions). The HC's
      // next move is with the client, not the coach.
      if (entry.colorReason === "red-window-call-asked") return;

      var actionType = slackActionTypeFor(entry);
      if (!actionType) return;

      out.push({
        kind: "coach-slack",
        client: state.clientName,
        coach: state.coach,
        pathway: entry.pathway,
        standard: entry.standard || null,
        streakLength: entry.streakLength || 0,
        color: entry.color,
        colorReason: entry.colorReason,
        expectedAction: entry.expectedAction,
        actionType: actionType,
        actionLabel: actionLabelFor(entry),
        pathwayLabel: pathwayLabel(entry),
        templateData: entry.templateData || null
      });
    }

    if (ps.p1) consider(ps.p1);
    (ps.p2 || []).forEach(function (p2) {
      // Attach standard for label/template
      var withStd = Object.assign({}, p2, { standard: p2.standard });
      consider(withStd);
    });
    if (ps.p3) consider(ps.p3);
    return out;
  }

  // Identify clients in Post-Red Resolution Path. They appear in Direct
  // Client Actions until a closing action is logged. Determines what
  // buttons to show based on the latest open action.
  //
  // POST_RED_OPEN action types (from color-deriver.js):
  //   "Coach Call Outcome: Did Not Resolve",
  //   "Coach Call Outcome: Client No Response",
  //   "Coach Call Outcome: Client Declined",
  //   "HC Email: Sent",
  //   "HC Email: Follow-up",
  //   "HC Call: Scheduled",
  //   "HC Call: Did Not Resolve"
  function collectDirectClientActions(state, hcActions) {
    var clientActions = (hcActions || []).filter(function (a) {
      return a.client && state.clientName &&
        a.client.toLowerCase().trim() === state.clientName.toLowerCase().trim();
    });
    // Get the most recent action per pathway/standard combo.
    // For v1 simplicity: if ANY pathway has colorReason "post-red-tracking",
    // surface ONE row per such pathway with buttons based on the latest
    // open action across that pathway/standard.
    var rows = [];
    var ps = state.pathwayStates || {};

    function latestActionFor(pathwayCode, standard) {
      var sorted = clientActions
        .filter(function (a) {
          if (a.pathway !== pathwayCode) return false;
          if (pathwayCode === "P2" && standard) {
            // Tolerate short and long form standard names.
            var s = (a.standard || "").toLowerCase();
            var target = standard.toLowerCase();
            var shortMap = (root.FlagConfig && root.FlagConfig.STANDARD_SHORT_NAMES) || {};
            var alt = (shortMap[standard] || "").toLowerCase();
            if (s !== target && s !== alt) return false;
          }
          return true;
        })
        .sort(function (a, b) {
          var ta = a.timestamp ? a.timestamp.getTime() : 0;
          var tb = b.timestamp ? b.timestamp.getTime() : 0;
          return tb - ta;
        });
      return sorted[0] || null;
    }

    function buttonsForLatest(latest) {
      if (!latest) {
        // Coach call outcome forced HC to take over but HC hasn't acted.
        // First HC step is sending the email.
        return [
          { label: "Mark HC email sent", actionType: "HC Email: Sent", primary: true }
        ];
      }
      switch (latest.actionType) {
        case "Coach Call Outcome: Did Not Resolve":
        case "Coach Call Outcome: Client No Response":
        case "Coach Call Outcome: Client Declined":
          return [
            { label: "Mark HC email sent", actionType: "HC Email: Sent", primary: true }
          ];
        case "HC Email: Sent":
          return [
            { label: "Mark follow-up sent", actionType: "HC Email: Follow-up", primary: true },
            { label: "Mark client responded", actionType: "HC Call: Scheduled" }
          ];
        case "HC Email: Follow-up":
          return [
            { label: "Mark client responded", actionType: "HC Call: Scheduled", primary: true }
          ];
        case "HC Call: Scheduled":
          return [
            { label: "Mark call resolved", actionType: "HC Call: Resolved", primary: true },
            { label: "Mark call did not resolve", actionType: "HC Call: Did Not Resolve" }
          ];
        case "HC Call: Did Not Resolve":
          return [
            { label: "Trigger Black Flag", actionType: "Black Flag: Triggered", primary: true }
          ];
        default:
          return [];
      }
    }

    function describeContext(latest) {
      if (!latest) return "HC action pending";
      if (latest.actionType === "HC Email: Sent") {
        var days = latest.timestamp
          ? Math.floor((Date.now() - latest.timestamp.getTime()) / 86400000)
          : "?";
        return "Post-Red, Day " + days + " since HC email";
      }
      if (latest.actionType === "HC Email: Follow-up") {
        return "Post-Red, follow-up sent";
      }
      if (latest.actionType === "HC Call: Scheduled") {
        return "HC Call scheduled";
      }
      if (latest.actionType === "HC Call: Did Not Resolve") {
        return "HC Call did not resolve — Black Flag threshold";
      }
      if (latest.actionType && latest.actionType.indexOf("Coach Call Outcome:") === 0) {
        return latest.actionType.replace("Coach Call Outcome: ", "Coach call: ");
      }
      return latest.actionType;
    }

    function emitRow(pathwayCode, standard, label) {
      var latest = latestActionFor(pathwayCode, standard);
      rows.push({
        kind: "direct-client",
        client: state.clientName,
        coach: state.coach,
        pathway: pathwayCode,
        standard: standard || null,
        pathwayLabel: label,
        contextLine: describeContext(latest),
        buttons: buttonsForLatest(latest),
        latestActionType: latest ? latest.actionType : null
      });
    }

    if (ps.p1 && ps.p1.colorReason === "post-red-tracking") {
      emitRow("P1", null, "P1");
    } else if (ps.p1 && ps.p1.colorReason === "red-window-call-asked") {
      emitRow("P1", null, "P1");
    }

    (ps.p2 || []).forEach(function (p2) {
      if (p2.colorReason === "post-red-tracking" || p2.colorReason === "red-window-call-asked") {
        var short = (root.FlagConfig && root.FlagConfig.STANDARD_SHORT_NAMES) || {};
        var s = short[p2.standard] || p2.standard;
        emitRow("P2", p2.standard, "P2 " + s);
      }
    });

    if (ps.p3 && ps.p3.colorReason === "post-red-tracking") {
      emitRow("P3", null, "P3");
    } else if (ps.p3 && ps.p3.colorReason === "red-window-call-asked") {
      emitRow("P3", null, "P3");
    }

    return rows;
  }

  // ---------- Main builder ----------
  function build(states, hcActions, options) {
    var opts = options || {};
    var now = opts.now || new Date();
    var currentWeek = isoWeekKey(now);

    // 1. Coach actions.
    var coachActions = [];
    var directActions = [];
    for (var i = 0; i < states.length; i++) {
      var s = states[i];
      coachActions = coachActions.concat(collectCoachActions(s));
      directActions = directActions.concat(collectDirectClientActions(s, hcActions));
    }

    // 2. Group coach actions by coach, sort within group.
    var byCoach = Object.create(null);
    coachActions.forEach(function (a) {
      var k = a.coach || "Unassigned";
      if (!byCoach[k]) byCoach[k] = [];
      byCoach[k].push(a);
    });
    var coachGroups = Object.keys(byCoach).sort().map(function (coach) {
      var list = byCoach[coach].slice().sort(function (a, b) {
        var ra = severityRank(a) - severityRank(b);
        if (ra !== 0) return ra;
        return a.client.localeCompare(b.client);
      });
      return { coach: coach, actions: list, count: list.length };
    });

    // 3. Direct client actions: severity-then-name.
    directActions.sort(function (a, b) {
      // Push "Trigger Black Flag" cases to the top.
      function urgency(row) {
        if (row.latestActionType === "HC Call: Did Not Resolve") return 0;
        if (row.latestActionType === "HC Call: Scheduled") return 1;
        if (row.latestActionType && row.latestActionType.indexOf("HC Email") === 0) return 2;
        return 3;
      }
      var u = urgency(a) - urgency(b);
      if (u !== 0) return u;
      return a.client.localeCompare(b.client);
    });

    // 4. Completed this week: filter HC Actions to current ISO week.
    var completed = (hcActions || [])
      .filter(function (a) {
        if (!a.timestamp) return false;
        return isoWeekKey(a.timestamp) === currentWeek;
      })
      .sort(function (a, b) {
        return (b.timestamp ? b.timestamp.getTime() : 0) -
               (a.timestamp ? a.timestamp.getTime() : 0);
      });

    var totalCoachActions = coachActions.length;

    return {
      currentWeek: currentWeek,
      coachGroups: coachGroups,
      totalCoachActions: totalCoachActions,
      totalCoaches: coachGroups.length,
      directActions: directActions,
      completed: completed
    };
  }

  root.QueueBuilder = {
    build: build,
    _internal: {
      isoWeekKey: isoWeekKey,
      severityRank: severityRank,
      collectCoachActions: collectCoachActions,
      collectDirectClientActions: collectDirectClientActions
    }
  };
})(typeof window !== "undefined" ? window : this);
