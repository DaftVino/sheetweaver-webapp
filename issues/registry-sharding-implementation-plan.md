# Shard the connection registry past the GAS 9KB per-property cap

Spec archive (source of truth, produced by /spec): `C:\Users\jm3ak\.gstack\projects\DaftVino-SheetWeaver-Webapp\specs\20260701-172821-18012-registry-hits-gas-9kb-per-property-cap-at-9-connections--sha.md`

## Context

SheetWeaver stores every connection in one Script Property, `capture_registry` (`Code.js:48`). Google Apps Script caps a single property value at 9KB; the live deployment is at 6,774 / 9,000 bytes with only 7 connections (~968 bytes each), so ~2 more connections until every registry write throws. `_flushRegistryResults` (`Code.js:1087-1096`) already catches and logs that failure, but sync state is silently dropped when it fires. This is a multi-user deployment: one user adding a connection breaks writes for everyone.

Decisions locked with the owner during /spec:
- Shard to **one Script Property per connection** (~500-connection ceiling via the 500KB total store).
- **Automatic, zero-loss, lazy migration**; original blob preserved as backup.
- Keep the identity triple `(userEmail, spreadsheetUrl, tabName)` and full-URL storage (no openById switch).
- Include a **500-char cap on `lastError`** (same failure class, one line).
- Breaking existing connections is tolerable if migration misbehaves, but the plan is zero-loss anyway.

## Approach

New key scheme: `capture_conn_<hash>` where `<hash>` = hex MD5 of `userEmail + '|' + spreadsheetUrl + '|' + tabName` via `Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, ...)`. The 9KB cap then applies per connection, not per registry.

### 1. Registry helpers — `Code.js:338-344`

- `_connKey(conn)` — computes the hash key from the triple.
- `_readRegistry(props)` — one `props.getProperties()` call, filter keys by `capture_conn_` prefix, parse each, return the **same array shape as today**. The 6 read-only consumers (`getDebugSnapshot:197`, `getDashboardData:349`, `repairConnection:481`, `getEditConfig:496`, `processEmails:1102`, and the duplicate-check scan in `setupSpreadsheet`) then need zero changes.
- `_writeConnection(props, conn)` — `setProperty(_connKey(conn), JSON.stringify(conn))`.
- `_deleteConnectionShard(props, conn)` — `deleteProperty(_connKey(conn))`.
- Remove `_writeRegistry` once all callers are converted (grep for it at the end; no stragglers).

### 2. Lazy zero-loss migration (inside `_readRegistry`)

If `capture_registry` exists: acquire `LockService.getScriptLock()`, re-check under lock, write each record to its shard, copy the raw blob to `capture_registry_backup_v1`, delete `capture_registry`, release. Runs once on the first read after deploy — every entry point flows through `_readRegistry`, so no manual step. `lastSyncTime` and `headerConfigs` carry over byte-identical. Subsequent reads short-circuit (registry key absent).

### 3. Write-path conversion (the four RMW sites)

| Site | Line | Change |
|---|---|---|
| `togglePauseConnection` | `Code.js:410-424` | after mutating `conn.isPaused`, call `_writeConnection(props, conn)` instead of `_writeRegistry` |
| `deleteConnection` | `Code.js:449-462` | replace filter+rewrite with `_deleteConnectionShard(props, conn)` |
| `setupSpreadsheet` | `Code.js:787-816` | keep the all-shard scan for the cross-user duplicate check (`:797-800`); delete the old shard for the `originalTabName` rename case, then `_writeConnection` the new record |
| `_flushRegistryResults` | `Code.js:1068-1100` | re-read fresh, apply `recordConnectionRun` + `lastSyncTime`/`syncCursor`, then `_writeConnection` **only the updated shards**; keep the try/catch + `logDiag` around each write |

Keep the existing `ScriptLock` pattern on every multi-step write, unchanged. Disjoint shards additionally remove the cross-user lost-update surface.

### 4. `lastError` cap — `Code.js:112`

In `recordConnectionRun`: `conn.lastError = result.error ? String(result.error).substring(0, 500) : null;`. Full text stays reachable via the `reportId` diag entry.

### 5. Admin health panel

- `getAdminDiagnostics` (`Code.js:162-179`): replace single-blob metrics with `{ connectionCount, perUserCounts, largestConnBytes, largestConnTab, perConnCap: 9000, totalStoreBytes, totalStoreCap: 500000, hasTrigger }`. Compute from the same `getProperties()` snapshot — no new RPC (GAS-quota rule in CLAUDE.md).
- `Index.html:2197-2218`: update the renderer for the new shape (largest connection vs 9,000 + total store vs 500,000). Use existing CSS tokens; no hardcoded values.

## Files modified

- `Code.js` — helpers + migration (~`:338`), `recordConnectionRun` (`:112`), `getAdminDiagnostics` (`:162-179`), the four write sites listed above.
- `Index.html` — registry-health renderer only (`:2197-2218`).

## Verification (manual — no test framework in this repo)

1. **Migration**: `clasp push`, load dashboard once. In Apps Script editor → Project Settings → Script Properties, confirm: 7 `capture_conn_*` keys, `capture_registry` gone, `capture_registry_backup_v1` present; dashboard renders all 7 connections identically; spot-check `lastSyncTime`/`headerConfigs` in a shard vs the backup blob. Reload — migration does not re-run.
2. **CRUD flows** against sharded storage: create, edit/rename (old shard removed, no orphan), pause/resume, delete (shard property removed), repair, timed sync run, debug snapshot.
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
