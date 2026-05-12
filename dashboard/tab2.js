/**
 * Flag System Dashboard — Tab 2 (Client Roster Overview)
 *
 * Panoramic table of all active clients with filters, sort, and
 * drill-down to PathwayDetail.
 *
 * Public API:
 *   Tab2.render(states, hcActions, ctx)
 *     states:    array of ClientState objects from StateBuilder
 *     hcActions: raw HC Actions array (passed through to PathwayDetail)
 *     ctx:       { formResponses, currentWeek, onActionLogged }
 *
 * Columns:
 *   Client | Coach | Color | Pathways | This Week | Action Pending | Status
 *
 * Filters:
 *   color (multi), coach (single select), pathway (multi), special (multi),
 *   search (text). All client-side, in-memory.
 *
 * Sort: severity desc -> coach asc -> client asc (default).
 */
(function (root) {
  "use strict";

  // ---------- HTML escape ----------
  function esc(s) {
    if (s === null || s === undefined) return "";
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  // ---------- Severity rank ----------
  function severityRank(color) {
    if (color === "Red") return 0;
    if (color === "Yellow") return 1;
    if (color === "Green") return 2;
    return 3;
  }

  // ---------- Pathway label ----------
  function activePathwayLabels(state) {
    var out = [];
    var ps = state.pathwayStates || {};
    if (ps.p1 && ps.p1.active) {
      out.push("P1 W" + (ps.p1.streakLength || 0));
    }
    (ps.p2 || []).forEach(function (p) {
      if (p && p.active) {
        var short = (root.FlagConfig && root.FlagConfig.STANDARD_SHORT_NAMES) || {};
        var s = short[p.standard] || p.standard || "";
        out.push("P2 " + s + " W" + (p.streakLength || 0));
      }
    });
    if (ps.p3 && ps.p3.active) {
      out.push("P3 W" + (ps.p3.streakLength || 0));
    }
    return out;
  }

  function activePathwayCodes(state) {
    // Used for filter matching (just codes, no week).
    var out = {};
    var ps = state.pathwayStates || {};
    if (ps.p1 && ps.p1.active) out.P1 = true;
    (ps.p2 || []).forEach(function (p) { if (p && p.active) out.P2 = true; });
    if (ps.p3 && ps.p3.active) out.P3 = true;
    return Object.keys(out);
  }

  // ---------- This Week status ----------
  // The lastEvaluableWeek/evaluatedAtWeek represent the most recent
  // closed coaching week. If status === "evaluable" → Submitted.
  // exempt → Exempt. missing/no data → Missing.
  function thisWeekStatus(state) {
    var lw = state.lastEvaluableWeek;
    if (!lw) {
      // No evaluable week at all in the window.
      return { label: "Missing", symbol: "⚠️", cssClass: "tw-missing" };
    }
    // lastEvaluableWeek is always evaluable by definition. But it might
    // not be the most recent week of the timeline. We need to check if
    // the week being evaluated (evaluatedAtWeek) matches lastEvaluableWeek's weekId.
    // If they match → the most recent closed week IS evaluable (submitted).
    // If they don't → the most recent week was either exempt or missing.
    if (state.evaluatedAtWeek && lw.weekId === state.evaluatedAtWeek) {
      return { label: "Submitted", symbol: "✓", cssClass: "tw-submitted" };
    }
    // The most recent week is not evaluable. We can't tell exempt vs missing
    // from the state object alone, so we fall back to a neutral "Not evaluable".
    // The Pathway Detail will show exact status.
    return { label: "Not evaluable", symbol: "—", cssClass: "tw-other" };
  }

  // ---------- Action Pending ----------
  // Derived from current pathway state + recent HC actions.
  // Rules:
  //   - If color === "Red" and a "post-red" colorReason is on any pathway:
  //     check most recent HC action for that client to determine what's pending.
  //   - If any pathway has colorReason 'warning' or 'notification' or
  //     'red-window-awaiting-call' and no Slack logged this week: Slack pending.
  //   - If most recent action is HC Email: Sent (no follow-up yet): Follow-up due.
  //   - If most recent action is HC Call: Scheduled (no resolution): Verify call.
  //   - Else: None.
  function actionPending(state, hcActions, currentWeek) {
    var clientName = String(state.clientName || "").toLowerCase().trim();
    var clientActions = (hcActions || [])
      .filter(function (a) {
        return String(a.client || "").toLowerCase().trim() === clientName;
      })
      .sort(function (a, b) {
        var ta = a.timestamp ? a.timestamp.getTime() : 0;
        var tb = b.timestamp ? b.timestamp.getTime() : 0;
        return tb - ta;
      });

    var latest = clientActions[0] || null;

    // Check for HC Email follow-up / Call verification first (highest urgency).
    if (latest) {
      if (latest.actionType === "HC Email: Sent") {
        // Follow-up rule is 3 days; if more than 3 days have passed without
        // a Follow-up, Response, or Call: Scheduled, mark as Follow-up due.
        var sentTime = latest.timestamp ? latest.timestamp.getTime() : 0;
        var threeDaysMs = 3 * 24 * 60 * 60 * 1000;
        var elapsed = Date.now() - sentTime;
        if (elapsed >= threeDaysMs) {
          return { label: "Follow-up due", cssClass: "ap-followup" };
        }
        return { label: "Email pending response", cssClass: "ap-pending" };
      }
      if (latest.actionType === "HC Email: Follow-up") {
        return { label: "Awaiting response", cssClass: "ap-pending" };
      }
      if (latest.actionType === "HC Call: Scheduled") {
        return { label: "Verify call", cssClass: "ap-verify" };
      }
      if (latest.actionType === "HC Call: Did Not Resolve") {
        return { label: "Black Flag pending", cssClass: "ap-followup" };
      }
    }

    // Check open pathways needing a Slack.
    var ps = state.pathwayStates || {};
    var needsSlack = false;
    function entryNeedsSlack(entry) {
      if (!entry || !entry.active) return false;
      if (entry.color === "Green") return false;
      var reason = entry.colorReason || "";
      if (reason === "warning" || reason === "notification" ||
          reason === "red-window-awaiting-call") {
        return true;
      }
      if (entry.color === "Red") return true;
      return false;
    }
    if (entryNeedsSlack(ps.p1)) needsSlack = true;
    (ps.p2 || []).forEach(function (p) { if (entryNeedsSlack(p)) needsSlack = true; });
    if (entryNeedsSlack(ps.p3)) needsSlack = true;

    if (needsSlack) {
      // Check whether a Slack was already logged this week for this client.
      var slackThisWeek = clientActions.some(function (a) {
        if (!a.actionType) return false;
        if (a.actionType.indexOf("Slack:") !== 0) return false;
        return a.actionWeek === currentWeek;
      });
      if (!slackThisWeek) {
        return { label: "Slack pending", cssClass: "ap-pending" };
      }
    }

    return { label: "None", cssClass: "ap-none" };
  }

  // ---------- Special status ----------
  function specialStatus(state) {
    var out = [];
    if (state.blackFlags && state.blackFlags.active) out.push("Black flag");
    // We don't surface Exempt or Missing Data here at row-level because
    // "This Week" already shows that signal. Keep this for true outliers.
    return out;
  }

  // ---------- Filter state ----------
  var filters = {
    colors: { Red: false, Yellow: false, Green: false },
    coach: "",
    pathways: { P1: false, P2: false, P3: false },
    special: { black: false },
    search: ""
  };

  function passesFilters(state) {
    // Color filter (OR within colors; if none selected, allow all).
    var anyColor = filters.colors.Red || filters.colors.Yellow || filters.colors.Green;
    if (anyColor && !filters.colors[state.color]) return false;

    // Coach filter
    if (filters.coach && state.coach !== filters.coach) return false;

    // Pathway filter (AND across pathways NOT useful; use OR — any selected matches)
    var anyPathway = filters.pathways.P1 || filters.pathways.P2 || filters.pathways.P3;
    if (anyPathway) {
      var codes = activePathwayCodes(state);
      var hit = false;
      if (filters.pathways.P1 && codes.indexOf("P1") >= 0) hit = true;
      if (filters.pathways.P2 && codes.indexOf("P2") >= 0) hit = true;
      if (filters.pathways.P3 && codes.indexOf("P3") >= 0) hit = true;
      if (!hit) return false;
    }

    // Special filter
    if (filters.special.black && !(state.blackFlags && state.blackFlags.active)) return false;

    // Search
    if (filters.search) {
      var q = filters.search.toLowerCase();
      var hay = (state.clientName + " " + (state.coach || "")).toLowerCase();
      if (hay.indexOf(q) === -1) return false;
    }

    return true;
  }

  function compareStates(a, b) {
    var ra = severityRank(a.color);
    var rb = severityRank(b.color);
    if (ra !== rb) return ra - rb;
    var ca = (a.coach || "").toLowerCase();
    var cb = (b.coach || "").toLowerCase();
    if (ca < cb) return -1;
    if (ca > cb) return 1;
    var na = (a.clientName || "").toLowerCase();
    var nb = (b.clientName || "").toLowerCase();
    if (na < nb) return -1;
    if (na > nb) return 1;
    return 0;
  }

  // ---------- Render: filter bar ----------
  function renderFilterBar(allCoaches, totalCount, visibleCount) {
    var html = '<div class="roster-filter-bar">';

    // Search
    html += '<div class="roster-filter-search">';
    html += '<input type="text" id="roster-search" placeholder="Search client or coach…" value="' + esc(filters.search) + '">';
    html += '</div>';

    // Color chips
    html += '<div class="roster-chip-group" data-group="colors">';
    ["Red", "Yellow", "Green"].forEach(function (c) {
      var active = filters.colors[c] ? " is-active" : "";
      html += '<button type="button" class="roster-chip chip-' + c.toLowerCase() + active + '" data-color="' + c + '">' + c + '</button>';
    });
    html += '</div>';

    // Coach select
    html += '<div class="roster-filter-coach">';
    html += '<select id="roster-coach">';
    html += '<option value="">All coaches</option>';
    allCoaches.forEach(function (c) {
      var selected = filters.coach === c ? " selected" : "";
      html += '<option value="' + esc(c) + '"' + selected + '>' + esc(c) + '</option>';
    });
    html += '</select>';
    html += '</div>';

    // Pathway chips
    html += '<div class="roster-chip-group" data-group="pathways">';
    ["P1", "P2", "P3"].forEach(function (p) {
      var active = filters.pathways[p] ? " is-active" : "";
      html += '<button type="button" class="roster-chip chip-pathway' + active + '" data-pathway="' + p + '">' + p + '</button>';
    });
    html += '</div>';

    // Special chips
    html += '<div class="roster-chip-group" data-group="special">';
    var blackActive = filters.special.black ? " is-active" : "";
    html += '<button type="button" class="roster-chip chip-black' + blackActive + '" data-special="black">Black flag</button>';
    html += '</div>';

    // Count
    html += '<div class="roster-count">' + visibleCount + ' of ' + totalCount + ' clients</div>';

    html += '</div>';
    return html;
  }

  // ---------- Render: table ----------
  function renderTable(visibleStates, hcActions, currentWeek) {
    var html = "";
    html += '<div class="roster-table">';
    html += '<div class="roster-table-head">';
    html += '<div class="rt-col rt-col-client">Client</div>';
    html += '<div class="rt-col rt-col-coach">Coach</div>';
    html += '<div class="rt-col rt-col-color">Color</div>';
    html += '<div class="rt-col rt-col-pathways">Pathways</div>';
    html += '<div class="rt-col rt-col-thisweek">This Week</div>';
    html += '<div class="rt-col rt-col-action">Action Pending</div>';
    html += '<div class="rt-col rt-col-status">Status</div>';
    html += '</div>';

    if (visibleStates.length === 0) {
      html += '<div class="roster-empty">No clients match the current filters.</div>';
      html += '</div>';
      return html;
    }

    visibleStates.forEach(function (s) {
      var pathways = activePathwayLabels(s);
      var pathwaysHtml = pathways.length > 0 ?
        pathways.map(function (p) { return '<span class="pathway-pill">' + esc(p) + '</span>'; }).join("") :
        '<span class="rt-dim">—</span>';

      var tw = thisWeekStatus(s);
      var ap = actionPending(s, hcActions, currentWeek);
      var special = specialStatus(s);
      var specialHtml = special.length > 0 ?
        special.map(function (x) { return '<span class="status-badge ' + (x === "Black flag" ? "sb-black" : "") + '">' + esc(x) + '</span>'; }).join("") :
        '<span class="rt-dim">—</span>';

      var colorBadge = '<span class="rt-color-badge rt-color-' + s.color.toLowerCase() + '">' + esc(s.color) + '</span>';

      html += '<button type="button" class="roster-row" data-client="' + esc(s.clientName) + '">';
      html += '<div class="rt-col rt-col-client">' + esc(s.clientName) + '</div>';
      html += '<div class="rt-col rt-col-coach">' + esc(s.coach || "—") + '</div>';
      html += '<div class="rt-col rt-col-color">' + colorBadge + '</div>';
      html += '<div class="rt-col rt-col-pathways">' + pathwaysHtml + '</div>';
      html += '<div class="rt-col rt-col-thisweek"><span class="' + tw.cssClass + '">' + esc(tw.symbol) + ' ' + esc(tw.label) + '</span></div>';
      html += '<div class="rt-col rt-col-action"><span class="' + ap.cssClass + '">' + esc(ap.label) + '</span></div>';
      html += '<div class="rt-col rt-col-status">' + specialHtml + '</div>';
      html += '</button>';
    });

    html += '</div>';
    return html;
  }

  // ---------- Main render ----------
  function render(states, hcActions, ctx) {
    ctx = ctx || {};
    var rootEl = document.getElementById("roster-content");
    if (!rootEl) return;

    var allCoaches = uniqueCoaches(states);
    var visible = states.filter(passesFilters).sort(compareStates);
    var totalCount = states.length;

    var html = "";
    html += '<div class="queue-header">';
    html += '<div>';
    html += '<h1>CLIENT ROSTER</h1>';
    html += '<div class="week-label">Active clients · current state</div>';
    html += '</div>';
    html += '</div>';

    html += renderFilterBar(allCoaches, totalCount, visible.length);
    html += renderTable(visible, hcActions, ctx.currentWeek);

    rootEl.innerHTML = html;

    wireFilters(states, hcActions, ctx);
    wireRows(states, hcActions, ctx);
  }

  function uniqueCoaches(states) {
    var seen = {};
    var out = [];
    states.forEach(function (s) {
      if (s.coach && !seen[s.coach]) {
        seen[s.coach] = true;
        out.push(s.coach);
      }
    });
    return out.sort();
  }

  // ---------- Wiring ----------
  function wireFilters(states, hcActions, ctx) {
    var rerender = function () { render(states, hcActions, ctx); };

    var searchInput = document.getElementById("roster-search");
    if (searchInput) {
      var debounceTimer = null;
      searchInput.addEventListener("input", function (e) {
        filters.search = e.target.value;
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(rerender, 120);
      });
    }

    var coachSelect = document.getElementById("roster-coach");
    if (coachSelect) {
      coachSelect.addEventListener("change", function (e) {
        filters.coach = e.target.value;
        rerender();
      });
    }

    document.querySelectorAll('.roster-chip[data-color]').forEach(function (chip) {
      chip.addEventListener("click", function () {
        var c = chip.getAttribute("data-color");
        filters.colors[c] = !filters.colors[c];
        rerender();
      });
    });

    document.querySelectorAll('.roster-chip[data-pathway]').forEach(function (chip) {
      chip.addEventListener("click", function () {
        var p = chip.getAttribute("data-pathway");
        filters.pathways[p] = !filters.pathways[p];
        rerender();
      });
    });

    document.querySelectorAll('.roster-chip[data-special]').forEach(function (chip) {
      chip.addEventListener("click", function () {
        var s = chip.getAttribute("data-special");
        filters.special[s] = !filters.special[s];
        rerender();
      });
    });
  }

  function wireRows(states, hcActions, ctx) {
    document.querySelectorAll(".roster-row").forEach(function (row) {
      row.addEventListener("click", function () {
        var clientName = row.getAttribute("data-client");
        if (!clientName) return;
        if (!root.PathwayDetail) return;
        root.PathwayDetail.open(clientName, {
          states: states,
          hcActions: hcActions,
          formResponses: ctx.formResponses || [],
          currentWeek: ctx.currentWeek,
          onActionLogged: ctx.onActionLogged
        });
      });
    });
  }

  // ---------- Public ----------
  root.Tab2 = {
    render: render
  };
})(typeof window !== "undefined" ? window : this);
