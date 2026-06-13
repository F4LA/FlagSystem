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

  // ---------- Week key helpers ----------
  //
  // Two distinct week concepts are used here:
  //
  //   queueWeek    = the most recently CLOSED Coaching Week (Thu–Wed).
  //                  This is what the HC reviews on Thursday morning. It
  //                  remains stable from Thursday 00:00 ET through the
  //                  following Wednesday 23:59 ET.
  //
  //   completedWeek = the Coaching Week currently IN PROGRESS. HC actions
  //                   logged during this window appear in "Completed This
  //                   Week" so the HC can see the work they've done since
  //                   opening the queue on Thursday.
  //
  // Both use CoachingWeek (Thu–Wed) format "YYYY-CW##", which is
  // consistent with how the engine (pathway-engine.js + client-timeline.js)
  // analyzes data.
  //
  // Legacy ISO week (YYYY-Www, Mon–Sun) is retained as `currentWeek` in
  // the return value to preserve backward compatibility with anything
  // downstream that may still expect it (e.g. actions-writer payloads
  // and Tab2/3/4 references).
  function isoWeekKey(date) {
    var d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    var dayNum = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - dayNum);
    var yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    var weekNum = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
    return d.getUTCFullYear() + "-W" + (weekNum < 10 ? "0" + weekNum : weekNum);
  }

  function getCoachingWeekModule() {
    if (!root.CoachingWeek) {
      throw new Error(
        "queue-builder.js: CoachingWeek module not loaded. " +
        "Check that engine/coaching-week.js is included before this script."
      );
    }
    return root.CoachingWeek;
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

    // Per Overview v3.5 & SOP §2.1: once a client has ANY pathway in Post-Red,
    // the HC manages them directly. They appear ONLY in Direct Client Actions,
    // never in the coach Slack queue — sending the coach "ask for a call" while
    // the HC is emailing the client directly is contradictory. So if any active
    // pathway is in Post-Red, suppress the coach Slack for the whole client.
    var inPostRed = actives.some(function (e) {
      return e.colorReason === "post-red-tracking" ||
             e.colorReason === "red-window-call-asked";
    });
    if (inPostRed) return null;

    // Remaining pathways (none Post-Red after the guard above) are coach-facing.
    var coachFacing = actives.filter(function (e) {
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

  // ---------- Post-Red grace / "park" computation ----------
  //
  // Decides whether a Post-Red client's HC-email prompt should be suppressed
  // ("parked") this week. The client is NEVER hidden — callers render parked
  // rows visibly (greyed), just without the email prompt. Design (agreed):
  //   1. Manual HC override ("HC: Park" until a date) always wins.
  //   2. Else, if the coach logged "Client accepted" + a call date (form col I):
  //        - hold the email until the first EVALUABLE coaching week AFTER the
  //          call date exists;
  //        - then: a problem pathway still failing -> email (call didn't work);
  //          clean -> stay parked (engine resolves to Green after 2 clean weeks);
  //        - a pathway that went Red AFTER the call date -> new problem -> email.
  //   3. Declined / no-response / escalated / no date -> not parked (email now).
  // Engine is only READ here (ClientTimeline) — never modified.
  var PARK_ACTION = "HC: Park";
  var UNPARK_ACTION = "HC: Unpark";
  var ACCEPTED_CALL = "Client accepted";

  function qbParseDate(v) {
    if (!v) return null;
    if (v instanceof Date) return isNaN(v.getTime()) ? null : v;
    var d = new Date(v);
    return isNaN(d.getTime()) ? null : d;
  }

  function qbSameClient(a, b) {
    return String(a || "").toLowerCase().trim() === String(b || "").toLowerCase().trim();
  }

  function qbFmtDate(d) {
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/New_York" });
  }

  // One "fails this week" predicate per active Post-Red pathway.
  function qbProblemPredicates(postRed) {
    return (postRed || []).map(function (p) {
      if (p.pathway === "P1") return function (wr) { return (wr.points || 0) >= 5; };
      if (p.pathway === "P3") return function (wr) { return (wr.failedStandards || []).length > 0; };
      var std = p.standard;
      return function (wr) { return (wr.failedStandards || []).indexOf(std) !== -1; };
    });
  }

  function computeParkState(state, postRed, formResponses, clientActions, now) {
    now = now || new Date();

    // 1. Manual override wins (latest Park/Unpark for the client).
    var parkRows = (clientActions || []).filter(function (a) {
      return a && a.timestamp && (a.actionType === PARK_ACTION || a.actionType === UNPARK_ACTION);
    }).sort(function (a, b) { return a.timestamp.getTime() - b.timestamp.getTime(); });
    var lastPark = parkRows[parkRows.length - 1];
    if (lastPark && lastPark.actionType === PARK_ACTION) {
      var until = qbParseDate(lastPark.followUpDueDate);
      if (until && until.getTime() > now.getTime()) {
        return { parked: true, until: until, reason: "manual", note: lastPark.notes || "" };
      }
    }

    // 2. Auto-grace from the form call-date.
    if (!Array.isArray(formResponses)) return { parked: false };
    var subs = formResponses
      .filter(function (r) { return r && r[0] && qbSameClient(r[1], state.clientName); })
      .sort(function (a, b) {
        var ta = qbParseDate(a[0]), tb = qbParseDate(b[0]);
        return (tb ? tb.getTime() : 0) - (ta ? ta.getTime() : 0);
      });
    var callSub = null;
    for (var i = 0; i < subs.length; i++) {
      if (String(subs[i][6] || "").trim() !== "") { callSub = subs[i]; break; }
    }
    if (!callSub) return { parked: false };
    var response = String(callSub[6]).trim();
    var callDate = qbParseDate(callSub[8]); // col I (index 8) = call scheduled date
    if (response !== ACCEPTED_CALL || !callDate) return { parked: false };

    // A pathway whose streak began AFTER the call = new problem -> email.
    for (var k = 0; k < (postRed || []).length; k++) {
      var sw = postRed[k].streakWeeks || [];
      var start = sw.length ? qbParseDate(sw[0].weekStart) : null;
      if (start && start.getTime() > callDate.getTime()) {
        return { parked: false };
      }
    }

    // Inspect post-call EVALUABLE weeks via the engine timeline (read-only).
    var timeline = [];
    if (root.ClientTimeline && typeof root.ClientTimeline.buildClientTimeline === "function") {
      try {
        timeline = root.ClientTimeline.buildClientTimeline(state.clientName, formResponses, {
          lookbackWeeks: (root.FlagConfig && root.FlagConfig.LOOKBACK_WEEKS) || 16,
          currentDate: now
        });
      } catch (e) { timeline = []; }
    }
    var postCallEval = timeline.filter(function (wr) {
      var ws = qbParseDate(wr.weekStart);
      return ws && ws.getTime() > callDate.getTime() && wr.status === "evaluable";
    });

    // No evaluable post-call week yet -> keep giving the call a chance.
    if (postCallEval.length === 0) {
      return { parked: true, until: null, reason: "grace",
               note: "Coach call accepted — scheduled " + qbFmtDate(callDate) };
    }

    // A problem pathway still fails in a post-call week -> email.
    var preds = qbProblemPredicates(postRed);
    var stillFailing = postCallEval.some(function (wr) {
      return preds.some(function (pred) { return pred(wr); });
    });
    if (stillFailing) return { parked: false };

    // Problem pathways clean post-call -> improving; engine will resolve to Green.
    return { parked: true, until: null, reason: "improving",
             note: "Improving since coach call (" + qbFmtDate(callDate) + ")" };
  }

  // ---------- Direct Client Actions (Post-Red) ----------
  function collectDirectClientActions(state, hcActions, formResponses, now) {
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

    function postRedActive(entry) {
      return entry && (entry.colorReason === "post-red-tracking" ||
                       entry.colorReason === "red-window-call-asked");
    }

    // Collect EVERY Post-Red pathway for this client into ONE consolidated
    // row. The HC manages the client directly (one support email covers the
    // whole person), not each pathway separately. See SOP §2.2 / TDD §5.1.
    var postRed = [];
    if (postRedActive(ps.p1)) {
      postRed.push({ pathway: "P1", standard: null, label: "P1",
                     streakLength: ps.p1.streakLength || 0,
                     streakWeeks: ps.p1.streakWeeks || [] });
    }
    (ps.p2 || []).forEach(function (p2) {
      if (postRedActive(p2)) {
        var short = (root.FlagConfig && root.FlagConfig.STANDARD_SHORT_NAMES) || {};
        var s = short[p2.standard] || p2.standard;
        postRed.push({ pathway: "P2", standard: p2.standard, label: "P2 " + s,
                       streakLength: p2.streakLength || 0,
                       streakWeeks: p2.streakWeeks || [] });
      }
    });
    if (postRedActive(ps.p3)) {
      postRed.push({ pathway: "P3", standard: null, label: "P3",
                     streakLength: ps.p3.streakLength || 0,
                     streakWeeks: ps.p3.streakWeeks || [] });
    }

    if (postRed.length === 0) return rows;

    // Client-level chain position: the most recent Post-Red CHAIN action
    // (HC emails/calls, coach-call outcomes). Coach Slack actions ("Slack: …")
    // and audit notes are NOT part of the HC chain and must be ignored —
    // otherwise a client whose only logged action is the coach "Slack: Warning"
    // resolves to no actionable button at all. With them excluded, a fresh
    // Post-Red client correctly falls back to the first step
    // ("HC action pending" → "Mark HC email sent").
    var latest = (clientActions || [])
      .filter(function (a) {
        return a && a.timestamp && a.actionType &&
               a.actionType.indexOf("Slack:") !== 0 &&
               a.actionType.indexOf("Coach Audit Note") !== 0;
      })
      .sort(function (a, b) {
        return b.timestamp.getTime() - a.timestamp.getTime();
      })[0] || null;

    var pathwayLabel = postRed.map(function (p) {
      return p.label + (p.streakLength ? " (" + p.streakLength + "w)" : "");
    }).join(" · ");

    // Grace / park: should the HC-email prompt be suppressed this week?
    var park = computeParkState(state, postRed, formResponses, clientActions, now);

    rows.push({
      kind: "direct-client",
      client: state.clientName,
      coach: state.coach,
      park: park,                   // { parked, until, reason, note }
      // Primary pathway kept for backward-compat with any single-pathway
      // consumer; the full set lives in `pathways`.
      pathway: postRed[0].pathway,
      standard: postRed[0].standard,
      pathways: postRed,            // all Post-Red pathways (fan-out + brief)
      pathwayLabel: pathwayLabel,
      contextLine: describeContext(latest),
      buttons: buttonsForLatest(latest),
      latestActionType: latest ? latest.actionType : null,
      clientActions: clientActions  // full HC action history for the brief
    });
    return rows;
  }

  // ---------- Main builder ----------
  function build(states, hcActions, options) {
    var opts = options || {};
    var now = opts.now || new Date();
    var CW = getCoachingWeekModule();

    // The HC reviews the most recently CLOSED Coaching Week (Thu–Wed).
    var queueWeek = CW.closedCoachingWeek(now);
    var queueWeekRange = CW.coachingWeekRange(queueWeek);

    // "Completed This Week" tracks HC actions logged during the Coaching
    // Week currently in progress (Thu of this week through Wed of next).
    var completedWeek = CW.currentCoachingWeek(now);
    var completedWeekRange = CW.coachingWeekRange(completedWeek);

    // Retained for backward compatibility with downstream consumers
    // (Tab2/3/4, actions-writer payloads). Format: YYYY-Www (ISO Mon–Sun).
    var currentWeek = isoWeekKey(now);

    var coachActions = [];
    var directActions = [];
    for (var i = 0; i < states.length; i++) {
      var s = states[i];
      var ca = buildClientAction(s);
      if (ca) coachActions.push(ca);
      directActions = directActions.concat(
        collectDirectClientActions(s, hcActions, opts.formResponses, now)
      );
    }

    // Mark coach actions as alreadyLogged if a matching HC Action exists
    // within the current Coaching Week in progress. Match criteria:
    //   client + coach + actionType ("Slack: Warning" or "Slack: Notification")
    //   AND timestamp within completedWeekRange.
    // This is what persists the "Logged ✓" state across page refreshes.
    var completedStartMs = completedWeekRange.start.getTime();
    var completedEndMs = completedWeekRange.end.getTime();
    coachActions.forEach(function (a) {
      a.alreadyLogged = (hcActions || []).some(function (hca) {
        if (!hca.timestamp) return false;
        var t = hca.timestamp.getTime();
        if (t < completedStartMs || t > completedEndMs) return false;
        return hca.client === a.client &&
               hca.coach === a.coach &&
               hca.actionType === a.actionType;
      });
    });

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
      // Parked (in-grace) clients sink to the bottom — visible but not nagging.
      var pa = (a.park && a.park.parked) ? 1 : 0;
      var pb = (b.park && b.park.parked) ? 1 : 0;
      if (pa !== pb) return pa - pb;
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

    // Completed this week. Filter by the Coaching Week currently in
    // progress (Thu of this week through Wed of next), inclusive.
    var completedStart = completedWeekRange.start.getTime();
    var completedEnd = completedWeekRange.end.getTime();
    var completed = (hcActions || [])
      .filter(function (a) {
        if (!a.timestamp) return false;
        var t = a.timestamp.getTime();
        return t >= completedStart && t <= completedEnd;
      })
      .sort(function (a, b) {
        return (b.timestamp ? b.timestamp.getTime() : 0) -
               (a.timestamp ? a.timestamp.getTime() : 0);
      });

    return {
      // Legacy field. Retained so Tab2/3/4 and actions-writer payloads
      // continue working unchanged.
      currentWeek: currentWeek,

      // Coaching Week the queue is analyzing (closed, Thu–Wed).
      queueWeek: queueWeek,
      queueWeekStart: queueWeekRange.start,
      queueWeekEnd: queueWeekRange.end,

      // Coaching Week currently in progress (used for Completed filter).
      completedWeek: completedWeek,
      completedWeekStart: completedWeekRange.start,
      completedWeekEnd: completedWeekRange.end,

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
      computeParkState: computeParkState,
      pathwayShortLabel: pathwayShortLabel,
      pathwayLabelWithWeek: pathwayLabelWithWeek,
      flattenActivePathways: flattenActivePathways
    }
  };
})(typeof window !== "undefined" ? window : this);
