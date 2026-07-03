# Shard the connection registry past the GAS 9KB per-property cap

Spec archive (source of truth, produced by /spec): `C:\Users\jm3ak\.gstack\projects\DaftVino-SheetWeaver-Webapp\specs\20260701-172821-18012-registry-hits-gas-9kb-per-property-cap-at-9-connections--sha.md`

## Context

SheetWeaver stores every connection in one Script Property, `capture_registry` (`Code.js:48`). Google Apps Script caps a single property value at 9KB; the live deployment is at 6,774 / 9,000 bytes with only 7 connections (~968 bytes each), so ~2 more connections until every registry write throws. `_flushRegistryResults` (`Code.js:1087-1096`) already catches and logs that failure, but sync state is silently dropped when it fires. This is a multi-user deployment: one user adding a connection breaks writes for everyone.

Decisions locked with the owner during /spec:
- Shard to **one Script Property per connection**. (Ceiling revised 2026-07-03 (D7): storage alone allows ~500 connections, but PropertiesService daily read/write quotas (~50k/day) realistically bind around **100-200 connections** with 15-minute syncs — revisit write batching if that range is approached.)
- **Automatic, zero-loss, lazy migration**; original blob preserved as backup.
- Keep the identity triple `(userEmail, spreadsheetUrl, tabName)` and full-URL storage (no openById switch).
- Include a **500-char cap on `lastError`** (same failure class, one line).
- Breaking existing connections is tolerable if migration misbehaves, but the plan is zero-loss anyway.

## Approach

New key scheme (**revised 2026-07-03, eng review D2 — supersedes the MD5-of-triple derivation from /spec**): `capture_conn_<id>` where `<id>` = `conn.id`, a `Utilities.getUuid()` assigned once — at creation in `setupSpreadsheet`, or during migration for existing records. The key never changes after assignment: renames and URL edits overwrite in place, eliminating the delete-old-shard step and the orphan-shard bug class. No digest code, no hex conversion, no `computeDigest` mocks. Matching semantics are unchanged — lookups still use the identity triple via `_connMatches`. The 9KB cap then applies per connection, not per registry.

### 1. Registry helpers — `Code.js:338-344`

- `_connKey(conn)` — `'capture_conn_' + conn.id` (stored UUID; D2).
- `_connMatches(conn, email, tabName, url)` — the single identity-triple predicate (3A); used by all lookups.
- `_readRegistry(props)` — one `props.getProperties()` call, filter keys by `capture_conn_` prefix, parse each shard inside try/catch (corrupt shard → skip, collect into an error out-param; caller logs AFTER lock release — 2A), sort the result by `(userEmail, tabName)` for stable dashboard order (D8), return the **same array shape as today**. If `capture_registry` still exists (migration pending/blocked), reads fall back to parsing the blob directly (D4). The 6 read-only consumers (`getDebugSnapshot:197`, `getDashboardData:349`, `repairConnection:481`, `getEditConfig:496`, `processEmails:1102`, and the duplicate-check scan in `setupSpreadsheet`) then need zero changes.
- `_writeConnection(props, conn)` — `setProperty(_connKey(conn), JSON.stringify(conn))`.
- `_deleteConnectionShard(props, conn)` — `deleteProperty(_connKey(conn))`.
- Remove `_writeRegistry` once all callers are converted (grep for it at the end; no stragglers).

### 2. Explicit, merge-only, zero-loss migration — `_migrateRegistryIfNeeded(props)` (revised per 1A, D3, D4, D5)

Called at each entry point BEFORE any lock is acquired (never from inside `_readRegistry` or a locked section — 1A). Behavior:

- If `capture_registry` absent → no-op (fast path).
- Else acquire `LockService.getScriptLock()`, re-check under lock, then **merge-only** (D3): for each blob record, skip it if an existing shard already matches via `_connMatches` (a live shard always wins — this is what makes the mixed-version deploy window safe); otherwise assign `conn.id = Utilities.getUuid()` and write the shard. Copy the raw blob to `capture_registry_backup_v1`, delete `capture_registry`, release. `lastSyncTime` and `headerConfigs` carry over byte-identical.
- **Corrupt blob (D5):** wrap the blob `JSON.parse` in try/catch — on failure, copy the raw text to `capture_registry_backup_v1`, delete `capture_registry`, `logDiag('ERROR', ...)` (after release), continue with existing shards. Never brick the app on a bad blob.
- **Lock failure (D4):** if `tryLock` fails while the blob still exists, MUTATING entry points return `{success:false, error:'Update in progress, please retry.'}`; READ paths proceed via `_readRegistry`'s blob fallback.
- **Cutover procedure (D3, belt-and-suspenders):** pause the `processEmails` trigger, `clasp push`, bump the live deployment version, load the dashboard once, re-enable the trigger. The merge-only code makes a fumbled cutover non-corrupting; the procedure makes it clean.

