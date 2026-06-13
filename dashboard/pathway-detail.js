/**
 * Flag System Dashboard — Pathway Detail Modal (shared)
 *
 * Drill-down modal accessible from Tabs 2, 3, and 4. Renders a single
 * client's full state: form submissions timeline, open/closed pathways,
 * HC actions taken, and black flag status if applicable.
 *
 * Public API:
 *   PathwayDetail.init()
 *     Wires up modal close handlers (call once on dashboard init).
 *
 *   PathwayDetail.open(clientName, ctx)
 *     Opens the modal for the given client. ctx provides shared data:
 *       {
 *         states:        array of ClientState objects from StateBuilder
 *         hcActions:     array of HC Actions rows
 *         formResponses: array of raw form response rows
 *         currentWeek:   ISO week key string "YYYY-Www" (optional)
 *         onActionLogged: function() called after a write succeeds (optional)
 *       }
 *
 *   PathwayDetail.close()
 *     Closes the modal and clears hash.
 *
 * Deep linking:
 *   Sets location.hash to #client/<encodedClientName> when opened.
 *   On dashboard load, app.js can call PathwayDetail.checkHashOnLoad(ctx)
 *   to auto-open the modal if the URL has a matching hash.
 *
 * Data source for the timeline:
 *   Rebuilds the client's timeline locally via ClientTimeline so the
 *   16-week / full-history toggle can change lookback without disturbing
 *   the rest of the dashboard.
 */
