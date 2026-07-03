# TODOS

## Deferred from help-and-ux.md (2026-06-30)

### Contextual "?" links on dashboard error states

**What:** Add inline "?" help links to each dashboard error state (e.g. "Gmail access denied → ?" links directly to the troubleshooting.md#gmail-access section).

**Why:** Users hitting specific errors currently have to (1) open the Help dropdown, (2) find Troubleshooting Guide, (3) ctrl+F for the error. Contextual links would take them directly to the relevant section, reducing time-to-resolution.

**Current state:** The Help dropdown (from help-and-ux.md) provides one-click access to the Troubleshooting Guide. This covers the gap acceptably for the current release. Contextual links are the next level of fidelity.

**Pros:**
- Dramatically reduces time-to-resolution for common error states
- Each error becomes self-documenting
- Natural upgrade path once troubleshooting.md is stable

**Cons:**
- Requires mapping each error type/state to a specific doc section anchor
- troubleshooting.md heading anchors must be stable (GitHub doesn't guarantee anchor stability on heading changes)
- ~6-8 error states to map; medium implementation effort

**Context:** Deferred in CEO plan (scope complexity). Deferred again in eng review (Help dropdown covers the gap). Pick this up after the first-time-user-flow.md doc stabilizes — the same anchor-mapping discipline applies.

**Depends on / blocked by:** troubleshooting.md must have stable, named anchors for each error state.

## Deferred from registry-sharding eng review (2026-07-03)

### Prune headerConfigs redundancy from connection records

**What:** `conn.headerConfigs` duplicates the column rules already stored in sheet header notes (`_processSingleConnection` parses rules from notes at `Code.js:1197`, not from the registry — line numbers shift as this file changes, refer to the function name if this drifts again). The registry copy is used only by `repairConnection` as a backup. Storing it separately (or dropping it with a repair redesign) shrinks each record by the majority of its bytes.

**Why:** headerConfigs is the bulk of each ~968-byte record. Pruning buys 3-4× headroom against both the 9KB per-connection cap and the PropertiesService quota-bound ceiling (~100-200 connections).

**Cons / blocker:** `repairConnection` (`Code.js:716`, function name won't drift even if the line number does) depends on the registry copy — pruning without a repair redesign breaks it. Needs its own small design pass.

**Context:** Surfaced by the outside voice during the 2026-07-03 /plan-eng-review of the sharding plan (finding #8). The interim mitigation shipped in Phase 1 is the 9KB size guard in `setupSpreadsheet` (D6).

**Depends on / blocked by:** registry sharding (Phase 1) landing first; a decision on how repair works without the registry copy.

## Deferred from registry-sharding adversarial review (2026-07-03)

### Enforce (or alert on) the 500KB total-store cap

**What:** `getAdminDiagnostics`'s `registryHealth.totalStoreBytes`/`totalStoreCap` (500KB) is reported in the admin panel but nothing actually checks it on any write path. Sharding removed the old single-9KB-blob ceiling but replaced it with an unbounded number of per-connection shards; nothing stops the total script-property store (shared across every user) from creeping toward GAS's real ~500KB ceiling as connections accumulate across the whole deployment.

**Why:** Once the real GAS quota is crossed, every `PropertiesService.setProperty` call for every user starts throwing — a store-wide outage, not a per-user one. Today's per-connection guard (D6) prevents any single record from being the cause, but says nothing about aggregate growth.

**Pros:**
- Turns a silent, deployment-wide failure mode into a proactive admin alert or hard stop
- The metric already exists in `getAdminDiagnostics` — this is surfacing/enforcing it, not building new plumbing

**Cons:**
- This is a policy decision (hard cap on new connections? alert threshold? per-user quota?), not a one-line fix
- No current deployment is anywhere near this ceiling, so it's not urgent

**Context:** Surfaced by the Claude adversarial subagent during the 2026-07-03 `/ship` pre-landing review of the sharding work.

**Depends on / blocked by:** none technically; needs a design decision on the enforcement policy before implementation.

### Recovery path for connection records that fail migration

**What:** `_migrateRegistryIfNeeded` now skips and logs (rather than crashing on) a record whose shard write throws mid-migration, but `capture_registry` is still deleted unconditionally afterward. The failed record survives only in the forensic `capture_registry_backup_v1` blob — the affected user's connection silently disappears from their dashboard and stops syncing, with no in-app error, until an admin manually reconstructs a shard from the backup JSON.

**Why:** This is the right tradeoff for preventing a store-wide migration-retry-loop outage (see the `_migrateRegistryIfNeeded` fix in this same release), but it trades a total outage for a silent per-user data-loss-looking state with no documented recovery runbook.

**Pros:**
- Small, scoped fix: either a documented manual-recovery runbook, or a lightweight "N connections failed to migrate, contact admin" surface in the dashboard/admin panel

**Cons:**
- Needs a decision on whether this belongs in-product (dashboard notice) or is purely an admin/support runbook concern

**Context:** Surfaced by the Claude adversarial subagent during the 2026-07-03 `/ship` pre-landing review, alongside the migration write-loop try/catch fix it's a direct consequence of.

**Depends on / blocked by:** none; ready to design whenever prioritized.

## Completed

### Test coverage for lock-acquire-failure paths in togglePauseConnection/deleteConnection

**What:** `scripts/local-verify.js` has no check that `togglePauseConnection`/`deleteConnection` return `{success:false, error:'Could not acquire lock.'}` (and leave the registry unmodified) when `LockService.getScriptLock().tryLock()` fails.

**Completed:** v2.1.0 (2026-07-03) — added as part of the registry sharding work (which touched both functions anyway); shards are confirmed unmodified on lock failure.
