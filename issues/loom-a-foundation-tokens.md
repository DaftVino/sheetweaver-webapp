---
spec_filed_at: 2026-07-01
spec_branch: main
spec_epic: loom-epic
spec_blocks: [loom-b-status-line, loom-c-weave-animation]
---

# Loom A — Foundation: `--thread` token + motion duration tokens

## Context

Both loom features (status line, weave animation) need the reserved `--thread` "data in motion" color. It exists only in the mockup (`design/theme_previews.html:43,66,82`) — it is **not** in `Index.html`'s token layer. `design/DESIGN.md:50` also records motion duration tokens (120/180ms) as approved-but-unapplied; they are folded in here because the animation (child C) needs duration tokens anyway.

## Current State (verified 2026-07-01)

- `Index.html:12` — `:root` token block; no `--thread`, no duration tokens.
- `Index.html:94` — `body.theme-torres` overrides; no `--thread`.
- `Index.html:134` — `body.theme-nes` overrides; no `--thread`.
- Ad-hoc duration literals at `Index.html:252, 283, 325, 343, 425` (and possibly more — grep is the source of truth).
- `Index.html:211` — NES button press `80ms` (exempt: the snap is the theme's personality, `DESIGN.md:50`).

## Proposed Change

| File | Change |
|------|--------|
| `Index.html:12` (`:root`) | Add `--thread: #2dd4bf;`, `--duration-fast: 120ms;`, `--duration-base: 180ms;` |
| `Index.html:94` (`body.theme-torres`) | Add `--thread: #5eead4;` |
| `Index.html:134` (`body.theme-nes`) | Add `--thread: #b9432f;` |
| `Index.html` — full grep sweep for `120ms` and `180ms` | Replace literals with `var(--duration-fast)` / `var(--duration-base)`; known sites: 252, 283, 325, 343, 425 |
| `Index.html:211` | **Do NOT touch** — NES 80ms press stays literal |
| `design/DESIGN.md:50` | Update "(approved-but-unapplied)" note to applied |

Rule: `--thread` is exclusively for data-in-motion (active syncs, progress, the loom). **Never on buttons** (`DESIGN.md:35`).

## Acceptance Criteria

1. `--thread` resolves to the correct value in all 3 themes (devtools computed-style check).
2. Grep for `120ms|180ms` in `Index.html` returns zero literals except documented exemptions (80ms at :211 is out of pattern; list any other intentional survivors in the PR description).
3. Zero visual change: hover/transition behavior identical in all 3 themes before vs after (pure refactor + token addition).
4. `--thread` is consumed by nothing yet — this issue adds the token only.

## Testing Plan

Manual (no test framework, per `CLAUDE.md`): theme-switch through all three themes; hover buttons, table rows, help menu; confirm transitions feel identical. Safari private mode smoke check.

## Rollback Plan

Revert the commit. Pure additive/refactor; no state, no server.

## Effort Estimate

~1h: 15min token additions + 30min grep sweep/replace + 15min three-theme verification.

## Out of Scope

- Using `--thread` anywhere (children B and C do that).
- Tokenizing the NES 80ms press.
