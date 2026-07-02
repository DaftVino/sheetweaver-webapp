---
spec_issue_number:
spec_issue_url:
spec_filed_at: 2026-07-01T21:28:21Z
spec_branch: main
spec_plan_mode: active
spec_executed: false
spec_worktree_path:
---

# Registry hits GAS 9KB per-property cap at ~9 connections — shard to one Script Property per connection

## Context

SheetWeaver stores every connection (Gmail label -> sheet tab mapping plus column rules and sync state) in a single Script Property, `capture_registry` (`Code.js:48`). Google Apps Script caps each property value at 9KB. The deployment is at 6,774 / 9,000 bytes (75%) with only 7 connections, averaging ~968 bytes each -- roughly 2 more connections before every write path starts throwing. This is a multi-user deployment, so the ceiling is shared: one user adding a connection can break writes for everyone.

## Current State (verified 2026-07-01)

- `_readRegistry` / `_writeRegistry` (`Code.js:338-344`) serialize the entire connection array into the one property.
- Each record (`Code.js:802-812`) stores: `userEmail`, `gmailLabel`, `tabName`, full `spreadsheetUrl` (~100 chars), `sheetId`, `isPaused`, `initialSync`, `lastSyncTime`, `headerConfigs` (the bulk), plus run metadata added by `recordConnectionRun` (`Code.js:108-116`) -- including unbounded `lastError`.
- The failure is already anticipated: `_flushRegistryResults` (`Code.js:1087-1096`) catches the write failure and logs it, but sync state (`lastSyncTime`, `syncCursor`) is silently dropped -- the same window re-scans every run.
- Total Script Properties store cap is 500KB; only the single 9KB value is the bottleneck.

Registry touchpoint audit (all 10 consumers):

| Function | Line | Access | Change needed |
|---|---|---|---|
| `getAdminDiagnostics` | 151 | read raw (byte health) | new health shape |
| `getDebugSnapshot` | 197 | read, filter by user | none (reads via `_readRegistry`) |
| `getDashboardData` | 349 | read all | none |
| `togglePauseConnection` | 410 | locked RMW | write one shard |
| `deleteConnection` | 449 | locked RMW | delete one shard |
| `repairConnection` | 481 | read | none |
| `getEditConfig` | 496 | read | none |
| `setupSpreadsheet` | 787 | locked upsert | delete old shard + write new |
| `_flushRegistryResults` | 1068 | locked RMW | write only updated shards |
| `processEmails` | 1102 | read | none |

## Proposed Change

Shard the registry: one Script Property per connection, key `capture_conn_<hash>` where `<hash>` = hex MD5 (via `Utilities.computeDigest`) of `userEmail + '|' + spreadsheetUrl + '|' + tabName`. The 9KB cap then applies per connection; the 500KB store supports ~500 connections.

### Implementation details

1. Helpers (`Code.js:338-344`): `_readRegistry(props)` calls `props.getProperties()` once, filters keys by the `capture_conn_` prefix, parses each, returns the same array shape as today -- the 6 read-only consumers need zero changes. Add `_connKey(conn)`, `_writeConnection(props, conn)`, `_deleteConnectionShard(props, conn)`.
2. Write paths: `togglePauseConnection` and `_flushRegistryResults` write only the mutated connection's shard; `deleteConnection` deletes its shard; `setupSpreadsheet` deletes the old-key shard (rename case via `originalTabName`) and writes the new one. The existing `ScriptLock` pattern stays on every multi-step write -- the cross-user duplicate-tab check in `setupSpreadsheet:797-800` still scans all shards under lock.
3. Migration (automatic, zero-loss, lazy): inside `_readRegistry`, if `capture_registry` exists -- acquire script lock, re-check, write each record to its shard, copy the original blob to `capture_registry_backup_v1`, delete `capture_registry`, release. Runs exactly once on the first read after deploy; every entry point goes through `_readRegistry`, so no manual step. `lastSyncTime` and `headerConfigs` carry over byte-identical.
4. `lastError` cap: truncate to 500 chars in `recordConnectionRun` (`Code.js:112`); full text remains reachable via the `reportId` diag entry.
5. Admin health panel: `registryHealth` (`Code.js:172-179`) becomes `{ connectionCount, perUserCounts, largestConnBytes, largestConnTab, perConnCap: 9000, totalStoreBytes, totalStoreCap: 500000, hasTrigger }`; update the renderer at `Index.html:2197-2218`. No new on-load RPC -- piggybacks on the existing `getAdminDiagnostics` call, per the GAS-quota constraint in CLAUDE.md.

## Acceptance Criteria

1. First dashboard load after deploy migrates: 7 `capture_conn_*` properties exist, `capture_registry` is deleted, `capture_registry_backup_v1` holds the original blob, and all 7 connections render identically.
2. `lastSyncTime` and `headerConfigs` in each shard are byte-identical to the backup blob's values (spot-check via Apps Script editor -> Project Settings -> Script Properties).
3. 15 connections can be created without any write error (old hard ceiling was ~9).
4. Each of these works against sharded storage: create, edit/rename (old shard removed, no orphan), pause/resume, delete (shard property removed), repair, timed sync run, debug snapshot.
5. A sync-trigger write for user A does not clobber a concurrent pause toggle by user B (shards are disjoint; lock retained).
6. `lastError` stored value is <=500 chars even when the thrown error is longer; the diag entry keeps the full text.
7. Admin debug panel shows largest-connection bytes vs 9,000 and total store bytes vs 500,000; the old single-blob "6,774 / 9,000" metric is gone.
8. Second and subsequent reads do not re-run migration (backup key present + registry key absent short-circuits).
9. No new on-load RPC added.

## Testing Plan (manual -- no test framework in this repo)

| Layer | What | Count |
|---|---|---|
| Migration | Deploy against live 7-connection blob; verify criteria 1, 2, 8 | 3 checks |
| CRUD | Criterion 4's seven flows, each verified in Script Properties | 7 checks |
| Scale | Script-console loop creating 15 connections | 1 check |
| Concurrency | Trigger sync + simultaneous pause toggle from UI | 1 check |
| UI | Debug panel in all three themes (Solar, Torres, C64) | 3 checks |

## Rollback Plan

Redeploy the previous version, copy `capture_registry_backup_v1`'s value back into `capture_registry`, delete all `capture_conn_*` properties. Connections created after migration are lost on rollback -- acceptable per the owner (breaking existing connections is tolerable; users re-create).

## Effort Estimate

~6h human / ~20 min CC: helpers + migration 2h, write-path refactor 2h, health panel + Index.html 1h, manual QA 1h.

## Out of Scope

- Switching `openByUrl`/URL-based identity to spreadsheet IDs (marginal savings, large blast radius)
- Redesigning run-metadata storage or the diag log
- Any automated test framework
