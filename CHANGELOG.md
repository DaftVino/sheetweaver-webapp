# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.3.1] - 2026-07-03

### Added
- Contextual "?" help links on dashboard error states (Loom Phase 5). Each error now
  carries a small circled "?" that deep-links straight to the matching section of the
  Troubleshooting Guide: setup label/authorization errors, broken Gmail-label and
  broken sheet-tab connections, a sync run that errored, and the auto-sync-off banner.
  Cuts time-to-resolution from "open Help → find guide → search" to one click.
- New "Broken Connection (Gmail Label or Sheet Tab Missing)" section in the
  Troubleshooting Guide, covering label/tab deletion after setup and the Mend flow.
- `scripts/local-verify.js` now fails the build if a contextual link points at a
  Troubleshooting Guide heading that does not exist (anchor-drift guard).

## [2.3.0] - 2026-07-03

Docs got a cleanup pass, and the wizard's success animation actually plays now.

### Fixed
- The wizard's success-screen weave animation now plays as designed: a bug made the
  "The Loom Is Strung!" title reappear the instant a connection was saved, hiding
  nearly the entire ~2.6s thread-weave animation behind it. The title now stays
  hidden until the animation actually finishes.
- The dashboard status line's "next weave" countdown now refreshes every minute
  instead of freezing at whatever it read when the page first loaded.

### Changed
- Documentation reorganized: install and update steps now live in one place (the
  Setup Guide) with every other doc linking to it instead of repeating the
  commands. Fixed a broken link in CONTRIBUTING.md and a stale pointer in
  SUPPORT.md. Updated a handful of doc references still using pre-rename button
  names ("Enable Auto-Sync," "Active Connections") to match the current UI.
- The dashboard status footer is now announced to screen readers as a live
  status region.

## [2.2.0] - 2026-07-03

The loom now tells you it's working. A quiet status line on the dashboard shows when
the next weave will run and how many rows have been woven since install, and the
setup wizard's success screen gets a moment of craft: two threads draw together and
snap into one as your new connection joins the loom.

### Added
- Dashboard status line below the connections table: "Next weave in ~N min · X,XXX
  rows woven," with quieter states for a resting loom, an overdue weave, or a
  brand-new install still awaiting its first run. Hidden entirely with no connections.
- Lifetime rows-woven counter, visible in the status line — counts every row ever
  written across all connections since install, survives connection deletion.
- Thread-weave animation on the wizard's success screen: fires once when a new
  connection is created (never on edits). Two threads draw, tense, and snap into one
  strand that resolves into the "Loom Is Strung!" title — a spark burst in Solar and
  Torres, a race car erasing the thread in the C64 theme. Fully skipped for anyone
  with reduced-motion enabled; a stray error never blocks the wizard.

### Changed
- The 15-minute auto-weave interval is now read from the server on every dashboard
  load rather than assumed client-side, so the status line's countdown can never
  drift from the actual trigger cadence.

## [2.1.1] - 2026-07-03

The app now speaks its own vocabulary: connections are threads, syncing is weaving, the
dashboard is the loom. Foundation tokens for the upcoming loom status line and weave
animation are also in place.

### Added
- `--thread` design token (teal/thread accent) and `--duration-fast`/`--duration-base`
  motion tokens in all three themes, ready for upcoming loom status-line and weave-animation
  features. Not yet used by any element.
- `Start the Loom` button now shows a tooltip spelling out the 15-minute auto-weave
  cadence that its shorter label dropped.

### Changed
- Renamed ~35 user-facing strings across the dashboard, setup wizard, and status
  messages to a consistent loom/weave vocabulary: connections are now "threads,"
  syncing is "weaving," pausing is "resting," repairing is "mending," and the
  dashboard reads as "the loom." Full details in `design/sheetweaver-ui-rename.md`.
- Existing motion durations (120ms/180ms) now reference the new tokens instead of
  repeating the literal values in five separate CSS rules — same values, one source
  of truth. The retro theme's snappier 80ms button press is intentionally unchanged.

## [2.1.0] - 2026-07-03

Registry sharding: removes the hard ~9-connection ceiling that was about to break writes for
every user on this deployment.

### Added
- Per-connection size guard: saving a capture with too many columns/rules now fails with a
  clear message instead of silently corrupting the shared registry.
- Admin debug panel now shows largest-connection size and total store usage, replacing the old
  single-blob byte metric that stopped meaning anything once the registry was sharded.

### Changed
- The connection registry moved from a single Script Property (capped at 9KB total, shared by
  every user) to one property per connection — the practical ceiling goes from ~9 connections to
  roughly 100-200, bound by the ~500KB total Script Properties storage cap rather than the old
  9KB-per-registry hard cap.
- Editing a capture's target Google Sheet URL now updates the same connection in place instead
  of silently creating a duplicate.
- Existing registries migrate automatically and losslessly on first load after this update; the
  original data is preserved as a backup Script Property.

### Fixed
- A corrupted single connection record no longer takes down the whole dashboard for every user —
  the bad record is skipped and logged, everyone else's connections still load.
- Editing/repairing a connection can no longer leave an orphaned duplicate behind.
- Editing a connection's tab name into a match with another of your own connections is now
  rejected with a clear message, instead of silently creating a duplicate that pause/delete/edit
  could never reach again.
