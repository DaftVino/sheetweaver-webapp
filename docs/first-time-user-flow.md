# First-Time User Guide

SheetWeaver automatically copies emails from a Gmail label into a Google Spreadsheet on a schedule you control. When a matching email arrives in your inbox and gets that label, SheetWeaver extracts the sender, subject, date, and body into a new row — no manual copy-paste required.

This guide covers what you need to do as a standard user who has received a link to a deployed SheetWeaver app. It does not cover deployment or admin setup — see [setup-guide.md](setup-guide.md) for that.

---

## First login: granting permissions

When you open the app for the first time, Google will ask you to authorize it. SheetWeaver requests access to:

| Permission | Why it's needed |
|---|---|
| Read Gmail labels and messages | To find emails matching the label you configure |
| Read and write Google Sheets | To append rows to your spreadsheet |
| Run as you | So the sync trigger can run on your behalf, on a schedule |

Click **Allow** for all permissions. SheetWeaver does not store your email content — it only reads messages to extract fields you configure, then writes them to your spreadsheet.

---

## The setup wizard

After granting permissions you land on the dashboard. If you have no captures yet, click **+ Add a new capture** to open the wizard.

### Step 1 — Enter a Gmail label name

Type the exact name of the Gmail label you want to track. The name must match what appears in Gmail's left sidebar (case-sensitive). Click **Verify & Scan Label** to confirm the label exists and count existing messages.

### Step 2 — Configure spreadsheet data

Paste the URL of the Google Spreadsheet where rows should be written. Enter the sheet (tab) name. Choose which email fields to capture (sender, subject, date, body snippet, etc.). Preview the output format before saving.

### Step 3 — Save

Review your configuration and click **Save**. SheetWeaver creates a sync trigger that runs automatically every hour.

---

## Setting up your first Gmail label capture

If you do not have a Gmail label yet:

1. In Gmail, open an email you want to track.
2. Click the label icon (or More → Label as) and create a new label — for example `receipts` or `support-tickets`.
3. Apply that label to the email.
4. Return to SheetWeaver and enter that label name in Step 1 of the wizard.

---

## What the dashboard shows

| Column | Meaning |
|---|---|
| Label | The Gmail label being tracked |
| Sheet | The spreadsheet tab receiving new rows |
| Last Run | When SheetWeaver last synced this capture |
| Status | `ok` = last sync succeeded; `error` = something went wrong |
| Emails Synced | Cumulative count of emails written to the sheet |
| Actions | Pause, edit, or delete this capture |

A sync trigger runs all your captures automatically. The **Sync Now** button at the top of the dashboard runs an immediate sync if you want to catch up without waiting.

---

## What the trigger does and how to know it's working

SheetWeaver installs a time-driven trigger (under your Google account) that fires every hour. You can verify it is active:

- A green **"Syncing hourly"** banner appears at the top of the dashboard when the trigger is installed.
- In Google Apps Script: open your copy of the script → Triggers (clock icon) → you should see a `processEmails` trigger owned by your email.

If the banner shows **"Sync trigger off"**, click **Enable hourly sync** to reinstall it.

---

## When something goes wrong

1. Check the **Status** column on the dashboard — `error` rows show what failed.
2. Click **Copy Debug** in the top-right corner. This copies a snapshot of your configuration and recent errors.
3. Open a [GitHub Issue](https://github.com/DaftVino/SheetWeaver-Webapp/issues/new/choose) and paste the copied text.
4. Describe what you were doing when the error occurred.

For common problems (label not found, spreadsheet access denied, trigger quota exceeded) see [troubleshooting.md](troubleshooting.md).

---

## Need more help?

- [Troubleshooting Guide](troubleshooting.md) — common errors and fixes
- [SUPPORT.md](../SUPPORT.md) — how to reach the maintainer