### 3. Write-path conversion (the four RMW sites)

| Site | Line | Change |
|---|---|---|
| `togglePauseConnection` | `Code.js:410-424` | after mutating `conn.isPaused`, call `_writeConnection(props, conn)` instead of `_writeRegistry` |
| `deleteConnection` | `Code.js:449-462` | replace filter+rewrite with `_deleteConnectionShard(props, conn)` |
| `setupSpreadsheet` | `Code.js:787-816` | keep the all-shard scan for the cross-user duplicate check (`:797-800`); with the UUID key, edits/renames find the existing record (via `conn.id` passed through the edit flow — D9: `getEditConfig` returns it, `setupSpreadsheet` accepts an optional `id` and updates that record regardless of tab/URL changes, reusing its key) and overwrite in place — no delete-old-shard step. New records get `conn.id = Utilities.getUuid()`. **Size guard (D6):** before write, reject with `{success:false, error:'This capture has too many columns/rules to save (limit ~9KB). Remove some columns.'}` when `JSON.stringify(conn).length >= 9000` |
| `_flushRegistryResults` | `Code.js:1068-1100` | re-read fresh, apply `recordConnectionRun` + `lastSyncTime`/`syncCursor`, then `_writeConnection` **only the updated shards**; keep the try/catch around each write but collect failures and `logDiag` AFTER lock release (1A) |

Keep the existing `ScriptLock` pattern on every multi-step write, unchanged. Disjoint shards additionally remove the cross-user lost-update surface.

### 4. `lastError` cap — `Code.js:112`

In `recordConnectionRun`: `conn.lastError = result.error ? String(result.error).substring(0, 500) : null;`. Full text stays reachable via the `reportId` diag entry.

### 5. Admin health panel

- `getAdminDiagnostics` (`Code.js:162-179`): replace single-blob metrics with `{ connectionCount, perUserCounts, largestConnBytes, largestConnTab, perConnCap: 9000, totalStoreBytes, totalStoreCap: 500000, hasTrigger }`. Compute from the same `getProperties()` snapshot — no new RPC (GAS-quota rule in CLAUDE.md). `totalStoreBytes` counts key names + values (that is how the 500KB store is metered — D10).
- `Index.html:2197-2218`: update the renderer for the new shape (largest connection vs 9,000 + total store vs 500,000). Use existing CSS tokens; no hardcoded values.

## Files modified

- `Code.js` — helpers + migration (~`:338`), `recordConnectionRun` (`:112`), `getAdminDiagnostics` (`:162-179`), the four write sites listed above.
- `Index.html` — registry-health renderer only (`:2197-2218`).

## Eng review amendments (approved 2026-07-03, /plan-eng-review)

1. **Migration is explicit and pre-lock (1A).** Migration moves OUT of `_readRegistry` into `_migrateRegistryIfNeeded(props)`, called at each entry point BEFORE any lock is acquired. `_readRegistry` stays pure (read + parse only). The `logDiag` call at `Code.js:1095` moves outside the locked section — collect errors during the critical section, log after release. Rationale: GAS LockService reentrancy is undocumented; nested acquire/release (migration or `logDiag` inside an outer lock) could release the outer critical section early.
2. **Corrupt-shard tolerance (2A).** `_readRegistry` wraps each shard's `JSON.parse` in try/catch: a corrupt shard is skipped, not fatal. Consistent with 1A, corrupt-shard errors are collected into an out-param and logged by the caller AFTER any lock release (never `logDiag` inside `_readRegistry`, which may run under a caller's lock).
3. **Centralized identity (3A).** New `_connMatches(conn, email, tabName, url)` helper replaces the six inline triple predicates (`Code.js:418, 457, 459, 485, 500, 1080`); with the UUID key it is also the merge-only migration's dedup predicate.
4. **Automated coverage (4A — full set).** `scripts/local-verify.js` changes are in-scope for this phase:
   - **Harness fixes (mandatory — the sharding diff breaks it):** add `getProperties()` to the GAS property mocks (`local-verify.js:84-88, 243-249`); re-point assertions from the `capture_registry` key to shard keys (`:176, :193, :273`); the cross-user hijack regression (commit `1e6fc9f`) must stay green against sharded storage.
   - **Migration tests:** blob → shards + backup + registry-key delete; second read is idempotent (no re-migration).
   - **Lock-failure checks (TODOS.md P1, folded in):** `togglePauseConnection`/`deleteConnection` return `{success:false, error:'Could not acquire lock.'}` and leave shards unmodified when `tryLock()` is false.
   - **Behavior checks (7):** corrupt-shard skip; rename leaves no orphan shard; flush writes only updated shards; `lastError` truncated to 500; delete removes the shard property; pause writes only its own shard; admin health shape.
