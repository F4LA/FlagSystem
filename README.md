[README (1).md](https://github.com/user-attachments/files/27739608/README.1.md)
# Flag System Dashboard

Operational console the Head Coach uses on Fridays to execute the Flag System workflow.

**Status:** v1.0 — Tab 1 (Friday Action Queue) complete. Tabs 2–4 are placeholders.

---

## ⚠️ Shared Engine — Coordination Required

The files under `/engine/` are consumed externally by the **Coach Pulse Dashboard** (repo `F4LA/CoachPulse`) via CDN with a pinned commit hash.

**Before modifying any file in `/engine/`, you MUST:**

1. Read `Engine_Change_Protocol.md` in the Strong Standard project files.
2. Confirm both dashboards will be updated in coordination.
3. After deploying changes here, bump the commit hash in `F4LA/CoachPulse/index.html` to pull the new engine version.

**Shared files:**

- `engine/coaching-week.js`
- `engine/client-timeline.js`
- `engine/consecutive-evaluable.js`
- `engine/pathway-evaluators.js`
- `engine/color-deriver.js`
- `engine/pathway-engine.js`

Changes to anything outside `/engine/` (the `dashboard/`, `apps-script/` folders, or root-level files like `index.html`, `app.js`, `styles.css`) do NOT require coordination.

---

**Reference:** Flag System Dashboard Technical Design Document v1.0.

---

## Repo layout

```
.
├── index.html                       Shell + tab nav
├── styles.css                       All styling
├── app.js                           Top-level orchestrator
├── engine/                          Pathway engine (unchanged from design phase)
│   ├── coaching-week.js
│   ├── client-timeline.js
│   ├── consecutive-evaluable.js
│   ├── pathway-evaluators.js
│   ├── color-deriver.js
│   └── pathway-engine.js
├── dashboard/
│   ├── config.js                    Sheet IDs + secrets (REPLACE_ME)
│   ├── sheets-reader.js             Google Sheets API loader
│   ├── state-builder.js             Runs engine over the active roster
│   ├── slack-templates.js           TDD §6.2 verbatim + variant picker
│   ├── queue-builder.js             Slices states into Tab 1 sections
│   ├── actions-writer.js            POSTs to Apps Script
│   └── tab1.js                      Tab 1 renderer + button wiring
└── apps-script/
    └── Code.gs                      Apps Script web app (paste into script.google.com)
```

---

## Deployment

### 1. Sheets API key (read)

The dashboard reads from 3 Google Sheets via the Sheets API v4.

1. In Google Cloud Console project **plucky-zodiac-491515-j6** ("Google Sheet Access"), confirm an API key exists.
2. Restrict the key:
   - **API restriction:** Google Sheets API only.
   - **HTTP referrer restriction:** `https://f4la.github.io/*`
3. Paste the key into `dashboard/config.js` → `SHEETS_API_KEY`.
4. Confirm all 3 sheets are shared with **Anyone with the link → Viewer** (the API key alone does not grant access; the sheets must be readable).

### 2. Apps Script web app (write)

1. Go to https://script.google.com → New project.
2. Replace `Code.gs` with the contents of `apps-script/Code.gs`.
3. Run `doGet` once to trigger the OAuth consent dialog (authorize as the sheet owner).
4. **Deploy → New deployment:**
   - Type: **Web app**
   - Description: *Flag System — HC Actions Writer v1*
   - Execute as: **Me (the owner)**
   - Who has access: **Anyone**
5. Copy the deployment URL (ends in `/exec`).
6. Paste into `dashboard/config.js` → `APPS_SCRIPT_URL`.
7. Smoke test in browser: open the `/exec` URL. Should return:
   `{"ok":true,"service":"FlagSystem.ActionsWriter",...}`

### 3. HC Actions sheet header row

Confirm row 1 of the **HC Actions** tab matches:

| A | B | C | D | E | F | G | H | I | J | K |
|---|---|---|---|---|---|---|---|---|---|---|
| Timestamp | Action Week | Client | Coach | Pathway | Standard | Action Type | Notes | Outcome | Follow-up Due Date | Action ID |

### 4. GitHub Pages

1. Push the repo to **F4LA/FlagSystem**.
2. Settings → Pages → Branch: `main` / root.
3. Visit https://f4la.github.io/FlagSystem/.

---

## Validation checklist

- [ ] `index.html` loads with all 4 tabs visible.
- [ ] "Friday Action Queue" tab shows real client data within ~5s.
- [ ] Summary stats show non-zero counts (assuming there is at least one Yellow/Red client).
- [ ] Coach groups can be collapsed/expanded.
- [ ] "Generate Slack" opens a modal with the correct template variant.
- [ ] "Copy" copies the message to clipboard.
- [ ] "Mark sent" appends a row to the HC Actions sheet and shows a success toast.
- [ ] Refresh button reloads all 3 sheets and re-renders.
- [ ] Tabs 2/3/4 show "Coming in v1.1" placeholders.

---

## Out of scope for Chat A

- Tab 2 (Client Roster), Tab 3 (Coach Patterns), Tab 4 (Black Flagged Clients) — Chat B.
- Pathway Detail modal — Chat B.
- Slack templates for Critical Call Request, Black Flag Triggered, HC client emails — not in TDD §6.2.
