---
spec_filed_at: 2026-07-01
spec_branch: main
spec_epic: loom-epic
spec_blocks: [loom-b-status-line]
---

# Loom D — UI vocabulary rename (loom/weave)

## Context

Rename user-facing UI strings to the loom/weave vocabulary so the product speaks its own identity. `design/sheetweaver-ui-rename.md` is the **source of truth** for all mappings, do-not-rename lists, untouched sections, and Rules 1-6 — execute it exactly as written, **except for the four accepted revisions below** (agreed 2026-07-01, they override the doc where they conflict).

Strings-only task: no logic, markup structure, CSS, function names, variable names, storage keys, or API/trigger identifiers change.

## Accepted Revisions (override the source doc)

1. **`Saving...` → `Threading...`** (not `Weaving...`). The doc's own Rule 1 reserves "Weaving" for a sync actively running; the save spinner is a different state and must not share the word.
2. **`Paused` chip → `Resting`** (not `Loom Unspun`). Pairs with the `Rest` row action; "Loom Unspun" reads as the whole loom stopped, which is the separate no-trigger state. Per-thread vs whole-loom states stay distinct.
3. **Delete modal body keeps explicitness:** "This will **permanently delete** '…' from the loom and stop scanning emails for this label." (preserve interpolated label). Title `Cut This Thread?` and button `Yes, Cut the Thread` stay as the doc says — but the word "delete" must survive in the body. Destructive confirms for office staff must be unmistakable.
4. **Auto-sync button text is `Start the Loom` only.** The doc's `Start the Loom (15-min Auto-Weave)` is 10 chars longer than today's button and wraps at phone widths. The "(15-min Auto-Weave)" detail moves to a tooltip/`title` or subtitle line.

## Acceptance Criteria

1. Every mapped string replaced at its source of truth (trace template literals; don't grep rendered text).
2. All interpolated values (`"..."`, counts, versions, error details) preserved exactly (doc Rule 2).
3. Non-visual strings swept: toasts, `aria-label`s, `title` attributes, confirm dialogs (doc Rule 3). `Rest` / `Weave On` carry their tooltips (`Pause weaving` / `Resume weaving`).
4. Final consistency grep for `capture`, `connection`, `sync`, `Dashboard` in user-facing strings: every survivor is on the doc's do-not-rename list or in an untouched section (doc Rule 6) — list survivors in the PR description.
5. Untouched sections verified untouched: Header/Global, Label/Permission Errors, Admin UI, Debug Fallback, table column headers (doc §"Sections to leave entirely untouched").
6. No identifier, storage key, trigger name, or debug payload key changed (doc Rule 4). If any UI string doubles as a stored value, it is mapped at the display layer and flagged in the PR — never migrated.
7. Every renamed button and status chip verified no-wrap/no-overflow at 599px and 360px in all 3 themes (this UI seeds the Gmail add-on port).
8. `docs/troubleshooting.md` and GitHub issue templates updated where they reference renamed UI elements (doc Rule 5), e.g. `docs/standardize-documentation` cross-refs.

## Testing Plan

Manual: full click-through of dashboard, wizard steps 1-3, pause/resume/mend/delete flows, empty states, and search — in all 3 themes, at desktop/599px/360px. Screen-reader spot check on renamed aria-labels (themed strings must make sense without visual context).

## Rollback Plan

Revert the commit. Strings only; no logic or storage entanglement.

## Effort Estimate

~3h: 1.5h tracing + replacing ~35 strings at source + 0.5h docs sweep + 1h three-theme/three-width verification.

## Out of Scope

- Any string in the untouched sections.
- The loom status line strings (child B owns those; B adopts this vocabulary).

## Related

- `design/sheetweaver-ui-rename.md` — full mapping tables.
- Blocks: `issues/loom-b-status-line.md`.
