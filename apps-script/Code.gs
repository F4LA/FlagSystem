/**
 * Flag System Dashboard — Apps Script Writer
 *
 * Web App that receives JSON POST payloads from the dashboard and
 * appends a validated row to the HC Actions sheet.
 *
 * Deployment:
 *   1. Open https://script.google.com -> New project
 *   2. Replace Code.gs contents with this file
 *   3. File -> Project properties -> Script properties:
 *        none required; SHEET_ID is hardcoded below
 *   4. Deploy -> New deployment -> Type: Web app
 *        - Execute as:  Me (the owner)
 *        - Who has access: Anyone
 *      Copy the /exec URL into dashboard/config.js APPS_SCRIPT_URL.
 *   5. Test by POSTing JSON to /exec. Server returns
 *        { ok: true, actionId, timestamp, actionWeek }
 *
 * Schema written to HC Actions tab (TDD §3.3):
 *   A Timestamp           ISO datetime
 *   B Action Week         "YYYY-Www"
 *   C Client              string
 *   D Coach               string
 *   E Pathway             "P1" | "P2" | "P3" | "Post-Red" | "N/A"
 *   F Standard            string (P2 only) or ""
 *   G Action Type         closed list (validated)
 *   H Notes               string
 *   I Outcome             string
 *   J Follow-up Due Date  ISO datetime or ""
 *   K Action ID           UUID
 */

// ===== Sheet identity =====
var SHEET_ID = "1TmlmzNPi-BtLy1C4sizqJmvLFHAxyH6Glb9mWP3Vv64";
var TAB_NAME = "HC Actions";

// ===== Closed action-type list (TDD §3.4) =====
var VALID_ACTION_TYPES = [
  // Slack to coaches
  "Slack: Notification",
  "Slack: Warning",
  "Slack: Acknowledgment",
  // HC actions with clients (Post-Red Resolution Path)
  "HC Email: Sent",
  "HC Email: Follow-up",
  "HC Call: Scheduled",
  "HC Call: Resolved",
  "HC Call: Did Not Resolve",
  // Outcomes the form does NOT capture
  "Coach Call Outcome: Resolved",
  "Coach Call Outcome: Did Not Resolve",
  "Coach Call Outcome: Client No Response",
  "Coach Call Outcome: Client Declined",
  // Black flag
  "Black Flag: Triggered",
  "Black Flag: Removed",
  // Special cases
  "Manual Override: Pathway Closed",
  "Manual Override: Color Change",
  "Manual Override: Black Flag Removed",
  "Coach Audit Note"
];

var VALID_PATHWAYS = ["P1", "P2", "P3", "Post-Red", "N/A"];

// ===== Helpers =====

function _json(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function _err(msg) {
  return _json({ ok: false, error: msg });
}

function _uuid() {
  return Utilities.getUuid();
}

function _isoWeek(date) {
  // Returns "YYYY-Www" per ISO 8601.
  var d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  var dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  var yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  var weekNum = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  return d.getUTCFullYear() + "-W" + (weekNum < 10 ? "0" + weekNum : weekNum);
}

function _validate(p) {
  if (!p || typeof p !== "object") return "Payload must be a JSON object";
  if (!p.client || typeof p.client !== "string" || !p.client.trim()) {
    return "client is required";
  }
  if (!p.coach || typeof p.coach !== "string" || !p.coach.trim()) {
    return "coach is required";
  }
  if (!p.actionType || typeof p.actionType !== "string") {
    return "actionType is required";
  }
  if (VALID_ACTION_TYPES.indexOf(p.actionType) === -1) {
    return "actionType '" + p.actionType + "' is not in the closed list";
  }
  if (p.pathway && VALID_PATHWAYS.indexOf(p.pathway) === -1) {
    return "pathway '" + p.pathway + "' is invalid";
  }
  if (p.pathway === "P2" && !p.standard) {
    return "standard is required when pathway is P2";
  }
  return null;
}

// ===== Web app entrypoints =====

function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) {
      return _err("No request body");
    }
    var payload;
    try {
      payload = JSON.parse(e.postData.contents);
    } catch (err) {
      return _err("Invalid JSON body");
    }

    var validationError = _validate(payload);
    if (validationError) return _err(validationError);

    var now = new Date();
    var actionWeek = payload.actionWeek && /^\d{4}-W\d{2}$/.test(payload.actionWeek)
      ? payload.actionWeek
      : _isoWeek(now);
    var actionId = _uuid();

    var followUp = "";
    if (payload.followUpDueDate) {
      var d = new Date(payload.followUpDueDate);
      if (!isNaN(d.getTime())) followUp = d;
    }

    var row = [
      now,                                  // A Timestamp
      actionWeek,                           // B Action Week
      String(payload.client).trim(),        // C Client
      String(payload.coach).trim(),         // D Coach
      payload.pathway || "N/A",             // E Pathway
      payload.standard || "",               // F Standard
      payload.actionType,                   // G Action Type
      payload.notes || "",                  // H Notes
      payload.outcome || "",                // I Outcome
      followUp,                             // J Follow-up Due Date
      actionId                              // K Action ID
    ];

    var ss = SpreadsheetApp.openById(SHEET_ID);
    var sheet = ss.getSheetByName(TAB_NAME);
    if (!sheet) return _err("Sheet tab '" + TAB_NAME + "' not found");

    sheet.appendRow(row);

    return _json({
      ok: true,
      actionId: actionId,
      timestamp: now.toISOString(),
      actionWeek: actionWeek
    });
  } catch (err) {
    return _err("Server error: " + (err && err.message ? err.message : String(err)));
  }
}

// Optional: simple GET handler for sanity checks. Hit the /exec URL in
// a browser; you should see {"ok":true,"service":"FlagSystem.ActionsWriter"}.
function doGet(e) {
  return _json({
    ok: true,
    service: "FlagSystem.ActionsWriter",
    tab: TAB_NAME,
    validActionTypes: VALID_ACTION_TYPES.length
  });
}
