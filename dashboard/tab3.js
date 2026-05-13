/**
 * Flag System Dashboard — Tab 3: Coach Diagnostics
 *
 * Private HC view answering three diagnostic questions per coach:
 *   1. Which standards do their clients fail most? (Component 1)
 *   2. Are flags concentrated in a few clients or distributed? (Component 2 — NEXT BLOCK)
 *   3. How long are clients staying in each pathway, and how is it trending?
 *      (Component 3 — NEXT BLOCK)
 *
 * This file is the renderer. All math lives in
 * CoachDiagnosticsAggregators. Drill-down to a single client delegates
 * to PathwayDetail.open (shared modal).
 *
 * Public API:
 *   Tab3.render(ctx)
 *     ctx: { states, formResponses, hcActions, roster }
 *
 * The render function is idempotent — re-calling it re-paints the panel
 * from scratch. State that lives across renders (selected coach, selected
 * period, compare mode) is kept in module-scope `viewState`.
 */
(function (root) {
  "use strict";

  // ---------- Module state (survives across renders) ----------
  var viewState = {
    selectedCoach: null,   // populated on first render
    periodDays: 90,        // 30 | 90 | 180
    compareMode: false,    // toggle for Bloque 3
    drillDown: null        // { kind: "standard"|"client", payload }
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

  // ---------- Helpers ----------
  function uniqueCoaches(states) {
    var set = new Set();
    (states || []).forEach(function (s) {
      if (s && s.coach) set.add(s.coach);
    });
    return Array.from(set).sort();
  }

  function shortStandard(name) {
    var map = (root.FlagConfig && root.FlagConfig.STANDARD_SHORT_NAMES) || {};
    return map[name] || name;
  }

  // ---------- Toolbar (coach selector + period selector) ----------
  function renderToolbar(coaches) {
    var html = "";
    html += '<div class="t3-toolbar">';

    // Coach selector
    html += '<div class="t3-toolbar-group">';
    html += '<label class="t3-toolbar-label">COACH</label>';
    html += '<div class="t3-coach-tabs">';
    coaches.forEach(function (c) {
      var active = c === viewState.selectedCoach ? " is-active" : "";
      html += '<button type="button" class="t3-coach-tab' + active +
        '" data-coach="' + esc(c) + '">' + esc(c) + '</button>';
    });
    html += '</div>';
    html += '</div>';

    // Period selector
    html += '<div class="t3-toolbar-group">';
    html += '<label class="t3-toolbar-label">PERIOD</label>';
    html += '<div class="t3-period-tabs">';
    [30, 90, 180].forEach(function (d) {
      var active = d === viewState.periodDays ? " is-active" : "";
      html += '<button type="button" class="t3-period-tab' + active +
        '" data-days="' + d + '">' + d + 'd</button>';
    });
    html += '</div>';
    html += '</div>';

    html += '</div>';
    return html;
  }

  // ---------- Header (page title) ----------
  function renderHeader() {
    var html = "";
    html += '<div class="t3-header">';
    html += '<h1 class="t3-title">COACH DIAGNOSTICS</h1>';
    html += '<p class="t3-subtitle">Private view for HC. Answers WHY a coach\'s metrics are what they are.</p>';
    html += '</div>';
    return html;
  }

  // ---------- Component 1: Standard Failure Distribution ----------
  function renderComponent1(distribution) {
    var html = "";
    html += '<section class="t3-card">';
    html += '<header class="t3-card-header">';
    html += '<h2 class="t3-card-title">STANDARD FAILURE DISTRIBUTION</h2>';
    html += '<span class="t3-card-meta">' + distribution.totalFlags +
      ' total flag' + (distribution.totalFlags === 1 ? '' : 's') + '</span>';
    html += '</header>';
    html += '<div class="t3-card-body">';

    if (distribution.totalFlags === 0) {
      html += '<div class="t3-empty">No failed standards in this period.</div>';
    } else {
      html += renderBarChart(distribution);
    }

    html += '</div>';
    html += '</section>';
    return html;
  }

  function renderBarChart(distribution) {
    // Show only standards with count > 0, plus all standards at 0 to keep
    // visibility consistent. Sort: all >0 first (already sorted by count
    // desc from aggregator), then 0s at the bottom in the canonical order.
    var withFlags = distribution.byStandard.filter(function (s) { return s.count > 0; });
    var withoutFlags = distribution.byStandard.filter(function (s) { return s.count === 0; });
    var ordered = withFlags.concat(withoutFlags);

    var maxCount = ordered.length > 0 ? ordered[0].count : 0;

    var html = '<div class="t3-bar-chart">';
    ordered.forEach(function (s) {
      var pct = maxCount > 0 ? (s.count / maxCount) * 100 : 0;
      var zeroClass = s.count === 0 ? ' is-zero' : '';
      var clickable = s.count > 0 ? ' is-clickable' : '';
      html += '<div class="t3-bar-row' + zeroClass + clickable +
        '" data-standard="' + esc(s.standard) + '"' +
        (s.count > 0 ? ' tabindex="0" role="button"' : '') + '>';

      html += '<div class="t3-bar-label">' + esc(shortStandard(s.standard)) + '</div>';
      html += '<div class="t3-bar-track">';
      html += '<div class="t3-bar-fill" style="width:' + pct + '%"></div>';
      html += '</div>';
      html += '<div class="t3-bar-value">';
      html += '<span class="t3-bar-count">' + s.count + '</span>';
      html += '<span class="t3-bar-pct">' + s.percentage + '%</span>';
      html += '</div>';

      html += '</div>';
    });
    html += '</div>';
    return html;
  }

  // ---------- Drill-down panel: clients per standard ----------
  function renderStandardDrilldown(standard, distribution) {
    var match = distribution.byStandard.find(function (s) {
      return s.standard === standard;
    });
    if (!match) return "";

    var html = '<section class="t3-drilldown">';
    html += '<header class="t3-drilldown-header">';
    html += '<div>';
    html += '<h3 class="t3-drilldown-title">' + esc(shortStandard(standard)) + '</h3>';
    html += '<span class="t3-drilldown-meta">' + match.count +
      ' flag' + (match.count === 1 ? '' : 's') + ' from ' +
      match.clients.length + ' client' + (match.clients.length === 1 ? '' : 's') + '</span>';
    html += '</div>';
    html += '<button type="button" class="t3-drilldown-close" aria-label="Close">×</button>';
    html += '</header>';
    html += '<div class="t3-drilldown-body">';

    if (match.clients.length === 0) {
      html += '<div class="t3-empty">No clients to show.</div>';
    } else {
      html += '<ul class="t3-client-list">';
      match.clients.forEach(function (c) {
        html += '<li class="t3-client-row" data-client="' + esc(c.clientName) +
          '" tabindex="0" role="button">';
        html += '<span class="t3-client-name">' + esc(c.clientName) + '</span>';
        html += '<span class="t3-client-count">' + c.count +
          ' flag' + (c.count === 1 ? '' : 's') + '</span>';
        html += '</li>';
      });
      html += '</ul>';
    }

    html += '</div>';
    html += '</section>';
    return html;
  }

  // ---------- Main panel renderer ----------
  function renderPanel(ctx) {
    var container = document.getElementById("patterns-content");
    if (!container) return;

    var coaches = uniqueCoaches(ctx.states);

    // Default selected coach: first alphabetically.
    if (!viewState.selectedCoach || coaches.indexOf(viewState.selectedCoach) === -1) {
      viewState.selectedCoach = coaches[0] || null;
    }

    if (!viewState.selectedCoach) {
      container.innerHTML = renderHeader() +
        '<div class="t3-empty-state">' +
        '<p>No coaches with active clients to diagnose.</p>' +
        '</div>';
      return;
    }

    // Compute Component 1 data
    var distribution = root.CoachDiagnosticsAggregators.calculateStandardDistribution(
      ctx.formResponses,
      ctx.roster,
      viewState.selectedCoach,
      viewState.periodDays
    );

    var html = "";
    html += renderHeader();
    html += renderToolbar(coaches);
    html += '<div class="t3-grid">';

    // Left: Component 1 (bars)
    html += '<div class="t3-col t3-col-main">';
    html += renderComponent1(distribution);
    html += '</div>';

    // Right: drill-down panel (sticky context)
    html += '<aside class="t3-col t3-col-aside">';
    if (viewState.drillDown && viewState.drillDown.kind === "standard") {
      html += renderStandardDrilldown(viewState.drillDown.payload, distribution);
    } else {
      html += renderDrilldownPlaceholder();
    }
    html += '</aside>';

    html += '</div>';

    container.innerHTML = html;
    wireInteractions(ctx, distribution);
  }

  function renderDrilldownPlaceholder() {
    var html = '<section class="t3-drilldown is-placeholder">';
    html += '<div class="t3-drilldown-placeholder-body">';
    html += '<div class="t3-placeholder-icon">→</div>';
    html += '<p class="t3-placeholder-text">Click a standard bar to see which clients contributed.</p>';
    html += '</div>';
    html += '</section>';
    return html;
  }

  // ---------- Wire interactions ----------
  function wireInteractions(ctx, distribution) {
    // Coach selector
    document.querySelectorAll(".t3-coach-tab").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var c = btn.getAttribute("data-coach");
        if (c && c !== viewState.selectedCoach) {
          viewState.selectedCoach = c;
          viewState.drillDown = null; // reset drill-down on coach change
          renderPanel(ctx);
        }
      });
    });

    // Period selector
    document.querySelectorAll(".t3-period-tab").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var d = parseInt(btn.getAttribute("data-days"), 10);
        if (!isNaN(d) && d !== viewState.periodDays) {
          viewState.periodDays = d;
          viewState.drillDown = null; // reset drill-down on period change
          renderPanel(ctx);
        }
      });
    });

    // Bar click -> open standard drill-down
    document.querySelectorAll(".t3-bar-row.is-clickable").forEach(function (row) {
      var open = function () {
        var std = row.getAttribute("data-standard");
        if (std) {
          viewState.drillDown = { kind: "standard", payload: std };
          renderPanel(ctx);
        }
      };
      row.addEventListener("click", open);
      row.addEventListener("keydown", function (e) {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          open();
        }
      });
    });

    // Drill-down close
    var closeBtn = document.querySelector(".t3-drilldown-close");
    if (closeBtn) {
      closeBtn.addEventListener("click", function () {
        viewState.drillDown = null;
        renderPanel(ctx);
      });
    }

    // Client row -> open PathwayDetail modal
    document.querySelectorAll(".t3-client-row").forEach(function (row) {
      var open = function () {
        var clientName = row.getAttribute("data-client");
        if (clientName && root.PathwayDetail && root.PathwayDetail.open) {
          root.PathwayDetail.open(clientName, {
            states: ctx.states,
            hcActions: ctx.hcActions,
            formResponses: ctx.formResponses
          });
        }
      };
      row.addEventListener("click", open);
      row.addEventListener("keydown", function (e) {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          open();
        }
      });
    });
  }

  // ---------- Public ----------
  function render(ctx) {
    if (!ctx) return;
    if (!root.CoachDiagnosticsAggregators) {
      var container = document.getElementById("patterns-content");
      if (container) {
        container.innerHTML = '<div class="error-state"><h2>Could not load Tab 3</h2>' +
          '<p>CoachDiagnosticsAggregators module not available.</p></div>';
      }
      return;
    }
    renderPanel(ctx);
  }

  root.Tab3 = {
    render: render
  };
})(typeof window !== "undefined" ? window : this);
