---
spec_filed_at: 2026-07-03
spec_branch: feat/loom-b-c-phase3
spec_epic: loom-epic
spec_depends_on: [loom-a-foundation-tokens]
---

# Loom E — Ambient thread weave (background, all pages)

## Context

The dot-matrix page background (`Index.html:257-260`) is static. This adds a quiet,
perpetual ambient animation on **every** page/step: faint wavy "S" threads that draw
between two dots of the grid, hold, and fade — the loom idea, running softly behind
the whole app instead of only at success.

**This intentionally reverses a prior scope decision.** Loom C
(`issues/loom-c-weave-animation.md:104`) explicitly scoped out "any recurring/ambient
animation." The owner has since decided they want an ambient background effect. Loom C
(one-shot success weave) is unaffected and continues to live alongside this.

**Design finalized 2026-07-03** through interactive iteration in
`design/mockups/loom-threads-mockup.html`. That mockup is the visual source of truth —
its `makeThread()`/`drawThread()`/`frame()` functions and the locked parameter block
below are the portable core. Visual quality is the primary acceptance bar.

## Current State (verified 2026-07-03)

- **Dot grid**: now painted by a fixed, full-viewport `#loomBackdrop` layer (`z-index: -2`) instead of the body background, so it always covers 100% of the screen and registers exactly with the fixed thread/wave layers. `radial-gradient(rgba(255,255,255,0.055) 1px, transparent 1px)`, `background-size: 24px 24px`, dot centers at `(12 + 24i, 12 + 24j)` from the viewport top-left. Hardcoded white for all themes (not tokenized).
- **Reduced-motion**: `Index.html:279-284` is a global CSS sledgehammer (`*` → `transition/animation-duration: 0.01ms !important`). It neutralizes CSS motion but does **not** stop a JS `requestAnimationFrame` loop, so this feature needs its own explicit `matchMedia` guard.
- **z-index hierarchy** (must not break): `#statusToast` 11000 > `#debugCopiedToast` 10500 > `_showFallback` 9999 > Loom C `#weaveOverlay` 9000. Loom C's `#weaveDots` sits at `-1` (behind the card, above the body background) — this feature layers the same way.
- **Themes**: body class (`theme-torres`, `theme-nes`); thread color `var(--thread)` (Solar `#2dd4bf`, Torres `#5eead4`, C64 `#b9432f`), from Loom A.
- No server round-trip involved; pure client-side. Adds no on-load RPC (respects the GAS-quota constraint).

## Scope

- **In**: one `<canvas>` background layer, always running, on all steps (0-3) and all themes; the spawn/shape/timing engine with the locked values below; reduced-motion and tab-visibility handling.
- **Out**: see "Out of Scope." Notably this does not touch Loom C, does not tokenize the dot color, and adds no controls/settings UI.

## Final Design (decided 2026-07-03 — zero implementer choices)

### Concept

At any moment, ~2-3 faint threads (avg; capped at 5) are weaving. Each thread is born on
a grid dot, draws a wavy line (1-3 sine "S" bends) to another grid dot some distance
away, holds as a faint connection, then fades out. New threads spawn on a randomized
gap. Most threads are long, sweeping arcs; the rest are short local stitches. Each dot
a thread touches **brightens as the thread plugs in**, so the grid's own dots — the
loom — visibly participate rather than sit as passive scenery. Threads that end on dots
behind the app card are occluded by it, so they read as weaving *into* the interface.

### Structure

