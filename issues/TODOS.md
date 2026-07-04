# TODOS

## Loom E/F ambient background (2026-07-03)

### Manual QA matrix for the ambient weave + dot-glow wave

**Priority:** P1

**What:** The visual/manual acceptance criteria for Loom E/F (v2.4.0) are still unverified on a live deployment: steady-state density ~2-3 threads (AC4/5), no jank at 4× CPU throttle / Moto-G class (AC8), 360px width (AC10), Safari private mode (AC12), rAF-idle performance trace (AC13), and the 3-themes × steps × reduced-motion-toggle sweep. The ship test plan artifact lives at `~/.gstack/projects/DaftVino-SheetWeaver-Webapp/jm3ak-feat-loom-ef-ambient-background-ship-test-plan-20260703-120000.md`.

**Why:** Everything vm-testable is covered by `local-verify.js`, but animation aesthetics and real-device performance can only be judged in a browser. Deferred at ship time by explicit choice ("ship, QA after").

## Deferred from registry-sharding eng review (2026-07-03)

### Prune headerConfigs redundancy from connection records

**What:** `conn.headerConfigs` duplicates the column rules already stored in sheet header notes (`_processSingleConnection` parses rules from notes at `Code.js:1197`, not from the registry — line numbers shift as this file changes, refer to the function name if this drifts again). The registry copy is used only by `repairConnection` as a backup. Storing it separately (or dropping it with a repair redesign) shrinks each record by the majority of its bytes.

**Why:** headerConfigs is the bulk of each ~968-byte record. Pruning buys 3-4× headroom against both the 9KB per-connection cap and the PropertiesService quota-bound ceiling (~100-200 connections).

**Cons / blocker:** `repairConnection` (`Code.js:716`, function name won't drift even if the line number does) depends on the registry copy — pruning without a repair redesign breaks it. Needs its own small design pass.

**Context:** Surfaced by the outside voice during the 2026-07-03 /plan-eng-review of the sharding plan (finding #8). The interim mitigation shipped in Phase 1 is the 9KB size guard in `setupSpreadsheet` (D6).

**Depends on / blocked by:** registry sharding (Phase 1) landing first; a decision on how repair works without the registry copy.

## Completed

### Contextual "?" links on dashboard error states

**What:** Inline "?" help links on each dashboard error state, deep-linking to the matching `troubleshooting.md` section.

**Completed:** v2.3.1 (2026-07-03), Loom Phase 5 — `feat/contextual-error-links`. Added a `TROUBLESHOOT_ANCHORS` map + `_troubleshootLink()` helper and wired a circled "?" link at all 5 error surfaces (setup label/auth error, broken Gmail-label, broken sheet-tab, sync-run-errored, auto-sync-off banner). Added a new "Broken Connection (Gmail Label or Sheet Tab Missing)" section to `troubleshooting.md` for the two broken states, plus a `local-verify.js` anchor-drift guard. Spec + eng review: `issues/contextual-error-links-spec.md`. Manual visual/a11y QA (3 themes × 3 viewports) still pending on the live deployment.

### getDashboardData() over-exposes connection metadata to non-owners

**What:** `getDashboardData()` sent `lastRunReportId`/`lastDurationMs` for every connection to every caller regardless of ownership — dead data for non-owned rows, never rendered anywhere in `Index.html`.

**Completed:** `fix/registry-security-and-reliability-gaps` (2026-07-03) — those two fields are now included only for the caller's own connections. Every other field (userEmail, gmailLabel, spreadsheetUrl, lastError, lastCounts, etc.) is unchanged for all rows, since those are actively used by the dashboard's existing team-visibility feature; restricting those further remains an open product question, not addressed by this fix.

### Enforce the 500KB total-store cap

**What:** `getAdminDiagnostics`'s `registryHealth.totalStoreBytes`/`totalStoreCap` (500KB) was reported but never enforced on any write path.

**Completed:** `fix/registry-security-and-reliability-gaps` (2026-07-03) — `setupSpreadsheet` now hard-blocks a new connection save (mirroring the existing 9KB per-connection guard, D6) if it would push the total store over the cap. Only blocks net growth: in-place edits/repairs of existing connections are never blocked, even when the store is already at/over cap. Migration and per-shard writes (`_writeConnection`) intentionally remain pure tally/report paths, unchanged.

### Recovery path for connection records that fail migration

**What:** A record whose shard write failed during migration vanished silently — `capture_registry` was deleted unconditionally regardless of per-record failures, and the failure log only captured `tabName` (not unique across users).

**Completed:** `fix/registry-security-and-reliability-gaps` (2026-07-03) — the failure log payload now includes `userEmail`/`spreadsheetUrl`, and `getAdminDiagnostics` surfaces a `registryHealth.migrationFailures` summary derived from the diagnostic event log it already fetches (no new RPC, no new persistent state). Accepted limitation: `DIAG_MAX` (50) caps the event log, so a very old failure can still scroll out of visibility before an admin checks — documented in code, not blocking.

### Test coverage for lock-acquire-failure paths in togglePauseConnection/deleteConnection

**What:** `scripts/local-verify.js` has no check that `togglePauseConnection`/`deleteConnection` return `{success:false, error:'Could not acquire lock.'}` (and leave the registry unmodified) when `LockService.getScriptLock().tryLock()` fails.

**Completed:** v2.1.0 (2026-07-03) — added as part of the registry sharding work (which touched both functions anyway); shards are confirmed unmodified on lock failure.
