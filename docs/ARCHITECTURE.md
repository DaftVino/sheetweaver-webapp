# Architecture

## Overview

SheetWeaver is a Google Apps Script web app. There is no traditional server — Google's infrastructure hosts and runs all code. The "backend" is a set of server-side functions in `Code.js` exposed to the browser via `google.script.run`. The "frontend" is a single HTML file (`Index.html`) served by `HtmlService`.

```
Browser
  │
  │  HTTPS (HtmlService)
  ▼
Index.html  ──── google.script.run ────▶  Code.js
                                              │
                                    ┌─────────┴──────────┐
                                    │                     │
                               GmailApp             SpreadsheetApp
                            (read labels)          (read/write sheets)
                                              PropertiesService
                                              (config storage)
                                              ScriptApp
                                              (trigger management)
```

## Execution Model

The app is deployed with `executeAs: USER_ACCESSING`. This means:

- Every user who opens the web app runs the Apps Script code **as themselves**, using their own OAuth token.
- `GmailApp` reads **their** Gmail inbox.
- `SpreadsheetApp` writes to sheets **they have access to**.
- `ScriptApp` creates **their own** time-based trigger — each user maintains an independent trigger under their account.

This design avoids a single service account bottleneck and keeps each user's data isolated by Gmail permissions without any application-level auth layer.

## Data Flow

### Setup (interactive)

```
User fills form
  → google.script.run.verifyLabel(label)
      → GmailApp.getUserLabelByName(label)
  → google.script.run.scanEmailForSuggestions(label)
      → GmailApp.search(label, 0, 10)  [read up to 10 emails]
      → parse bodies → return suggested field names
  → google.script.run.setupSpreadsheet(...)
      → Open/create sheet tab
      → Write header row with embedded rule metadata (as cell notes)
      → Append entry to capture_registry in PropertiesService
      → If initialSync requested: processEmails() for this connection
```

### Recurring sync (triggered)

```
ScriptApp time trigger fires every 15 min (per user)
  → processEmails()
      → Read capture_registry → filter to current user's connections
      → For each connection:
          → GmailApp.search(label, after:lastRunTimestamp)
          → For each matching email:
              → Extract fields using rules from sheet header notes
              → Append row to sheet tab
          → Update lastRun timestamp in registry
```

### Dashboard (interactive)

```
User opens app → loadDashboard()
  → google.script.run.getDashboardData()
      → Read capture_registry
      → For each connection: check if tab still exists
      → Return connection list with health status
  → Render table with Edit / Pause / Delete / Repair actions
```

## Storage

| Store | Mechanism | What's Stored | Limits |
|-------|-----------|---------------|--------|
| Connection registry | `PropertiesService.getScriptProperties()` key `capture_registry` | JSON array of all connections (all users) | ~9 KB per property value |
| Extraction rules | Cell notes on header row of each sheet tab | Field name, pattern, delimiter, format per column | None in practice |
| User default sheet URL | `PropertiesService.getUserProperties()` key `user_default_spreadsheet_url` | Per-user fallback sheet | Isolated per user |
| UI theme | `PropertiesService.getUserProperties()` key `ui_theme` | `solar` / `torres` / `nes` | Isolated per user |

### Registry Structure

Each entry in the `capture_registry` array represents one Gmail→Sheet connection. Fields are written at different points in the lifecycle:

**Set at connection creation** (`setupSpreadsheet`):
```json
{
  "userEmail": "user@domain.com",
  "gmailLabel": "Ops/Invoices",
  "tabName": "Invoices Q1",
  "spreadsheetUrl": "https://docs.google.com/...",
  "sheetId": 123456789,
  "isPaused": false,
  "initialSync": "50",
  "lastSyncTime": null,
  "syncCursor": null,
  "headerConfigs": [
    { "name": "Date Received", "pattern": "EMAIL_DATE", "delimiter": "none", "format": "date" },
    { "name": "Message ID",    "pattern": "EMAIL_ID",   "delimiter": "none", "format": "text" },
    { "name": "Amount",        "pattern": "Total:",     "delimiter": "newline", "format": "currency" }
  ]
}
```

**Updated after each sync run** (`recordConnectionRun` called from `_flushRegistryResults`):
```json
{
  "lastRunStatus": "ok",
  "lastRunAt": "2026-01-15T10:30:00.000Z",
  "lastRunReportId": "a1b2c3d4",
  "lastError": null,
  "lastCounts": { "scanned": 12, "new": 3, "updated": 1 },
  "lastDurationMs": 8200,
  "lastBodyType": "plain"
}
```

**Updated during initial bulk-sync** (`_processSingleConnection`):
- `lastSyncTime` — Unix timestamp (seconds) of when the initial backfill completed. Once set, incremental syncs use `after:lastSyncTime - 86400` instead of the initial strategy.
- `syncCursor` — batch offset for `initialSync: 'all'` multi-run backfills. `null` when not in progress.

The registry is a single shared JSON blob stored in one Script Property. All users read and write the same key. `LockService.getScriptLock()` is acquired for all registry writes to prevent concurrent corruption.

## Frontend Architecture

`Index.html` is a self-contained single-page application with four views controlled by CSS `display` toggling:

