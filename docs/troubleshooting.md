# Troubleshooting

Fixes for common problems, for anyone using or admin-ing SheetWeaver. For first-time setup steps see the [Setup Guide](setup-guide.md); for the everyday walkthrough see the [First-Time User Guide](first-time-user-flow.md).

Most errors show a **report ID** — an 8-character code like `a1b2c3d4`. Give that ID
to your admin. They can look it up in the Admin Diagnostics panel or in Apps Script →
Executions. Regular users only see the report ID, never the raw error.

**Do this first: click the Copy Debug button** in the top-right of any screen. It copies
your thread status, recent report IDs, and browser details into one block of text. Paste
that into your support message. Browser-side (JavaScript) errors are included too.

---

## Admin Diagnostics Panel

If you are the admin (you ran `bootstrapAdmin` during setup), you see an **Admin Diagnostics** section at the top of the dashboard. It lists recent errors with report ID, timestamp, user, error type, and counts.

To access execution logs directly:

- **Apps Script editor → Executions** — shows each run; search for a report ID or `[DIAG]`
- **Google Cloud Console → Logging** — full log search; filter by `[DIAG]`

Use **Clear Diagnostics** in the Admin panel to reset the event list after resolving issues.

---

## Emails Are Not Being Processed

**Check whether the loom is running.**
Open the web app dashboard. If a yellow banner says **"⚠️ The Loom is Idle,"** click
**Start the Loom**. Setup turns the loom on for you — this banner is a backup for
the rare case where that failed.

**Check execution logs.**
In the Apps Script editor go to **Executions**. Look for `processEmails` runs. If they show errors, expand the stack trace or search for the report ID shown in the Admin panel.

**Check the label name.**
Gmail label names are case-sensitive. Go to Gmail Settings → Labels and confirm the exact spelling. Nested labels use `/` as a separator (e.g., `Ops/Invoices`).

---

## "Label not found" or Authorization Error During Setup

Label verification now returns a detailed error message and report ID distinguishing:

- **Gmail scope not authorized** — click **Recheck Permissions** or **Open Authorization** in the error panel.
- **System label** (Inbox, Sent, Spam, Trash, Drafts, Starred, Important, Unread, Chat) — these are not supported as custom label targets. Create a new custom label instead.
- **Label truly not found** — check spelling and capitalization in Gmail Settings → Labels.
- **Empty label** — the label exists but contains no emails. Add test emails first, or the scan will return no suggestions.
- **Empty identity** — the app could not read your Google account. This can happen in multi-account browser sessions. Sign out of all Google accounts, then sign back in as the intended account and reload the app.

In all cases, click **Copy Report ID** in the error panel and share it with your admin for diagnostics.

---

## Setup Wizard Hangs on "Scanning emails..."

The scan reads up to 10 recent emails. If the label has no emails the scan completes instantly with no suggestions — this is normal.

If it hangs, open the Apps Script Executions panel and check whether `scanEmailForSuggestions` is timing out or showing a report ID in the Admin Diagnostics panel.

---

## First Sync Never Finishes / Tab is Empty After Setup

The initial sync is now cursor-paged: it processes up to 100 threads per run and resumes where it left off on the next trigger. A large label will fill in over several 15-minute runs rather than timing out.

If the tab is still empty after 30+ minutes:

1. Open the Admin Diagnostics panel and look for a report ID with `where: processEmails`.
2. Check Apps Script → Executions for `processEmails` runs — confirm they are completing without errors.
3. Confirm the Sheet tab name matches exactly what was entered during setup (case-sensitive).
4. Confirm the trigger is active (see "Emails Are Not Being Processed" above).

---

## Action Buttons (Edit/Delete/Rest/Mend) Don't Work

Tab names and label names with apostrophes, quotes, or other special characters are now handled correctly. Dashboard action buttons use DOM event listeners rather than inline `onclick` attributes.

If buttons are still unresponsive, open the browser console (F12 → Console) and check for JavaScript errors. A report ID in the error output will help the admin trace the cause.

---

## The Dashboard Shows No Threads After Setup

The connection registry is stored in Script Properties, one key per connection. If it was cleared or setup failed silently:

1. Open the Apps Script editor → **Project Settings → Script Properties**.
2. Look for keys named `capture_conn_<id>` — one per connection, each holding a single JSON object. (On a project not yet upgraded to sharding, you may instead see a single `capture_registry` key holding a JSON array; it is migrated to `capture_conn_*` shards automatically the next time the registry is read or written.)
3. If the expected keys are missing, check the Admin Diagnostics panel for a report ID from `setupSpreadsheet`.
4. Re-run the setup flow; the Admin Diagnostics panel will capture any new failure with a report ID.

---

## "Could not read your Google identity"

**What you see:** the app can't tell who you're signed in as. Common causes (admin note: `Session.getActiveUser().getEmail()` returned an empty string):

- You are signed into multiple Google accounts in the same browser. Sign out of all, then sign in as a single account.
- The web app was deployed with `access: DOMAIN` but your account is a consumer `@gmail.com`. Ask your admin to change the manifest to `ANYONE` and redeploy.

A report ID is included in the error message — share it with your admin.

---

## Stuck in a Login / Permission Loop (Works Only in Incognito)

