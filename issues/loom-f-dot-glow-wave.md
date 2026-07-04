---
spec_filed_at: 2026-07-03
spec_branch: feat/loom-b-c-phase3
spec_epic: loom-epic
spec_depends_on: []
---

# Loom F — Dot-glow wave (screen-open sweep)

## Context

When the main screen opens, a band of brighter dots sweeps once from the top-center
down and out to the outer bottom, following the same elliptical shape as the existing
light bloom, then fades. It reads as "the loom energizes" on arrival — a one-shot
flicker of craft, distinct from Loom E's continuous ambient threads.

**Design finalized 2026-07-03** in `design/mockups/loom-threads-mockup.html` (the
"Dot-glow wave" control group + `playWave()`/`bandMask()`/`#dotWave`). That mockup is
the visual source of truth; the locked values below are its defaults.

This is a **separate feature from Loom E** (`issues/loom-e-ambient-thread-weave.md`).
Loom E is a perpetual thread animation; Loom F is a one-shot background sweep on open.
They share the dot grid and coexist.

## Current State (verified 2026-07-03)

- **Dot grid**: painted by a fixed, full-viewport `#loomBackdrop` layer (`z-index: -2`), `radial-gradient(rgba(255,255,255,0.055) 1px, transparent 1px)`, `background-size: 24px 24px`, dot centers at `(12 + 24i, 12 + 24j)` from the viewport top-left. Hardcoded white for all themes. (`#dotWave` registers exactly on it.)
- **Light bloom**: the second body gradient, `radial-gradient(ellipse 80% 55% at 50% -5%, var(--bg-glow) 0%, transparent 70%)` — top-center origin. This feature mirrors that origin/shape, extended further down.
- **Reduced-motion**: global CSS sledgehammer at `Index.html:279-284` neutralizes CSS motion but not JS rAF; this feature needs its own `matchMedia` guard.
- **Main screen**: step-0 (dashboard). Wizard steps 1-3 are separate `.step` blocks.

## Trigger (decided)

Plays once each time the **main screen (step-0) becomes visible** — on initial page
load, and when the user returns to step-0 from the wizard. Debounced so rapid
re-entry does not stack sweeps (ignore a re-trigger while a sweep is already running).
Not on wizard steps.

**Integration point:** call `playWave()` from `nextStep(0)` (the `.step` switcher, per
`CLAUDE.md`) and once from the initial step-0 render on load. Guard with a running-flag
so a `nextStep(0)` fired while a sweep is mid-flight is a no-op (the debounce above).

## Final Design (decided 2026-07-03 — zero implementer choices)

### Concept

A dimmer second copy of the dot grid (`#dotWave`), registered exactly on the base
grid (same 24px tiling → same dot centers). A brightness **band** expands from the
top-center out past the bottom edge, masked to an ellipse that mirrors the bloom's
origin. The band's dots are brighter than the base grid; where the band isn't, dots
are at baseline. When the band exits, the layer **fades out** (transient sweep).

### Structure

- One full-viewport `<div id="dotWave">`: `position: fixed; inset: 0; pointer-events: none; z-index: -1` (above the body dot-grid background, behind the app card and all UI — same layer as Loom C's `#weaveDots` and Loom E's canvas).
- `background-image: radial-gradient(rgba(255,255,255,<peakGlow>) <dotSize>px, transparent <dotSize>px)`; `background-size: 24px 24px`. **Peak brightness is the dots' own alpha** (`peakGlow`), not element opacity — so it can read clearly over the faint 0.055 base.
- The **band** is the CSS `mask-image`, an expanding elliptical ring rebuilt each frame: `radial-gradient(ellipse 110% <reach>% at 50% -8%, transparent <crest−band>%, #000 <crest>%, transparent <crest+band>%)`. `crest` travels `0 → 100+bandWidth` (%) over `sweepMs`, so the ring expands from top-center and exits past the bottom.
- Element `opacity` carries only the tail fade (full during the sweep; ramps to 0 over the last 20% of `sweepMs`). Brightness and fade are decoupled.
- rAF-driven, one-shot. No layout properties animated, no reflow.

### Choreography

```
t=0        band crest at top-center (0%), opacity 1
0 → 80%    crest expands outward through the viewport, dots along the band bright
80 → 100%  crest exits past the bottom; opacity ramps 1 → 0
t=sweepMs  #dotWave opacity 0 (grid back to baseline)
```

Total ≈ `sweepMs` (1400ms).