(function (root) {
  "use strict";

  // ---------- Constants ----------
  var DEFAULT_LOOKBACK_WEEKS = 16;
  var FULL_HISTORY_WEEKS = 9999;

  // ---------- Module state ----------
  var state = {
    open: false,
    clientName: null,
    ctx: null,
    showFullHistory: false
  };

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

  function escAttr(s) {
    return esc(s);
  }

  // ---------- ISO week helpers ----------
  function weekRangeShort(weekKey) {
    var m = /^(\d{4})-W(\d{2})$/.exec(weekKey || "");
    if (!m) return weekKey || "";
    var year = parseInt(m[1], 10);
    var week = parseInt(m[2], 10);
    var jan4 = new Date(Date.UTC(year, 0, 4));
    var jan4Day = jan4.getUTCDay() || 7;
    var mondayWeek1 = new Date(jan4);
    mondayWeek1.setUTCDate(jan4.getUTCDate() - (jan4Day - 1));
    var monday = new Date(mondayWeek1);
    monday.setUTCDate(mondayWeek1.getUTCDate() + (week - 1) * 7);
    var fmt = function (d) {
      return d.toLocaleDateString("en-US", {
        month: "short", day: "numeric", timeZone: "UTC"
      });
    };
    return fmt(monday);
  }

  function isoWeekKeyFromDate(date) {
    if (!date) return null;
    var d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    var dayNum = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - dayNum);
    var yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    var weekNum = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
    return d.getUTCFullYear() + "-W" + (weekNum < 10 ? "0" + weekNum : weekNum);
  }

  // ---------- Find client state ----------
  function findState(clientName, states) {
    if (!states) return null;
    var target = String(clientName || "").toLowerCase().trim();
    for (var i = 0; i < states.length; i++) {
      if (String(states[i].clientName || "").toLowerCase().trim() === target) {
        return states[i];
      }
    }
    return null;
  }

  // ---------- Build timeline ----------
  function buildTimeline(clientName, formResponses, lookbackWeeks) {
    if (!root.ClientTimeline) return [];
    try {
      return root.ClientTimeline.buildClientTimeline(clientName, formResponses, {
        lookbackWeeks: lookbackWeeks
      });
    } catch (err) {
      if (root.console && root.console.warn) {
        root.console.warn("PathwayDetail: timeline build failed for " + clientName + ": " + err.message);
      }
      return [];
    }
  }

  // ---------- Filter HC Actions for client ----------
  function actionsForClient(clientName, hcActions) {
    var target = String(clientName || "").toLowerCase().trim();
    return (hcActions || [])
      .filter(function (a) {
        return String(a.client || "").toLowerCase().trim() === target;
      })
      .sort(function (a, b) {
        var ta = a.timestamp ? a.timestamp.getTime() : 0;
        var tb = b.timestamp ? b.timestamp.getTime() : 0;
        return tb - ta;
      });
  }

  // ---------- Color helpers ----------
  function colorClass(color) {
    if (color === "Red") return "pd-color-red";
    if (color === "Yellow") return "pd-color-yellow";
    if (color === "Green") return "pd-color-green";
    return "pd-color-neutral";
  }

  function pathwayLabel(entry) {
    if (!entry) return "";
    var weekN = entry.streakLength || 0;
    if (entry.pathway === "P2") {
      var short = (root.FlagConfig && root.FlagConfig.STANDARD_SHORT_NAMES) || {};
      var s = short[entry.standard] || entry.standard || "";
      return "P2 " + s + " Week " + weekN;
    }
    return (entry.pathway || "") + " Week " + weekN;
  }

  // ---------- Render: Header ----------
  function renderHeader(clientState) {
    var color = clientState.color || "Green";
    var bf = clientState.blackFlags || {};
    var pathways = [];
    var ps = clientState.pathwayStates || {};
    if (ps.p1 && ps.p1.active) pathways.push("P1");
    (ps.p2 || []).forEach(function (p) {
      if (p && p.active) pathways.push("P2 " + (p.standard || ""));
    });
    if (ps.p3 && ps.p3.active) pathways.push("P3");

    var html = "";
    html += '<div class="pd-header-row">';
    html += '<div class="pd-header-main">';
    html += '<div class="pd-client-name">' + esc(clientState.clientName) + '</div>';
    html += '<div class="pd-client-meta">';
    html += '<span class="pd-coach">' + esc(clientState.coach || "Unassigned") + '</span>';
    html += '<span class="pd-meta-sep">·</span>';
    html += '<span class="pd-color-badge ' + colorClass(color) + '">' + esc(color) + '</span>';
    if (bf.active) {
      html += '<span class="pd-black-badge" title="' + (bf.consecutiveGreenWeeks || 0) + '/6 Green weeks">⚫ Black Flag</span>';
    }
    if (pathways.length > 0) {
      html += '<span class="pd-meta-sep">·</span>';
      html += '<span class="pd-pathways">' + esc(pathways.join(", ")) + '</span>';
    }
    html += '</div>';
    html += '</div>';
    html += '<div class="pd-header-right">';
    if (clientState.evaluatedAtWeek) {
      html += '<span class="pd-eval-week">Evaluated at ' + esc(clientState.evaluatedAtWeek) + '</span>';
    }
    // Optional coach acknowledgment (Overview Outcome 1): copy a "client is
    // improving / good work" Slack for the coach. HC's judgment when to use it.
    html += '<button type="button" class="action-btn" id="pd-ack-btn">Copy acknowledgment for coach</button>';
    html += '</div>';
    html += '</div>';
    return html;
  }

  // ---------- Render: Timeline ----------
  function renderTimeline(timeline) {
    if (!timeline || timeline.length === 0) {
      return '<div class="pd-empty">No form submissions on record for this client.</div>';
    }

    var html = '<div class="pd-timeline-grid">';
    timeline.forEach(function (wr, idx) {
      var cellClass = "pd-week-cell";
      var statusLabel = "";
      var statusSym = "";

      if (wr.status === "evaluable") {
        if ((wr.points || 0) === 0 && (!wr.failedStandards || wr.failedStandards.length === 0)) {
          cellClass += " pd-week-green";
          statusSym = "✓";
        } else if ((wr.points || 0) >= 5) {
          cellClass += " pd-week-red";
          statusSym = "!";
        } else {
          cellClass += " pd-week-yellow";
          statusSym = "·";
        }
        statusLabel = (wr.points || 0) + " pt" + ((wr.points || 0) === 1 ? "" : "s");
      } else if (wr.status === "exempt") {
        cellClass += " pd-week-exempt";
        statusSym = "E";
        statusLabel = "Exempt";
      } else {
        cellClass += " pd-week-missing";
        statusSym = "—";
        statusLabel = "Missing";
      }

      html += '<button type="button" class="' + cellClass + '" data-week-idx="' + idx + '" ' +
              'title="' + escAttr(wr.weekId + " · " + statusLabel) + '">';
      html += '<span class="pd-week-id">' + esc(weekRangeShort(wr.weekId)) + '</span>';
      html += '<span class="pd-week-sym">' + esc(statusSym) + '</span>';
      html += '</button>';
    });
    html += '</div>';

    // Detail panel for selected week (populated on click).
    html += '<div class="pd-week-detail" id="pd-week-detail"></div>';
    return html;
  }

  function renderWeekDetail(wr) {
    if (!wr) return "";
    var html = "";
    html += '<div class="pd-week-detail-inner">';
    html += '<div class="pd-week-detail-header">';
    html += '<strong>' + esc(wr.weekId) + '</strong>';
    html += ' <span class="pd-week-detail-status">' + esc(wr.status) + '</span>';
    html += '</div>';

    if (wr.status === "evaluable") {
      html += '<div class="pd-week-detail-grid">';
      html += '<div><span class="pd-label">Points</span><span class="pd-value">' + (wr.points || 0) + '</span></div>';
      var failed = (wr.failedStandards && wr.failedStandards.length > 0) ?
        wr.failedStandards.join(", ") : "None";
      html += '<div><span class="pd-label">Failed standards</span><span class="pd-value">' + esc(failed) + '</span></div>';
      html += '<div><span class="pd-label">Call requested</span><span class="pd-value">' + esc(wr.callRequested || "No") + '</span></div>';
      html += '</div>';
      if (wr.notes) {
        html += '<div class="pd-week-detail-notes"><span class="pd-label">Notes</span><div class="pd-notes-body">' + esc(wr.notes) + '</div></div>';
      }
      if (wr.loomLink) {
        html += '<div class="pd-week-detail-loom"><a href="' + escAttr(wr.loomLink) + '" target="_blank" rel="noopener">Open Loom →</a></div>';
      }
    } else if (wr.status === "exempt") {
      if (wr.exemptJustification) {
        html += '<div class="pd-week-detail-notes"><span class="pd-label">Exempt reason</span><div class="pd-notes-body">' + esc(wr.exemptJustification) + '</div></div>';
      } else {
        html += '<div class="pd-empty-inline">Exempt — no justification recorded.</div>';
      }
    } else {
      html += '<div class="pd-empty-inline">No submission this week.</div>';
    }

    html += '</div>';
    return html;
  }

  // ---------- Render: Pathways ----------
  function renderPathways(clientState) {
    var ps = clientState.pathwayStates || {};
    var rows = [];

    function pushEntry(entry, code) {
      if (!entry) return;
      rows.push({
        code: code || entry.pathway,
        standard: entry.standard || null,
        active: entry.active,
        streakLength: entry.streakLength || 0,
        color: entry.color || "Green",
        colorReason: entry.colorReason || "",
        expectedAction: entry.expectedAction || null,
        resetReady: entry.resetReady || false
      });
    }

    pushEntry(ps.p1, "P1");
    (ps.p2 || []).forEach(function (p) { pushEntry(p, "P2"); });
    pushEntry(ps.p3, "P3");

    if (rows.length === 0) {
      return '<div class="pd-empty">No pathway data available.</div>';
    }

    var html = '<div class="pd-pathway-list">';
    rows.forEach(function (r) {
      var statusLabel = r.active ? "Open" : "Closed";
      var label = r.code === "P2" ? ("P2 " + (r.standard || "")) : r.code;
      html += '<div class="pd-pathway-row ' + colorClass(r.color) + '">';
      html += '<div class="pd-pathway-row-main">';
      html += '<span class="pd-pathway-code">' + esc(label) + '</span>';
      html += '<span class="pd-pathway-status">' + esc(statusLabel) + '</span>';
      html += '<span class="pd-pathway-color pd-color-badge ' + colorClass(r.color) + '">' + esc(r.color) + '</span>';
      html += '</div>';
      html += '<div class="pd-pathway-row-meta">';
      if (r.active) {
        html += '<span class="pd-label">Streak</span><span class="pd-value">' + r.streakLength + ' week' + (r.streakLength === 1 ? "" : "s") + '</span>';
      }
      if (r.expectedAction) {
        html += '<span class="pd-label">Expected action</span><span class="pd-value">' + esc(r.expectedAction) + '</span>';
      }
      if (r.colorReason) {
        html += '<span class="pd-label">Reason</span><span class="pd-value">' + esc(r.colorReason) + '</span>';
      }
      html += '</div>';
      html += '</div>';
    });
    html += '</div>';
    return html;
  }

  // ---------- Render: HC Actions ----------
  function renderHCActions(clientName, hcActions) {
    var rows = actionsForClient(clientName, hcActions);
    if (rows.length === 0) {
      return '<div class="pd-empty">No HC actions logged for this client.</div>';
    }
    var html = '<div class="pd-action-list">';
    rows.forEach(function (a) {
      var when = a.timestamp ?
        a.timestamp.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" }) +
        " · " +
        a.timestamp.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
        : "";
      var pathway = a.pathway || "";
      if (a.pathway === "P2" && a.standard) pathway = "P2 " + a.standard;

      html += '<div class="pd-action-row">';
      html += '<div class="pd-action-row-main">';
      html += '<span class="pd-action-type">' + esc(a.actionType || "") + '</span>';
      if (pathway) html += '<span class="pd-action-pathway">' + esc(pathway) + '</span>';
      html += '</div>';
      html += '<div class="pd-action-row-meta">';
      html += '<span class="pd-action-when">' + esc(when) + '</span>';
      if (a.outcome) html += '<span class="pd-action-outcome">' + esc(a.outcome) + '</span>';
      html += '</div>';
      if (a.notes) {
        html += '<div class="pd-action-notes">' + esc(a.notes) + '</div>';
      }
      html += '</div>';
    });
    html += '</div>';
    return html;
  }

  // ---------- Render: Black Flag section ----------
  function renderBlackFlag(clientState, hcActions) {
    var bf = clientState.blackFlags || {};
    if (!bf.active && (!bf.count || bf.count === 0) && !bf.lastTriggeredAt && !bf.lastResetAt) {
      return ""; // Section omitted entirely when no history.
    }

    var html = '<section class="pd-section">';
    html += '<h3 class="pd-section-title">Black Flag</h3>';
    html += '<div class="pd-section-body">';

    if (bf.active) {
      var counter = bf.consecutiveGreenWeeks || 0;
      var pct = Math.min(100, Math.round((counter / 6) * 100));
      html += '<div class="pd-bf-status active">';
      html += '<div class="pd-bf-row"><span class="pd-label">Status</span><span class="pd-value"><strong>Active</strong></span></div>';
      if (bf.lastTriggeredAt) {
        var triggeredDate = bf.lastTriggeredAt instanceof Date ? bf.lastTriggeredAt : new Date(bf.lastTriggeredAt);
        if (!isNaN(triggeredDate.getTime())) {
          html += '<div class="pd-bf-row"><span class="pd-label">Triggered</span><span class="pd-value">' +
            esc(triggeredDate.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" })) + '</span></div>';
        }
      }
      html += '<div class="pd-bf-row"><span class="pd-label">Green counter</span><span class="pd-value">' + counter + ' / 6 weeks</span></div>';
      html += '<div class="pd-bf-progress"><div class="pd-bf-progress-fill" style="width:' + pct + '%"></div></div>';
      html += '</div>';
    } else {
      html += '<div class="pd-bf-status inactive">';
      html += '<div class="pd-bf-row"><span class="pd-label">Status</span><span class="pd-value">Not active</span></div>';
      if (bf.lastResetAt) {
        var resetDate = bf.lastResetAt instanceof Date ? bf.lastResetAt : new Date(bf.lastResetAt);
        if (!isNaN(resetDate.getTime())) {
          html += '<div class="pd-bf-row"><span class="pd-label">Last removed</span><span class="pd-value">' +
            esc(resetDate.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" })) + '</span></div>';
        }
      }
      html += '</div>';
    }

    html += '</div></section>';
    return html;
  }

  // ---------- Render full modal body ----------
  function renderBody(clientState, ctx) {
    var lookback = state.showFullHistory ? FULL_HISTORY_WEEKS : DEFAULT_LOOKBACK_WEEKS;
    var timeline = buildTimeline(clientState.clientName, ctx.formResponses, lookback);

    var html = "";
    html += renderHeader(clientState);

    // Black Flag section (if applies) — at top because it's high priority.
    html += renderBlackFlag(clientState, ctx.hcActions);

    // Timeline section
    html += '<section class="pd-section">';
    html += '<header class="pd-section-header">';
    html += '<h3 class="pd-section-title">Form Submissions Timeline</h3>';
    html += '<div class="pd-section-controls">';
    html += '<span class="pd-section-meta">' + timeline.length + ' week' + (timeline.length === 1 ? "" : "s") + '</span>';
    html += '<button type="button" class="action-btn" id="pd-toggle-history">' +
      (state.showFullHistory ? "Show last 16 weeks" : "View full history") + '</button>';
    html += '</div>';
    html += '</header>';
    html += '<div class="pd-section-body">';
    html += renderTimeline(timeline);
    html += '</div>';
    html += '</section>';

    // Pathways section
    html += '<section class="pd-section">';
    html += '<header class="pd-section-header">';
    html += '<h3 class="pd-section-title">Pathways</h3>';
    html += '</header>';
    html += '<div class="pd-section-body">';
    html += renderPathways(clientState);
    html += '</div>';
    html += '</section>';

    // HC Actions section
    html += '<section class="pd-section">';
    html += '<header class="pd-section-header">';
    html += '<h3 class="pd-section-title">HC Actions Taken</h3>';
    html += '</header>';
    html += '<div class="pd-section-body">';
    html += renderHCActions(clientState.clientName, ctx.hcActions);
    html += '</div>';
    html += '</section>';

    return { html: html, timeline: timeline };
  }

  // ---------- Wire interactions inside modal ----------
  function wireWeekCells(timeline) {
    document.querySelectorAll(".pd-week-cell").forEach(function (cell) {
      cell.addEventListener("click", function () {
        var idx = parseInt(cell.getAttribute("data-week-idx"), 10);
        if (isNaN(idx) || idx < 0 || idx >= timeline.length) return;
        // Highlight selected
        document.querySelectorAll(".pd-week-cell.is-selected").forEach(function (c) {
          c.classList.remove("is-selected");
        });
        cell.classList.add("is-selected");
        // Render detail
        var detail = document.getElementById("pd-week-detail");
        if (detail) {
          detail.innerHTML = renderWeekDetail(timeline[idx]);
        }
      });
    });
  }

  function wireToggleHistory() {
    var btn = document.getElementById("pd-toggle-history");
    if (!btn) return;
    btn.addEventListener("click", function () {
      state.showFullHistory = !state.showFullHistory;
      renderModalBody();
    });
  }

  // Copy a coach acknowledgment Slack for the current client to the clipboard.
  function wireAcknowledge() {
    var btn = document.getElementById("pd-ack-btn");
    if (!btn) return;
    btn.addEventListener("click", function () {
      var cs = findState(state.clientName, state.ctx && state.ctx.states);
      if (!cs || !root.SlackTemplates || typeof root.SlackTemplates.acknowledgment !== "function") {
        btn.textContent = "Template unavailable";
        return;
      }
      var msg = root.SlackTemplates.acknowledgment(cs.clientName);
      var text = (msg && msg.text) ? msg.text : "";
      var ok = false;
      try {
        if (root.navigator && root.navigator.clipboard && root.navigator.clipboard.writeText) {
          root.navigator.clipboard.writeText(text);
          ok = true;
        } else {
          var ta = document.createElement("textarea");
          ta.value = text;
          document.body.appendChild(ta);
          ta.select();
          ok = document.execCommand("copy");
          document.body.removeChild(ta);
        }
      } catch (e) { ok = false; }
      var orig = "Copy acknowledgment for coach";
      btn.textContent = ok ? "Copied ✓ — paste in coach's DM" : "Copy failed";
      setTimeout(function () { btn.textContent = orig; }, 2200);
    });
  }

  // ---------- Render to DOM ----------
  function renderModalBody() {
    if (!state.open || !state.clientName || !state.ctx) return;
    var clientState = findState(state.clientName, state.ctx.states);
    var body = document.getElementById("pd-modal-body");
    if (!body) return;

    if (!clientState) {
      body.innerHTML = '<div class="pd-empty">Client not found in current dashboard data.</div>';
      return;
    }

    var rendered = renderBody(clientState, state.ctx);
    body.innerHTML = rendered.html;
    wireWeekCells(rendered.timeline);
    wireToggleHistory();
    wireAcknowledge();
  }

  // ---------- Hash linking ----------
  function setHash(clientName) {
    try {
      var encoded = encodeURIComponent(clientName);
      // Use replaceState to avoid polluting history.
      if (root.history && root.history.replaceState) {
        root.history.replaceState(null, "", "#client/" + encoded);
      } else {
        root.location.hash = "client/" + encoded;
      }
    } catch (err) { /* no-op */ }
  }

  function clearHash() {
    try {
      if (root.history && root.history.replaceState) {
        root.history.replaceState(null, "", root.location.pathname + root.location.search);
      } else {
        root.location.hash = "";
      }
    } catch (err) { /* no-op */ }
  }

  function checkHashOnLoad(ctx) {
    var hash = root.location && root.location.hash ? root.location.hash : "";
    var m = /^#?client\/(.+)$/.exec(hash.replace(/^#/, ""));
    if (!m) return;
    try {
      var clientName = decodeURIComponent(m[1]);
      open(clientName, ctx);
    } catch (err) { /* invalid hash */ }
  }

  // ---------- Open / Close ----------
  function open(clientName, ctx) {
    if (!clientName || !ctx) return;
    state.open = true;
    state.clientName = clientName;
    state.ctx = ctx;
    state.showFullHistory = false;

    var backdrop = document.getElementById("pd-modal-backdrop");
    if (!backdrop) {
      if (root.console && root.console.warn) {
        root.console.warn("PathwayDetail: backdrop not found in DOM. Did you add the modal scaffold to index.html?");
      }
      return;
    }
    backdrop.classList.remove("hidden");
    renderModalBody();
    setHash(clientName);

    // Focus the close button for accessibility.
    var closeBtn = document.getElementById("pd-modal-close");
    if (closeBtn) closeBtn.focus();
  }

  function close() {
    state.open = false;
    state.clientName = null;
    state.ctx = null;
    state.showFullHistory = false;
    var backdrop = document.getElementById("pd-modal-backdrop");
    if (backdrop) backdrop.classList.add("hidden");
    clearHash();
  }

  // ---------- Init ----------
  function init() {
    var backdrop = document.getElementById("pd-modal-backdrop");
    if (!backdrop) return;

    backdrop.addEventListener("click", function (e) {
      if (e.target.id === "pd-modal-backdrop") close();
    });

    var closeBtn = document.getElementById("pd-modal-close");
    if (closeBtn) closeBtn.addEventListener("click", close);

    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && state.open) close();
    });
  }

  // ---------- Public ----------
  root.PathwayDetail = {
    init: init,
    open: open,
    close: close,
    checkHashOnLoad: checkHashOnLoad
  };
})(typeof window !== "undefined" ? window : this);
