# Setup Guide

Step-by-step instructions for deploying Gmail Tracker Sheet Webapp for the first time.

There are three install paths:

- **[Path A — clasp, brand-new project](#path-a--clasp-brand-new-apps-script-project)** *(recommended)*
- **[Path B — clasp, existing project](#path-b--clasp-existing-apps-script-project)**
- **[Path C — manual copy-paste (no clasp)](#path-c--manual-copy-paste)**

All three paths end at [First-Time User Flow](#first-time-user-flow) and [Update Instructions](#update-instructions).

---

## Prerequisites

| Requirement | Notes |
|-------------|-------|
| Google account | Consumer `@gmail.com` or Google Workspace both work |
| Node.js 18+ | Download from nodejs.org |
| `clasp` CLI | Install globally (see below) — or use `npx clasp` as a per-command alternative |

### Install Node.js and clasp

**Windows (PowerShell):**

```powershell
node --version        # confirm 18+
npm --version         # confirm npm is available
npm install -g @google/clasp
clasp --version       # confirm install succeeded
```

**macOS / Linux (Terminal):**

```bash
node --version
npm --version
npm install -g @google/clasp
clasp --version
```

> **`npx clasp` alternative:** if you prefer not to install `clasp` globally, every `clasp` command in this guide can be replaced with `npx clasp`. You must run `npm install` in the project folder first. The behavior is identical; `npx` just downloads `clasp` on-demand instead of installing it permanently.

---

## Path A — clasp, Brand-New Apps Script Project

Use this path if you are installing the app for the first time and do not already have an Apps Script project.

### 1. Clone and install

**Windows (PowerShell):**

```powershell
git clone <repo-url>
cd "Gmail Tracker Sheet Webapp"
npm install
```

**macOS / Linux:**

```bash
git clone <repo-url>
cd "Gmail Tracker Sheet Webapp"
npm install
```

### 2. Authenticate clasp

```powershell
clasp login
```

This opens a browser window. Sign in with the Google account that will own this Apps Script project. clasp stores credentials in `~/.clasprc.json`.

### 3. Create a new Apps Script project

```powershell
clasp create --type webapp --title "Gmail Tracker Sheet Webapp"
```

clasp writes a `.clasp.json` file with a new `scriptId`. This file is gitignored — do not commit it.

> If `clasp create` is not available, copy the example file manually and fill in a script ID you create at script.google.com:
>
> **Windows:** `copy .clasp.json.example .clasp.json`  
> **macOS/Linux:** `cp .clasp.json.example .clasp.json`
>
> Then edit `.clasp.json` and replace `YOUR_SCRIPT_ID_HERE` with your actual script ID.

### 4. Run the local verification gate

```powershell
npm run verify:local
```

All checks must pass before pushing. Fix any reported failures before continuing.

### 5. Push code to Apps Script

```powershell
clasp push
```

### 6. Run bootstrapAdmin in the Apps Script editor

Open the Apps Script editor:

```powershell
clasp open
```

In the editor, select `bootstrapAdmin` from the function dropdown and click **Run**. This records you as the admin for this instance. It is idempotent — running it more than once has no effect. Only the person who runs it first becomes the admin.

> **Why this step matters:** `bootstrapAdmin` reads `Session.getEffectiveUser()` in the editor context (where your identity is always known) and writes your email as the admin to Script Properties. If run from the web app later, the effective user may differ. Run it from the editor exactly once after first deploy.

### 7. Deploy as a web app

**Option 1 — command line:**

```powershell
clasp deploy --description "Initial deploy"
```

**Option 2 — Apps Script editor:**

1. Click **Deploy → New deployment**
2. Select **Web app**
3. Set **Execute as:** User accessing the web app
4. Set **Who has access:** Anyone with a Google account
5. Click **Deploy** and authorize the requested scopes
6. Copy the web app URL

```powershell
clasp deployments    # lists all deployment URLs
```

Share the web app URL with your team.

### 8. Optional: Workspace-only access

If your team is on Google Workspace and you want to restrict access to your domain only, edit `appsscript.json` before deploying:

```json
"access": "DOMAIN"
```

Redeploy after changing this value.

---

## Path B — clasp, Existing Apps Script Project

Use this path if you already have an Apps Script project you want to update with this codebase.

### 1–2. Clone, install, authenticate

Same as Path A steps 1–2.

### 3. Link to your existing project

```powershell
copy .clasp.json.example .clasp.json
```

```bash
# macOS/Linux
cp .clasp.json.example .clasp.json
```

Open `.clasp.json` and replace `YOUR_SCRIPT_ID_HERE` with the script ID from your Apps Script project URL:
`script.google.com/home/projects/<scriptId>/edit`

Do **not** commit `.clasp.json` — it is gitignored.

### 4–8. Continue as Path A

Follow steps 4–8 from Path A above.

---

## Path C — Manual Copy-Paste

Use this path if you cannot or prefer not to use `clasp`.

### 1. Create a new Apps Script project

Go to [script.google.com](https://script.google.com) → **New project**.

### 2. Add the three source files

In the editor, create (or rename the default `Code.gs` file) and paste the contents from the repo:

| Editor file | Repo file |
|-------------|-----------|
| `Code.gs` | `Code.js` |
| `Index.html` | `Index.html` |
| `appsscript.json` | `appsscript.json` |

To add `Index.html`: click **+ → HTML** and name it `Index`.  
To edit `appsscript.json`: click the **⚙ Project Settings** icon, then **Edit appsscript.json**.

### 3. Run bootstrapAdmin

Select `bootstrapAdmin` from the function dropdown and click **Run**. Authorize when prompted.

### 4. Deploy as a web app

1. Click **Deploy → New deployment**
2. Select **Web app**
3. Set **Execute as:** User accessing the web app
4. Set **Who has access:** Anyone with a Google account
5. Click **Deploy** and complete authorization
6. Copy the web app URL and share it with your team

---

## First-Time User Flow

When a user opens the web app for the first time:

1. They see the Dashboard. If no trigger is active, a yellow banner appears — but the trigger is typically enabled automatically during setup.
2. They click **New Connection**, enter a Gmail label name, and follow the wizard.
3. After saving, the app registers the connection and enables the user's 15-minute sync trigger automatically.
4. If trigger auto-enable fails (rare), a prompt appears to enable it via the dashboard banner.
5. Within ~15 minutes, matching emails are processed and data appears in the configured Sheet.

If anything goes wrong, click the **Copy Debug** button in the top-right corner of any screen and share the output with your admin. The snapshot includes your connection status, recent error report IDs, and browser context.

---

## Optional: Org-Wide Default Sheet URL

By default, users enter their own Sheet URL during setup. The app saves it as their personal default for next time.

If you want new users to see a URL pre-filled, set a Script Property:

**Apps Script editor → Project Settings → Script Properties → Add property:**

- Key: `default_spreadsheet_url`
- Value: `https://docs.google.com/spreadsheets/d/YOUR_SHEET_ID/edit`

This is optional and not recommended — each user's own URL is clearer.

---

## Update Instructions

When a new version of the repo is released, each installer applies the update to their own Apps Script project:

**Windows (PowerShell):**

```powershell
git pull                  # pull the latest changes from the repo
npm install               # only needed if package.json changed
npm run verify:local      # must pass before pushing
clasp push
clasp deploy --description "Update to <version>"
```

**macOS / Linux:**

```bash
git pull
npm install
npm run verify:local
clasp push
clasp deploy --description "Update to <version>"
```

After deploying, open the web app and confirm the Admin Diagnostics panel no longer shows errors from the previous version.

> **Note:** `clasp pull` is NOT the update path. It downloads the Apps Script cloud copy into your local repo (useful for recovering manual edits) but does not apply upstream repo updates. Always use `git pull` to pull updates, then `clasp push` to send them to Apps Script.

### Will an update reset existing users or connections?

No, as long as you update the **same Apps Script project**. `clasp push` and `clasp deploy` update the
code files and deployment version; they do not wipe Script Properties, User Properties, existing
Sheets, or user-created triggers.

Existing connections stay in the `capture_registry` Script Property and should continue to appear and
sync after the update. New fields added by later versions, such as last-run status or sync cursors,
are additive and are filled in as each connection runs.

Users should not need to recreate connections. They may need to reauthorize if the update adds new
OAuth scopes, click **Enable Auto-Sync** if they never had a trigger, or repair/recreate a connection
that was created under an older bug and has missing owner identity or missing backup rules.

If you create a **brand-new Apps Script project** instead of updating the same one, previous
connections, Script Properties, User Properties, and triggers do not come with it. Treat that as a
fresh install unless you intentionally migrate those properties.

---

## Granting Access to Other Developers

Share the Apps Script project via **Apps Script editor → Share** (top-right) with **Editor** access so they can use `clasp push`.

## Re-Deploying After Changes

Every push requires a new deployment version for users to see the update:

```powershell
clasp push
clasp deploy --description "Short description of change"
```

The web app URL remains the same — users do not need a new link.

## GitHub Actions CI Deploy

The repo includes `.github/workflows/deploy.yml` as a **manual-only** workflow (`workflow_dispatch`). It is disabled by default and will not run on push.

If you want to use it for your project:

1. Add `CLASPRC_JSON` as a GitHub Actions secret (copy the contents of `~/.clasprc.json`).
2. Ensure `.clasp.json` in the repo root contains your `scriptId`.
3. Trigger the workflow manually from the Actions tab.

Forks must reconfigure both the secret and the `scriptId` before using the workflow, or the deploy will fail or push to the wrong project.
