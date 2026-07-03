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

**What:** `conn.headerConfigs` duplicates the column rules already stored in sheet header notes (`processEmails` parses rules from notes at `Code.js:917`, not from the registry). The registry copy is used only by `repairConnection` as a backup. Storing it separately (or dropping it with a repair redesign) shrinks each record by the majority of its bytes.

**Why:** headerConfigs is the bulk of each ~968-byte record. Pruning buys 3-4× headroom against both the 9KB per-connection cap and the PropertiesService quota-bound ceiling (~100-200 connections).

**Cons / blocker:** `repairConnection` (`Code.js:481-494`) depends on the registry copy — pruning without a repair redesign breaks it. Needs its own small design pass.

**Context:** Surfaced by the outside voice during the 2026-07-03 /plan-eng-review of the sharding plan (finding #8). The interim mitigation shipped in Phase 1 is the 9KB size guard in `setupSpreadsheet` (D6).

**Depends on / blocked by:** registry sharding (Phase 1) landing first; a decision on how repair works without the registry copy.

## Deferred from /ship pre-landing review (2026-06-30)

### Test coverage for lock-acquire-failure paths in togglePauseConnection/deleteConnection

**What:** `scripts/local-verify.js` has no check that `togglePauseConnection`/`deleteConnection` return `{success:false, error:'Could not acquire lock.'}` (and leave the registry unmodified) when `LockService.getScriptLock().tryLock()` fails.

**Why:** This is the same class of bug just fixed for `setupSpreadsheet` in commit 6b1366d ("silently reported success on lock-acquire failure"). A future refactor could silently drop the `tryLock` guard in these two functions and nothing would catch it.

**Priority:** P1

**Context:** Flagged by the testing specialist during /ship's pre-landing review (2026-06-30). Deferred rather than fixed inline to keep that ship run focused — the isAdmin/response-shape/localStorage-convention checks were added instead as the higher-value, cheaper wins from the same review pass.
