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

  // ---------- Modal ----------
  var modalState = {
    open: false,
    payload: null,        // the action payload to send on "Mark sent"
    onSent: null          // callback to disable the originating button
  };

  function openSlackModal(payload, slackText, metaLine, onSent, alreadyLogged) {
    modalState.open = true;
    modalState.payload = payload;
    modalState.onSent = onSent;

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
  }

  function wireModal() {
    document.getElementById("modal-close").addEventListener("click", closeModal);
    document.getElementById("slack-modal-backdrop").addEventListener("click", function (e) {
      if (e.target.id === "slack-modal-backdrop") closeModal();
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && modalState.open) closeModal();
    });

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
    // Determine severity tone for the bar.
    var sevClass = "sev-yellow";
    if (row.latestActionType === "HC Call: Did Not Resolve") sevClass = "sev-red";

    var html = '<div class="action-row ' + sevClass + '" data-direct-idx="' + idx + '">';
    html += '<div class="severity-bar"></div>';
    html += '<div class="action-meta">';
    html += '<div class="action-client">' + esc(row.client) + '</div>';
    html += '<div class="action-detail">';
    html += '<span class="pathway-tag">' + esc(row.pathwayLabel) + '</span>';
    html += '<span class="action-type-tag">' + esc(row.contextLine) + '</span>';
    html += '<span style="color:var(--text-faint); margin-left:8px; font-size:11px;">' + esc(row.coach) + '</span>';
    html += '</div></div>';
    html += '<div class="action-buttons">';
    row.buttons.forEach(function (b, bi) {
      var cls = b.primary ? "action-btn action-btn-primary" : "action-btn";
      html += '<button class="' + cls + ' js-direct-btn" data-btn-idx="' + bi + '" type="button">' + esc(b.label) + '</button>';
    });
    html += '</div></div>';
    return html;
  }

  function renderDirectRow(row, idx) {
    // Determine severity tone for the bar.
    var sevClass = "sev-yellow";
    if (row.latestActionType === "HC Call: Did Not Resolve") sevClass = "sev-red";

    var html = '<div class="action-row ' + sevClass + '" data-direct-idx="' + idx + '">';
    html += '<div class="severity-bar"></div>';
    html += '<div class="action-meta">';
    html += '<div class="action-client">' + esc(row.client) + '</div>';
    html += '<div class="action-detail">';
    html += '<span class="pathway-tag">' + esc(row.pathwayLabel) + '</span>';
    html += '<span class="action-type-tag">' + esc(row.contextLine) + '</span>';
    html += '<span style="color:var(--text-faint); margin-left:8px; font-size:11px;">' + esc(row.coach) + '</span>';
    html += '</div></div>';
    html += '<div class="action-buttons">';
    row.buttons.forEach(function (b, bi) {
      var cls = b.primary ? "action-btn action-btn-primary" : "action-btn";
      html += '<button class="' + cls + ' js-direct-btn" data-btn-idx="' + bi + '" type="button">' + esc(b.label) + '</button>';
    });
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

        openSlackModal(payload, msg.text, meta, function () {
          row.querySelectorAll(".action-btn").forEach(function (b) {
            b.disabled = true;
          });
          row.querySelector(".js-mark-sent-direct").textContent = "Logged ✓";
        }, action.alreadyLogged === true);
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
        var payload = {
          client: directRow.client,
          coach: directRow.coach,
          pathway: directRow.pathway,
          standard: directRow.standard,
          actionType: btnSpec.actionType,
          notes: null,
          outcome: null,
          followUpDueDate: followUpDate,
          actionWeek: queue.currentWeek
        };

        var originalLabel = btn.textContent;
        btn.disabled = true;
        btn.textContent = "Logging…";
        // Disable sibling buttons too so HC doesn't double-log.
        row.querySelectorAll(".action-btn").forEach(function (b) { b.disabled = true; });

        root.ActionsWriter.logAction(payload)
          .then(function () {
            toast("Logged: " + btnSpec.actionType, "success");
            btn.textContent = "Logged ✓";
          })
          .catch(function (err) {
            row.querySelectorAll(".action-btn").forEach(function (b) { b.disabled = false; });
            btn.textContent = originalLabel;
            toast("Failed to log: " + err.message, "error");
          });
      });
    });
  }

  // ---------- Init ----------
  function init() {
    wireModal();
  }

  root.Tab1 = {
    render: render,
    init: init
  };
})(typeof window !== "undefined" ? window : this);
