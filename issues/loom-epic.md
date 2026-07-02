---
spec_filed_at: 2026-07-01
spec_branch: main
spec_type: epic
spec_children: [loom-a-foundation-tokens, loom-d-ui-vocabulary-rename, loom-b-status-line, loom-c-weave-animation]
---

# EPIC — The Loom: make the weaving identity an event

## Context

`design/DESIGN.md:61-65` sanctions "The Loom" as the approved future direction: the weaving-the-grid identity becomes an event, not just a backdrop. The app is moving from internal working-tool to a product pushed to other companies. Current audience is company office staff; the next milestone is porting this UI into a Gmail add-on, so **mobile rigor (599px and 360px) is mandatory on every child issue** — this UI is the basis for that port.

## Child Issues

| # | File | Title | Priority | Effort | Dependencies |
|---|------|-------|----------|--------|--------------|
| A | `issues/loom-a-foundation-tokens.md` | Foundation: `--thread` + motion tokens | Critical (blocks B, C) | ~1h | none |
| D | `issues/loom-d-ui-vocabulary-rename.md` | UI vocabulary rename (loom/weave) | High | ~3h | none |
| B | `issues/loom-b-status-line.md` | Loom status line | High | ~4h | A (token), D (vocabulary) |
| C | `issues/loom-c-weave-animation.md` | Thread weave animation | Medium | ~4h | A (token) |

## Dependency Graph

```
A ─┬─> B
   └─> C
D ───> B

(A ∥ D can run in parallel; then B ∥ C in either order)
```

## Sequencing Rationale

A and D touch disjoint surfaces (CSS token layer vs UI strings) — safe in parallel, zero merge risk. B consumes both: it renders `--thread` (A) and speaks the loom vocabulary (D). C only needs A. No child blocks on server work except B. Reordering B before D would ship status-line strings that immediately need renaming.

## Definition of Done

1. All four child issues closed.
2. All three themes (Solar, Torres, C64) visually verified per child.
3. All loom UI verified at 599px and 360px viewport widths.
4. `prefers-reduced-motion` path verified (animation skipped entirely; success title still appears — see child C).
5. No new on-load RPC introduced (GAS daily-quota rule, `CLAUDE.md`).

## Out of Scope

- The Gmail add-on port itself (next project; this epic only keeps its 360px constraint honest).
- General mobile layout audit beyond the loom elements.
- Theme system changes (three themes, one token vocabulary — unchanged).

## Related

- `design/DESIGN.md` §"Sanctioned future direction" and Decisions Log 2026-07-01.
- `design/theme_previews.html` — visual mockup of the status line and `--thread` values.
- `design/mockups/loom-weave-mockup.html` — interactive mockup of the weave animation; child C's visual source of truth (design finalized 2026-07-02).
- `design/sheetweaver-ui-rename.md` — source doc for child D (with 4 accepted revisions, see D).
