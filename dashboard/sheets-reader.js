/**
 * Flag System Dashboard — Sheets Reader
 *
 * Fetches the 3 sheets in parallel and parses them into the shapes
 * the engine and queue-builder expect.
 *
 * Output:
 *   {
 *     roster: [{ client, coach }],
 *     formResponses: [Array],    // raw rows; engine consumes as arrays
 *     hcActions: [{ timestamp, actionWeek, client, coach, pathway,
 *                    standard, actionType, notes, outcome,
 *                    followUpDueDate, actionId }]
 *   }
 */
(function (root) {
  "use strict";

  var cfg = root.FlagConfig;
  if (!cfg) {
    throw new Error("sheets-reader.js: FlagConfig not loaded");
  }

  var API_BASE = "https://sheets.googleapis.com/v4/spreadsheets";

  function buildUrl(sheetId, range) {
    return API_BASE + "/" + sheetId + "/values/" + encodeURIComponent(range) +
      "?key=" + encodeURIComponent(cfg.SHEETS_API_KEY) +
      "&valueRenderOption=UNFORMATTED_VALUE" +
      "&dateTimeRenderOption=FORMATTED_STRING";
  }

  function fetchRange(sheetId, range) {
    var url = buildUrl(sheetId, range);
    return fetch(url, { method: "GET" })
      .then(function (res) {
        if (!res.ok) {
          return res.text().then(function (body) {
            throw new Error(
              "Sheets API " + res.status + " for " + range + ": " + body.slice(0, 200)
            );
          });
        }
        return res.json();
      })
      .then(function (data) {
        return Array.isArray(data.values) ? data.values : [];
      });
  }

  // ---------- Roster ----------
  // Active = present in the Roster tab. Column A = client name, F = coach.
  function parseRoster(rows) {
    var out = [];
    var seen = Object.create(null);
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i] || [];
      var first = (r[0] || "").toString().trim();
      var last  = (r[1] || "").toString().trim();
      var coach = (r[5] || "").toString().trim();
      var client = (first + " " + last).trim();
      if (!client) continue;
      var key = client.toLowerCase();
      if (seen[key]) continue;
      seen[key] = true;
      out.push({ client: client, coach: coach || "Unassigned" });
    }
    return out;
  }
  // ---------- Form Responses ----------
  // Engine accepts raw arrays in normalizeSubmission. We pass them through
  // unchanged, with only a basic shape guarantee (8 columns).
  function parseFormResponses(rows) {
    var out = [];
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i] || [];
      // Pad to 9 columns so indexing is reliable. Cols A–H (0–7) are consumed
      // by the engine (normalizeSubmission); col I (8) = call scheduled date,
      // read only by the dashboard's Post-Red grace logic.
      while (r.length < 9) r.push("");
      // Drop rows without a timestamp + client.
      if (!r[0] || !r[1]) continue;
      out.push(r);
    }
    return out;
  }

  // ---------- HC Actions ----------
  function parseHcActions(rows) {
    var out = [];
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i] || [];
      while (r.length < 11) r.push("");
      var actionType = (r[6] || "").toString().trim();
      if (!actionType) continue; // skip blank rows
      out.push({
        timestamp:        r[0] ? new Date(r[0]) : null,
        actionWeek:       (r[1] || "").toString().trim() || null,
        client:           (r[2] || "").toString().trim(),
        coach:            (r[3] || "").toString().trim(),
        pathway:          (r[4] || "").toString().trim() || null,
        standard:         (r[5] || "").toString().trim() || null,
        actionType:       actionType,
        notes:            (r[7] || "").toString(),
        outcome:          (r[8] || "").toString().trim() || null,
        followUpDueDate:  r[9] ? new Date(r[9]) : null,
        actionId:         (r[10] || "").toString().trim() || null
      });
    }
    return out;
  }

  function loadAll() {
    return Promise.all([
      fetchRange(cfg.ROSTER.sheetId, cfg.ROSTER.range),
      fetchRange(cfg.FORM_RESPONSES.sheetId, cfg.FORM_RESPONSES.range),
      fetchRange(cfg.HC_ACTIONS.sheetId, cfg.HC_ACTIONS.range)
    ]).then(function (results) {
      return {
        roster:        parseRoster(results[0]),
        formResponses: parseFormResponses(results[1]),
        hcActions:     parseHcActions(results[2])
      };
    });
  }

  root.SheetsReader = {
    loadAll: loadAll,
    _internal: {
      parseRoster: parseRoster,
      parseFormResponses: parseFormResponses,
      parseHcActions: parseHcActions
    }
  };
})(typeof window !== "undefined" ? window : this);
