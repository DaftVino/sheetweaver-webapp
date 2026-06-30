# Troubleshooting

Most failures produce a **report ID** (8-character hex string like `a1b2c3d4`). Give that ID to your admin; they can look it up in the Admin Diagnostics panel or in Apps Script → Executions. Non-admins see only the report ID — no raw error details are exposed.

**Fastest first step: click the Copy Debug button** in the top-right of any screen. It gathers your connection status, recent error report IDs, and browser context into a single text block you can paste directly into a support message. Client-side JavaScript errors are now also captured and included.

---

## Admin Diagnostics Panel

If you are the admin (you ran `bootstrapAdmin` during setup), you see an **Admin Diagnostics** section at the top of the dashboard. It lists recent errors with report ID, timestamp, user, error type, and counts.

To access execution logs directly:

- **Apps Script editor → Executions** — shows each run; search for a report ID or `[DIAG]`
- **Google Cloud Console → Logging** — full log search; filter by `[DIAG]`

Use **Clear Diagnostics** in the Admin panel to reset the event list after resolving issues.

---

## Emails Are Not Being Processed

**Check whether a trigger is active.**
Open the web app dashboard. If a yellow banner says "Trigger not enabled," click the button to enable it. Setup now enables the trigger automatically — the banner is a fallback for cases where auto-enable failed.

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

## Action Buttons (Edit/Delete/Pause/Repair) Don't Work

Tab names and label names with apostrophes, quotes, or other special characters are now handled correctly. Dashboard action buttons use DOM event listeners rather than inline `onclick` attributes.

If buttons are still unresponsive, open the browser console (F12 → Console) and check for JavaScript errors. A report ID in the error output will help the admin trace the cause.

---

## The Dashboard Shows No Connections After Setup

The connection registry is stored in Script Properties. If it was cleared or setup failed silently:

1. Open the Apps Script editor → **Project Settings → Script Properties**.
2. Look for a key named `capture_registry`. Its value should be a JSON array.
3. If it's missing or empty, check the Admin Diagnostics panel for a report ID from `setupSpreadsheet`.
4. Re-run the setup flow; the Admin Diagnostics panel will capture any new failure with a report ID.

---

## "Could not read your Google identity"

This error means `Session.getActiveUser().getEmail()` returned an empty string. Common causes:

- You are signed into multiple Google accounts in the same browser. Sign out of all, then sign in as a single account.
- The web app was deployed with `access: DOMAIN` but your account is a consumer `@gmail.com`. Ask your admin to change the manifest to `ANYONE` and redeploy.

A report ID is included in the error message — share it with your admin.

---

## Stuck in a Login / Permission Loop (Works Only in Incognito)

**Symptom:** in a normal browser tab the app keeps asking you to sign in or grant permission — pick an account, approve, and it just loops back to the login screen. The same URL works fine in an **Incognito/Private window**.

**Cause:** a **stale or mismatched authorization cookie** saved for the app's domain. An Apps Script web app stores a session cookie that ties your browser to a *completed* authorization for a specific account and deployment version. That cookie can get into a bad state — for example after switching Google accounts, dismissing the consent screen partway through, or when the admin pushes a new deployment version. On each load the app tries to reconcile the bad cookie, fails, and redirects you to log in again. Incognito works because it starts with no stored cookies.

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

When the admin opens the dashboard, the Admin Diagnostics panel checks the GitHub Releases API for a newer version (at most once every 7 days; result is cached). If a newer release exists, a banner appears at the top of the Admin panel with a link to the release notes.

The banner means: a new version of the code is in the repo. It does **not** update automatically. The web app cannot run `git`, `clasp`, or shell commands — the admin must apply the update locally.

**To apply the update:**

**Windows (PowerShell):**

```powershell
git pull
npm install              # only if package.json changed
npm run verify:local     # must pass before pushing
clasp push
```

**macOS / Linux:**

```bash
git pull
npm install
npm run verify:local
clasp push
```

After `clasp push`, update the existing live deployment in the Apps Script editor:

1. Click **Deploy → Manage deployments**.
2. Select the live web app deployment.
3. Click the **Edit** pencil.
4. Set **Version** to **New version**.
5. Click **Deploy**.

Do not use **Deploy → New deployment** for routine updates. That creates a separate deployment and may produce a different URL. Editing the deployment but only changing its name or description also does not update the live script; **Version** must be changed to **New version**.

After updating the live deployment, hard-reload the web app (Ctrl+Shift+R / Cmd+Shift+R). The banner will disappear once the cached version check expires (up to 7 days) or when the `APP_VERSION` constant in `Code.js` matches the latest release tag.

---

## Update Did Not Take Effect / Old Version Still Showing

After running `clasp push`, users must receive a new deployment version before they see the update. `clasp push` alone only updates the saved code — it does not bump the live web app version.

**Fix:**

```powershell
clasp push
```

Then open **Apps Script editor → Deploy → Manage deployments**, edit the existing live web app deployment, and change **Version** to **New version**. Click **Deploy** to apply the new version.

The web app URL does not change when you edit the existing deployment. Users do not need a new link — they just need to hard-reload the page (Ctrl+Shift+R / Cmd+Shift+R) after the deployment version is updated.

If the old version still shows, confirm you did not create a separate **New deployment** and did not only rename or resave the existing deployment. The live deployment must point to a newly created version.

**Wrong update path:** `clasp pull` downloads the Apps Script cloud copy into your local repo. It does NOT apply upstream repo updates. Always use `git pull` to get new code, then `clasp push` to send it to Apps Script. Running `clasp pull` after `git pull` will overwrite your local changes with the cloud version.

**After updating, verify:**

1. Open the web app and confirm the version-specific behavior you expected is present.
2. Open the Admin Diagnostics panel and confirm no new report IDs appeared from the update process.
3. Confirm existing connections still sync (check the `lastRunStatus` column on the dashboard).

---

## Registry Write Failures (Advanced)

The `capture_registry` Script Property is capped at ~9 KB. If connections are failing to save, check the Admin Diagnostics panel for a report ID from `setupSpreadsheet` and look at the registry byte size shown there.

If the byte size is near 9000:

- Delete unused connections from the dashboard.
- Ask your admin whether `headerConfigs` stored per-connection can be trimmed.

The admin can monitor byte size in the Admin Diagnostics panel. A write failure will produce a report ID and a `[DIAG]` log entry with `where: setupSpreadsheet` or `processEmails`.
