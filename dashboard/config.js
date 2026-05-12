/**
 * Flag System Dashboard — Configuration
 *
 * Replace the two REPLACE_ME values after deploying. The rest is locked
 * to the Strong Standard sheet IDs and tab names per TDD v1.0 §3.1.
 *
 * SHEETS_API_KEY:
 *   Restricted API key from Google Cloud Console project
 *   plucky-zodiac-491515-j6 (Google Sheet Access). Restrict by HTTP
 *   referrer to https://f4la.github.io/* and by API to Google Sheets API.
 *
 * APPS_SCRIPT_URL:
 *   Deployment URL of the Apps Script Web App bound to the HC Actions
 *   sheet. Deploy as "Anyone" (the script runs as the owner). The URL
 *   ends in /exec.
 */
(function (root) {
  "use strict";

  root.FlagConfig = {
    // ===== Replace after deploy =====
    SHEETS_API_KEY: "AIzaSyCbpE8CmLKpfmbMPLXkEmWe-5zEx53XyIg",
    APPS_SCRIPT_URL: "https://script.google.com/macros/s/AKfycbwHne-CZKkMfoKiy__YQcnSHLmaXdOxuFc0DPHJugYPkAI96nXlXAoreoflRwf-g6OP2A/exec",

    // ===== Sheet identifiers (locked) =====
    ROSTER: {
      sheetId: "1VxxqmOVuXffLOpPvMWnSUHhyhkjIajtBeBoSV3xk1fc",
      tab: "Roster",
      // Per TDD §3.1: coach is in column F.
      // Active client list lives in this tab. Column layout assumed:
      //   A: Client Name (full)
      //   F: Assigned Coach
      // We read A:F and filter to rows with both populated.
      range: "Roster!A2:F"
    },
    FORM_RESPONSES: {
      sheetId: "1ugM0iOCwdaQpyDVPuJQfKRhu72NQrtC-hEjJ7PkGHoA",
      tab: "Form Responses 1",
      // Schema (per client-timeline.js normalizeSubmission array branch):
      //   A: timestamp
      //   B: client
      //   C: exempt (Yes/No)
      //   D: exempt justification
      //   E: standards completed (comma-separated checklist)
      //   F: loom link
      //   G: call requested
      //   H: notes
      range: "'Form Responses 1'!A2:H"
    },
    HC_ACTIONS: {
      sheetId: "1TmlmzNPi-BtLy1C4sizqJmvLFHAxyH6Glb9mWP3Vv64",
      tab: "HC Actions",
      // Schema per TDD §3.3:
      //   A: Timestamp
      //   B: Action Week (YYYY-Www)
      //   C: Client
      //   D: Coach
      //   E: Pathway
      //   F: Standard
      //   G: Action Type
      //   H: Notes
      //   I: Outcome
      //   J: Follow-up Due Date
      //   K: Action ID
      range: "'HC Actions'!A2:K"
    },

    // ===== Engine settings =====
    LOOKBACK_WEEKS: 16, // TDD §8.4

    // ===== Long-form → short-form standard names for Slack templates =====
    STANDARD_SHORT_NAMES: {
      "Check-In Submission": "Check-In",
      "Training Adherence": "Training",
      "Nutrition Adherence": "Nutrition",
      "Movement Target": "Movement",
      "Technique Feedback": "Technique"
    }
  };
})(typeof window !== "undefined" ? window : this);