**Symptom:** in a normal browser tab the app keeps asking you to sign in or grant permission — pick an account, approve, and it just loops back to the login screen. The same URL works fine in an **Incognito/Private window**.

**Cause:** a **stale or mismatched sign-in cookie** for the app. The app saves a cookie
that links your browser to a finished sign-in for one account and one app version. That
cookie can go bad — for example after you switch Google accounts, close the consent screen
too early, or after the admin pushes a new version. Each time the page loads, the app tries
to fix the bad cookie, fails, and sends you back to the login screen. Incognito works
because it starts with no saved cookies.

**Fix (fastest — clears just this site):**

1. In the address bar, click the **site-info button** (the icon to the left of the URL — a tune/sliders or lock icon).
2. Choose **Cookies and site data** → **Manage / Delete** the data for this site (or **Reset permissions**).
3. **Reload** the page.

You will usually go **straight into the app without logging in again** — your browser is still signed into Google at the account level, so the app silently issues a fresh, clean session cookie.

**If it still loops after clearing cookies:** the cross-site cookies the app relies on are being *blocked* (not just stale). Check, in order:

- A **privacy/ad-blocking extension** (uBlock Origin, Privacy Badger, Ghostery, AdGuard, etc.) — pause it for this site, or whitelist the app URL. (Extensions are off by default in Incognito, which is often why Incognito works.)
- **Third-party cookies blocked** in `chrome://settings/cookies` — add **Allow** exceptions for `[*.]google.com` and `[*.]googleusercontent.com`.
- **Enhanced Tracking Protection** (Brave / Firefox / Edge) — set to Standard or add a site exception.

This is a browser-side issue; no app redeploy is needed.

---

## `clasp push` Fails with "Could not find script"

Your `.clasp.json` contains a `scriptId` your Google account does not have edit access to. Either:

- You are using the wrong Google account (`clasp login` with the correct account).
- You need to copy `.clasp.json.example` to `.clasp.json` and fill in your own script ID (see [Setup Guide](setup-guide.md)).

---

## GitHub Actions Deployment Fails

The deploy workflow is **manual-only** and project-specific. It will not run on push. If you triggered it manually and it failed:

1. **`Unexpected end of JSON input` / clasp auth error** — the `CLASPRC_JSON` secret is missing or malformed. Re-run `clasp login` locally, copy the full contents of `~/.clasprc.json` (including outer `{}` braces), and update the secret.
2. **"Could not find script"** — the `.clasp.json` in the repo does not contain your `scriptId`. Each installer must configure their own `.clasp.json`; do not use another installer's ID.
3. **Credentials expired** — `clasp` credentials expire. Re-run `clasp login` and update the `CLASPRC_JSON` secret.

See [Setup Guide — GitHub Actions CI Deploy](setup-guide.md#github-actions-ci-deploy) for full setup instructions.

---

## Update Available Banner in Admin Diagnostics

**What you see:** the Admin Diagnostics panel checks GitHub for a newer version (at most once every 7 days) and shows a banner with a link to the release notes if one exists.

**What it means:** newer code exists in the repo. The web app can't update itself — it can't run `git`, `clasp`, or shell commands — so the admin must apply the update locally. See [Setup Guide — Update Instructions](setup-guide.md#update-instructions) for the full steps.

After updating the live deployment, hard-reload the web app (Ctrl+Shift+R / Cmd+Shift+R). The banner disappears once the cached version check expires (up to 7 days) or once `APP_VERSION` in `Code.js` matches the latest release tag.

---

## Update Did Not Take Effect / Old Version Still Showing

**What you see:** you ran `clasp push` but users still see the old version.

**Why:** `clasp push` only saves the new code — it does not put it live. Someone still has to edit the live deployment and set **Version** to **New version**. See [Setup Guide — Update Instructions](setup-guide.md#update-instructions) for the exact steps.

**Wrong update path:** `clasp pull` downloads the Apps Script cloud copy into your local repo. It does NOT apply upstream repo updates. Always use `git pull` to get new code, then `clasp push` to send it to Apps Script. Running `clasp pull` after `git pull` will overwrite your local changes with the cloud version.

**After updating, verify:**

1. Open the web app and confirm the version-specific behavior you expected is present.
2. Open the Admin Diagnostics panel and confirm no new report IDs appeared from the update process.
3. Confirm existing connections still sync (check the `lastRunStatus` column on the dashboard).

---

## Registry Write Failures (Advanced)

Each connection is stored in its own `capture_conn_<id>` Script Property, capped at ~9 KB (`MAX_CONN_BYTES`), and the Script Properties store as a whole is capped at ~500 KB across all connections and users. If connections are failing to save, check the Admin Diagnostics panel for a report ID from `setupSpreadsheet` and look at the **Largest connection** and **Total store** metrics shown there.

If **Largest connection** is near its cap:

- That single connection's `headerConfigs` (or other per-connection data) is too large — ask your admin whether it can be trimmed.
- Because the registry is sharded, this only affects the one oversized connection; other connections can still save normally.

If **Total store** is near its cap:

- Delete unused connections from the dashboard to free up Script Properties space.

The admin can monitor both metrics in the Admin Diagnostics panel. A write failure will produce a report ID and a `[DIAG]` log entry with `where: setupSpreadsheet` or `processEmails`.
