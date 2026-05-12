/**
 * Flag System Dashboard — Tab 4 (Black Flagged Clients)
 *
 * Dedicated view for the small but critical Black-flagged population.
 *
 * Public API:
 *   Tab4.render(states, hcActions, ctx)
 *     ctx: { formResponses, currentWeek, onActionLogged }
 *
 * Sections:
 *   Active Black Flags (accordion, expandable per client)
 *   Removed in Last 8 Weeks (collapsed by default, read-only)
 */
(function (root) {
  "use strict";

  var REMOVAL_ACTION_TYPES = ["Black Flag: Removed", "Manual Override: Black Flag Removed"];
  var REMOVED_WINDOW_WEEKS = 8;

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

  // ---------- ISO week math ----------
  function isoWeekKey(date) {
    if (!date) return null;
    var d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    var dayNum = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - dayNum);
    var yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    var weekNum = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
    return d.getUTCFullYear() + "-W" + (weekNum < 10 ? "0" + weekNum : weekNum);
  }

  function weeksAgo(date) {
    if (!date) return null;
    var now = new Date();
    var diffMs = now.getTime() - date.getTime();
    var diffWeeks = Math.floor(diffMs / (7 * 24 * 60 * 60 * 1000));
    return diffWeeks;
  }

  function fmtDate(date) {
    if (!date) return "—";
    var d = date instanceof Date ? date : new Date(date);
    if (isNaN(d.getTime())) return "—";
    return d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
  }

  // ---------- HC Actions helpers ----------
  function actionsForClient(clientName, hcActions) {
    var target = String(clientName || "").toLowerCase().trim();
    return (hcActions || [])
      .filter(function (a) {
        return String(a.client || "").toLowerCase().trim() === target;
      })
      .sort(function (a, b) {
        var ta = a.timestamp ? a.timestamp.getTime() : 0;
        var tb = b.timestamp ? b.timestamp.getTime() : 0;
        return ta - tb; // ascending for trail
      });
  }

  // ---------- Build "Removed in Last 8 Weeks" list ----------
  // Read from HC Actions: any removal action whose timestamp is within
  // the last 8 ISO weeks gets surfaced as a removed-recently entry.
  function buildRemovedList(hcActions, states) {
    var nowMs = Date.now();
    var cutoffMs = nowMs - (REMOVED_WINDOW_WEEKS * 7 * 24 * 60 * 60 * 1000);
    var coachByClient = {};
    states.forEach(function (s) {
      coachByClient[String(s.clientName).toLowerCase().trim()] = s.coach;
    });

    var entries = [];
    (hcActions || []).forEach(function (a) {
      if (!a.actionType) return;
      if (REMOVAL_ACTION_TYPES.indexOf(a.actionType) === -1) return;
      var ts = a.timestamp ? a.timestamp.getTime() : 0;
      if (!ts || ts < cutoffMs) return;
      entries.push({
        client: a.client,
        coach: a.coach || coachByClient[String(a.client || "").toLowerCase().trim()] || "—",
        actionType: a.actionType,
        timestamp: a.timestamp,
        notes: a.notes || null
      });
    });

    return entries.sort(function (a, b) {
      var ta = a.timestamp ? a.timestamp.getTime() : 0;
      var tb = b.timestamp ? b.timestamp.getTime() : 0;
      return tb - ta;
    });
  }

  // ---------- Last form submission status (per state) ----------
  function lastSubmissionStatus(state) {
    if (!state.lastEvaluableWeek || !state.evaluatedAtWeek) {
      return { label: "Missing this week", cssClass: "tw-missing", symbol: "⚠️" };
    }
    if (state.lastEvaluableWeek.weekId === state.evaluatedAtWeek) {
      return { label: "Submitted this week", cssClass: "tw-submitted", symbol: "✓" };
    }
    return { label: "Missing this week", cssClass: "tw-missing", symbol: "⚠️" };
  }

  // ---------- Build pathway trail that led to Black ----------
  // Read sourceRows from blackFlags + any pathway-related actions before
  // the trigger.
  function buildPathwayTrail(state, hcActions) {
    var bf = state.blackFlags || {};
    var clientActions = actionsForClient(state.clientName, hcActions);
    var triggerAction = clientActions.filter(function (a) {
      return a.actionType === "Black Flag: Triggered";
    }).pop(); // last trigger (ascending sort)

    if (!triggerAction) {
      return [];
    }

    var triggerTime = triggerAction.timestamp ? triggerAction.timestamp.getTime() : 0;
    // Trail: all client actions strictly before the trigger, plus the trigger itself.
    var trail = clientActions.filter(function (a) {
      var t = a.timestamp ? a.timestamp.getTime() : 0;
      return t <= triggerTime;
    });
    return trail;
  }

  // ---------- Render: active black flag card ----------
  function renderActiveCard(state, hcActions, idx) {
    var bf = state.blackFlags || {};
    var counter = bf.consecutiveGreenWeeks || 0;
    var pct = Math.min(100, Math.round((counter / 6) * 100));
    var triggeredDate = bf.lastTriggeredAt ? (bf.lastTriggeredAt instanceof Date ? bf.lastTriggeredAt : new Date(bf.lastTriggeredAt)) : null;
    var weekId = triggeredDate ? isoWeekKey(triggeredDate) : "—";
    var wa = triggeredDate ? weeksAgo(triggeredDate) : null;
    var lastSub = lastSubmissionStatus(state);
    var trail = buildPathwayTrail(state, hcActions);

    var html = '<div class="bf-card" data-bf-idx="' + idx + '" data-client="' + esc(state.clientName) + '">';

    // Header
    html += '<button type="button" class="bf-card-header">';
    html += '<span class="bf-caret">▾</span>';
    html += '<div class="bf-header-main">';
    html += '<div class="bf-client-name">' + esc(state.clientName) + '</div>';
    html += '<div class="bf-client-meta">';
    html += '<span class="bf-coach">' + esc(state.coach || "—") + '</span>';
    html += '<span class="pd-meta-sep">·</span>';
    html += '<span class="bf-triggered">Triggered ' + esc(weekId);
    if (wa !== null && wa >= 0) html += ' (' + wa + ' week' + (wa === 1 ? '' : 's') + ' ago)';
    html += '</span>';
    html += '</div>';
    html += '</div>';
    html += '<div class="bf-header-right">';
    html += '<span class="bf-counter-text">' + counter + '/6 Green</span>';
    html += '<div class="bf-progress"><div class="bf-progress-fill" style="width:' + pct + '%"></div></div>';
    html += '<span class="rt-color-badge rt-color-' + (state.color || "").toLowerCase() + '">' + esc(state.color) + '</span>';
    html += '</div>';
    html += '</button>';

    // Body (expandable)
    html += '<div class="bf-card-body">';

    html += '<div class="bf-row-grid">';
    html += '<div><span class="pd-label">Current color</span><span class="pd-value">' + esc(state.color) + '</span></div>';
    html += '<div><span class="pd-label">Last submission</span><span class="pd-value ' + lastSub.cssClass + '">' + esc(lastSub.symbol) + ' ' + esc(lastSub.label) + '</span></div>';
    html += '<div><span class="pd-label">Counter progress</span><span class="pd-value">' + counter + ' / 6 weeks</span></div>';
    html += '</div>';

    // Pathway trail
    html += '<div class="bf-trail">';
    html += '<div class="bf-trail-title">Pathway trail to Black</div>';
    if (trail.length === 0) {
      html += '<div class="cp-empty">No pathway actions logged before trigger.</div>';
    } else {
      html += '<ol class="bf-trail-list">';
      trail.forEach(function (a) {
        var when = fmtDate(a.timestamp);
        var path = "";
        if (a.pathway) {
          path = a.pathway === "P2" && a.standard ? "P2 " + a.standard : a.pathway;
        }
        html += '<li class="bf-trail-item">';
        html += '<span class="bf-trail-when">' + esc(when) + '</span>';
        if (path) html += '<span class="bf-trail-pathway">' + esc(path) + '</span>';
        html += '<span class="bf-trail-action">' + esc(a.actionType) + '</span>';
        html += '</li>';
      });
      html += '</ol>';
    }
    html += '</div>';

    // Actions
    html += '<div class="bf-card-actions">';
    html += '<button type="button" class="action-btn action-btn-primary bf-view-timeline" data-client="' + esc(state.clientName) + '">View full timeline</button>';
    html += '<button type="button" class="action-btn bf-manual-override" data-client="' + esc(state.clientName) + '" data-coach="' + esc(state.coach || "") + '">Manual Override: Remove Black Flag</button>';
    html += '</div>';

    html += '</div>'; // .bf-card-body
    html += '</div>'; // .bf-card

    return html;
  }

  // ---------- Render: removed-recently row ----------
  function renderRemovedRow(entry) {
    var html = '<div class="bf-removed-row">';
    html += '<div class="bf-removed-main">';
    html += '<span class="bf-removed-client">' + esc(entry.client) + '</span>';
    html += '<span class="bf-removed-coach">' + esc(entry.coach) + '</span>';
    html += '</div>';
    html += '<div class="bf-removed-meta">';
    html += '<span class="bf-removed-type">' + esc(entry.actionType) + '</span>';
    html += '<span class="bf-removed-when">' + esc(fmtDate(entry.timestamp)) + '</span>';
    html += '</div>';
    html += '</div>';
    return html;
  }

  // ---------- Main render ----------
  function render(states, hcActions, ctx) {
    ctx = ctx || {};
    var rootEl = document.getElementById("black-content");
    if (!rootEl) return;

    var active = states.filter(function (s) {
      return s.blackFlags && s.blackFlags.active;
    }).sort(function (a, b) {
      // Most recent trigger first.
      var ta = (a.blackFlags && a.blackFlags.lastTriggeredAt) ?
        (a.blackFlags.lastTriggeredAt instanceof Date ?
          a.blackFlags.lastTriggeredAt.getTime() :
          new Date(a.blackFlags.lastTriggeredAt).getTime()) : 0;
      var tb = (b.blackFlags && b.blackFlags.lastTriggeredAt) ?
        (b.blackFlags.lastTriggeredAt instanceof Date ?
          b.blackFlags.lastTriggeredAt.getTime() :
          new Date(b.blackFlags.lastTriggeredAt).getTime()) : 0;
      return tb - ta;
    });

    var removed = buildRemovedList(hcActions, states);

    var html = "";
    html += '<div class="queue-header">';
    html += '<div>';
    html += '<h1>BLACK FLAGGED CLIENTS</h1>';
    html += '<div class="week-label">Active escalations · ' + active.length + ' client' + (active.length === 1 ? "" : "s") + '</div>';
    html += '</div>';
    html += '</div>';

    // Active section
    html += '<section class="queue-section">';
    html += '<header class="queue-section-header">';
    html += '<h2 class="queue-section-title">Active Black Flags</h2>';
    html += '<span class="queue-section-count">' + active.length + ' client' + (active.length === 1 ? "" : "s") + '</span>';
    html += '</header>';
    html += '<div class="queue-section-body">';
    if (active.length === 0) {
      html += '<div class="section-empty">No active Black flags. Nice.</div>';
    } else {
      html += '<div class="bf-list">';
      active.forEach(function (s, i) {
        html += renderActiveCard(s, hcActions, i);
      });
      html += '</div>';
    }
    html += '</div></section>';

    // Removed section (collapsible, collapsed by default)
    html += '<section class="queue-section is-collapsible is-collapsed">';
    html += '<header class="queue-section-header">';
    html += '<h2 class="queue-section-title">Removed in Last 8 Weeks</h2>';
    html += '<span class="queue-section-count">' + removed.length + ' removal' + (removed.length === 1 ? "" : "s") + '</span>';
    html += '</header>';
    html += '<div class="queue-section-body">';
    if (removed.length === 0) {
      html += '<div class="section-empty">No Black flags removed in the last 8 weeks.</div>';
    } else {
      html += '<div class="bf-removed-list">';
      removed.forEach(function (r) {
        html += renderRemovedRow(r);
      });
      html += '</div>';
    }
    html += '</div></section>';

    rootEl.innerHTML = html;

    wireCardAccordion();
    wireCollapsibleSections();
    wireDrilldown(states, hcActions, ctx);
    wireManualOverride(states, hcActions, ctx);
  }

  // ---------- Wiring ----------
  function wireCardAccordion() {
    document.querySelectorAll(".bf-card-header").forEach(function (h) {
      h.addEventListener("click", function () {
        h.parentElement.classList.toggle("is-expanded");
      });
    });
  }

  function wireCollapsibleSections() {
    // Reuse Tab 1's pattern: clicking the section header toggles is-collapsed.
    document.querySelectorAll("#black-content .queue-section.is-collapsible .queue-section-header").forEach(function (h) {
      h.addEventListener("click", function () {
        h.parentElement.classList.toggle("is-collapsed");
      });
    });
  }

  function wireDrilldown(states, hcActions, ctx) {
    document.querySelectorAll(".bf-view-timeline").forEach(function (btn) {
      btn.addEventListener("click", function (e) {
        e.stopPropagation();
        var clientName = btn.getAttribute("data-client");
        if (!clientName || !root.PathwayDetail) return;
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

  function wireManualOverride(states, hcActions, ctx) {
    document.querySelectorAll(".bf-manual-override").forEach(function (btn) {
      btn.addEventListener("click", function (e) {
        e.stopPropagation();
        var client = btn.getAttribute("data-client");
        var coach = btn.getAttribute("data-coach");
        if (!client) return;

        var confirmed = root.confirm(
          "Manual Override: Remove Black Flag\n\n" +
          "Client: " + client + "\n" +
          "Coach: " + (coach || "—") + "\n\n" +
          "This logs a Manual Override action that removes the Black flag " +
          "without waiting for the 6-week Green counter. Used for exceptional " +
          "cases only.\n\n" +
          "Proceed?"
        );
        if (!confirmed) return;

        btn.disabled = true;
        var originalLabel = btn.textContent;
        btn.textContent = "Logging…";

        var payload = {
          client: client,
          coach: coach,
          pathway: "N/A",
          standard: null,
          actionType: "Manual Override: Black Flag Removed",
          notes: "Manual override from Black Flagged Clients tab.",
          outcome: null,
          followUpDueDate: null,
          actionWeek: ctx.currentWeek
        };

        root.ActionsWriter.logAction(payload)
          .then(function () {
            btn.textContent = "Logged ✓";
            if (typeof ctx.onActionLogged === "function") {
              ctx.onActionLogged();
            }
          })
          .catch(function (err) {
            btn.disabled = false;
            btn.textContent = originalLabel;
            alert("Failed to log override: " + err.message);
          });
      });
    });
  }

  // ---------- Public ----------
  root.Tab4 = {
    render: render
  };
})(typeof window !== "undefined" ? window : this);
