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
