/**
 * Flag System Dashboard — Top-level orchestrator
 *
 * Wires the tab nav, the Refresh button, and the full data-load pipeline
 * (SheetsReader -> StateBuilder -> QueueBuilder -> Tab1.render +
 *  Tab2/3/4.render).
 */
(function () {
  "use strict";

  var state = {
    lastRefresh: null,
    // Cache of the latest loaded payload + derived states so Tab 2/3/4
    // can reference them without re-fetching, and so PathwayDetail can
    // open from a hash on first load.
    lastData: null,
    lastStates: null,
    lastQueue: null
  };

  // ---------- Tab nav ----------
  function wireTabs() {
    var tabs = document.querySelectorAll(".tab-btn");
    var panels = document.querySelectorAll(".tab-panel");
    tabs.forEach(function (tab) {
      tab.addEventListener("click", function () {
        var name = tab.getAttribute("data-tab");
        tabs.forEach(function (t) { t.classList.toggle("is-active", t === tab); });
        panels.forEach(function (p) {
          p.classList.toggle("is-active", p.id === "panel-" + name);
        });
      });
    });
  }

  // ---------- Refresh ----------
  function setRefreshMeta(text) {
    var el = document.getElementById("refresh-meta");
    if (el) el.textContent = text;
  }

  function showLoading() {
    document.getElementById("queue-loading").classList.remove("hidden");
    document.getElementById("queue-error").classList.add("hidden");
    document.getElementById("queue-content").classList.add("hidden");
  }

  function showContent() {
    document.getElementById("queue-loading").classList.add("hidden");
    document.getElementById("queue-error").classList.add("hidden");
    document.getElementById("queue-content").classList.remove("hidden");
  }

  function showError(msg) {
    document.getElementById("queue-loading").classList.add("hidden");
    document.getElementById("queue-content").classList.add("hidden");
    document.getElementById("queue-error").classList.remove("hidden");
    document.getElementById("queue-error-message").textContent = msg;
  }

  function formatRefreshTime(d) {
    return "Last refresh: " + d.toLocaleString("en-US", {
      weekday: "short",
      hour: "numeric",
      minute: "2-digit"
    });
  }

  function refresh() {
    var refreshBtn = document.getElementById("refresh-btn");
    refreshBtn.disabled = true;
    setRefreshMeta("Refreshing…");
    showLoading();

    window.SheetsReader.loadAll()
      .then(function (data) {
        var states = window.StateBuilder.buildAll(data);
        var queue = window.QueueBuilder.build(states, data.hcActions, {
          formResponses: data.formResponses
        });

        // Cache for cross-tab use and deep linking.
        state.lastData = data;
        state.lastStates = states;
        state.lastQueue = queue;

        // Tab 1 (existing). Pass formResponses so the Slack modal can show
        // the client's most-recent coach note(s) alongside the message.
        window.Tab1.render(queue, { formResponses: data.formResponses });

        // Tabs 2/3/4 (v1.1). Shared context.
        var sharedCtx = {
          formResponses: data.formResponses,
          currentWeek: queue.currentWeek,
          onActionLogged: refresh
        };
        if (window.Tab2 && typeof window.Tab2.render === "function") {
          window.Tab2.render(states, data.hcActions, sharedCtx);
        }
        if (window.Tab3 && typeof window.Tab3.render === "function") {
          window.Tab3.render(states, data.hcActions, sharedCtx);
        }
        if (window.Tab4 && typeof window.Tab4.render === "function") {
          window.Tab4.render(states, data.hcActions, sharedCtx);
        }

        state.lastRefresh = new Date();
        setRefreshMeta(formatRefreshTime(state.lastRefresh));
        showContent();
      })
      .catch(function (err) {
        console.error("Refresh failed:", err);
        showError(err && err.message ? err.message : String(err));
        setRefreshMeta("Refresh failed");
      })
      .then(function () {
        refreshBtn.disabled = false;
      });
  }

  // ---------- Deep linking ----------
  // After the very first successful load, check the URL hash and open
  // PathwayDetail if it points to a client. Runs once.
  var hashChecked = false;
  function checkHashOnce() {
    if (hashChecked) return;
    if (!state.lastStates || !state.lastData || !state.lastQueue) return;
    if (!window.PathwayDetail || typeof window.PathwayDetail.checkHashOnLoad !== "function") return;
    hashChecked = true;
    window.PathwayDetail.checkHashOnLoad({
      states: state.lastStates,
      hcActions: state.lastData.hcActions,
      formResponses: state.lastData.formResponses,
      currentWeek: state.lastQueue.currentWeek,
      onActionLogged: refresh
    });
  }

  // ---------- Init ----------
  function init() {
    wireTabs();
    window.Tab1.init();

    // Init the shared Pathway Detail modal once.
    if (window.PathwayDetail && typeof window.PathwayDetail.init === "function") {
      window.PathwayDetail.init();
    }

    document.getElementById("refresh-btn").addEventListener("click", refresh);

    // First load. Attach a one-time post-load hook to check the hash.
    refresh();
    // Poll briefly for the first successful load to fire the hash check.
    // (Refresh is async and we don't want to add a callback parameter just
    // for this; a small polling loop is simpler and safe.)
    var attempts = 0;
    var hashTimer = setInterval(function () {
      attempts++;
      if (state.lastStates && state.lastData && state.lastQueue) {
        checkHashOnce();
        clearInterval(hashTimer);
      } else if (attempts > 50) {
        // Give up after ~10s. Either the load failed or it's still going;
        // the user can still open clients via the tabs.
        clearInterval(hashTimer);
      }
    }, 200);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
