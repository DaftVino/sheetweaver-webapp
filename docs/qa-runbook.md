# QA Runbook — Post-Deploy Test Matrix

Run these checks after every new deployment. All tests require a live Apps Script deployment and at least two Google accounts: one admin (the installer) and one regular user. A third "denied" account is needed for scope-revoke tests.

**Local gate must pass before any deploy:**

```powershell
npm run verify:local
```

---

## 1. Clean-Room Install

Verify the install path works end-to-end from zero for a new installer.

| # | Test | Expected |
|---|------|----------|
| 1.1 | Follow Path A (clasp, brand-new project) from docs | No errors; `clasp push` completes |
| 1.2 | Run `bootstrapAdmin` in the Apps Script editor | Runs without error; no output means it set the admin property |
| 1.3 | Open the web app as the admin account | Dashboard loads; Admin Diagnostics section is visible |
| 1.4 | Open the web app as a second (non-admin) account | Dashboard loads; Admin Diagnostics section is NOT visible |
| 1.5 | Attempt to call `getAdminDiagnostics` as a non-admin (via Apps Script editor Run) | Returns `{authorized: false}` |
| 1.6 | Attempt to run `bootstrapAdmin` again as the admin | No-op; admin email unchanged |
| 1.7 | Attempt to run `bootstrapAdmin` as a non-admin in the web-app context | No-op; admin email unchanged (admin-takeover guard) |
| 1.8 | Grep deployed sources for any personal email address, owner Sheet ID, or original `scriptId` | No matches |

---

## 2. Account and Identity

| # | Test | Expected |
|---|------|----------|
| 2.1 | Sign in as admin account and load dashboard | `getActiveEmail()` is non-empty; no identity error |
| 2.2 | Sign in as a team member (non-admin) Google account | `getActiveEmail()` is non-empty |
| 2.3 | Open app while signed into two Google accounts in the same browser | Identity error with report ID shown; Admin Diagnostics shows same report ID |
| 2.4 | Open app with a consumer `@gmail.com` account (deploy at `ANYONE_WITH_GOOGLE`) | App loads and functions normally |
| 2.5 | Open app with `access: DOMAIN` deploy and a consumer account outside the domain | Access denied by Google at the deploy level (not an app error) |

---

## 3. Label Verification

| # | Test | Expected |
|---|------|----------|
| 3.1 | Enter a valid custom label | Label verified; scan proceeds |
| 3.2 | Enter a nested label (`Ops/Invoices`) | Label verified correctly |
| 3.3 | Enter a label name with wrong capitalization | "Label not found" error with report ID and corrected-spelling suggestion |
| 3.4 | Enter `Inbox` (system label) | Error: "system label" message with report ID; no crash |
| 3.5 | Enter an empty label name | Error: "empty input" message; no backend call made |
| 3.6 | Enter a valid label that has zero emails | Error: "label exists but is empty" with report ID |
| 3.7 | Revoke Gmail scope from myaccount.google.com, then enter any label | Error: "Gmail scope not authorized" with report ID and an Open Authorization link |
| 3.8 | Click **Recheck Permissions** after re-granting scope | Scope confirmed; label scan retried automatically |
| 3.9 | Click **Copy Report ID** | Report ID is copied to clipboard |

---

## 4. Sheet Configuration

| # | Test | Expected |
|---|------|----------|
| 4.1 | Enter a URL for a Sheet the user owns | Setup proceeds normally |
| 4.2 | Enter a URL for a Sheet shared with the user (edit access) | Setup proceeds normally |
| 4.3 | Enter a URL for a Sheet the user cannot access | Clear error during `setupSpreadsheet` with report ID |
| 4.4 | Enter a Sheet URL with a tab that was deleted | Error with report ID; sheet is not deleted |
| 4.5 | Enter a Sheet where `Message ID` column was renamed | Dedup disabled warning in Admin Diagnostics; run still completes |
| 4.6 | Enter a Sheet where `Date Received` column was renamed | Sort skipped warning in Admin Diagnostics; run still completes |
| 4.7 | Leave Sheet URL blank and click Save | Client-side validation fires; error shown before any backend call |
| 4.8 | No Sheet URL is saved as user default and no admin default set | Placeholder "Enter your Google Sheet URL (required)" shown; no pre-fill |

---

## 5. Sync Modes

