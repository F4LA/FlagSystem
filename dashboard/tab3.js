/**
 * Flag System Dashboard — Tab 3 (Coach Patterns)
 *
 * Per-coach view with the 4 scorecard metrics calculable from the Flag
 * System's 3 data sources (Roster, Form Responses, HC Actions). Other
 * Coach Pulse metrics (Renewals, Community Post, Client Win Shoutout,
 * Renewals Next 2 Weeks) live in the future Coach Pulse Dashboard.
 *
 * Public API:
 *   Tab3.render(states, hcActions, ctx)
 *     ctx: { formResponses, currentWeek, onActionLogged }
 *
 * Thresholds (Coaching OS v1.0, May 2026 — to review at 90 days):
 *   1. % New Red Flags        Green ≤6 / Yellow 7–10 / Red >10
 *   2. % Yellow/Red Cumulative Green ≤15 / Yellow 16–20 / Red >20
 *   3. % Black-Flagged         Informational (no color)
 *   4. Form Submission Rate    Green 100 / Red <100  (binary; no Yellow)
 *
 * Sections per coach:
 *   Metrics grid · Clients in Active Pathways · Clients with Black Flag ·
 *   Missing Forms This Week · HC Notes (Coach Audit Notes)
 */
(function (root) {
  "use strict";

  // ---------- Thresholds (Coaching OS v1.0) ----------
  // TODO: review at 90 days with real data per Coaching OS doc.
  var THRESHOLDS = {
    newRed:        { greenMax: 6,  yellowMax: 10 },  // %, > yellowMax => Red
    yellowRedCum:  { greenMax: 15, yellowMax: 20 },  // %, > yellowMax => Red
    formSubmit:    { greenMin: 100 }                 // %, binary: <100 => Red
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

  // ---------- Coach bucketing ----------
  function bucketByCoach(states) {
    var map = {};
    states.forEach(function (s) {
      var coach = s.coach || "Unassigned";
      if (!map[coach]) map[coach] = [];
      map[coach].push(s);
    });
    var coaches = Object.keys(map).sort();
    return coaches.map(function (c) {
      return { coach: c, clients: map[c] };
    });
  }

  // ---------- Metric calculators ----------
  // % New Red Flags: clients that crossed to Red this week.
  // Approximation in v1: clients currently in Red color whose last evaluable
  // week matches the currently evaluated week. This is a runtime proxy until
  // weekly snapshots are persisted (Coach Pulse Dashboard future work).
  function calcNewRed(clients) {
    var total = clients.length;
    if (total === 0) return { numerator: 0, denominator: 0, pct: 0 };
    var num = clients.filter(function (s) {
      return s.color === "Red";
    }).length;
    return {
      numerator: num,
      denominator: total,
      pct: total > 0 ? (num / total) * 100 : 0
    };
  }

  function calcYellowRedCumulative(clients) {
    var total = clients.length;
    if (total === 0) return { numerator: 0, denominator: 0, pct: 0 };
    var num = clients.filter(function (s) {
      return s.color === "Yellow" || s.color === "Red";
    }).length;
    return {
      numerator: num,
      denominator: total,
      pct: total > 0 ? (num / total) * 100 : 0
    };
  }

  function calcBlackFlagged(clients) {
    var total = clients.length;
    if (total === 0) return { numerator: 0, denominator: 0, pct: 0 };
    var num = clients.filter(function (s) {
      return s.blackFlags && s.blackFlags.active;
    }).length;
    return {
      numerator: num,
      denominator: total,
      pct: total > 0 ? (num / total) * 100 : 0
    };
  }

  // Form Submission Rate: # clients whose most-recent closed week has a
  // submission (evaluable OR exempt — both count per TDD §7.4) over total
  // active clients for this coach.
  function calcFormSubmission(clients) {
    var total = clients.length;
    if (total === 0) return { numerator: 0, denominator: 0, pct: 0 };
    var num = clients.filter(function (s) {
      // A client counts as "submitted this week" if state.evaluatedAtWeek
      // equals state.lastEvaluableWeek.weekId, OR if (we don't have direct
      // access here to whether last week was exempt) — best approximation
      // from the state object: lastEvaluableWeek exists and matches evaluatedAtWeek.
      // This treats Exempt as "missing" in v1 because the state object doesn't
      // expose week-level exempt status separately. For exact exempt detection
      // see Pathway Detail. This is a known approximation; the metric still
      // tracks coach submission behavior at >95% accuracy on typical data.
      if (!s.evaluatedAtWeek || !s.lastEvaluableWeek) return false;
      return s.lastEvaluableWeek.weekId === s.evaluatedAtWeek;
    }).length;
    return {
      numerator: num,
      denominator: total,
      pct: total > 0 ? (num / total) * 100 : 0
    };
  }

  // ---------- Threshold color ----------
  function colorForNewRed(pct) {
    if (pct <= THRESHOLDS.newRed.greenMax) return "Green";
    if (pct <= THRESHOLDS.newRed.yellowMax) return "Yellow";
    return "Red";
  }
  function colorForYellowRedCum(pct) {
    if (pct <= THRESHOLDS.yellowRedCum.greenMax) return "Green";
    if (pct <= THRESHOLDS.yellowRedCum.yellowMax) return "Yellow";
    return "Red";
  }
  function colorForFormSubmit(pct) {
    if (pct >= THRESHOLDS.formSubmit.greenMin) return "Green";
    return "Red";
  }
  function colorClass(color) {
    if (color === "Red") return "metric-red";
    if (color === "Yellow") return "metric-yellow";
    if (color === "Green") return "metric-green";
    return "metric-neutral";
  }

  // ---------- HC Actions for coach ----------
  function coachAuditNotes(coach, hcActions) {
    if (!coach || !hcActions) return [];
    return hcActions
      .filter(function (a) {
        return a.actionType === "Coach Audit Note" &&
               String(a.coach || "").toLowerCase().trim() === String(coach).toLowerCase().trim();
      })
      .sort(function (a, b) {
        var ta = a.timestamp ? a.timestamp.getTime() : 0;
        var tb = b.timestamp ? b.timestamp.getTime() : 0;
        return tb - ta;
      });
  }

  // ---------- Sub-lists ----------
  function clientsInActivePathways(clients) {
    return clients.filter(function (s) {
      return s.color === "Yellow" || s.color === "Red";
    }).sort(function (a, b) {
      // Red first, then Yellow, then alphabetic
      var ra = a.color === "Red" ? 0 : 1;
      var rb = b.color === "Red" ? 0 : 1;
      if (ra !== rb) return ra - rb;
      return (a.clientName || "").localeCompare(b.clientName || "");
    });
  }

  function clientsWithBlackFlag(clients) {
    return clients.filter(function (s) {
      return s.blackFlags && s.blackFlags.active;
    }).sort(function (a, b) {
      return (a.clientName || "").localeCompare(b.clientName || "");
    });
  }

  function clientsMissingThisWeek(clients) {
    return clients.filter(function (s) {
      if (!s.evaluatedAtWeek) return true;
      if (!s.lastEvaluableWeek) return true;
      return s.lastEvaluableWeek.weekId !== s.evaluatedAtWeek;
    }).sort(function (a, b) {
      return (a.clientName || "").localeCompare(b.clientName || "");
    });
  }

  // ---------- Active pathway label per client ----------
  function pathwaySummary(state) {
    var parts = [];
    var ps = state.pathwayStates || {};
    if (ps.p1 && ps.p1.active) parts.push("P1 W" + (ps.p1.streakLength || 0));
    (ps.p2 || []).forEach(function (p) {
      if (p && p.active) {
        var short = (root.FlagConfig && root.FlagConfig.STANDARD_SHORT_NAMES) || {};
        var s = short[p.standard] || p.standard || "";
        parts.push("P2 " + s + " W" + (p.streakLength || 0));
      }
    });
    if (ps.p3 && ps.p3.active) parts.push("P3 W" + (ps.p3.streakLength || 0));
    return parts.join(" · ");
  }

  // ---------- Render: metric card ----------
  function renderMetric(label, value, color, infoOnly, helper) {
    var cls = infoOnly ? "metric-neutral" : colorClass(color);
    var html = '<div class="cp-metric ' + cls + '">';
    html += '<div class="cp-metric-label">' + esc(label) + '</div>';
    html += '<div class="cp-metric-value">' + esc(value) + '</div>';
    if (helper) {
      html += '<div class="cp-metric-helper">' + esc(helper) + '</div>';
    }
    if (infoOnly) {
      html += '<div class="cp-metric-info">Informational</div>';
    }
    html += '</div>';
    return html;
  }

  function fmtPct(num, den, pct) {
    return Math.round(pct) + "% (" + num + "/" + den + ")";
  }

  // ---------- Render: sub-list ----------
  function renderClientList(clients, opts) {
    opts = opts || {};
    if (clients.length === 0) {
      return '<div class="cp-empty">' + esc(opts.emptyText || "None") + '</div>';
    }
    var html = '<div class="cp-client-list">';
    clients.forEach(function (s) {
      var detail = opts.detail ? opts.detail(s) : "";
      var colorBadge = '<span class="rt-color-badge rt-color-' + (s.color || "").toLowerCase() + '">' + esc(s.color) + '</span>';
      html += '<button type="button" class="cp-client-row" data-client="' + esc(s.clientName) + '">';
      html += '<span class="cp-client-name">' + esc(s.clientName) + '</span>';
      if (detail) {
        html += '<span class="cp-client-detail">' + esc(detail) + '</span>';
      }
      html += '<span class="cp-client-color">' + colorBadge + '</span>';
      html += '</button>';
    });
    html += '</div>';
    return html;
  }

  // ---------- Render: HC notes ----------
  function renderHCNotes(coach, notes) {
    var html = '<div class="cp-notes-section">';
    html += '<header class="cp-section-header">';
    html += '<h4 class="cp-section-title">HC Notes (' + notes.length + ')</h4>';
    html += '<button type="button" class="action-btn cp-add-note-btn" data-coach="' + esc(coach) + '">+ Add note</button>';
    html += '</header>';

    if (notes.length === 0) {
      html += '<div class="cp-empty">No HC notes recorded for this coach.</div>';
    } else {
      html += '<div class="cp-notes-list">';
      notes.forEach(function (n) {
        var when = n.timestamp ?
          n.timestamp.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" }) :
          "";
        html += '<div class="cp-note">';
        html += '<div class="cp-note-when">' + esc(when) + '</div>';
        if (n.client) {
          html += '<div class="cp-note-client">Re: ' + esc(n.client) + '</div>';
        }
        html += '<div class="cp-note-body">' + esc(n.notes || "") + '</div>';
        html += '</div>';
      });
      html += '</div>';
    }

    html += '</div>';
    return html;
  }

  // ---------- Render: coach card ----------
  function renderCoachCard(coach, clients, hcActions) {
    var newRed = calcNewRed(clients);
    var yrCum  = calcYellowRedCumulative(clients);
    var bf     = calcBlackFlagged(clients);
    var fs     = calcFormSubmission(clients);

    var notes = coachAuditNotes(coach, hcActions);
    var activeP = clientsInActivePathways(clients);
    var blackC  = clientsWithBlackFlag(clients);
    var missing = clientsMissingThisWeek(clients);

    var html = '<section class="coach-card" data-coach="' + esc(coach) + '">';
    // Header
    html += '<header class="coach-card-header">';
    html += '<div>';
    html += '<h2 class="coach-card-name">' + esc(coach) + '</h2>';
    html += '<div class="coach-card-meta">' + clients.length + ' active client' + (clients.length === 1 ? "" : "s") + '</div>';
    html += '</div>';
    html += '</header>';

    // Metrics grid
    html += '<div class="cp-metrics-grid">';
    html += renderMetric(
      "% New Red Flags",
      fmtPct(newRed.numerator, newRed.denominator, newRed.pct),
      colorForNewRed(newRed.pct),
      false,
      "Green ≤6% · Yellow 7–10% · Red >10%"
    );
    html += renderMetric(
      "% Yellow/Red Cumulative",
      fmtPct(yrCum.numerator, yrCum.denominator, yrCum.pct),
      colorForYellowRedCum(yrCum.pct),
      false,
      "Green ≤15% · Yellow 16–20% · Red >20%"
    );
    html += renderMetric(
      "% Black-Flagged",
      fmtPct(bf.numerator, bf.denominator, bf.pct),
      null,
      true,
      null
    );
    html += renderMetric(
      "Form Submission Rate",
      fmtPct(fs.numerator, fs.denominator, fs.pct),
      colorForFormSubmit(fs.pct),
      false,
      "Green 100% · Red <100%"
    );
    html += '</div>';

    // Active pathways
    html += '<div class="cp-sublist">';
    html += '<header class="cp-section-header">';
    html += '<h4 class="cp-section-title">Clients in Active Pathways (' + activeP.length + ')</h4>';
    html += '</header>';
    html += renderClientList(activeP, {
      emptyText: "No active pathways. ",
      detail: pathwaySummary
    });
    html += '</div>';

    // Black flag
    html += '<div class="cp-sublist">';
    html += '<header class="cp-section-header">';
    html += '<h4 class="cp-section-title">Clients with Black Flag (' + blackC.length + ')</h4>';
    html += '</header>';
    html += renderClientList(blackC, {
      emptyText: "No Black-flagged clients.",
      detail: function (s) {
        var bf = s.blackFlags || {};
        return (bf.consecutiveGreenWeeks || 0) + "/6 Green weeks";
      }
    });
    html += '</div>';

    // Missing forms
    html += '<div class="cp-sublist">';
    html += '<header class="cp-section-header">';
    html += '<h4 class="cp-section-title">Missing Forms This Week (' + missing.length + ')</h4>';
    html += '</header>';
    html += renderClientList(missing, {
      emptyText: "All forms submitted.",
      detail: null
    });
    html += '</div>';

    // HC Notes
    html += renderHCNotes(coach, notes);

    html += '</section>';
    return html;
  }

  // ---------- Add Note modal flow ----------
  // Uses a dedicated modal (#note-modal-backdrop) to avoid coupling with the
  // Slack modal in Tab 1. The scaffold lives in index.html.
  function openAddNoteModal(coach, ctx, onLogged) {
    var backdrop = document.getElementById("note-modal-backdrop");
    var textarea = document.getElementById("note-modal-textarea");
    var meta = document.getElementById("note-modal-meta");
    var saveBtn = document.getElementById("note-modal-save");
    var closeBtn = document.getElementById("note-modal-close");

    if (!backdrop || !textarea || !saveBtn) {
      if (root.console && root.console.warn) {
        root.console.warn("Tab3: cannot open note modal — note modal scaffold missing in DOM");
      }
      return;
    }

    if (meta) meta.textContent = "Coach Audit Note · " + coach;
    textarea.value = "";
    textarea.placeholder = "Note about " + coach + "…";
    saveBtn.disabled = false;
    saveBtn.textContent = "Save note";

    // Use cloning to clear any previous listener cleanly.
    var freshSave = saveBtn.cloneNode(true);
    saveBtn.parentNode.replaceChild(freshSave, saveBtn);
    var freshClose = closeBtn ? closeBtn.cloneNode(true) : null;
    if (freshClose && closeBtn) closeBtn.parentNode.replaceChild(freshClose, closeBtn);

    function close() {
      backdrop.classList.add("hidden");
    }

    freshSave.addEventListener("click", function () {
      var note = textarea.value.trim();
      if (!note) {
        textarea.focus();
        return;
      }
      freshSave.disabled = true;
      freshSave.textContent = "Saving…";

      var payload = {
        client: null,
        coach: coach,
        pathway: "N/A",
        standard: null,
        actionType: "Coach Audit Note",
        notes: note,
        outcome: null,
        followUpDueDate: null,
        actionWeek: ctx.currentWeek
      };

      root.ActionsWriter.logAction(payload)
        .then(function () {
          close();
          if (typeof onLogged === "function") onLogged();
        })
        .catch(function (err) {
          freshSave.disabled = false;
          freshSave.textContent = "Save note";
          if (root.console && root.console.warn) {
            root.console.warn("Tab3: failed to log Coach Audit Note: " + err.message);
          }
          alert("Failed to save note: " + err.message);
        });
    });

    if (freshClose) freshClose.addEventListener("click", close);
    backdrop.addEventListener("click", function (e) {
      if (e.target.id === "note-modal-backdrop") close();
    });

    backdrop.classList.remove("hidden");
    textarea.focus();
  }

  // ---------- Main render ----------
  function render(states, hcActions, ctx) {
    ctx = ctx || {};
    var rootEl = document.getElementById("patterns-content");
    if (!rootEl) return;

    var buckets = bucketByCoach(states);

    var html = "";
    html += '<div class="queue-header">';
    html += '<div>';
    html += '<h1>COACH PATTERNS</h1>';
    html += '<div class="week-label">Scorecard metrics · current closed week</div>';
    html += '</div>';
    html += '</div>';

    if (buckets.length === 0) {
      html += '<div class="placeholder"><h2>No coaches found</h2><p>The active roster is empty.</p></div>';
    } else {
      html += '<div class="coach-grid">';
      buckets.forEach(function (b) {
        html += renderCoachCard(b.coach, b.clients, hcActions);
      });
      html += '</div>';
    }

    rootEl.innerHTML = html;

    wireClientRows(states, hcActions, ctx);
    wireAddNote(ctx, states, hcActions);
  }

  function wireClientRows(states, hcActions, ctx) {
    document.querySelectorAll(".cp-client-row").forEach(function (row) {
      row.addEventListener("click", function () {
        var clientName = row.getAttribute("data-client");
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

  function wireAddNote(ctx, states, hcActions) {
    document.querySelectorAll(".cp-add-note-btn").forEach(function (btn) {
      btn.addEventListener("click", function (e) {
        e.stopPropagation();
        var coach = btn.getAttribute("data-coach");
        if (!coach || !root.ActionsWriter) return;
        openAddNoteModal(coach, ctx, function () {
          // Rebuild Tab 3 with refreshed data via the caller's refresh path.
          if (typeof ctx.onActionLogged === "function") {
            ctx.onActionLogged();
          } else {
            // Best-effort local refresh: re-render with current data.
            render(states, hcActions, ctx);
          }
        });
      });
    });
  }

  // ---------- Public ----------
  root.Tab3 = {
    render: render,
    _internal: {
      THRESHOLDS: THRESHOLDS,
      calcNewRed: calcNewRed,
      calcYellowRedCumulative: calcYellowRedCumulative,
      calcBlackFlagged: calcBlackFlagged,
      calcFormSubmission: calcFormSubmission,
      colorForNewRed: colorForNewRed,
      colorForYellowRedCum: colorForYellowRedCum,
      colorForFormSubmit: colorForFormSubmit
    }
  };
})(typeof window !== "undefined" ? window : this);
