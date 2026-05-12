/**
 * Flag System Dashboard — Actions Writer
 *
 * Wraps fetch() calls to the Apps Script Web App that appends rows to
 * the HC Actions sheet.
 *
 * Why text/plain Content-Type:
 *   Apps Script Web Apps don't return CORS headers on preflight OPTIONS,
 *   so we avoid the preflight entirely by using a simple request (no
 *   custom headers, body sent as text). The Apps Script reads
 *   e.postData.contents and JSON.parse()s it.
 *
 * Payload shape (subset of TDD §3.3 schema; server fills the rest):
 *   {
 *     client:           string (required),
 *     coach:            string (required),
 *     pathway:          "P1" | "P2" | "P3" | "Post-Red" | "N/A",
 *     standard:         string | null,   (P2 only)
 *     actionType:       string (required, validated against §3.4 list),
 *     notes:            string | null,
 *     outcome:          string | null,
 *     followUpDueDate:  ISO date string | null,
 *     actionWeek:       "YYYY-Www" | null   (server fills if null)
 *   }
 *
 * Server returns:
 *   { ok: true, actionId, timestamp, actionWeek }   on success
 *   { ok: false, error: string }                    on validation/server error
 */
(function (root) {
  "use strict";

  var cfg = root.FlagConfig;
  if (!cfg) {
    throw new Error("actions-writer.js: FlagConfig not loaded");
  }

  function logAction(payload) {
    if (!cfg.APPS_SCRIPT_URL || cfg.APPS_SCRIPT_URL === "REPLACE_AFTER_DEPLOY") {
      return Promise.reject(new Error(
        "Apps Script URL not configured. Set FlagConfig.APPS_SCRIPT_URL in dashboard/config.js."
      ));
    }
    // Required fields check
    if (!payload || !payload.client || !payload.coach || !payload.actionType) {
      return Promise.reject(new Error(
        "logAction: client, coach, and actionType are required"
      ));
    }
    return fetch(cfg.APPS_SCRIPT_URL, {
      method: "POST",
      // Simple request: text/plain avoids CORS preflight on Apps Script.
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(payload),
      redirect: "follow"
    })
      .then(function (res) {
        return res.text().then(function (body) {
          var parsed;
          try { parsed = JSON.parse(body); }
          catch (err) {
            throw new Error("Server returned non-JSON: " + body.slice(0, 200));
          }
          if (!parsed.ok) {
            throw new Error(parsed.error || "Unknown server error");
          }
          return parsed;
        });
      });
  }

  root.ActionsWriter = { logAction: logAction };
})(typeof window !== "undefined" ? window : this);
