/**
 * Flag System Dashboard — Queue Builder (v2: consolidated per client)
 *
 * Slices the full client-state list and the HC Actions log into the
 * three sections of Tab 1 (Friday Action Queue), per TDD v1.0 §5.1
 * with the operational rule update of May 2026:
 *
 *   ONE ACTION PER CLIENT. When a client has multiple active pathways,
 *   they consolidate into a single Slack to the coach based on:
 *
 *     1. Red wins: if any pathway has color Red and not in Post-Red
 *        tracking, the client goes to Direct Client Actions (Post-Red
 *        Resolution Path). No combined Slack.
 *
 *     2. Warning level (urgency = "ask for direct call"):
 *        All active Warnings combine. If Notifications are ALSO active,
 *        they get appended as secondary heads-up context.
 *
 *     3. Notification level (urgency = "call-out on next check-in"):
 *        Only fires if NO Warning is active. All active Notifications
 *        combine into a single call-out message.
 *
 *   Slack templates handle the multi-pathway rendering. queue-builder
 *   only produces the consolidated action descriptor.
 *
 * Sections:
 *   COACHES: one entry per client needing coach-facing Slack.
 *     Grouped by coach. Ordered Warning-level first, then Notification.
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
    var d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    var dayNum = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - dayNum);
    var yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    var weekNum = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
    return d.getUTCFullYear() + "-W" + (weekNum < 10 ? "0" + weekNum : weekNum);
  }

  // ---------- Pathway descriptor helpers ----------
  function pathwayShortLabel(entry) {
    // "P1", "P2 Nutrition", "P3"
    if (entry.pathway === "P2") {
      var short = (root.FlagConfig && root.FlagConfig.STANDARD_SHORT_NAMES) || {};
      var s = short[entry.standard] || entry.standard;
      return "P2 " + s;
    }
    return entry.pathway;
  }

  function pathwayLabelWithWeek(entry) {
    var weekN = entry.streakLength || entry.weekOfPathway || 0;
    return pathwayShortLabel(entry) + " Week " + weekN;
  }

  // Build a normalized entry that we can iterate over uniformly. P2 array
  // gets one normalized entry per active standard.
  function flattenActivePathways(state) {
    var ps = state.pathwayStates || {};
    var out = [];
    if (ps.p1 && ps.p1.active && ps.p1.color !== "Green") {
      out.push(Object.assign({}, ps.p1, { _key: "P1" }));
    }
    (ps.p2 || []).forEach(function (p2) {
      if (p2 && p2.active && p2.color !== "Green") {
        out.push(Object.assign({}, p2, { _key: "P2:" + p2.standard }));
      }
    });
    if (ps.p3 && ps.p3.active && ps.p3.color !== "Green") {
      out.push(Object.assign({}, ps.p3, { _key: "P3" }));
    }
    return out;
  }

  // ---------- Consolidation rule ----------
  //
  // Returns ONE consolidated action descriptor per client, or null if no
  // coach-facing Slack is due.
  //
  // Output shape:
  //   {
  //     kind: "coach-slack",
  //     client, coach,
  //     level: "Warning" | "Notification",
  //     actionType: "Slack: Warning" | "Slack: Notification",
  //     warnings: [pathwayEntry, ...],    // empty if level is Notification
  //     notifications: [pathwayEntry, ...], // secondary heads-up if level is Warning
  //     pathwayLabel: "..."                 // display label for the row
  //   }
  function buildClientAction(state) {
    var actives = flattenActivePathways(state);
    if (actives.length === 0) return null;

    // Filter out pathways that are in Post-Red tracking. Those are HC
    // domain, not coach-facing — they go to collectDirectClientActions.
    var coachFacing = actives.filter(function (e) {
      // post-red-tracking and red-window-call-asked belong to Direct Client.
      return e.colorReason !== "post-red-tracking" &&
             e.colorReason !== "red-window-call-asked";
    });
    if (coachFacing.length === 0) return null;

    // Split by level.
    var warnings = [];
    var notifications = [];
    coachFacing.forEach(function (e) {
      // colorReason values we care about:
      //   "warning"               -> Warning
      //   "red-window-awaiting-call" -> Warning level (coach should escalate)
      //   "notification"          -> Notification
      if (e.colorReason === "warning" || e.colorReason === "red-window-awaiting-call") {
        warnings.push(e);
      } else if (e.colorReason === "notification") {
        notifications.push(e);
      }
    });

    if (warnings.length === 0 && notifications.length === 0) return null;

    // OPERATIONAL RULE (May 2026): If P1 Warning is active, suppress P2
    // Notifications from the same client to avoid redundancy. P1 Warning
    // already describes which standards failed in the acute crisis week(s);
    // listing P2 Notifications for those same standards would just repeat
    // the information. P2 Warnings (3+ weeks) and P3 Notifications/Warnings
    // ARE kept because they convey cronicity information that P1 doesn't.
    var hasP1Warning = warnings.some(function (w) { return w.pathway === "P1"; });
    if (hasP1Warning) {
      notifications = notifications.filter(function (n) {
        return n.pathway !== "P2";
      });
    }

    var level, actionType, pathwayLabelStr;
    if (warnings.length > 0) {
      level = "Warning";
      actionType = "Slack: Warning";
      // Label: list the warning pathways. If notifications also exist,
      // append a "+N more" hint so HC sees there's secondary content.
      var warnLabels = warnings.map(pathwayShortLabel);
      pathwayLabelStr = warnLabels.join(" + ");
      if (notifications.length > 0) {
        pathwayLabelStr += " (+" + notifications.length + " heads-up)";
      }
    } else {
      level = "Notification";
      actionType = "Slack: Notification";
      var notifLabels = notifications.map(pathwayShortLabel);
      pathwayLabelStr = notifLabels.join(" + ");
    }

    return {
      kind: "coach-slack",
      client: state.clientName,
      coach: state.coach,
      level: level,
      actionType: actionType,
      warnings: warnings,
      notifications: notifications,
      pathwayLabel: pathwayLabelStr,
      // Detailed labels for the row's secondary line (with week counts).
      warningsDetail: warnings.map(pathwayLabelWithWeek),
      notificationsDetail: notifications.map(pathwayLabelWithWeek)
    };
  }

  // ---------- Direct Client Actions (Post-Red) ----------
  function collectDirectClientActions(state, hcActions) {
    var clientActions = (hcActions || []).filter(function (a) {
      return a.client && state.clientName &&
        a.client.toLowerCase().trim() === state.clientName.toLowerCase().trim();
    });
    var rows = [];
    var ps = state.pathwayStates || {};

    function latestActionFor(pathwayCode, standard) {
      var sorted = clientActions
        .filter(function (a) {
          if (a.pathway !== pathwayCode) return false;
          if (pathwayCode === "P2" && standard) {
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
      if (latest.actionType === "HC Email: Follow-up") return "Post-Red, follow-up sent";
      if (latest.actionType === "HC Call: Scheduled") return "HC Call scheduled";
      if (latest.actionType === "HC Call: Did Not Resolve") return "HC Call did not resolve — Black Flag threshold";
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

    if (ps.p1 && (ps.p1.colorReason === "post-red-tracking" || ps.p1.colorReason === "red-window-call-asked")) {
      emitRow("P1", null, "P1");
    }
    (ps.p2 || []).forEach(function (p2) {
      if (p2.colorReason === "post-red-tracking" || p2.colorReason === "red-window-call-asked") {
        var short = (root.FlagConfig && root.FlagConfig.STANDARD_SHORT_NAMES) || {};
        var s = short[p2.standard] || p2.standard;
        emitRow("P2", p2.standard, "P2 " + s);
      }
    });
    if (ps.p3 && (ps.p3.colorReason === "post-red-tracking" || ps.p3.colorReason === "red-window-call-asked")) {
      emitRow("P3", null, "P3");
    }
    return rows;
  }

  // ---------- Main builder ----------
  function build(states, hcActions, options) {
    var opts = options || {};
    var now = opts.now || new Date();
    var currentWeek = isoWeekKey(now);

    var coachActions = [];
    var directActions = [];
    for (var i = 0; i < states.length; i++) {
      var s = states[i];
      var ca = buildClientAction(s);
      if (ca) coachActions.push(ca);
      directActions = directActions.concat(collectDirectClientActions(s, hcActions));
    }

    // Group coach actions by coach. Within group: Warnings before
    // Notifications, then alphabetic by client.
    var byCoach = Object.create(null);
    coachActions.forEach(function (a) {
      var k = a.coach || "Unassigned";
      if (!byCoach[k]) byCoach[k] = [];
      byCoach[k].push(a);
    });
    var coachGroups = Object.keys(byCoach).sort().map(function (coach) {
      var list = byCoach[coach].slice().sort(function (a, b) {
        if (a.level !== b.level) {
          // Warning before Notification
          return a.level === "Warning" ? -1 : 1;
        }
        return a.client.localeCompare(b.client);
      });
      return { coach: coach, actions: list, count: list.length };
    });

    // Direct client actions: severity-then-name.
    directActions.sort(function (a, b) {
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

    // Completed this week.
    var completed = (hcActions || [])
      .filter(function (a) {
        if (!a.timestamp) return false;
        return isoWeekKey(a.timestamp) === currentWeek;
      })
      .sort(function (a, b) {
        return (b.timestamp ? b.timestamp.getTime() : 0) -
               (a.timestamp ? a.timestamp.getTime() : 0);
      });

    return {
      currentWeek: currentWeek,
      coachGroups: coachGroups,
      totalCoachActions: coachActions.length,
      totalCoaches: coachGroups.length,
      directActions: directActions,
      completed: completed
    };
  }

  root.QueueBuilder = {
    build: build,
    _internal: {
      isoWeekKey: isoWeekKey,
      buildClientAction: buildClientAction,
      collectDirectClientActions: collectDirectClientActions,
      pathwayShortLabel: pathwayShortLabel,
      pathwayLabelWithWeek: pathwayLabelWithWeek,
      flattenActivePathways: flattenActivePathways
    }
  };
})(typeof window !== "undefined" ? window : this);