### Locked parameters (canonical — freeze these values)

```json
{
  "peakGlow": 0.3,
  "dotSize": 1,
  "sweepMs": 1400,
  "bandWidth": 15,
  "reach": 115,
  "ending": "fade-out"
}
```

Units: `peakGlow` = white-dot alpha at the band crest (0-1; base grid is 0.055, so
0.3 ≈ 5.5× the base); `dotSize` px (radius of the wave dots; base is 1px); `sweepMs`
total sweep time; `bandWidth` = half-thickness of the bright band as % of the mask
radius; `reach` = mask ellipse height %. `ending` = `fade-out` (the sweep passes and
the grid returns to baseline). A `stay-lit` alternative (settle into a steady
top-down glow) is a one-line change but is **not** the chosen behavior.

### Invariants

- One-shot per step-0 entry; debounced against overlap; never runs on wizard steps.
- All three themes: the wave dots are white (matching the base grid, which is white in every theme); only the intensity changes.
- `prefers-reduced-motion: reduce`: the sweep **does not run** — no animation. Checked via `matchMedia` before starting. (No static fallback is shown; the grid stays at baseline.)
- `z-index: -1`: never intercepts input (`pointer-events: none`), never occludes UI.
- Motion is mask/opacity only — no layout, no reflow. Uses no `localStorage`, no server call, no on-load RPC.
- Additive isolation: removing the `#dotWave` div + its CSS/JS restores today's background exactly.
- `mask-image` is required (modern Chrome/Safari/Firefox all support it; safe for this GAS webapp). If unsupported, the layer simply never shows — no error, graceful.
- **Coexists with three `z-index: -1` layers**: Loom C's `#weaveDots`, Loom E's `#threadCanvas`, and this `#dotWave`. Paint order among them is DOM order; it is visually immaterial (all three are additive/transparent where nothing is drawn), but the markup pins the order for determinism. None occlude the others' effect.

## Acceptance Criteria

1. On opening step-0 (load, and returning from the wizard) a brighter dot band sweeps once from top-center to past the bottom, then fades to baseline — in all three themes.
2. The wave's shape and origin match the light bloom (top-center ellipse); the band reaches the outer bottom before fading.
3. Peak brightness reads clearly above the base grid (≈5× at `peakGlow` 0.3) without washing out the card or UI.
4. With OS reduced-motion enabled: no sweep runs; the grid stays at baseline; no errors.
5. Re-entering step-0 rapidly does not stack overlapping sweeps (debounced).
6. The layer never intercepts clicks and never renders above the card, toasts, or `_showFallback`.
7. No dropped-frame jank at 360px or under 4× CPU throttle; mask/opacity-only verified.
8. Removing the feature restores today's static background exactly.
9. Safari private mode: no errors.

## Testing Plan

Manual (reference: `design/mockups/loom-threads-mockup.html`, "🌊 Play wave" button
replays it; the Dot-glow wave slider group matches the locked values):

- Open step-0 in each theme; confirm the sweep plays once, correct shape, fades out.
- Return to step-0 from the wizard; confirm it replays; hammer the transition to confirm no stacked sweeps.
- OS reduced-motion ON: no sweep, no error, grid at baseline.
- 360px width + 4× CPU throttle: smooth, no scrollbar.
- Trigger with Loom E threads running: both coexist; z-order correct (both behind the card).
- Safari private mode: no console errors.

## Rollback Plan

Delete the `#dotWave` div, its CSS rule, and the `playWave()` JS. No state, no server,
no markup dependencies. Static dot grid returns unchanged.

## Effort Estimate

~1.5h: 0.5h port `#dotWave` + CSS + `playWave()`/`bandMask()` into `Index.html`;
0.25h wire the step-0-show trigger + debounce; 0.25h reduced-motion guard; 0.5h QA
(themes × reduced-motion × 360px × Safari × coexist-with-Loom-E).

## Out of Scope

- Continuous/looping variants (this is one-shot per open).
- The `stay-lit` steady-glow ending (explored in the mockup, not chosen).
- Coupling to Loom E, or reacting to threads/cursor/scroll.
- Tokenizing the base dot color per theme.

## Related

- Sibling: `issues/loom-e-ambient-thread-weave.md` (continuous threads; shares the dot grid, coexists).
- Epic: `issues/loom-epic.md`.
- Design source of truth: `design/mockups/loom-threads-mockup.html` (Dot-glow wave controls; "🌊 Play wave").
- Mirrors the light bloom at `Index.html:259`.