5. **Second review pass — all outside-voice items resolved (2026-07-03, D2-D10; all recommended options accepted):**
   - **D2 — UUID shard key** (supersedes /spec's MD5 derivation; see Approach). Closes OV#4 (computeDigest signed-byte pitfall) outright.
   - **D3 — merge-only migration + documented cutover** (OV#1): live shard wins over blob record (matched via `_connMatches`); cutover = pause trigger → push → bump deployment → load once → re-enable.
   - **D4 — migration lock-failure semantics** (OV#2): mutating entry points return a retry error while the blob exists; reads fall back to the blob.
   - **D5 — corrupt source blob tolerated** (OV#5): backup raw, delete key, log, continue.
   - **D6 — 9KB per-connection guard in `setupSpreadsheet`** (OV#8) with plain-English rejection; headerConfigs pruning captured in `issues/TODOS.md`.
   - **D7 — honest ceiling** (OV#6): 100-200 connections quota-bound, not 500.
   - **D8 — deterministic ordering** (OV#9): `_readRegistry` sorts by `(userEmail, tabName)`.
   - **D9 — id-through-edit-flow** (OV#10): `getEditConfig` returns `conn.id`; `setupSpreadsheet` updates by id, so URL-change edits no longer ghost a record.
   - **D10 — realistic test fixtures** (OV#11): registry tests seed foreign keys (`diag_*`, `admin_email`, `update_check_*`) and assert exclusion; `totalStoreBytes` counts keys + values.
   - **Additional local-verify checks from D2-D10:** merge-only migration (pre-existing shard survives a re-migration attempt); migration retry-error on lock failure; corrupt-blob path; size-cap rejection; stable sort order; URL-change edit updates in place.

## Verification (manual — no test framework in this repo)

1. **Migration**: `clasp push`, load dashboard once. In Apps Script editor → Project Settings → Script Properties, confirm: 7 `capture_conn_*` keys, `capture_registry` gone, `capture_registry_backup_v1` present; dashboard renders all 7 connections identically; spot-check `lastSyncTime`/`headerConfigs` in a shard vs the backup blob. Reload — migration does not re-run.
2. **CRUD flows** against sharded storage: create, edit/rename AND edit changing the target URL (same shard updated in place via `conn.id`, exactly one `capture_conn_*` key before and after — D2/D9), pause/resume, delete (shard property removed), repair, timed sync run, debug snapshot.
3. **Scale**: script-console loop creating 15 connections — no write errors (old ceiling ~9).
4. **Concurrency**: trigger a sync while toggling pause from the UI for a different user's connection — both persist.
5. **lastError cap**: force a sync error with a long message; stored value ≤500 chars, diag entry keeps full text.
6. **UI**: debug panel shows the new metrics in all three themes (Solar, Torres, C64); keyboard nav unaffected.

## Rollback

Redeploy previous version; copy `capture_registry_backup_v1` back into `capture_registry`; delete all `capture_conn_*` properties. Connections created post-migration are lost on rollback (accepted by owner).

## Out of scope

- openById / spreadsheet-ID identity switch
- Run-metadata or diag-log redesign
- Automated test framework
- headerConfigs redundancy pruning (outside voice 2026-07-03 #8 — would break repairConnection; captured in `issues/TODOS.md`)

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 0 | — | — |
| Codex Review | `/codex review` | Independent 2nd opinion | 1 (Claude subagent fallback) | issues_found | 11 findings (3×P1, 5×P2, 3×P3) — all 11 resolved by owner 2026-07-03 |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 2 | clean | 15 issues; 4 amendments (1A/2A/3A/4A) + 9 owner decisions (D2-D10) all folded into plan |
| Design Review | `/plan-design-review` | UI/UX gaps | 0 | — | — |
| DX Review | `/plan-devex-review` | Developer experience gaps | 0 | — | — |

- **CROSS-MODEL:** Both reviewers agreed the core sharding design was sound with migration/lock discipline as the risk center. The one tension (shard-key scheme) was resolved by the owner in favor of the outside voice's stored-UUID key (D2), superseding the /spec MD5 derivation.
- **VERDICT:** ENG CLEARED — ready to implement. All amendments and owner decisions are folded into the plan body above; both prior critical gaps (mixed-version deploy window, migration lock-failure) are closed by D3/D4.

NO UNRESOLVED DECISIONS
