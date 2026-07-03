# First-Time User Guide

SheetWeaver copies emails from a Gmail label into a Google Sheet for you. When a
new email gets that label, SheetWeaver reads it and adds a new row to your sheet.
It saves the sender, subject, date, and any fields you pick. You never have to
copy and paste.

This guide is for regular users who got a link to a SheetWeaver app. It does not
cover deploying or admin setup. For that, see [setup-guide.md](setup-guide.md).

---

## First login: allowing permissions

The first time you open the app, Google asks you to allow it. SheetWeaver needs
these permissions:

| Permission | Why it's needed |
|---|---|
| Read your Gmail labels and messages | To find the emails that match your label |
| Read and write Google Sheets | To add rows to your sheet |
| Run as you | So the sync can run for you on a schedule |

Click **Allow** for each one. SheetWeaver does not save your emails. It only reads
them to pull out the fields you choose, then writes those fields to your sheet.

---

## The setup wizard

After you allow the permissions, you land on the dashboard. If you have no
threads yet, click **+ Weave a New Thread** to open the wizard.

### Step 1 — Enter a Gmail label name

Type the exact name of the Gmail label you want to track. It must match the name
in Gmail's left sidebar, including capital letters. Click **Verify & Scan Label**.
The app checks that the label exists and reads a few emails to suggest fields.

### Step 2 — Configure spreadsheet data

This screen is called **Configure Spreadsheet Data**. Here you:

- Paste the link to your Google Sheet.
- Set a **Custom Tab Name** if you want one. Leave it blank to use the label name.
- Pick **First Sync Fetch** — how many old emails to grab on the first run:
  **Last 50 Emails**, **Last 30 Days**, or **All (Max 1000)**.
- Choose which fields to capture and check the preview.

### Step 3 — Save

Look over your setup and click **Save**. SheetWeaver creates a weave that runs on
its own every 15 minutes. You see a **"The Loom Is Strung!"** message when it is done, with a
brief thread-weave animation to mark the new thread (shown once, and skipped
automatically if you have reduced motion enabled).

---

## Making your first Gmail label

Don't have a label yet? Make one first:

1. In Gmail, open an email you want to track.
2. Click the label icon (or **More → Label as**) and make a new label. For
   example, `receipts` or `support-tickets`.
3. Add that label to the email.
4. Go back to SheetWeaver and type that label name in Step 1.

---

## What the dashboard shows

The dashboard lists your threads under **Active Threads**:

| Column | What it means |
|---|---|
| Creator Email | The account that owns this thread |
| Gmail Label | The Gmail label being tracked |
| Spreadsheet Tab | The sheet tab where new rows are added |
| Gmail Status | Whether the app can read the label |
| Sheet Status | Whether the app can write to the tab |
| Last Weave | When the last weave ran |
| Actions | Edit, rest, delete, or mend this thread |

The loom weaves all your threads on its own every 15 minutes.

Below the table, a status line shows when the next weave will run for your threads, and
how many rows have been woven in across *every* thread on this deployment since it was
installed (not just yours — it's a shared, whole-team count).

---

## How to know the loom is running

SheetWeaver sets up a trigger under your Google account that runs every 15
minutes. You can check that it is on:

- A green **"✅ The Loom is Running"** banner shows at the top of the dashboard
  when the trigger is on.
- In Google Apps Script: open your copy of the script, click **Triggers** (the
  clock icon), and look for a `processEmails` trigger owned by your email.

If the banner says **"⚠️ The Loom is Idle"**, click **Start the Loom** to
turn it back on.

---

## When something goes wrong

1. Look at the **Gmail Status** and **Sheet Status** columns. They show which part
   failed.
2. Click **Copy Debug** in the top-right corner. This copies your setup and recent
   errors.
3. Open a [GitHub Issue](https://github.com/DaftVino/sheetweaver-webapp/issues/new/choose)
   and paste in the copied text.
4. Say what you were doing when the error happened.

For common problems (label not found, no sheet access, trigger limits), see
[troubleshooting.md](troubleshooting.md).

---

## Need more help?

- [Troubleshooting Guide](troubleshooting.md) — common errors and fixes
- [SUPPORT.md](../.github/SUPPORT.md) — how to reach the maintainer