| # | Test | Expected |
|---|------|----------|
| 5.1 | First sync with "recent 50 emails" mode | Completes in one run; data appears in Sheet |
| 5.2 | First sync with "last 30 days" mode | Completes or progresses; report ID in Admin panel if partial |
| 5.3 | First sync with "all emails" on a label with 150+ emails | First run processes 100 threads; cursor saved; second run picks up remaining; both runs advance correctly |
| 5.4 | Run sync again immediately (trigger fires) | Incremental sync; only new emails added; no duplicates |
| 5.5 | Sync with large HTML email bodies | Email processed; no timeout; counts appear in last-sync column |
| 5.6 | Pause a connection, wait for trigger, unpause | No emails processed while paused; sync resumes after unpause |
| 5.7 | Delete a connection from the dashboard | Connection removed from registry; no further sync |
| 5.8 | Create a connection with tab name containing `'` `"` `\` `<` | Setup succeeds; all dashboard action buttons (Edit/Pause/Delete/Repair) function correctly |

---

## 6. Diagnostics

| # | Test | Expected |
|---|------|----------|
| 6.1 | Trigger any setup failure (bad label, denied scope) | Report ID shown to user in error panel |
| 6.2 | Admin opens Admin Diagnostics panel | Same report ID appears in the panel with correct `where`, user, and error class |
| 6.3 | Admin opens Apps Script → Executions | Same report ID appears in `[DIAG]` log line |
| 6.4 | Admin clicks **Clear Diagnostics** | Panel is empty on next load |
| 6.5 | Non-admin account opens dashboard | Admin Diagnostics section is absent |
| 6.6 | Admin reviews registry byte size in Admin Diagnostics | Byte size shown; significantly below 9000 for typical use |
| 6.7 | Admin reviews `lastRunStatus` column in dashboard | Shows status (ok/warn/partial/error) and relative time for each connection |
| 6.8 | Click **Copy Debug** on dashboard and inside the wizard | Clipboard receives a text block starting with `=== Sheet Weaver Debug ===`; contains app version, user email, connection status, recent error report IDs |
| 6.9 | Force a client-side failure (temporarily break a `google.script.run` call), then click **Copy Debug** | Failure appears in the "Recent Client Errors" section; the same event also appears in Admin Diagnostics (via `logClientError`) |
| 6.10 | Call `getDebugSnapshot()` as a non-admin user with connections | Returns only that user's own connections; no other users' data visible |
| 6.11 | `npm run verify:local` | All checks pass, including Phase 1 static checks for `logClientError`, `getDebugSnapshot`, Copy Debug button |

---

## 7. No-Default-Sheet Path

| # | Test | Expected |
|---|------|----------|
| 7.1 | Fresh deploy with `DEFAULT_SPREADSHEET_URL = ''` and no `default_spreadsheet_url` Script Property | Sheet URL field is blank with placeholder "Enter your Google Sheet URL (required)" |
| 7.2 | User saves a Sheet URL, then re-opens setup | Previous URL is pre-filled from user default |
| 7.3 | User clears Sheet URL and saves | Error: "Please enter a Google Sheet URL before saving." (no opaque crash) |

---

## 8. Multi-User Team Scenario

| # | Test | Expected |
|---|------|----------|
| 8.1 | Two users each create a connection on the same web app | Both connections appear in the team dashboard |
| 8.2 | User A's connection contains their own Gmail label | Only User A's trigger reads User A's Gmail |
| 8.3 | User B tries to edit User A's connection | Edit action blocked (ownership guard); error with report ID logged |
| 8.4 | Admin views Admin Diagnostics after User B's blocked edit | Ownership-violation diag entry visible with User B's email and report ID |

---

## 9. Update Flow

| # | Test | Expected |
|---|------|----------|
| 9.1 | Simulate an update: `git pull`, `npm run verify:local`, `clasp push`, `clasp deploy` | All commands succeed; web app loads the new version |
| 9.2 | After update, Admin Diagnostics panel loads normally | No new errors introduced by the update |
| 9.3 | Existing connections still sync after update | Data continues to appear in Sheets |

---

## Pass Criteria

All tests in sections 1–8 must pass before marking a deployment ready for general use. Section 9 must pass on each subsequent update.

Log any test failure with its report ID (where applicable) and the Apps Script Executions entry. Do not mark a phase complete based solely on local `npm run verify:local` — that gate verifies syntax and static invariants only; it cannot test OAuth, Gmail API, Sheets API, triggers, or multi-account behavior.
