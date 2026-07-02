---
spec_filed_at: 2026-07-01
spec_branch: main
spec_epic: loom-epic
spec_depends_on: [loom-a-foundation-tokens]
---

# Loom C — Thread weave animation

## Context

`design/DESIGN.md:63`: on wizard completion, a teal thread animation expresses the
weave concept — modern, sleek, not distracting. **Visual quality is the primary
acceptance bar.** Depends on child A for `var(--thread)` and `var(--duration-base)`.

**Design finalized 2026-07-02** through interactive iteration in
`design/mockups/loom-weave-mockup.html`. That mockup is the visual source of truth —
its `runWeave()` function and `#weaveOverlay`/`#weaveDots` CSS blocks are the
portable core. The design evolved substantially from the original single-thread
over-under sketch; the sections below describe the final decided choreography.

## Current State (verified 2026-07-01)

- Success screen: `#step-3` at `Index.html:854-855` (`Success!` → `The Loom Is Strung!` after child D). Shown after `setupSpreadsheet` succeeds.
- `prefers-reduced-motion: reduce` guard exists at `Index.html:269`.
- z-index hierarchy (must not break): `#statusToast` 11000 > `#debugCopiedToast` 10500 > `_showFallback` overlay 9999.
- Dot grid: body background, 24px pitch, dots at `(12+24i, 12+24j)`, `rgba(255,255,255,0.055)` (Solar values, `design/DESIGN.md:30`).

## Trigger (decided)

Fires when `#step-3` is shown after a **new** connection save. Not on edit-saves,
not on revisits, exactly once per creation. Rationale: it marks "a thread joined
the loom"; the success screen is a dead-end pause where the motion blocks nothing.

## Final Design (decided 2026-07-02 — zero implementer choices)

### Concept

Two threads draw toward each other from opposite ends, interlace as a two-strand
braid, tense (bulge), snap into one solid strand, then resolve into the success
title: the strand retreats into a single dot that bursts into sparks exactly where
"Success!" fades in. The words emerge from the thread.

### Structure

