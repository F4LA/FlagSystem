/**
 * Flag System Dashboard — Tab 1 Renderer (Friday Action Queue)
 *
 * Pure DOM rendering + button wiring. No data fetching. Receives the
 * output of QueueBuilder.build and produces the Tab 1 UI inside
 * #queue-content.
 *
 * Public API:
 *   Tab1.render(queue, ctx)
 *     queue: output of QueueBuilder.build
 *     ctx:   { onActionLogged: function(payload) }   // optional callback
 *
 * Wires:
 *   - Generate Slack buttons → SlackTemplates.buildSlackMessage → modal
 *   - Mark sent (in modal) → ActionsWriter.logAction → toast + disable
 *   - Direct client action buttons → ActionsWriter.logAction → toast + disable
 *   - Coach group collapse/expand
 *   - Completed This Week collapse/expand
 */
(function (root) {
  "use strict";

  // Raw form-response rows from the most recent load. Set in render() via
  // ctx.formResponses so the Slack modal can rebuild a client's timeline and
  // surface their most-recent coach note(s). Engine is only READ here (via
  // ClientTimeline.buildClientTimeline), never modified.
  var currentFormResponses = [];
  // For logging Park/Unpark actions and refreshing after.
  var currentActionWeek = null;
  var currentOnActionLogged = null;

  // Default lookback for the note timeline (matches FlagConfig.LOOKBACK_WEEKS).
  var NOTE_LOOKBACK_WEEKS =
    (root.FlagConfig && root.FlagConfig.LOOKBACK_WEEKS) || 16;

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

  // ---------- Coaching Week label ----------
  //
  // Formats a Coaching Week range (Thu–Wed) for display.
  // Accepts the queueWeekStart and queueWeekEnd Date objects produced by
  // queue-builder.js. Returns "May 14–20, 2026" or "Dec 31, 2026 – Jan 6, 2027"
  // for month-crossing ranges.
  function weekRangeLabel(startDate, endDate) {
    if (!(startDate instanceof Date) || !(endDate instanceof Date)) {
      return "";
    }
    var startMonth = startDate.toLocaleDateString("en-US", {
      month: "short", timeZone: "America/New_York"
    });
    var endMonth = endDate.toLocaleDateString("en-US", {
      month: "short", timeZone: "America/New_York"
    });
    var startDay = parseInt(startDate.toLocaleDateString("en-US", {
      day: "numeric", timeZone: "America/New_York"
    }), 10);
    var endDay = parseInt(endDate.toLocaleDateString("en-US", {
      day: "numeric", timeZone: "America/New_York"
    }), 10);
    var startYear = parseInt(startDate.toLocaleDateString("en-US", {
      year: "numeric", timeZone: "America/New_York"
    }), 10);
    var endYear = parseInt(endDate.toLocaleDateString("en-US", {
      year: "numeric", timeZone: "America/New_York"
    }), 10);

    if (startMonth === endMonth && startYear === endYear) {
      return startMonth + " " + startDay + "–" + endDay + ", " + endYear;
    }
    if (startYear === endYear) {
      return startMonth + " " + startDay + " – " + endMonth + " " + endDay + ", " + endYear;
    }
    return startMonth + " " + startDay + ", " + startYear +
           " – " + endMonth + " " + endDay + ", " + endYear;
  }

  // ---------- Toast ----------
  function toast(msg, kind) {
    var container = document.getElementById("toast-container");
    if (!container) return;
    var el = document.createElement("div");
    el.className = "toast" + (kind === "error" ? " toast-error" : " toast-success");
    el.textContent = msg;
    container.appendChild(el);
    setTimeout(function () {
      el.style.transition = "opacity 200ms ease";
      el.style.opacity = "0";
      setTimeout(function () { el.remove(); }, 220);
    }, 3500);
  }

  // ---------- Coach notes ----------
  //
  // Rebuild the client's timeline (read-only call into the engine) and pull
  // the most recent weeks that carry a free-text coach note ("Additional
  // notes", column H of Form Responses → wr.notes). Returns newest-first,
  // capped at `limit` entries.
  function getRecentNotes(clientName, limit) {
    limit = limit || 3;
    if (!root.ClientTimeline || typeof root.ClientTimeline.buildClientTimeline !== "function") {
      return [];
    }
    var timeline;
    try {
      timeline = root.ClientTimeline.buildClientTimeline(
        clientName,
        currentFormResponses,
        { lookbackWeeks: NOTE_LOOKBACK_WEEKS }
      );
    } catch (err) {
      if (root.console && root.console.warn) {
        root.console.warn("Tab1.getRecentNotes: timeline build failed for " +
          clientName + ": " + err.message);
      }
      return [];
    }

    var withNotes = [];
    // Timeline is oldest-first; walk backwards to collect newest notes first.
    for (var i = timeline.length - 1; i >= 0 && withNotes.length < limit; i--) {
      var wr = timeline[i];
      var note = wr && wr.notes ? String(wr.notes).trim() : "";
      if (note) {
        withNotes.push({ weekId: wr.weekId, weekStart: wr.weekStart, notes: note });
      }
    }
    return withNotes;
  }

  function formatNoteWeek(entry) {
    if (entry && entry.weekStart instanceof Date && !isNaN(entry.weekStart.getTime())) {
      return "Week of " + entry.weekStart.toLocaleDateString("en-US", {
        month: "short", day: "numeric", timeZone: "America/New_York"
      });
    }
    return entry && entry.weekId ? entry.weekId : "";
  }

  function renderNotesHtml(notes, expanded) {
    if (!notes || notes.length === 0) {
      return '<div class="slack-note-empty">No notes recorded.</div>';
    }
    var visible = expanded ? notes : notes.slice(0, 1);
    return visible.map(function (n) {
      return '<div class="slack-note-entry">' +
        '<span class="slack-note-week">' + esc(formatNoteWeek(n)) + '</span>' +
        '<div class="slack-note-text">' + esc(n.notes) + '</div>' +
        '</div>';
    }).join("");
  }

  // Populate the note column from modalState and wire the expand toggle label.
  function renderNoteColumn() {
    var body = document.getElementById("modal-note-body");
    var toggle = document.getElementById("modal-note-toggle");
    if (!body || !toggle) return;
    var notes = modalState.notes || [];
    body.innerHTML = renderNotesHtml(notes, modalState.notesExpanded);
    if (notes.length > 1) {
      toggle.classList.remove("hidden");
      toggle.textContent = modalState.notesExpanded
        ? "Show most recent only"
        : "Show last " + notes.length;
    } else {
      toggle.classList.add("hidden");
    }
  }

  // ---------- Situation brief (Direct Client Actions) ----------
  //
  // Deterministic, read-only summary so the HC understands a Post-Red client
  // before writing the support email: what's failing (plain language), what's
  // already happened (chain history), and the coach's notes verbatim. No AI —
  // facts are templated, coach notes are shown exactly as written.

  function shortStandard(name) {
    var m = (root.FlagConfig && root.FlagConfig.STANDARD_SHORT_NAMES) || {};
    return m[name] || name || "";
  }

  function getClientTimeline(clientName) {
    if (!root.ClientTimeline || typeof root.ClientTimeline.buildClientTimeline !== "function") {
      return [];
    }
    try {
      return root.ClientTimeline.buildClientTimeline(
        clientName, currentFormResponses, { lookbackWeeks: NOTE_LOOKBACK_WEEKS }
      );
    } catch (err) {
      return [];
    }
  }

  function weekLabelShort(wr) {
    if (wr && wr.weekStart instanceof Date && !isNaN(wr.weekStart.getTime())) {
      return wr.weekStart.toLocaleDateString("en-US", {
        month: "short", day: "numeric", timeZone: "America/New_York"
      });
    }
    return (wr && wr.weekId) ? wr.weekId : "";
  }

  // Plain-language one-liner per pathway.
  function pathwaySummaryLines(pathways) {
    return (pathways || []).map(function (p) {
      var n = p.streakLength || 0;
      if (p.pathway === "P1") {
        return "Had an acute crisis week — multiple standards failed at once.";
      }
      if (p.pathway === "P2") {
        return "Has missed " + shortStandard(p.standard) + " " + n +
               " week" + (n === 1 ? "" : "s") + " in a row.";
      }
      if (p.pathway === "P3") {
        return "Broadly inconsistent " + n + " week" + (n === 1 ? "" : "s") +
               " straight — different things slipping, no clean week.";
      }
      return p.label || p.pathway;
    });
  }

  // Plain-language status of a single week.
  function describeWeekPlain(wr) {
    if (!wr) return "";
    if (wr.status === "missing") return "No submission";
    if (wr.status === "exempt") return "Exempt";
    var failed = wr.failedStandards || [];
    if ((wr.points || 0) === 0 && failed.length === 0) return "Clean week ✓";
    var names = failed.map(shortStandard);
    return "Failed " + names.join(", ") +
           " (" + (wr.points || 0) + " pt" + ((wr.points || 0) === 1 ? "" : "s") + ")";
  }

  // Map HC Action types → plain sentences for the "what's happened" trail.
  var ACTION_PLAIN = {
    "Slack: Notification": "Coach was notified to call out the issue on the next check-in.",
    "Slack: Warning": "Coach was told to ask the client for a direct call.",
    "Slack: Acknowledgment": "Coach was acknowledged for the client's improvement.",
    "Coach Call Outcome: Resolved": "Coach's call resolved the issue.",
    "Coach Call Outcome: Did Not Resolve": "Coach's call happened but did not resolve it.",
    "Coach Call Outcome: Client No Response": "Client did not respond to the coach's call request.",
    "Coach Call Outcome: Client Declined": "Client declined the coach's call.",
    "HC Email: Sent": "You (HC) emailed the client directly.",
    "HC Email: Follow-up": "You sent a follow-up email.",
    "HC Call: Scheduled": "HC call was scheduled.",
    "HC Call: Resolved": "HC call resolved the issue.",
    "HC Call: Did Not Resolve": "HC call happened but did not resolve it.",
    "Black Flag: Triggered": "Black Flag was triggered.",
    "Black Flag: Removed": "Black Flag was removed.",
    "Manual Override: Black Flag Removed": "Black Flag removed by manual override."
  };

  function buildHistoryLines(clientActions) {
    var sorted = (clientActions || [])
      .filter(function (a) { return a && a.timestamp; })
      .slice()
      .sort(function (a, b) { return a.timestamp.getTime() - b.timestamp.getTime(); });
    var seen = {};
    var lines = [];
    sorted.forEach(function (a) {
      var dateStr = a.timestamp.toLocaleDateString("en-US", {
        month: "short", day: "numeric", timeZone: "America/New_York"
      });
      // Dedupe the lockstep fan-out: one click logs the same action+date
      // against several pathways; show it to the HC only once.
      var key = dateStr + "|" + a.actionType;
      if (seen[key]) return;
      seen[key] = true;
      lines.push(dateStr + " — " + (ACTION_PLAIN[a.actionType] || a.actionType));
    });
    return lines;
  }

  function buildBriefHtml(directRow) {
    var html = "";
    html += '<div class="brief-meta">' + esc(directRow.client) +
            ' &middot; Coach: ' + esc(directRow.coach || "Unassigned") + '</div>';

    // Section 1 — what's going wrong
    html += '<div class="brief-section"><h3>What’s going wrong</h3>';
    var sum = pathwaySummaryLines(directRow.pathways);
    if (sum.length) {
      sum.forEach(function (l) { html += '<div class="brief-line">• ' + esc(l) + '</div>'; });
    } else {
      html += '<div class="brief-empty">No active pathways.</div>';
    }
    var timeline = getClientTimeline(directRow.client);
    var recent = timeline.slice(-6).reverse(); // last 6 weeks, newest first
    if (recent.length) {
      html += '<div class="brief-weeks">';
      recent.forEach(function (wr) {
        html += '<div class="brief-week-line">' + esc(weekLabelShort(wr)) + ': ' +
                esc(describeWeekPlain(wr)) + '</div>';
      });
      html += '</div>';
    }
    html += '</div>';

    // Section 2 — what's happened so far
    html += '<div class="brief-section"><h3>What’s happened so far</h3>';
    var hist = buildHistoryLines(directRow.clientActions);
    if (hist.length) {
      hist.forEach(function (l) { html += '<div class="brief-line">• ' + esc(l) + '</div>'; });
    } else {
      html += '<div class="brief-empty">No HC actions logged yet — this is the first touch.</div>';
    }
    html += '</div>';

    // Section 3 — coach notes (verbatim)
    html += '<div class="brief-section"><h3>Coach notes (exact)</h3>';
    var notes = getRecentNotes(directRow.client, 5);
    if (notes.length) {
      notes.forEach(function (n) {
        html += '<div class="brief-note"><span class="brief-note-week">' +
                esc(formatNoteWeek(n)) + '</span><div class="brief-note-text">' +
                esc(n.notes) + '</div></div>';
      });
    } else {
      html += '<div class="brief-empty">No coach notes recorded.</div>';
    }
    html += '</div>';

    return html;
  }

  function openBriefModal(directRow) {
    var body = document.getElementById("brief-modal-body");
    if (!body) return;
    body.innerHTML = buildBriefHtml(directRow);
    document.getElementById("brief-modal-backdrop").classList.remove("hidden");
  }

  function closeBriefModal() {
    var bd = document.getElementById("brief-modal-backdrop");
    if (bd) bd.classList.add("hidden");
  }

  function wireBriefModal() {
    var close = document.getElementById("brief-modal-close");
    if (close) close.addEventListener("click", closeBriefModal);
    var bd = document.getElementById("brief-modal-backdrop");
    if (bd) {
      bd.addEventListener("click", function (e) {
        if (e.target.id === "brief-modal-backdrop") closeBriefModal();
      });
    }
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") closeBriefModal();
    });
  }

  function wireBriefButtons(queue) {
    document.querySelectorAll(".js-brief-btn").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var row = btn.closest(".action-row");
        var idx = parseInt(row.getAttribute("data-direct-idx"), 10);
        var directRow = queue.directActions[idx];
        if (directRow) openBriefModal(directRow);
      });
    });
  }

  // ---------- Park / Unpark (manual grace override) ----------
  //
  // The HC's fallback for the auto-grace: park a client (suppress the email
  // prompt) until a chosen date, with a note. Logged as an inert "HC: Park"
  // action the engine ignores. "Reactivate" logs "HC: Unpark".
  var parkModalState = { client: null, coach: null, pathway: null };

  function openParkModal(directRow) {
    parkModalState.client = directRow.client;
    parkModalState.coach = directRow.coach;
    parkModalState.pathway = directRow.pathway || "Post-Red";
    document.getElementById("park-modal-meta").textContent =
      directRow.client + (directRow.coach ? " · " + directRow.coach : "");
    document.getElementById("park-modal-date").value = "";
    document.getElementById("park-modal-note").value = "";
    document.getElementById("park-modal-backdrop").classList.remove("hidden");
    document.getElementById("park-modal-date").focus();
  }

  function closeParkModal() {
    document.getElementById("park-modal-backdrop").classList.add("hidden");
  }

  function logParkAction(actionType, untilISO, note, onOk, onErr) {
    var payload = {
      client: parkModalState.client,
      coach: parkModalState.coach,
      pathway: parkModalState.pathway,
      standard: null,
      actionType: actionType,
      notes: note || null,
      outcome: null,
      followUpDueDate: untilISO || null,
      actionWeek: currentActionWeek
    };
    root.ActionsWriter.logAction(payload).then(onOk).catch(onErr);
  }

  function wireParkModal() {
    var close = document.getElementById("park-modal-close");
    if (close) close.addEventListener("click", closeParkModal);
    var bd = document.getElementById("park-modal-backdrop");
    if (bd) {
      bd.addEventListener("click", function (e) {
        if (e.target.id === "park-modal-backdrop") closeParkModal();
      });
    }
    var save = document.getElementById("park-modal-save");
    if (save) {
      save.addEventListener("click", function () {
        var dateVal = document.getElementById("park-modal-date").value; // "YYYY-MM-DD"
        if (!dateVal) { toast("Pick a date to park until.", "error"); return; }
        var note = document.getElementById("park-modal-note").value || "";
        // Local noon avoids a UTC off-by-one on the date.
        var untilISO = new Date(dateVal + "T12:00:00").toISOString();
        save.disabled = true;
        save.textContent = "Parking…";
        logParkAction("HC: Park", untilISO, note,
          function () {
            toast("Parked: " + parkModalState.client, "success");
            save.disabled = false; save.textContent = "Park";
            closeParkModal();
            if (typeof currentOnActionLogged === "function") currentOnActionLogged();
          },
          function (err) {
            save.disabled = false; save.textContent = "Park";
            toast("Failed to park: " + err.message, "error");
          });
      });
    }
  }

  function wireParkButtons(queue) {
    document.querySelectorAll(".js-park-btn").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var row = btn.closest(".action-row");
        var idx = parseInt(row.getAttribute("data-direct-idx"), 10);
        var dr = queue.directActions[idx];
        if (dr) openParkModal(dr);
      });
    });
    document.querySelectorAll(".js-unpark-btn").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var row = btn.closest(".action-row");
        var idx = parseInt(row.getAttribute("data-direct-idx"), 10);
        var dr = queue.directActions[idx];
        if (!dr) return;
        parkModalState.client = dr.client;
        parkModalState.coach = dr.coach;
        parkModalState.pathway = dr.pathway || "Post-Red";
        btn.disabled = true;
        btn.textContent = "…";
        logParkAction("HC: Unpark", null, null,
          function () {
            toast("Reactivated: " + dr.client, "success");
            if (typeof currentOnActionLogged === "function") currentOnActionLogged();
          },
          function (err) {
            btn.disabled = false; btn.textContent = "Reactivate";
            toast("Failed: " + err.message, "error");
          });
      });
    });
  }

  // ---------- Modal ----------
  var modalState = {
    open: false,
    payload: null,        // the action payload to send on "Mark sent"
    onSent: null,         // callback to disable the originating button
    notes: [],            // recent coach notes for the current client
    notesExpanded: false  // whether the note column shows all (up to 3)
  };

  function openSlackModal(payload, slackText, metaLine, onSent, alreadyLogged, notes) {
    modalState.open = true;
    modalState.payload = payload;
    modalState.onSent = onSent;
    modalState.notes = notes || [];
    modalState.notesExpanded = false;
    renderNoteColumn();

    document.getElementById("modal-meta").textContent = metaLine;
    var ta = document.getElementById("modal-textarea");
    ta.value = slackText;
    document.getElementById("modal-copy-label").textContent = "Copy";
    var markBtn = document.getElementById("modal-mark-sent");
    if (alreadyLogged) {
      markBtn.disabled = true;
      markBtn.textContent = "Logged ✓";
    } else {
      markBtn.disabled = false;
      markBtn.textContent = "Mark sent →";
    }

    document.getElementById("slack-modal-backdrop").classList.remove("hidden");
    ta.focus();
    ta.select();
  }

  function closeModal() {
    document.getElementById("slack-modal-backdrop").classList.add("hidden");
    modalState.open = false;
    modalState.payload = null;
    modalState.onSent = null;
    modalState.notes = [];
    modalState.notesExpanded = false;
  }

  function wireModal() {
    document.getElementById("modal-close").addEventListener("click", closeModal);
    document.getElementById("slack-modal-backdrop").addEventListener("click", function (e) {
      if (e.target.id === "slack-modal-backdrop") closeModal();
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && modalState.open) closeModal();
    });

    var noteToggle = document.getElementById("modal-note-toggle");
    if (noteToggle) {
      noteToggle.addEventListener("click", function () {
        modalState.notesExpanded = !modalState.notesExpanded;
        renderNoteColumn();
      });
    }

    document.getElementById("modal-copy").addEventListener("click", function () {
      var ta = document.getElementById("modal-textarea");
      ta.select();
      var ok = false;
      try {
        // Modern API
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(ta.value);
          ok = true;
        } else {
          ok = document.execCommand("copy");
        }
      } catch (err) {
        ok = false;
      }
      document.getElementById("modal-copy-label").textContent = ok ? "Copied ✓" : "Copy failed";
      setTimeout(function () {
        document.getElementById("modal-copy-label").textContent = "Copy";
      }, 1800);
    });

    document.getElementById("modal-mark-sent").addEventListener("click", function () {
      if (!modalState.payload) return;
      var btn = document.getElementById("modal-mark-sent");
      btn.disabled = true;
      btn.textContent = "Logging…";
      // Capture notes from textarea (HC may have edited).
      var finalText = document.getElementById("modal-textarea").value;
      var payload = Object.assign({}, modalState.payload, { notes: finalText });
      var onSent = modalState.onSent;

      root.ActionsWriter.logAction(payload)
        .then(function (res) {
          toast("Logged: " + payload.actionType, "success");
          if (typeof onSent === "function") onSent(res);
          closeModal();
        })
        .catch(function (err) {
          btn.disabled = false;
          btn.textContent = "Mark sent →";
          toast("Failed to log: " + err.message, "error");
        });
    });
  }

  // ---------- Render ----------
  function render(queue, ctx) {
    var root_ = document.getElementById("queue-content");
    if (!root_) return;
    root_.innerHTML = "";
    ctx = ctx || {};

    // Cache raw form responses so the Slack modal can surface coach notes.
    if (ctx.formResponses) currentFormResponses = ctx.formResponses;
    currentActionWeek = queue.currentWeek;
    if (ctx.onActionLogged) currentOnActionLogged = ctx.onActionLogged;

    var weekLabel = weekRangeLabel(queue.queueWeekStart, queue.queueWeekEnd);

    // Header + summary
    var totalDirect = queue.directActions.length;
    var totalCompleted = queue.completed.length;

    var html = "";
    html += '<div class="queue-header">';
    html += '<div>';
    html += '<h1>THURSDAY ACTION QUEUE</h1>';
    html += '<div class="week-label">' + esc(queue.queueWeek) + ' &middot; ' + esc(weekLabel) + '</div>';
    html += '</div>';
    html += '</div>';

    html += '<div class="queue-summary">';
    html += statBox(queue.totalCoachActions, "Coach actions across " + queue.totalCoaches + " coach" + (queue.totalCoaches === 1 ? "" : "es"));
    html += statBox(totalDirect, "Direct client actions");
    html += statBox(totalCompleted, "Completed this week");
    html += '</div>';

    // Section 1: Coaches
    html += '<section class="queue-section" data-section="coaches">';
    html += '<header class="queue-section-header">';
    html += '<h2 class="queue-section-title">Coaches</h2>';
    html += '<span class="queue-section-count">' + queue.totalCoachActions + ' action' + (queue.totalCoachActions === 1 ? "" : "s") + ' &middot; ' + queue.totalCoaches + ' coach' + (queue.totalCoaches === 1 ? "" : "es") + '</span>';
    html += '</header>';
    html += '<div class="queue-section-body">';
    if (queue.coachGroups.length === 0) {
      html += '<div class="section-empty">No coach-facing actions due. Nice.</div>';
    } else {
      queue.coachGroups.forEach(function (group, idx) {
        html += renderCoachGroup(group, idx);
      });
    }
    html += '</div></section>';

    // Section 2: Direct Client Actions
    html += '<section class="queue-section" data-section="direct">';
    html += '<header class="queue-section-header">';
    html += '<h2 class="queue-section-title">Direct Client Actions</h2>';
    html += '<span class="queue-section-count">' + totalDirect + ' action' + (totalDirect === 1 ? "" : "s") + '</span>';
    html += '</header>';
    html += '<div class="queue-section-body">';
    if (totalDirect === 0) {
      html += '<div class="section-empty">No open Post-Red cases.</div>';
    } else {
      queue.directActions.forEach(function (row, i) {
        html += renderDirectRow(row, i);
      });
    }
    html += '</div></section>';

    // Section 3: Completed This Week (collapsible, collapsed by default)
    html += '<section class="queue-section is-collapsible is-collapsed" data-section="completed">';
    html += '<header class="queue-section-header">';
    html += '<h2 class="queue-section-title">Completed This Week</h2>';
    html += '<span class="queue-section-count">' + totalCompleted + ' action' + (totalCompleted === 1 ? "" : "s") + '</span>';
    html += '</header>';
    html += '<div class="queue-section-body">';
    if (totalCompleted === 0) {
      html += '<div class="completed-empty">No actions logged yet this week.</div>';
    } else {
      queue.completed.forEach(function (a) {
        html += renderCompletedRow(a);
      });
    }
    html += '</div></section>';

    root_.innerHTML = html;
    wireCoachGroups();
    wireCompletedToggle();
    wireSlackButtons(queue);
    wireDirectButtons(queue, ctx);
    wireBriefButtons(queue);
    wireParkButtons(queue);
  }

  function statBox(value, label) {
    return '<div class="summary-stat">' +
      '<div class="stat-value">' + esc(String(value)) + '</div>' +
      '<div class="stat-label">' + esc(label) + '</div>' +
      '</div>';
  }

  function renderCoachGroup(group, idx) {
    var html = '<div class="coach-group" data-coach-idx="' + idx + '">';
    html += '<header class="coach-group-header">';
    html += '<span><span class="caret">▼</span><span class="coach-name">' + esc(group.coach) + '</span><span class="coach-count">(' + group.count + ' action' + (group.count === 1 ? "" : "s") + ')</span></span>';
    html += '</header>';
    html += '<div class="coach-actions-list">';
    group.actions.forEach(function (a, i) {
      html += renderCoachAction(a, idx, i);
    });
    html += '</div></div>';
    return html;
  }

  function renderCoachAction(a, groupIdx, rowIdx) {
    // a is now a ConsolidatedClientAction:
    //   { client, coach, level: "Warning"|"Notification", actionType,
    //     warnings: [], notifications: [], pathwayLabel,
    //     warningsDetail: [], notificationsDetail: [] }
    var sevClass = a.level === "Warning" ? "sev-yellow" : "sev-yellow";
    // Warnings get a darker yellow visually; we still use sev-yellow class
    // but add a modifier so styling can differentiate.
    var levelClass = a.level === "Warning" ? "warning" : "notification";
    var typeLabel = a.actionType;

    // Build a detailed second line that shows the consolidated pathways.
    // Example: "P2 Nutrition Week 3 + P3 Week 4 (+1 heads-up)"
    var detailParts = (a.warningsDetail || []).concat(a.notificationsDetail || []);
    var detailLine = detailParts.length > 0 ? detailParts.join(" · ") : a.pathwayLabel;

    var html = '<div class="action-row ' + sevClass + '" ' +
               'data-coach-idx="' + groupIdx + '" data-row-idx="' + rowIdx + '">';
    html += '<div class="severity-bar"></div>';
    html += '<div class="action-meta">';
    html += '<div class="action-client">' + esc(a.client) + '</div>';
    html += '<div class="action-detail">';
    html += '<span class="pathway-tag">' + esc(a.pathwayLabel) + '</span>';
    html += '<span class="action-type-tag ' + levelClass + '">' + esc(typeLabel) + '</span>';
    if (detailParts.length > 1) {
      html += '<div style="margin-top:4px; font-size:11px; color:var(--text-faint);">' + esc(detailLine) + '</div>';
    }
    html += '</div></div>';
    html += '<div class="action-buttons">';
    html += '<button class="action-btn action-btn-primary js-generate-slack" type="button">Generate Slack</button>';
    if (a.alreadyLogged) {
      html += '<button class="action-btn js-mark-sent-direct" type="button" disabled>Logged ✓</button>';
    } else {
      html += '<button class="action-btn js-mark-sent-direct" type="button">Mark sent</button>';
    }
    html += '</div></div>';
    return html;
  }

  function renderDirectRow(row, idx) {
    var parked = !!(row.park && row.park.parked);

    // Determine severity tone for the bar.
    var sevClass = "sev-yellow";
    if (row.latestActionType === "HC Call: Did Not Resolve") sevClass = "sev-red";

    var html = '<div class="action-row ' + sevClass + (parked ? " is-parked" : "") +
               '" data-direct-idx="' + idx + '">';
    html += '<div class="severity-bar"></div>';
    html += '<div class="action-meta">';
    html += '<div class="action-client">' + esc(row.client) + '</div>';
    html += '<div class="action-detail">';
    html += '<span class="pathway-tag">' + esc(row.pathwayLabel) + '</span>';
    if (parked) {
      // Visible-but-parked: show the reason, suppress the email prompt.
      html += '<span class="action-type-tag parked-tag">⏸ Parked</span>';
      if (row.park.note) {
        html += '<span style="color:var(--text-muted); margin-left:8px; font-size:11px;">' +
                esc(row.park.note) + '</span>';
      }
    } else {
      html += '<span class="action-type-tag">' + esc(row.contextLine) + '</span>';
    }
    html += '<span style="color:var(--text-faint); margin-left:8px; font-size:11px;">' + esc(row.coach) + '</span>';
    html += '</div></div>';
    html += '<div class="action-buttons">';
    // "Situation" opens the deterministic brief. Not a .js-direct-btn, so it
    // stays clickable even after the chain buttons are disabled/logged.
    html += '<button class="action-btn js-brief-btn" type="button">Situation</button>';
    // While parked (coach call in its grace window), suppress the chain
    // buttons — the email prompt returns automatically when grace ends.
    if (parked) {
      html += '<button class="action-btn js-unpark-btn" type="button">Reactivate</button>';
    } else {
      row.buttons.forEach(function (b, bi) {
        var cls = b.primary ? "action-btn action-btn-primary" : "action-btn";
        html += '<button class="' + cls + ' js-direct-btn" data-btn-idx="' + bi + '" type="button">' + esc(b.label) + '</button>';
      });
      html += '<button class="action-btn js-park-btn" type="button">Park</button>';
    }
    html += '</div></div>';
    return html;
  }

  function renderCompletedRow(a) {
    var when = a.timestamp ? a.timestamp.toLocaleString("en-US", {
      weekday: "short", hour: "numeric", minute: "2-digit"
    }) : "";
    var path = a.pathway ? (a.pathway + (a.standard ? " " + a.standard : "")) : "";
    return '<div class="completed-row">' +
      '<div><span class="completed-client">' + esc(a.client) + '</span>' +
      (path ? ' <span style="color:var(--text-faint); font-size:11px; margin-left:6px;">' + esc(path) + '</span>' : '') +
      '</div>' +
      '<div class="completed-type">' + esc(a.actionType) + '</div>' +
      '<div class="completed-time">' + esc(when) + '</div>' +
      '</div>';
  }

  // ---------- Wiring ----------
  function wireCoachGroups() {
    document.querySelectorAll(".coach-group-header").forEach(function (h) {
      h.addEventListener("click", function () {
        h.parentElement.classList.toggle("is-collapsed");
      });
    });
  }

  function wireCompletedToggle() {
    document.querySelectorAll(".queue-section.is-collapsible .queue-section-header").forEach(function (h) {
      h.addEventListener("click", function () {
        h.parentElement.classList.toggle("is-collapsed");
      });
    });
  }

  function wireSlackButtons(queue) {
    document.querySelectorAll(".js-generate-slack").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var row = btn.closest(".action-row");
        var gIdx = parseInt(row.getAttribute("data-coach-idx"), 10);
        var rIdx = parseInt(row.getAttribute("data-row-idx"), 10);
        var action = queue.coachGroups[gIdx].actions[rIdx];

        var msg;
        try {
          // v2 API: pass the consolidated action directly. Slack templates
          // dispatches single vs multi-pathway internally.
          msg = root.SlackTemplates.buildSlackMessage(action);
        } catch (err) {
          toast("Cannot build Slack message: " + err.message, "error");
          return;
        }
        var meta = action.coach + " · " + action.pathwayLabel + " · " + action.actionType;
        document.getElementById("modal-meta").textContent = meta;

        // Logging payload uses a representative pathway from the action.
        // For multi-pathway actions, we store the level ("Warning" or
        // "Notification") on the actionType column and put the full client
        // context in notes. Pathway column gets the primary pathway
        // (first warning if any, else first notification).
        var primary = (action.warnings[0] || action.notifications[0]);
        var payload = {
          client: action.client,
          coach: action.coach,
          pathway: primary ? primary.pathway : "N/A",
          standard: primary ? (primary.standard || null) : null,
          actionType: action.actionType,
          notes: msg.text,
          outcome: null,
          followUpDueDate: null,
          actionWeek: queue.currentWeek
        };

        var notes = getRecentNotes(action.client, 3);

        openSlackModal(payload, msg.text, meta, function () {
          row.querySelectorAll(".action-btn").forEach(function (b) {
            b.disabled = true;
          });
          row.querySelector(".js-mark-sent-direct").textContent = "Logged ✓";
        }, action.alreadyLogged === true, notes);
      });
    });

    // "Mark sent" without opening the modal.
    document.querySelectorAll(".js-mark-sent-direct").forEach(function (btn) {
      btn.addEventListener("click", function () {
        if (btn.disabled) return;
        var row = btn.closest(".action-row");
        var gIdx = parseInt(row.getAttribute("data-coach-idx"), 10);
        var rIdx = parseInt(row.getAttribute("data-row-idx"), 10);
        var action = queue.coachGroups[gIdx].actions[rIdx];
        var primary = (action.warnings[0] || action.notifications[0]);
        var payload = {
          client: action.client,
          coach: action.coach,
          pathway: primary ? primary.pathway : "N/A",
          standard: primary ? (primary.standard || null) : null,
          actionType: action.actionType,
          notes: null,
          outcome: null,
          followUpDueDate: null,
          actionWeek: queue.currentWeek
        };
        btn.disabled = true;
        btn.textContent = "Logging…";
        root.ActionsWriter.logAction(payload)
          .then(function () {
            toast("Logged: " + payload.actionType, "success");
            row.querySelectorAll(".action-btn").forEach(function (b) {
              b.disabled = true;
            });
            btn.textContent = "Logged ✓";
          })
          .catch(function (err) {
            btn.disabled = false;
            btn.textContent = "Mark sent";
            toast("Failed to log: " + err.message, "error");
          });
      });
    });
  }

  function wireDirectButtons(queue, ctx) {
    document.querySelectorAll(".js-direct-btn").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var row = btn.closest(".action-row");
        var idx = parseInt(row.getAttribute("data-direct-idx"), 10);
        var bIdx = parseInt(btn.getAttribute("data-btn-idx"), 10);
        var directRow = queue.directActions[idx];
        var btnSpec = directRow.buttons[bIdx];

        // Build payload. For HC Email: Sent we add a follow-up due date
        // 3 days out per the standards' 3-day rule.
        var followUpDate = null;
        if (btnSpec.actionType === "HC Email: Sent") {
          var d = new Date();
          d.setDate(d.getDate() + 3);
          followUpDate = d.toISOString();
        }

        // Lockstep fan-out: log this action against EVERY Post-Red pathway for
        // the client, so the engine (which tracks Post-Red per pathway) moves
        // them all together. One HC click = one real-world action covering the
        // whole client. This writes the exact same per-pathway rows the HC
        // would have logged one by one before consolidation.
        var pathways = (directRow.pathways && directRow.pathways.length)
          ? directRow.pathways
          : [{ pathway: directRow.pathway || "Post-Red", standard: directRow.standard || null }];

        var payloads = pathways.map(function (p) {
          return {
            client: directRow.client,
            coach: directRow.coach,
            pathway: p.pathway,
            standard: p.standard || null,
            actionType: btnSpec.actionType,
            notes: null,
            outcome: null,
            followUpDueDate: followUpDate,
            actionWeek: queue.currentWeek
          };
        });

        var originalLabel = btn.textContent;
        btn.textContent = "Logging…";
        // Disable only the chain buttons (not "Situation") so HC doesn't
        // double-log but can still re-open the brief.
        row.querySelectorAll(".js-direct-btn").forEach(function (b) { b.disabled = true; });

        Promise.all(payloads.map(function (p) { return root.ActionsWriter.logAction(p); }))
          .then(function () {
            toast("Logged: " + btnSpec.actionType +
              " (" + payloads.length + " pathway" + (payloads.length === 1 ? "" : "s") + ")", "success");
            btn.textContent = "Logged ✓";
          })
          .catch(function (err) {
            row.querySelectorAll(".js-direct-btn").forEach(function (b) { b.disabled = false; });
            btn.textContent = originalLabel;
            toast("Failed to log: " + err.message, "error");
          });
      });
    });
  }

  // ---------- Init ----------
  function init() {
    wireModal();
    wireBriefModal();
    wireParkModal();
  }

  root.Tab1 = {
    render: render,
    init: init
  };
})(typeof window !== "undefined" ? window : this);
