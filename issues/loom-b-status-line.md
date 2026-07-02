---
spec_filed_at: 2026-07-01
spec_branch: main
spec_epic: loom-epic
spec_depends_on: [loom-a-foundation-tokens, loom-d-ui-vocabulary-rename]
---

# Loom B — Loom status line

## Context

A quiet footer on the dashboard giving ambient proof the loom runs: "Next weave in ~7 min · 1,204 rows woven" (`design/DESIGN.md:64`, mockup `design/theme_previews.html:172-177,239`). This is the "set it up once, trust it forever" feeling made visible. Depends on child A (`--thread` token) and child D (vocabulary).

## Current State (verified 2026-07-01)

- Per-connection `lastRunAt` / `lastRunStatus` / `lastRunReportId` persisted at `Code.js:109-111`; `triggerActive` returned at `Code.js:402-403`.
- **No rows-written counter exists anywhere.** `processEmails` appends rows (`newRows` write at `Code.js:1002-1003`) without tallying.
- `processEmails` already acquires `LockService.getScriptLock()` at `Code.js:1069` before ScriptProperties writes.
- `getDashboardData` (`Code.js:349-403`) is the single on-load RPC; `CLAUDE.md` forbids adding another.

## Proposed Change

### Server (`Code.js`)

- New **ScriptProperties** key `loom_total_rows_woven` — integer as string; absent key reads as 0. Deployment-wide (shared by all staff — decided 2026-07-01; per-user counts would show each person a different number, which reads as a bug).
- `processEmails`: accumulate the count of appended rows across all connections in the run (the `newRows.length` values at the `Code.js:1002-1003` write sites), then perform **one** counter read-increment-write per run, **inside the existing script lock** held at `Code.js:1069` (race-safe with zero new locking).
- Write failure = silent undercount: wrap in try/catch, `logDiag('WARN', 'processEmails:loomCounter', ...)`, never throw. The counter is ambient trust copy, not billing data.
- Counter semantics: **since-install total**, persists forever, survives connection deletion, no week-rollover logic, no migration (starts at 0 on first increment).
- `getDashboardData` piggybacks one new field on its return object (`Code.js:403`): `totalRowsWoven` (int). Next-weave math needs no new field — per-connection `lastRunAt` is already returned. **No new RPC.**

### Client (`Index.html`)

- New footer line inside `#step-0` (`Index.html:706`) below the connections table — dashboard only (same visibility regime as `.landing-only` content; it lives inside `#step-0` so step visibility already handles it).
- Markup/style per mockup `theme_previews.html:172-177`: small dot in `var(--thread)` with subtle glow, muted text (`--text-muted`), `font-variant-numeric: tabular-nums` on the count, thousands separator via `toLocaleString()`.
- Plain static text — **no** `aria-live` region (it updates only on dashboard load; a live region would announce noise).
- State machine (evaluated from `getDashboardData` payload):

| Condition | Rendered string |
|---|---|
| `triggerActive` && any `lastRunAt` && next weave ≥ 1 min out | `Next weave in ~N min · 1,204 rows woven` |
| `triggerActive` && any `lastRunAt` && overdue (now > max(lastRunAt) + 15 min) | `Weaving soon · 1,204 rows woven` |
| `triggerActive` false (loom stopped) | `The loom is resting — start Auto-Weave to resume` |
| Connections exist, no `lastRunAt` on any | `Awaiting first weave` |
| Zero connections | Line hidden entirely |

- `N = ceil((max(lastRunAt) + 15 min − now) / 60s)`, clamped to minimum 1. All timestamps compared client-side from the ISO strings already in the payload.

## Acceptance Criteria

1. Counter increments by exactly the number of rows appended in a run (manual verification against the sheet's row-count delta for a run with known matching emails).
2. Two users' triggers running near-simultaneously do not lose increments (single lock-protected read-modify-write per run; verify by code inspection + dual-trigger test).
3. Counter write failure does not fail the run (simulate by inspection: try/catch present, WARN diag logged).
4. All 5 UI states render the exact strings above; interpolated count and minutes correct.
5. Count renders tabular-nums with thousands separator.
6. Correct rendering in all 3 themes; C64 dot is square (radius 0 is the theme's identity), Solar/Torres dot is round with glow.
7. No layout shift or overflow at 599px and 360px.
8. `getDashboardData` payload change is backward-compatible: client code guards `totalRowsWoven === undefined` (old server / cached client mismatch during deploy window) by hiding the count segment.
9. No new on-load RPC (quota rule).
10. Counter persists after deleting all connections and re-creating one.

## Testing Plan

| Layer | What | How |
|---|---|---|
| Server manual | Counter accuracy, lock safety, fail-silent | Known-email run + row delta; inspect lock scope; force-throw in counter write |
| UI manual | 5 states × 3 themes × 3 widths | Toggle trigger, fresh install, populated install |
| Regression | Dashboard load unchanged for old payloads | Stub payload without `totalRowsWoven` |

## Rollback Plan

Remove the footer markup/JS and the increment block; the stale `loom_total_rows_woven` ScriptProperties key is inert and can remain (or be deleted via Apps Script console).

## Effort Estimate

~4h: 1h server (accumulate + locked write + piggyback) + 1.5h client states/styling + 1.5h manual QA matrix.

## Out of Scope

- Weekly/rolling-window counts (rejected: since-install total avoids rollover logic).
- Per-user counters.
- Live-updating countdown (static on load is the design: quiet, not a timer widget).

## Related

- Depends on: `issues/loom-a-foundation-tokens.md`, `issues/loom-d-ui-vocabulary-rename.md`.
