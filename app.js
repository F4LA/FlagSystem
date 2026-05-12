/**
 * Flag System Dashboard — Top-level orchestrator
 *
 * Wires the tab nav, the Refresh button, and the full data-load pipeline
 * (SheetsReader -> StateBuilder -> QueueBuilder -> Tab1.render).
 */
(function () {
  "use strict";

  var state = {
    lastRefresh: null
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
        var queue = window.QueueBuilder.build(states, data.hcActions);
        window.Tab1.render(queue);
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

  // ---------- Init ----------
  function init() {
    wireTabs();
    window.Tab1.init();
    document.getElementById("refresh-btn").addEventListener("click", refresh);
    refresh();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