- A single oversized connection record failing to migrate no longer blocks the whole registry
  migration (and every user's dashboard) from completing — the bad record is skipped and logged.
- Closed a narrow window, right after this update deploys, where two connections not yet fully
  migrated could silently overwrite each other's sync status instead of being stored separately.
- The per-connection size guard now measures actual storage size correctly for tab names and
  labels containing non-Latin characters (previously it could under-count and let an oversized
  capture through).

## [2.0.5] - 2026-06-30

Cleanup and polish release on top of 2.0.0: in-app help and first-run guidance, header layout
refinements, a server-side refactor pass, and security/robustness hardening.

### Added
- **Help menu** in the header (all views) — a `role="menu"` dropdown linking to the Troubleshooting
  Guide, Setup Guide, First-Time User Guide, Changelog, and a Report-a-Bug shortcut. Full keyboard
  contract (arrow keys within the menu, Escape closes and restores focus to the trigger).
- **App version label** in the header, sourced from `APP_VERSION` and surfaced via existing
  dashboard data (no new on-load RPC).
- **First-time welcome tip** on the dashboard — dismissible, persisted per-user.
- **`docs/first-time-user-flow.md`** — end-user walkthrough, linked from the in-app Help menu.

### Changed
- **Header layout** converted to a grid for predictable alignment of the title, version label, and
  action buttons; Copy Debug / Help button styling unified.
- **Server-side refactor** — `processEmails` and `loadDashboard` god-functions decomposed; registry
  access moved behind an abstraction with consistent lock coverage; constants extracted and dead code
  removed.
- **Faster font loading** via `preconnect` and consistent typography tokens.
- Documentation refreshed across README, ARCHITECTURE, setup-guide, troubleshooting, and qa-runbook.

### Fixed
- **`_showFallback` crash** — `insertBefore` failed when the close button had no rendered sibling;
  the close button is now appended before positioning.
- Mobile viewport meta tag is now emitted server-side in `doGet` so small screens render correctly.
- **`setupSpreadsheet` no longer reports success when it silently failed to save** — a script-lock
  timeout used to be swallowed; it now returns an error so the user can retry.
- A scheduled sync run that couldn't acquire the registry lock used to vanish with no record of
  what happened; it's now logged to Admin Diagnostics.
- Help menu items and the connection-error toast's close button now show a visible keyboard focus
  outline and a consistent "Dismiss notification" label.

### Security
- All client-side string-to-DOM paths converted from template literals to explicit string
  concatenation, removing template-literal interpolation as an injection surface.
- **Connection hijack via shared spreadsheets** — if two users on the same shared spreadsheet
  reused the same tab name, one user's setup could silently delete and replace the other's saved
  connection (losing their capture rules), and a scheduled sync run could write one user's results
  onto the other's connection. Every connection-write path now confirms ownership before touching
  a registry entry.

[2.0.5]: https://github.com/DaftVino/sheetweaver-webapp/releases/tag/v2.0.5

## [2.0.0] - 2026-06-28

First public release. Prior versions were private testing builds, so there is no earlier public
history to diff against.

### Added
- **Copy Debug button** in the app header (all views) — produces a labelled, copy-to-clipboard
  diagnostic block (`=== Sheet Weaver Debug ===`) with app version, user email, per-connection run
  status, and recent client error report IDs, for fast tester→admin handoff.
- **Client-side error capture** — `window.onerror` / `unhandledrejection` and all
  `withFailureHandler` rejections are buffered and routed through `logClientError`, so browser-side
  failures land in Admin Diagnostics with a server report ID.
- **`getDebugSnapshot()`** — non-admin, caller-scoped diagnostics (own connections + trigger state
  only; never exposes other users' data).
- **In-app status system** — themed toasts and a confirmation modal replace every native
  `alert()` / `confirm()`.
- **Dashboard last-sync indicator** — `Last synced … ago · counts` / `Paused` /
  `Waiting for first 15-min sync` / `Never`.
- **Search feedback** — live filtering with result count, clear button, and a "no matching captures"
  empty state.
- **Step progress indicator** for the setup wizard, and a preview expand/collapse with full-value
  tooltips for live examples.
- **HTML email handling** — the capture pipeline detects HTML-only bodies, strips them to plain
  text, logs a warning, and records the detected body type (`lastBodyType`) per run.
- `CHANGELOG.md` (this file).

### Changed
- **Dashboard table** — visible, predictable sorting (active-column highlight + `aria-sort`);
  Edit/Pause/Repair/Delete converted from spans to real focusable `<button>`s with accessible labels;
  row-level loading state instead of replacing the whole table body.
- **Inline validation** before save/verify — field-level messages and focus on the first invalid
  input.
- **Responsive layout** — `@media (max-width:720px)` rules for small screens (scrollable table,
  stacked controls, compact header grid).
- **Accessibility** — modals carry `role="dialog"` / `aria-modal` / `aria-labelledby`, Escape-to-close,
  and a focus trap; initial focus lands on Cancel.
- **Update-check hardening** — `checkForUpdates` now writes a short-TTL backoff before fetching so a
  flaky GitHub endpoint cannot trigger repeated live requests.
- Documentation refreshed across README, ARCHITECTURE, setup-guide, troubleshooting, qa-runbook,
  SUPPORT, CONTRIBUTING, and SECURITY to cover Copy Debug, diagnostics, and the access model.

### Fixed
- Robust plain-text extraction from complex/HTML email formats (previously could mis-extract from
  HTML-only messages).
- Corrected the package license metadata to MIT (matches `LICENSE`).

### Security
- `getDebugSnapshot()` is caller-scoped — no cross-user data exposure.
- DOM updates use `textContent` (no template-literal injection in modal content).

[2.0.0]: https://github.com/DaftVino/sheetweaver-webapp/releases/tag/v2.0.0