- One full-viewport `<canvas id="threadCanvas">`: `position: fixed; inset: 0; pointer-events: none; z-index: -1`. **`z-index: -1`** (same layer as Loom C's `#weaveDots`) puts it above the body dot-grid background and behind the app card and all UI — no change to `.container` stacking required.
- Sized to the viewport with devicePixelRatio scaling (`canvas.width = vw * dpr`, `ctx.setTransform(dpr,0,0,dpr,0,0)`, `dpr = min(devicePixelRatio, 2)`); re-sized on `resize`.
- Rendering is `requestAnimationFrame`-driven, canvas 2D only. No DOM/SVG nodes per thread, no layout properties touched, no reflow.
- **Clamped animation clock**: advance an internal `clock` by the per-frame delta, but clamp any delta > 100ms to ~16ms. This prevents background-tab throttling (which pauses rAF) from fast-forwarding and instantly expiring every in-flight thread on resume. All thread timing reads this `clock`, and each thread stores `t0 = clock` at birth.
- **Gated rAF (do not run the loop when nothing changes)**: the loop must run only while at least one thread is in its **draw** or **fade** phase. A thread's **hold** phase is a static frame and inter-spawn gaps with zero active threads have nothing to draw, so the loop sleeps then (`cancelAnimationFrame`, draw the static hold frame once). It is re-armed when a thread spawns or a held thread enters its fade. This roughly halves active loop time and removes the idle battery drain of an always-on 60fps canvas on a long-lived tab. **When the loop sleeps, the clamped clock must resume from real time on wake** (store `clock` and wall-time at sleep; on wake, do not credit the slept interval — same anti-fast-forward guarantee as the throttle case).

### Lifecycle (state machine — single teardown/start contract)

Five inputs mutate this feature's state: reduced-motion runtime toggle, tab visibility,
resize, the spawn scheduler, and rAF wake/sleep. Route **all** of them through one
idempotent `teardown()` and one idempotent `start()` — never ad-hoc cancellation at
each call site (that is where leaked timers and double-starts hide, and there is no
automated test net here to catch them).

- `teardown()` (idempotent): `cancelAnimationFrame(rafId)`; `clearTimeout(spawnTimer)`; clear the `threads` array; remove the `<canvas>`; null all handles. Safe to call twice.
- `start()` (idempotent): if reduced-motion is active or already running, no-op; else create the canvas, seed one thread, arm the scheduler. Safe to call twice.

```
                 reduced-motion OFF / init
        OFF ─────────────────────────────────▶ IDLE
         ▲                                       │  spawn OR held thread → fade
         │ reduced-motion ON → teardown()        ▼
         └──────────────────────────────── ANIMATING (rAF running)
                                                 │  last thread expires → rAF sleeps
                                                 ▼
                                               IDLE (rAF off, scheduler armed)

  tab hidden  : stop scheduling new spawns; in-flight threads finish; then idle.
  tab visible : resume scheduling (IDLE ⇄ hidden; no teardown).
  resize      : re-measure viewport + card rect, resize canvas; NO teardown.
```

Mirror this diagram as an ASCII comment above the engine IIFE in `Index.html`.

### Grid + geometry (per thread)

- `PITCH = 24`, `OFF = 12`. Start dot = a uniformly random dot within the viewport: `(OFF + i·PITCH, OFF + j·PITCH)`.
- Distance class: **long with probability `longPct` (65%)**, else short. `dist` = random integer in the class's `[min,max]` dot range.
- Angle = uniform `[0, 2π)`; end dot offset `di = round(dist·cos θ)`, `dj = round(dist·sin θ)` (so the end lands exactly on a dot); if both 0, force `di = dist`. End = `(sx + di·PITCH, sy + dj·PITCH)` — may be off-screen or behind the card.
- **Start/exit rule** (`startAvoid = false`): a thread may start anywhere on-screen, **including behind the card**, but must never be fully hidden and must never dead-end at a display edge. Reject and re-roll (up to 80 tries) when **either** (a) both endpoints fall inside the card rect (`getBoundingClientRect()` + 14px pad), or (b) the **end** dot falls outside the viewport (`ex<0 || ex>vw || ey<0 || ey>vh`). Ends may still sit behind the card (which is on-screen, so the thread reads as weaving into the UI), but a thread never runs off the display edge and stops there. (The legacy `startAvoid = true` path — reject any on-card *start* — remains in the mockup as a toggle but is **off** in the shipped config.)
- Path = the straight line start→end plus a perpendicular sine displacement `amp · sin(t · π · waves)`, `t ∈ [0,1]`. The sine is **0 at both `t=0` and `t=1`**, so the path begins and ends exactly on the two dots for any integer `waves`. `waves` rolled per thread in `[wavesMin, wavesMax]`. `amp = rand(ampMin, ampMax) · (isLong ? rand(longAmpMin, longAmpMax) : 1)`, then capped at `0.3 · lineLength` so short threads don't whip. Path sampled at `max(20, round(lineLength/4))` points.

### Per-thread rolls (all ranges rolled fresh at birth)

Every visual/timing parameter that varies is rolled uniformly within its `[min,max]`
window when the thread is created: base amplitude, long-amplitude multiplier, S-curve
count, and draw duration. Hold and fade are fixed. This is the "dice-roll" character
the owner tuned for.

### Choreography

| Phase | Duration | Detail |
|-------|----------|--------|
| 1. Draw | `drawMs` (rolled 2000-3000ms), ease | The head grows from the start dot along the sampled path to the end dot. Stroke `var(--thread)`, `globalAlpha = maxOpacity` (0.5). Round caps/joins (square for `theme-nes`). Stroke **tapers**: width = `strokeWidth · (taperEnd + (1−taperEnd)·sin(π·t))` along the path `t∈[0,1]` — full `strokeWidth` (1px) mid-span, thin (`taperEnd` 0.15× ≈ 0.15px) at each dot, so it reads as thread under tension, not a uniform rule. The **start dot pulses** as the thread is born. |
| 2. Hold | `holdMs` 10000ms | Full path visible at `maxOpacity`. The **end dot pulses** on arrival; both nodes then settle to a faint sustain. The thread reads as a settled connection between two lit nodes of the loom. |
| 3. Fade | `fadeMs` 1500ms | Whole thread (and both node pulses) fades `maxOpacity → 0`, then is removed. |

**Node participation (the dots are the loom — they light up).** `DESIGN.md` calls the
dot grid the loom; passive dots would make threads read as lines drifting over a dot
field. Instead, each dot a thread touches brightens as the thread plugs in. Per node,
alpha = `min(1, 0.1 + nodePulse · e^(−since/pulseDecayMs)) · fadeFactor`, drawn as a
filled dot of radius `nodeRadius` (1px; square for `theme-nes`), `var(--thread)`.
`since` = ms since that node's arrival (start = birth, end = draw complete);
`fadeFactor` tracks the thread's fade so nodes never outlive the strand. A short pulse
(`nodePulse` 0.75, `pulseDecayMs` 750) then a 0.1 sustain — a flicker of craft, not a
static blob (this replaces the earlier always-on `glow` dot, which read as clutter).

Thread lifetime ≈ `drawMs + 10000 + 1500` = **13.5-14.5s** (~14s avg).

### Spawn scheduler

- After each spawn, wait a randomized gap, then attempt the next: if `active < concurrency` and not paused/hidden, create one thread.
- Gap (seconds) = `gapMin + (gapMax − gapMin) · r`, where `r = random^(1/(1+bias))` — a power-curve roll biased toward **longer** gaps as `bias` rises. With the locked config the expected gap ≈ **5.8s**.
- **Density is emergent**: avg on screen ≈ `min(concurrency, lifetime / avgGap)` ≈ `min(5, 14/5.8)` ≈ **~2.4 threads** (gap-limited, not cap-limited). `concurrency` (5) is a hard ceiling, not a target.
- One thread is spawned immediately on init so the page is never blank on first paint.

### Locked parameters (canonical — freeze these exact values)

```json
{
  "maxOpacity": 0.5,
  "strokeWidth": 1,
  "taperEnd": 0.15,
  "nodePulse": 0.75,
  "nodeRadius": 1,
  "pulseDecayMs": 750,
  "ampMin": 5,
  "ampMax": 15,
  "longAmpMin": 1.5,
  "longAmpMax": 2,
  "wavesMin": 1,
  "wavesMax": 3,
  "drawMsMin": 2000,
  "drawMsMax": 3000,
  "holdMs": 10000,
  "fadeMs": 1500,
  "gapMin": 0.5,
  "gapMax": 10,
  "bias": 0.25,
  "concurrency": 5,
  "longPct": 65,
  "shortMin": 3,
  "shortMax": 12,
  "longMin": 15,
  "longMax": 30,
  "startAvoid": false
}
```

Units: opacity 0-1; `strokeWidth`/`nodeRadius`/`amp*` px; `taperEnd` fraction of
`strokeWidth` at the dots (0-1); `nodePulse` peak node alpha (0-1); `waves` integer
bends; `*Ms` milliseconds; `gap*` seconds; `long/shortMin/Max` in dots; `longPct`
percent chance a thread is long; `concurrency` max concurrent threads. The node-
participation values (`taperEnd`, `nodePulse`, `nodeRadius`, `pulseDecayMs`) are the
mockup's current defaults and remain tunable there before final lock.

### Invariants

- All motion is canvas draw only — no layout/reflow, no DOM node per thread.
- Thread color is always `var(--thread)`; caps/joins round, except `body.theme-nes` uses square (blockiness is that theme's identity, matching the Loom C invariant) — square applies to the tapered stroke and the node dots alike.
- Nodes participate: every dot a thread touches pulses on connect and fades with the strand (never a persistent static dot). The stroke tapers toward each dot. These sell the loom metaphor and are not optional decoration.
- `prefers-reduced-motion: reduce`: the feature **does not run at all** — no canvas created, no rAF loop, no threads. Checked via `matchMedia` before creating anything, and re-checked on a `matchMedia` change listener routed through `teardown()`/`start()` (enable at runtime → `teardown()`; disable → `start()`).
- **rAF is gated**: the loop runs only while ≥1 thread is drawing or fading; it sleeps during hold frames and idle gaps (see Structure). No always-on 60fps.
- Tab hidden (`visibilitychange` / `document.hidden`): stop spawning new threads; let in-flight threads finish; once none remain, the loop is already asleep (per gating). Resume spawning on visible. The clamped clock guarantees no fast-forward on resume or on loop-wake.
- All lifecycle transitions go through one idempotent `teardown()` / `start()` (see Lifecycle) — no per-call-site timer/rAF cancellation; both are safe to call twice with no leaked timers, listeners, or canvas nodes.
- The canvas never intercepts input (`pointer-events: none`) and never occludes UI (`z-index: -1`, below everything interactive).
- Uses no `localStorage`; adds no server call; adds no on-load RPC.
- Additive isolation: removing the CSS/JS/canvas block restores today's static background exactly.

## Acceptance Criteria

1. On every step (0-3) and in all three themes, faint threads continuously draw between grid dots, hold, and fade, with the correct `var(--thread)` color per theme and square caps only in C64.
2. Threads begin and end **exactly on dot centers** — no endpoint floating between dots — for any rolled `waves` count.
2b. **Nodes light up**: the start dot brightens as a thread is born and the end dot brightens on arrival, each pulsing then settling and fading with the thread; the stroke visibly tapers thinner at the dots than mid-span. A glance reads as "the loom weaving between its dots," not lines drifting over a dot field.
3. With OS reduced-motion enabled: no canvas node exists and no threads render (static background, byte-for-byte today's behavior). Toggling reduced-motion on at runtime tears the effect down; toggling off starts it.
4. Steady-state density averages ~2-3 threads and never exceeds `concurrency` (5) at any instant; verify the cap holds under the fastest gap.
5. ~65% of threads are long (15-30 dots) sweeping arcs; the rest are short (3-12 dots). Long threads visibly carry larger amplitude (up to the `0.3·length` cap).
6. No thread is ever fully hidden, and no thread dead-ends at a display edge: both endpoints stay within the viewport, and a start dot behind the card always ends on a *visible* (off-card) dot. Threads that *end* behind the card are cleanly occluded by the card (no stroke bleeds over it). No thread's end sits on or past the screen border.
7. Backgrounding the tab and returning does not produce a burst of instantly-expired threads or a visible time-jump; in-flight threads resume smoothly (clamped clock verified). While hidden, no new threads spawn and the loop idles once drained.
8. No dropped-frame jank on a mid-range phone (Moto G-class or 4× CPU-throttled devtools) at `concurrency = 5`; canvas-draw-only verified (no layout thrash in a performance trace).
9. z-index stays at `-1`: the app card and every toast/overlay/`_showFallback` render above the threads; a thread never draws over interactive UI.
10. Renders correctly at 360px width: canvas fills the viewport, threads scale, no horizontal scrollbar; endpoints stay on-screen (on a viewport too small to fit a long thread, the 80-try fallback may accept one that exits — acceptable degradation, not the common case).
11. Removing the feature's CSS/JS/canvas block restores today's static background exactly (additive isolation).
12. Safari private mode: no errors (feature touches no storage).
13. **rAF idles when nothing animates**: in a devtools performance trace, CPU/rAF activity drops to ~0 during a thread's hold phase and during zero-thread gaps; it wakes only for draw/fade. No continuous 60fps.
14. **No leaks**: toggling reduced-motion on/off ~10 times (and repeated hide/show) leaves no growing count of timers, rAF callbacks, listeners, or canvas nodes (`teardown()`/`start()` idempotent).
15. **Both-behind-card rejection**: forced with a tiny viewport + oversized card, `makeThread` never emits a thread with both endpoints behind the card; the 80-try fallback degrades gracefully (skips the spawn rather than hanging or drawing a fully-hidden thread).

## Testing Plan

Manual (reference: `design/mockups/loom-threads-mockup.html`, opened as a focused
foreground tab — background tabs and VS Code Live Preview throttle rAF):

- Load each step (0-3) in each theme (9 combinations); confirm threads render, colors and caps correct, cap never exceeded.
- Watch for a full minute: confirm density feels calm (~2 avg), long arcs dominate, no clustering that reads as messy.
- OS reduced-motion ON: static, no canvas. Toggle it on/off at runtime: effect tears down / starts.
- Background the tab ~30s, return: no time-jump burst; smooth resume.
- Devtools 360px width + 4× CPU throttle: no jank, no scrollbar.
- Trigger a toast and the Loom C success weave while ambient threads run: z-order correct (both render above the ambient layer); no interference.
- Safari private mode: no console errors.
- **Reduced-motion runtime toggle**: with the page open, flip the OS reduced-motion setting on (effect tears down, canvas gone) and off (effect starts) — both directions, live.
- **rAF idle check**: devtools performance profile while watching — confirm CPU drops to ~0 during hold phases and empty gaps, and spikes only during draw/fade.
- **Leak check**: toggle reduced-motion ~10×; confirm no accumulating timers / rAF callbacks / canvas nodes (idempotent `teardown()`/`start()`).
- **Both-behind-card edge**: shrink the viewport and/or enlarge the card so most dots sit behind it; confirm no thread is ever fully hidden and the spawn path never hangs (80-try fallback skips instead).

## Rollback Plan

Delete the additive CSS/JS/canvas block. No state, no server involvement, no markup
dependencies elsewhere. The static dot-grid background is untouched and returns as-is.

## Effort Estimate

~5h: 1.5h porting the mockup core (`makeThread`/`drawThread`/`frame`/scheduler +
clamped clock) into `Index.html`; 0.75h canvas/DPR/resize setup at `z-index: -1`;
1h reduced-motion + visibility lifecycle via idempotent `teardown()`/`start()` +
rAF gating (wake/sleep) with the state diagram as a code comment; 1.25h QA matrix
(steps × themes × reduced-motion runtime toggle × visibility × 360px × Safari ×
rAF-idle × leak × both-behind-card).

## Implementation Notes (files)

| File | Change |
|------|--------|
| `Index.html` (CSS, near the Loom C block ~286-299) | Add `#threadCanvas { position: fixed; inset: 0; pointer-events: none; z-index: -1; }` and the `body.theme-nes` square-cap note (handled in JS via `lineCap`). |
| `Index.html` (markup) | Add `<canvas id="threadCanvas" aria-hidden="true"></canvas>` as a body child (decorative, hidden from a11y tree). |
| `Index.html` (JS, near the Loom C weave JS ~2150+) | Add the ambient engine (IIFE): locked param constants, `resize`, `makeThread`, `drawThread`, `frame` with clamped clock, spawn scheduler, `matchMedia` reduced-motion guard + change listener, `visibilitychange` lifecycle. |

## Out of Scope

- Any change to Loom C (the one-shot success weave) — it stays as-is and coexists.
- Tokenizing the body dot color per theme (it stays hardcoded white as today).
- User-facing controls, settings, or a way to disable the effect beyond OS reduced-motion.
- Threads interacting with UI, cursor, or scroll; sound; color shifts; density that adapts to step or content.
- End-cap ornaments or dot-swell brightening (those are Loom C concepts).

## Related

- Depends on: `issues/loom-a-foundation-tokens.md` (`var(--thread)`).
- Epic: `issues/loom-epic.md`.
- Design source of truth: `design/mockups/loom-threads-mockup.html` (interactive; locked values are its defaults; live density estimate + per-thread roll controls).
- Sibling (do not modify): `issues/loom-c-weave-animation.md` — supersedes its "no ambient animation" out-of-scope line.