```
Step 0: Dashboard     — list all connections, search/sort/filter
Step 1: Label entry   — enter Gmail label, verify it, scan for field suggestions
Step 2: Field config  — define column headers and extraction patterns
Step 3: Success       — confirmation + trigger prompt
```

Navigation is handled by `nextStep(n)` and `loadDashboard()`. There is no client-side router or framework — all state lives in DOM element values and JS variables within the page lifecycle.

`google.script.run` calls are asynchronous. Each call uses `.withSuccessHandler()` and `.withFailureHandler()` callbacks. The UI shows inline loading spinners and error messages rather than modal dialogs.

## Concurrency

- **LockService (`getScriptLock`)** protects all writes to `capture_registry`. Lock-guarded paths: `togglePauseConnection`, `deleteConnection`, `setupSpreadsheet` (registry portion), and `_flushRegistryResults` (called from `processEmails`).
- **Per-user triggers** mean concurrent `processEmails()` calls from different users do not share a lock — each user's run is fully independent.
- `repairConnection` delegates to `setupSpreadsheet` (which acquires its own lock internally) and therefore needs no lock of its own.
- No locking around sheet writes; each connection writes to a distinct tab, so tab-level collisions are not possible within a single user's run.

## Scheduling

Each user who enables the trigger gets a `ScriptApp.newTrigger('processEmails').timeBased().everyMinutes(15)` trigger registered under their account. The trigger calls `processEmails()` which filters the registry to only that user's connections before doing any work.

`checkUserTrigger()` returns whether the current user has an active trigger. `enableUserTrigger()` creates one if absent. The dashboard shows a banner prompting the user to enable their trigger if it is missing.

## Admin Setup

Two functions are **manual Script Editor operations** — they are not exposed via the web UI and must be run directly in the GAS Script Editor by a project owner:

- **`bootstrapAdmin()`** — designates the effective user (the script owner) as admin by writing their email to the `adminEmail` Script Property. No-op if already set.
- **`setAdminEmail(email)`** — transfers admin rights to a different email. Requires the caller to already be the current admin.

## Diagnostics

`logDiag(level, where, payload)` is the central structured event logger. It assigns a `reportId` (8-char UUID slice), writes a JSON entry to Script Properties (keyed by report ID), updates the FIFO index, and emits a `[DIAG]` Cloud Logging entry. The Admin Diagnostics panel reads these via `getAdminDiagnostics()`.

Two additional functions extend diagnostics to the browser:

- **`logClientError(payload)`** — non-admin callable. Called fire-and-forget from `withFailureHandler` callbacks to persist browser-side failures in the same diagnostics store, giving them a server-side report ID visible to the admin.
- **`getDebugSnapshot()`** — non-admin callable, **caller-scoped only**. Returns the caller's own connections (label, tabName, lastRunStatus, lastRunAt, lastRunReportId, lastError, lastCounts, lastBodyType), the active trigger state, app version, and server timestamp. Never returns other users' data. Used by the **Copy Debug** button in the header.

The capture pipeline normalizes email bodies before extraction: it detects HTML-only messages, strips them to plain text, and logs a warning when an HTML-only body is processed. The detected body type (`plain` / `html`) is recorded per run as `lastBodyType` and surfaced in the debug snapshot so the admin can see whether a problematic capture came from an HTML email.

## Security Boundaries

- **Access model:** The default deploy uses `access: ANYONE` — any signed-in Google account (consumer `@gmail.com` or Workspace) can open the web app. Installers can tighten this to `DOMAIN` (Workspace-only) or loosen to `ANYONE_WITH_GOOGLE` in `appsscript.json`.
- **Data isolation by OAuth:** Each user's `GmailApp` call can only see their own email; cross-user Gmail access is not possible.
- **Debug snapshot scope:** `getDebugSnapshot()` filters the registry to the caller's own connections only. It never returns other users' label names, spreadsheet URLs, or run history.
- **Sheet access:** Governed by normal Google Drive sharing permissions — users can only write to sheets they have edit access to.
- **No secrets in code:** No API keys, tokens, or credentials in source. OAuth is handled entirely by Google's Apps Script runtime.

## File Roles

| File | Role |
|------|------|
| `Code.js` | All server-side logic: entry point (`doGet`), all `google.script.run`-callable functions, email processing engine, trigger management |
| `Index.html` | Complete frontend: HTML structure, embedded CSS (all three themes), embedded JavaScript for UI logic and `google.script.run` calls |
| `appsscript.json` | Apps Script manifest: runtime version (V8), logging target, webapp execution and access settings |
| `.clasp.json` | Clasp CLI config: binds this directory to the specific Apps Script project by Script ID |
| `package.json` | Node.js project metadata; only dev dependency is `@google/clasp` for deployment |

## Constraints & Known Limits

| Constraint | Value | Impact |
|-----------|-------|--------|
| Apps Script max execution time | 6 minutes | First-sync of large labels may be killed mid-run |
| PropertiesService value size | ~9 KB | Registry caps out at roughly 50–100 connections |
| `GmailApp.search()` results | 500 per call | Very large label backlogs require pagination |
| Trigger quota | 20 triggers per user per script | Not a current concern; one trigger per user |
| `HtmlService` output size | 50 MB | Not a current concern |
