# SheetWeaver UI Text Rename — Loom/Weave Theme

**Task:** Rename user-facing UI strings to the loom/weave vocabulary below. This is a string-replacement task only — no logic, markup structure, CSS, function names, variable names, storage keys, or API/trigger identifiers change. `processEmails`, PropertiesService keys, sheet column data, and debug/report payload field names are all off-limits.

## Canonical vocabulary

Use these terms consistently everywhere, including inside error messages (errors keep a plain tone but use the new nouns):

| Concept | Themed term |
|---|---|
| Capture / Connection | Thread |
| Sync (verb/noun) | Weave / Weaving |
| Dashboard | The Loom |
| Auto-Sync | Auto-Weave |
| Repair | Mend |

## String replacements

Match strings exactly as they appear in source (they may be split across template literals or i18n keys — find the source of truth for each, don't just grep rendered text).

### Dashboard

| Current | New |
|---|---|
| `Active Connections` | `Active Threads` |
| `+ Add a new capture` | `+ Weave a New Thread` |
| `Search connections by email, label, or tab...` | `Search threads by email, label, or tab...` |
| `Last Sync` | `Last Weave` |
| `Click "+ Add a new capture" to start tracking emails into your spreadsheet.` | `Click "+ Weave a New Thread" to start weaving emails into your spreadsheet.` |
| `No matching captures for "..."` | `No threads match "..."` (preserve the interpolated search term) |

### Status chips

| Current | New |
|---|---|
| `Connected` | `Threaded` |
| `Paused` | `Loom Unspun` |
| `Waiting for first 15-min sync` | `Awaiting first weave (~15 min)` |
| `Never` | `Not yet woven` |
| `Auto-Sync is Active: Your emails are being captured automatically every 15 minutes.` | `The Loom is Running: your emails are woven in automatically every 15 minutes.` |
| `Enable 15-Min Auto-Sync` | `Start the Loom (15-min Auto-Weave)` |

Do NOT rename: `Team`, `Broken`, `No Access`, `Sheet not shared with user`.

### Row actions

| Current | New |
|---|---|
| `Pause` | `Rest` (add/keep tooltip: `Pause weaving`) |
| `Resume` | `Weave On` (add/keep tooltip: `Resume weaving`) |
| `Repair` | `Mend` |
| `Updating…` | `Re-threading…` |
| `Enabling...` | `Stringing the loom...` |

Do NOT rename: `Edit`, `Delete`.

### Modals

| Current | New |
|---|---|
| `Confirm Deletion` | `Cut This Thread?` |
| `Are you sure you want to delete the capture configuration for "..."? This will stop scanning emails for this label.` | `This will cut "..." from the loom and stop scanning emails for this label.` (preserve interpolated label name) |
| `Yes, Delete Capture` | `Yes, Cut the Thread` |

Do NOT rename: `Cancel`, `OK`.

### Setup Step 1

| Current | New |
|---|---|
| `← Back to Dashboard` | `← Back to the Loom` |
| `Scanning Emails...` | `Gathering threads...` |

Do NOT rename: `Enter the Gmail Label name to capture:`, `Label Name`, `Verify & Scan Label`, `Verifying...`.

### Setup Step 2

| Current | New |
|---|---|
| `First Sync Fetch` | `First Weave` |
| `Accept & Update Tab` | `Accept & Weave Into Tab` |

Do NOT rename anything else in Step 2 or the rule builder — field labels (`Column Header`, `Header Name`, `Target Spreadsheet URL`, etc.), fetch options, delimiter options, and data types stay literal. `Capture Pattern` / `Pattern` stay as-is (already on-theme).

### Save / Sync messages

| Current | New |
|---|---|
| `Saving...` | `Weaving...` |
| `Auto-sync has been enabled automatically.` | `Auto-Weave is on — the loom runs every 15 minutes.` |
| `Auto-sync could not be enabled automatically — click Enable Auto-Sync from the dashboard.` | `Auto-Weave could not be enabled — click Start the Loom from the dashboard.` |

Do NOT rename: `A Google Sheet URL is required.`, `Add at least one custom capture rule before saving.` (but change `capture rule` → `thread rule` for noun consistency), `Save Error: ...`, `Error: ...`.

### Success screen

| Current | New |
|---|---|
| `Success!` | `The Loom Is Strung!` |
| `Return to Dashboard` | `Return to the Loom` |

## Sections to leave entirely untouched

- Header/Global (Help menu, Copy Debug, debug-copy flow, theme-save warning)
- Label/Permission Errors (all strings)
- Admin UI / Admin Diagnostics (all strings)
- Debug Fallback UI (all strings)
- Table column headers: `Creator Email`, `Gmail Label`, `Spreadsheet Tab`, `Gmail Status`, `Sheet Status`, `Actions`

Rationale: error and diagnostic text must stay literal for troubleshooting and support tickets.

## Rules & edge cases

1. **Distinct states must stay distinct.** `Threaded` = healthy/idle; `Weaving` = sync actively running. Never use "Weaving" for an idle-but-connected state.
2. **Preserve interpolation.** Any string with a dynamic value (`"..."`, counts, versions, error details) keeps its placeholder/template variable exactly.
3. **Sweep non-visual strings too.** Update matching text in toasts, `aria-label`s, `title` attributes, and confirm dialogs. Themed strings in aria-labels must still make sense without visual context — that's why `Rest`/`Weave On` require their tooltips.
4. **UI text only.** Do not touch identifiers, storage keys, trigger names, log/event level names, or debug payload keys. If a UI string doubles as a stored value (e.g., a status string persisted to the registry), map it at the display layer instead of changing the stored value — flag it rather than migrating data.
5. **Docs follow the UI.** Update the Troubleshooting Guide and GitHub issue template wording where they reference renamed UI elements (`Add a new capture`, `Enable Auto-Sync`, `Repair`, etc.) so support vocabulary matches.
6. **Consistency check before finishing.** Grep for leftover `capture`, `connection`, `sync`, `Dashboard` in user-facing strings (excluding the untouched sections above) and confirm each remaining instance is intentional.