- Full-viewport `<svg>` overlay: `position: fixed; inset: 0; pointer-events: none; z-index: 9000` (below `_showFallback` 9999 and all toasts).
- Companion dot-swell layer: fixed `<div>` at `z-index: -1` replicating the body dot grid (`radial-gradient(<dot-color> 1.5px, transparent 1.5px)`, 24px tiles — same tiling registers exactly on the body's dots, drawn slightly larger).
- Geometry is anchored to the success `<h2>`, measured via `getBoundingClientRect()`: baseline `y0` = title center; line span = **25% of viewport width**, centered on the title center. No grid snapping (snapping the endpoints de-centers the line by up to half a pitch).
- The success title starts hidden (`opacity: 0`) and fades in (500ms ease) as the animation's final beat. The hidden state must be applied by the feature itself at trigger time and guaranteed reversible: reduced-motion, any caught error, and the cleanup path all show the title.

### Choreography (all values final)

| Phase | Duration | Detail |
|-------|----------|--------|
| 1. Draw | 1000ms ease | Two 2px `var(--thread)` sinusoidal paths, **amplitude 10px, wavelength 120px**, opposite phase (mirrored). Thread A draws left→right, thread B right→left, simultaneously, via `stroke-dasharray`/`stroke-dashoffset`. Dot-swell layer fades 0 → 0.75 opacity over the same 1000ms (grid brightens ~75% as the loom "energizes"). |
| 2. Bulge | 350ms `cubic-bezier(0.34,1.2,0.64,1)` | Wave group scales vertically about the baseline to **1.5×** amplitude (`transform: scale(1, 1.5)`, `transform-origin` on the baseline). `vector-effect: non-scaling-stroke` keeps strokes 2px. |
| 3. Snap | 260ms `cubic-bezier(0.8,0,1,1)` | Waves collapse to `scale(1, 0.01)` — fully flat. Then a **single-frame swap**: waves to `opacity: 0`, merged straight line (2px, same baseline) to `opacity: 1`. No crossfade — at flat scale the threads are pixel-identical to the line, so nothing is ever visible at two heights at once. |
| 4. Plump | 200ms `cubic-bezier(0.34,1.3,0.64,1)` | Merged strand thickens 2px → **5px** (the "thunk" of merging). |
| 5. Hold | **0ms Solar/Torres; 750ms C64** | C64 needs the stage time for the race car (below). |
| 6a. Ending — Solar/Torres | 450ms + 340ms | Strand retreats from both ends into its center via `transform: scale(0.004, 1)`, 450ms `cubic-bezier(0.55,0,0.85,0.4)` (non-scaling stroke + round caps keep it a 5px dot). Then **9 sparks** (radii alternating 2.8px/2px, `var(--thread)`) scatter from the center, distributed across the measured title width, mostly horizontal (±7px vertical jitter, small random variance per run), fading over 340ms `cubic-bezier(0.2,0.6,0.4,1)`. Title fade-in starts at spark launch. Dot-swell layer fades back to 0 across the ending. |
| 6b. Ending — C64 | 930ms linear | 🏎️ emoji (22px, `aria-hidden`, separate fixed div, z-index 9000) drives right→left along the strand over `hold + 180ms` = 930ms, fading over its second half so it is fully transparent as it reaches the left end. The strand erases right→left in its wake via `stroke-dasharray`, trailing **100px** behind the car (clamped to the line length on narrow viewports). Title fades in after the wake completes. No collapse, no sparks. |

Total: ~2.6s (Solar/Torres), ~3.2s (C64).

### Invariants

- `stroke-linecap: round`; `body.theme-nes` overrides to `square` (blockiness is the theme's identity). Thread colors per theme: Solar `#2dd4bf`, Torres `#5eead4`, C64 `#b9432f` (all via `var(--thread)`).
- **No end cap** on the strand — knot/swatch/shuttle/spool terminations were explored in the mockup and rejected.
- All motion is stroke/opacity/transform only — no layout properties animated, no reflow.
- Entire feature wrapped in try/catch: any failure = no animation, title shown immediately, wizard flow completely unaffected.
- `prefers-reduced-motion: reduce`: the animation **does not run at all** — no shortened version, no static frame; the title simply appears. Check via `matchMedia` before creating any node.
- Cleanup removes the SVG overlay, the dot-swell div, and the car div. `transitionend` listener **plus** a 5s `setTimeout` fallback guarantees removal (worst case ~3.2s + fade leaves headroom).
- Feature uses no localStorage.

## Acceptance Criteria

1. Fires exactly once per new-connection success; never on edit-saves; never on returning to the success step via navigation quirks.
2. With OS reduced-motion enabled: no animation nodes are created, and the success title is visible immediately.
3. Correct `--thread` color and linecap in all 3 themes; race car appears **only** in C64.
4. The snap reads as one continuous motion — no frame where wavy threads and the straight strand are visible at different heights.
5. Line, collapse point, and spark spread are horizontally centered on the "Success!" title; sparks span the title's rendered width.
6. Dot-swell layer registers exactly on the body dot grid (no double-vision offset) and returns to baseline intensity by the end.
7. No dropped-frame jank on a mid-range phone (Moto G-class or 4x CPU-throttled devtools); stroke/opacity/transform-only verified.
8. Overlay never intercepts clicks (`pointer-events: none`) and never outlives 5s worst-case (fallback timer). Title can never be stranded hidden (error and reduced-motion paths show it).
9. z-index stays below 9999 — a toast or fallback overlay appearing mid-animation renders above it.
10. Renders correctly at 360px width: line scales to viewport, C64 wake clamps to line length, no horizontal scrollbar.
11. Removing the feature's CSS/JS block restores today's behavior exactly, including an always-visible title (additive isolation).
12. Safari private mode: no errors.

## Testing Plan

Manual: create a connection in each theme (3 runs — verify burst ending in Solar/Torres, car ending in C64); edit-save a connection (must NOT fire); keyboard-only completion run; OS reduced-motion on (title appears instantly); devtools 360px + 4x CPU throttle; Safari private mode; trigger a toast during the animation (z-order check). Reference visual: `design/mockups/loom-weave-mockup.html` (Replay + 4× slow buttons).

## Rollback Plan

Delete the additive CSS/JS block. No state, no server involvement, no markup dependencies elsewhere.

## Effort Estimate

~4h: 1.5h porting the mockup's `runWeave()` core into `Index.html` (geometry is settled) + 1h trigger wiring (new-vs-edit discrimination) + 0.5h title-reveal wiring with fail-safe paths + 1h QA matrix (themes × widths × reduced-motion × Safari).

## Out of Scope

- Any recurring/ambient animation (the loom status dot glow in child B is static).
- Sound, haptics, confetti-class effects beyond the decided 9-spark burst.
- Using the animation anywhere but new-connection success.
- End-cap ornaments (explored, rejected).

## Related

- Depends on: `issues/loom-a-foundation-tokens.md`.
- Design source of truth: `design/mockups/loom-weave-mockup.html` (interactive; final values are its defaults).
- Visual bar reference: `design/DESIGN.md` §Aesthetic Direction ("Someone made this. Calm competence with a flicker of craft."). Note: DESIGN.md:63's original "one second" sketch is superseded by this spec's ~2.6s choreography, decided by the owner during mockup iteration on 2026-07-02.
