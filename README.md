<p align="center">
  <img src="Logo\Logo\Full Logo@0.25x.png" alt="Sheet Weaver" width="360">
</p>

# Gmail Label Tracker Sheet Webapp

A Google Apps Script web app that automatically extracts structured data from Gmail labels into Google Sheets, running on a shared 15-minute schedule with no manual intervention required.

## What It Does

Users connect a Gmail label to a Google Sheet tab and define extraction rules (field names and patterns). The app then scans matching emails on a recurring trigger and writes parsed data — sender, date, subject, and custom-extracted fields — into rows on the configured sheet.

Multiple team members can each configure their own connections. Each user's trigger runs as themselves, reading their own Gmail and writing to their own permitted Sheets.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Runtime | Google Apps Script (V8) |
| Frontend | Vanilla HTML/CSS/JS served via `HtmlService` |
| Email | `GmailApp` (read-only label queries) |
| Storage | `SpreadsheetApp` + `PropertiesService` |
| Scheduling | `ScriptApp` time-based triggers (every 15 min) |
| Deploy CLI | `@google/clasp` |

## Prerequisites

- A Google account (consumer `@gmail.com` or Google Workspace both work)
- Node.js 18 or later
- `clasp` CLI authenticated with your Google account

Install `clasp` globally (recommended — simplest copy/paste for all commands below):

```powershell
# Windows PowerShell
node --version        # confirm 18+
npm --version         # confirm npm is available
npm install -g @google/clasp
```

```bash
# macOS / Linux
node --version
npm --version
npm install -g @google/clasp
```

> **Alternative:** if you prefer not to install `clasp` globally, replace every `clasp` command below with `npx clasp`. Repo-local `npx clasp` works the same way but requires `npm install` first and adds `npx` to every command.

## Install Checklist

Each installer creates their own Apps Script project and becomes the admin for that instance:

- [ ] Clone the repo and run `npm install`
- [ ] Create a new Apps Script project and put **your own** `scriptId` in `.clasp.json` (copy from `.clasp.json.example`)
- [ ] Push code with `clasp push`
- [ ] Run `bootstrapAdmin` once in the Apps Script editor to register yourself as admin
- [ ] Deploy as a web app — **Execute as:** User accessing the web app; **Who has access:** Anyone with a Google account
- [ ] Choose access level: leave `access` as `ANYONE` for consumer + Workspace accounts, or change it to `DOMAIN` for Workspace-only restriction (redeploy after changing)
- [ ] Open the web app, click **New Connection**, and enter your Sheet URL to complete your first connection
- [ ] Optionally set an org-wide default Sheet URL via a `default_spreadsheet_url` Script Property so new users see a pre-filled URL
- [ ] Share the web app URL with your team

## Setup

See **[docs/setup-guide.md](docs/setup-guide.md)** for full step-by-step instructions, including:

- Brand-new Apps Script project via `clasp` (primary path)
- Linking to an existing Apps Script project
- Manual copy-paste install (no `clasp` required)
- Update instructions for future pushes

## Configuration

### appsscript.json

| Setting | Value | Meaning |
|---------|-------|---------|
| `executeAs` | `USER_ACCESSING` | Each visitor's session runs as themselves |
| `access` | `ANYONE` | Any signed-in Google account can use the app |
| `timeZone` | `America/Los_Angeles` | Trigger scheduling reference |
| `exceptionLogging` | `STACKDRIVER` | Errors appear in Cloud Logging |

**Workspace-only variant:** if your team is on Google Workspace and you want to restrict access to your domain, change `access` to `"DOMAIN"` in `appsscript.json` before deploying. You must redeploy after changing this value.

**Personal install variant (single-user only):** if you want only yourself to use the app, you must set **both** of the following in the Apps Script deploy dialog — changing only one is unsafe:
- **Execute as:** Me (the deployer) — i.e. `executeAs: USER_DEPLOYING`
- **Who has access:** Only myself — i.e. `access: MYSELF`

> **Warning:** setting `executeAs: USER_DEPLOYING` while leaving `access: ANYONE` is unsafe — any signed-in Google user who has the URL can open the app and trigger backend operations that run as you. This variant is **single-user only** and disables the team model; use the default `USER_ACCESSING` settings for shared installs. *(Note: this personal-install path has not been end-to-end tested — use with caution.)*

### Default Spreadsheet URL

Users enter their Sheet URL in the app during setup. The app saves it as that user's personal default for next time. No hard-coded URL exists in the code.

As admin you can optionally set an org-wide default via a Script Property (`default_spreadsheet_url`), but this is not recommended — each user's own URL is clearer and avoids accidental shared-sheet writes.

## Project Structure

```
├── Code.js              # All backend logic
├── Index.html           # Full frontend — UI, themes, step wizard
├── appsscript.json      # Apps Script manifest
├── .clasp.json.example  # Template — copy to .clasp.json and fill in your scriptId
├── package.json         # Dev tooling (clasp + local verify)
├── scripts/
│   └── local-verify.js  # Local gate — run before every push
├── docs/
│   ├── setup-guide.md   # Full install and update instructions
│   ├── troubleshooting.md
│   └── qa-runbook.md    # Post-deploy test matrix
└── .github/
    └── workflows/
        └── deploy.yml   # Manual-only CI deploy (project-specific — see file header)
```

## Usage Flow

1. Open the web app URL — you see the **Dashboard** listing all your active connections.
2. Click **New Connection** and enter a Gmail label name. The app verifies the label and scans recent emails to suggest field names.
3. Define column headers and optional extraction patterns (regex or keyword delimiters).
4. Save — the app registers the connection and automatically enables your 15-minute sync trigger.
5. Emails arriving under the label are processed automatically every 15 minutes.

## Themes

The UI ships with three CSS themes selectable per-user:

| Theme | Style |
|-------|-------|
| `solar` | Light / warm tones |
| `torres` | Dark / muted |
| `nes` | Retro Commodore 64 palette |

Theme choice is persisted per-user via `PropertiesService`.

## Known Limitations

- The shared `capture_registry` property is capped at ~9 KB, limiting total connections across all users. Monitor byte size in the Admin Diagnostics panel.
- Consumer Gmail accounts operating under `ANYONE_WITH_GOOGLE` may see an empty identity in rare multi-account browser sessions. The app shows a clear error with a report ID when this happens.

Remediation history is internal and not included in this repository.

## Logs & Debugging

Every failure produces a **report ID** visible to the user in the app and to the admin in:

- **In-app Admin Diagnostics panel** (admin-only section of the dashboard)
- **Apps Script editor → Executions** (per-run view; search for the report ID)
- **Google Cloud Console → Logging** (full log search via `[DIAG]` prefix)

Non-admins see only the report ID in their error message. Admins can look up the full structured log by that ID.

### Copy Debug

The header bar has a **Copy Debug** button available on every screen. Clicking it:

1. Fetches a server-side snapshot of the caller's own connections and trigger state
2. Merges it with client context (current view, browser, page-load time, recent errors)
3. Copies the result as a formatted text block to your clipboard

**First-line tester→admin workflow:** when something goes wrong, click Copy Debug and paste the output into a support message. The snapshot includes all recent error report IDs, so the admin can look them up immediately without back-and-forth. Client-side errors (JavaScript failures in the browser) are now also captured and included in the snapshot.
