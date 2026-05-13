/**
 * Flag System Dashboard — Tab 3: Coach Diagnostics
 *
 * Private HC view answering three diagnostic questions per coach:
 *   1. Which standards do their clients fail most? (Component 1)
 *   2. Are flags concentrated in a few clients or distributed? (Component 2)
 *   3. How long are clients staying in each pathway? (Component 3)
 *
 * This file is the renderer. All math lives in
 * CoachDiagnosticsAggregators. Drill-down to a single client delegates
 * to PathwayDetail.open (shared modal).
 *
 * Public API:
 *   Tab3.render(states, hcActions, sharedCtx)
 *     states:     array of ClientState objects from StateBuilder
 *     hcActions:  array of HC Actions rows
 *     sharedCtx:  { formResponses, currentWeek, onActionLogged }
 */
(function (root) {
  "use strict";

  // ---------- Module state ----------
  var viewState = {
    selectedCoach: null,
    periodDays: 90,
    compareMode: false,
    drillDown: null,                // { kind: "standard"|"pathway", payload }
    chronicityCache: null,
    chronicityCacheKey: null
  };

  // ---------- Component descriptions ----------
  var DESCRIPTIONS = {
    component1:
      "Which standards fail most often for this coach's clients. Use it to spot training needs — if one standard dominates, the coach may need support on how to address that area with clients.",
    component2:
      "Whether flags are coming from a few clients or many. HIGH concentration = the issue is likely the client mix, not the coach. LOW concentration = a systemic coaching pattern worth addressing.",
    component3:
      "How many clients are currently in each pathway, and how that's been trending over the past 12 weeks. Rising lines or long average durations suggest cases that need a 1:1 outside Coach Pulse."
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

  function rosterFromStates(states) {
    return (states || []).map(function (s) {
      return { client: s.clientName, coach: s.coach };
    });
  }

  function shortStandard(name) {
    var map = (root.FlagConfig && root.FlagConfig.STANDARD_SHORT_NAMES) || {};
    return map[name] || name;
  }

  function formatWeekLabel(yyyymmdd) {
    if (!yyyymmdd || typeof yyyymmdd !== "string") return "";
    var parts = yyyymmdd.split("-");
    if (parts.length !== 3) return yyyymmdd;
    var d = new Date(Date.UTC(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10)));
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  }

  // ---------- Header ----------
  function renderHeader() {
    var html = "";
    html += '<div class="t3-header">';
    html += '<h1 class="t3-title">COACH DIAGNOSTICS</h1>';
    html += '<p class="t3-subtitle">Private view for HC. Answers WHY a coach\'s metrics are what they are.</p>';
    html += '</div>';
    return html;
  }

  // ---------- Toolbar ----------
  function renderToolbar(coaches) {
    var html = "";
    html += '<div class="t3-toolbar">';

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

  function renderDescription(text) {
    return '<p class="t3-card-desc">' + esc(text) + '</p>';
  }

  // ---------- Component 1 ----------
  function renderComponent1(distribution) {
    var html = "";
    html += '<section class="t3-card">';
    html += '<header class="t3-card-header">';
    html += '<h2 class="t3-card-title">STANDARD FAILURE DISTRIBUTION</h2>';
    html += '<span class="t3-card-meta">' + distribution.totalFlags +
      ' total flag' + (distribution.totalFlags === 1 ? '' : 's') + '</span>';
    html += '</header>';
    html += '<div class="t3-card-body">';
    html += renderDescription(DESCRIPTIONS.component1);

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

  // ---------- Component 2 ----------
  function renderComponent2(rotation) {
    var html = "";
    html += '<section class="t3-card">';
    html += '<header class="t3-card-header">';
    html += '<h2 class="t3-card-title">CLIENT ROTATION INDEX</h2>';
    html += '<span class="t3-card-meta">' + rotation.uniqueClients +
      ' unique client' + (rotation.uniqueClients === 1 ? '' : 's') + '</span>';
    html += '</header>';
    html += '<div class="t3-card-body">';
    html += renderDescription(DESCRIPTIONS.component2);

    if (rotation.totalFlags === 0) {
      html += '<div class="t3-empty">No flags to analyze in this period.</div>';
    } else {
      html += renderRotationBody(rotation);
    }

    html += '</div>';
    html += '</section>';
    return html;
  }

  function renderRotationBody(rotation) {
    var levelLabel = rotation.concentrationLevel.toUpperCase();
    var html = '<div class="t3-rotation-grid">';

    html += '<div class="t3-conc-card t3-conc-' + rotation.concentrationLevel + '">';
    html += '<div class="t3-conc-score">' + rotation.concentrationScore + '%</div>';
    html += '<div class="t3-conc-level">' + levelLabel + ' CONCENTRATION</div>';
    html += '<div class="t3-conc-sub">Top 3 clients = ' + rotation.concentrationScore +
      '% of ' + rotation.totalFlags + ' flag' + (rotation.totalFlags === 1 ? '' : 's') + '</div>';
    html += '</div>';

    html += '<div class="t3-contrib-list">';
    html += '<div class="t3-contrib-header">TOP CONTRIBUTORS</div>';
    if (rotation.topContributors.length === 0) {
      html += '<div class="t3-empty-inline">No contributors.</div>';
    } else {
      rotation.topContributors.forEach(function (c, i) {
        html += '<div class="t3-contrib-row" data-client="' + esc(c.clientName) +
          '" tabindex="0" role="button">';
        html += '<span class="t3-contrib-rank">#' + (i + 1) + '</span>';
        html += '<span class="t3-contrib-name">' + esc(c.clientName) + '</span>';
        html += '<span class="t3-contrib-count">' + c.flagCount + ' (' + c.percentage + '%)</span>';
        html += '</div>';
      });
    }
    html += '</div>';

    html += '</div>';
    return html;
  }

  // ---------- Component 3 ----------
  function renderComponent3(chronicity) {
    var html = "";
    html += '<section class="t3-card t3-card-wide">';
    html += '<header class="t3-card-header">';
    html += '<h2 class="t3-card-title">PATHWAY CHRONICITY</h2>';
    var totalCurrent = chronicity.currentState.P1 + chronicity.currentState.P2.total + chronicity.currentState.P3;
    html += '<span class="t3-card-meta">' + totalCurrent +
      ' active pathway' + (totalCurrent === 1 ? '' : 's') + ' now</span>';
    html += '</header>';
    html += '<div class="t3-card-body">';
    html += renderDescription(DESCRIPTIONS.component3);

    html += '<div class="t3-chronicity-grid">';

    html += '<div class="t3-chron-current">';
    html += '<div class="t3-chron-subheader">CURRENT PATHWAYS</div>';
    html += renderCurrentPathways(chronicity.currentState);
    html += '</div>';

    html += '<div class="t3-chron-trend">';
    html += '<div class="t3-chron-subheader">12-WEEK TREND</div>';
    html += renderTrendChart(chronicity.trend);
    html += renderAvgDuration(chronicity.trend.avgDuration);
    html += '</div>';

    html += '</div>';
    html += '</div>';
    html += '</section>';
    return html;
  }

  function renderCurrentPathways(currentState) {
    var html = '<div class="t3-current-stats">';

    html += '<div class="t3-stat-block t3-stat-p1' + (currentState.P1 > 0 ? '' : ' is-empty') +
      '" data-pathway="P1"' + (currentState.P1 > 0 ? ' tabindex="0" role="button"' : '') + '>';
    html += '<div class="t3-stat-num">' + currentState.P1 + '</div>';
    html += '<div class="t3-stat-label">P1 ACUTE</div>';
    html += '</div>';

    html += '<div class="t3-stat-block t3-stat-p2' + (currentState.P2.total > 0 ? '' : ' is-empty') +
      '" data-pathway="P2"' + (currentState.P2.total > 0 ? ' tabindex="0" role="button"' : '') + '>';
    html += '<div class="t3-stat-num">' + currentState.P2.total + '</div>';
    html += '<div class="t3-stat-label">P2 REPEATED</div>';
    if (currentState.P2.byStandard.length > 0) {
      html += '<div class="t3-stat-breakdown">';
      currentState.P2.byStandard.forEach(function (item) {
        html += '<span class="t3-stat-chip">' + esc(shortStandard(item.standard)) +
          ' (' + item.count + ')</span>';
      });
      html += '</div>';
    }
    html += '</div>';

    html += '<div class="t3-stat-block t3-stat-p3' + (currentState.P3 > 0 ? '' : ' is-empty') +
      '" data-pathway="P3"' + (currentState.P3 > 0 ? ' tabindex="0" role="button"' : '') + '>';
    html += '<div class="t3-stat-num">' + currentState.P3 + '</div>';
    html += '<div class="t3-stat-label">P3 INCONSISTENT</div>';
    html += '</div>';

    html += '</div>';
    return html;
  }

  function renderTrendChart(trend) {
    var points = trend.weeklyActiveByPathway || [];
    if (points.length === 0) {
      return '<div class="t3-empty-inline">No trend data available.</div>';
    }

    var maxY = 0;
    points.forEach(function (p) {
      if (p.P1 > maxY) maxY = p.P1;
      if (p.P2 > maxY) maxY = p.P2;
      if (p.P3 > maxY) maxY = p.P3;
    });
    if (maxY === 0) maxY = 1;

    var W = 640, H = 200;
    var padL = 32, padR = 12, padT = 14, padB = 36;
    var chartW = W - padL - padR;
    var chartH = H - padT - padB;

    var n = points.length;
    var stepX = n > 1 ? chartW / (n - 1) : 0;
    var x = function (i) { return padL + i * stepX; };
    var y = function (v) { return padT + chartH - (v / maxY) * chartH; };

    function pathFor(key) {
      var d = "";
      points.forEach(function (p, i) {
        d += (i === 0 ? "M " : " L ") + x(i).toFixed(1) + " " + y(p[key]).toFixed(1);
      });
      return d;
    }

    var html = '<div class="t3-trend-wrap">';

    html += '<div class="t3-trend-legend">';
    html += '<span class="t3-legend-item"><span class="t3-legend-dot t3-line-p1"></span>P1</span>';
    html += '<span class="t3-legend-item"><span class="t3-legend-dot t3-line-p2"></span>P2</span>';
    html += '<span class="t3-legend-item"><span class="t3-legend-dot t3-line-p3"></span>P3</span>';
    html += '</div>';

    html += '<svg class="t3-trend-svg" viewBox="0 0 ' + W + ' ' + H +
      '" preserveAspectRatio="none" role="img" aria-label="Pathway chronicity trend">';

    var gridVals = [0, Math.ceil(maxY / 2), maxY];
    // Dedup in case maxY is 1 (then mid==max)
    gridVals = gridVals.filter(function (v, i, a) { return a.indexOf(v) === i; });
    gridVals.forEach(function (v) {
      var yp = y(v);
      html += '<line class="t3-grid-line" x1="' + padL + '" y1="' + yp.toFixed(1) +
        '" x2="' + (W - padR) + '" y2="' + yp.toFixed(1) + '"/>';
      html += '<text class="t3-grid-label" x="' + (padL - 6) + '" y="' + (yp + 4).toFixed(1) +
        '" text-anchor="end">' + v + '</text>';
    });

    html += '<path class="t3-trend-line t3-line-p1" d="' + pathFor("P1") + '"/>';
    html += '<path class="t3-trend-line t3-line-p2" d="' + pathFor("P2") + '"/>';
    html += '<path class="t3-trend-line t3-line-p3" d="' + pathFor("P3") + '"/>';

    var xLabelIdxs = n <= 1 ? [0] : (n <= 3 ? [0, n - 1] : [0, Math.floor(n / 2), n - 1]);
    xLabelIdxs.forEach(function (i) {
      html += '<text class="t3-grid-label" x="' + x(i).toFixed(1) + '" y="' + (H - padB + 20) +
        '" text-anchor="middle">' + esc(formatWeekLabel(points[i].weekOf)) + '</text>';
    });

    html += '</svg>';
    html += '</div>';
    return html;
  }

  function renderAvgDuration(avg) {
    var html = '<div class="t3-avg-row">';
    html += '<span class="t3-avg-label">AVG DURATION</span>';
    html += '<span class="t3-avg-item"><strong class="t3-line-p1-text">P1</strong> ' + avg.P1 + 'w</span>';
    html += '<span class="t3-avg-item"><strong class="t3-line-p2-text">P2</strong> ' + avg.P2 + 'w</span>';
    html += '<span class="t3-avg-item"><strong class="t3-line-p3-text">P3</strong> ' + avg.P3 + 'w</span>';
    html += '</div>';
    return html;
  }

  // ---------- Drill-downs ----------
  function renderStandardDrilldown(standard, distribution) {
    var match = distribution.byStandard.find(function (s) { return s.standard === standard; });
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

  function renderPathwayDrilldown(pathwayCode, chronicity) {
    var clients = [];
    var title = "";
    if (pathwayCode === "P1") {
      clients = (chronicity.currentState.clientsByPathway.P1 || []).map(function (n) {
        return { clientName: n, sub: null };
      });
      title = "P1 ACUTE";
    } else if (pathwayCode === "P3") {
      clients = (chronicity.currentState.clientsByPathway.P3 || []).map(function (n) {
        return { clientName: n, sub: null };
      });
      title = "P3 INCONSISTENT";
    } else if (pathwayCode === "P2") {
      var byStd = chronicity.currentState.clientsByPathway.P2 || {};
      Object.keys(byStd).forEach(function (std) {
        byStd[std].forEach(function (n) {
          clients.push({ clientName: n, sub: shortStandard(std) });
        });
      });
      title = "P2 REPEATED";
    }

    var html = '<section class="t3-drilldown">';
    html += '<header class="t3-drilldown-header">';
    html += '<div>';
    html += '<h3 class="t3-drilldown-title">' + title + '</h3>';
    html += '<span class="t3-drilldown-meta">' + clients.length +
      ' client' + (clients.length === 1 ? '' : 's') + ' currently active</span>';
    html += '</div>';
    html += '<button type="button" class="t3-drilldown-close" aria-label="Close">×</button>';
    html += '</header>';
    html += '<div class="t3-drilldown-body">';

    if (clients.length === 0) {
      html += '<div class="t3-empty">No clients currently in this pathway.</div>';
    } else {
      html += '<ul class="t3-client-list">';
      clients.forEach(function (c) {
        html += '<li class="t3-client-row" data-client="' + esc(c.clientName) +
          '" tabindex="0" role="button">';
        html += '<span class="t3-client-name">' + esc(c.clientName) + '</span>';
        if (c.sub) {
          html += '<span class="t3-client-count">' + esc(c.sub) + '</span>';
        }
        html += '</li>';
      });
      html += '</ul>';
    }

    html += '</div>';
    html += '</section>';
    return html;
  }

  function renderDrilldownPlaceholder() {
    var html = '<section class="t3-drilldown is-placeholder">';
    html += '<div class="t3-drilldown-placeholder-body">';
    html += '<div class="t3-placeholder-icon">→</div>';
    html += '<p class="t3-placeholder-text">Click a standard bar, a top contributor, or a pathway block to see the clients behind the numbers.</p>';
    html += '</div>';
    html += '</section>';
    return html;
  }

  function renderActiveDrilldown(distribution, chronicity) {
    if (!viewState.drillDown) return renderDrilldownPlaceholder();
    if (viewState.drillDown.kind === "standard") {
      return renderStandardDrilldown(viewState.drillDown.payload, distribution);
    }
    if (viewState.drillDown.kind === "pathway") {
      return renderPathwayDrilldown(viewState.drillDown.payload, chronicity);
    }
    return renderDrilldownPlaceholder();
  }

  // ---------- Main render ----------
  function renderPanel(states, hcActions, sharedCtx) {
    var container = document.getElementById("patterns-content");
    if (!container) return;

    var coaches = uniqueCoaches(states);
    var roster = rosterFromStates(states);
    var formResponses = sharedCtx.formResponses || [];

    if (!viewState.selectedCoach || coaches.indexOf(viewState.selectedCoach) === -1) {
      viewState.selectedCoach = coaches[0] || null;
    }

    if (!viewState.selectedCoach) {
      container.innerHTML = renderHeader() +
        '<div class="t3-empty-state"><p>No coaches with active clients to diagnose.</p></div>';
      return;
    }

    var CDA = root.CoachDiagnosticsAggregators;

    var distribution = CDA.calculateStandardDistribution(
      formResponses, roster, viewState.selectedCoach, viewState.periodDays
    );

    var rotation = CDA.calculateRotationIndex(
      formResponses, roster, viewState.selectedCoach, viewState.periodDays
    );

    // Chronicity is expensive — cache per (coach, period) so re-renders
    // triggered by drill-down state don't recompute it.
    var cacheKey = viewState.selectedCoach + "|" + viewState.periodDays;
    var chronicity;
    if (viewState.chronicityCacheKey === cacheKey && viewState.chronicityCache) {
      chronicity = viewState.chronicityCache;
    } else {
      chronicity = CDA.calculatePathwayChronicity(
        states, formResponses, hcActions, roster, viewState.selectedCoach,
        { weeksBack: 12 }
      );
      viewState.chronicityCache = chronicity;
      viewState.chronicityCacheKey = cacheKey;
    }

    var html = "";
    html += renderHeader();
    html += renderToolbar(coaches);

    html += '<div class="t3-grid">';
    html += '<div class="t3-col t3-col-main">';
    html += renderComponent1(distribution);
    html += renderComponent2(rotation);
    html += '</div>';
    html += '<aside class="t3-col t3-col-aside">';
    html += renderActiveDrilldown(distribution, chronicity);
    html += '</aside>';
    html += '</div>';

    html += '<div class="t3-fullwidth">';
    html += renderComponent3(chronicity);
    html += '</div>';

    container.innerHTML = html;
    wireInteractions(states, hcActions, sharedCtx);
  }

  // ---------- Wire ----------
  function wireInteractions(states, hcActions, sharedCtx) {
    var rerender = function () { renderPanel(states, hcActions, sharedCtx); };

    document.querySelectorAll(".t3-coach-tab").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var c = btn.getAttribute("data-coach");
        if (c && c !== viewState.selectedCoach) {
          viewState.selectedCoach = c;
          viewState.drillDown = null;
          rerender();
        }
      });
    });

    document.querySelectorAll(".t3-period-tab").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var d = parseInt(btn.getAttribute("data-days"), 10);
        if (!isNaN(d) && d !== viewState.periodDays) {
          viewState.periodDays = d;
          viewState.drillDown = null;
          rerender();
        }
      });
    });

    document.querySelectorAll(".t3-bar-row.is-clickable").forEach(function (row) {
      var open = function () {
        var std = row.getAttribute("data-standard");
        if (std) {
          viewState.drillDown = { kind: "standard", payload: std };
          rerender();
        }
      };
      row.addEventListener("click", open);
      row.addEventListener("keydown", function (e) {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(); }
      });
    });

    document.querySelectorAll(".t3-stat-block[data-pathway]").forEach(function (block) {
      if (block.classList.contains("is-empty")) return;
      var open = function () {
        var p = block.getAttribute("data-pathway");
        if (p) {
          viewState.drillDown = { kind: "pathway", payload: p };
          rerender();
        }
      };
      block.addEventListener("click", open);
      block.addEventListener("keydown", function (e) {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(); }
      });
    });

    document.querySelectorAll(".t3-contrib-row").forEach(function (row) {
      var open = function () {
        var clientName = row.getAttribute("data-client");
        openClientDetail(clientName, states, hcActions, sharedCtx);
      };
      row.addEventListener("click", open);
      row.addEventListener("keydown", function (e) {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(); }
      });
    });

    var closeBtn = document.querySelector(".t3-drilldown-close");
    if (closeBtn) {
      closeBtn.addEventListener("click", function () {
        viewState.drillDown = null;
        rerender();
      });
    }

    document.querySelectorAll(".t3-client-row").forEach(function (row) {
      var open = function () {
        var clientName = row.getAttribute("data-client");
        openClientDetail(clientName, states, hcActions, sharedCtx);
      };
      row.addEventListener("click", open);
      row.addEventListener("keydown", function (e) {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(); }
      });
    });
  }

  function openClientDetail(clientName, states, hcActions, sharedCtx) {
    if (!clientName || !root.PathwayDetail || !root.PathwayDetail.open) return;
    root.PathwayDetail.open(clientName, {
      states: states,
      hcActions: hcActions,
      formResponses: sharedCtx.formResponses
    });
  }

  // ---------- Public ----------
  function render(states, hcActions, sharedCtx) {
    if (!root.CoachDiagnosticsAggregators) {
      var container = document.getElementById("patterns-content");
      if (container) {
        container.innerHTML = '<div class="error-state"><h2>Could not load Tab 3</h2>' +
          '<p>CoachDiagnosticsAggregators module not available.</p></div>';
      }
      return;
    }
    // Invalidate chronicity cache on external refresh.
    viewState.chronicityCache = null;
    viewState.chronicityCacheKey = null;
    renderPanel(states || [], hcActions || [], sharedCtx || {});
  }

  root.Tab3 = { render: render };
})(typeof window !== "undefined" ? window : this);
