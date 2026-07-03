# Design System — SheetWeaver

The one thing to remember: **the weaving-the-grid identity.** Email threads woven
into spreadsheet cells — teal thread on a navy loom. Every visual decision serves
this metaphor. The dark dot-grid page is the loom; white cards float on it; teal
is the thread.

## Product Context
- **What this is:** Google Apps Script webapp that extracts structured data from Gmail labels into Google Sheets rows on a 15-minute trigger.
- **Who it's for:** Small teams automating email→spreadsheet workflows; each user runs their own trigger.
- **Space/industry:** Productivity automation (peers: Zapier, Make, Coefficient) — but self-hosted and free.
- **Project type:** Single-file web app with a setup wizard (dashboard step-0, wizard steps 1-3). No build step, no framework.

## Aesthetic Direction
- **Direction:** Woven-grid polished SaaS. Dark teal-navy page frame with a subtle dot grid (the loom); crisp white cards floating on it. Deliberate departure from the category's white-shell convention: the color stays in the app, not just marketing.
- **Decoration level:** Intentional — dot-grid backdrop, radial glow, theme personality. Never expressive-for-its-own-sake.
- **Mood:** "Someone made this." Calm competence with a flicker of craft. Set it up once, trust it forever.
- **Themes:** Three full personalities on one token vocabulary — Solar (light, default), Torres (dark), C64 (retro). Theme switching via body class; every theme overrides the same token names.

## Typography
- **Headings:** Plus Jakarta Sans 500/600/700 — geometric warmth that reads product, not document.
- **Body/UI:** Inter 400/500/600 — a deliberate keep. Inter is ubiquitous, but this is a live utility app; switching would cost coherence for novelty. Recorded as a conscious tradeoff, not an oversight.
- **C64 headings:** Press Start 2P (h2/h3 at 0.65em, line-height 1.6) — the theme's voice.
- **Data/Tables:** Inter with `font-variant-numeric: tabular-nums` on all counts and timestamps. A data product's numbers must not jitter.
- **Loading:** Google Fonts CDN with `preconnect` (Index.html:8-10). Weights limited to those listed — do not add weights casually.
- **Scale (px):** xs 12 · sm 13 · base 16 · lg 18 · xl 20 · 2xl 24. Line-height: tight 1.25, normal 1.5.

## Color
- **Approach:** Balanced — semantic token vocabulary (~40 tokens), identical names across all three themes. Change the token layer first; never hardcode values in components.
- **Solar (default):** page `#0b3542` + dot grid `rgba(255,255,255,0.055)` 24px; card `#ffffff`; primary `#0d7070` (teal — the Sheets conceptual world); text `#253044`, muted `#647084`; border `#d7dde6`.
- **Torres (dark):** page `#0f172a`; card `#212b3d`; primary `#38c4b4`; button text darkens (`#0b2030`) for contrast on light-teal fills.
- **C64 (retro):** grey-beige case palette — card `#d8d5c8`, primary brown `#7b5a3a`, rainbow badge stripe, radius zeroed (blocky corners are identity).
- **Semantic triads:** success/warning/danger each carry bg + text + border tokens per theme; buttons carry `--on-*` text tokens. Use the triads, never approximate.
- **Dark mode strategy:** Torres redesigns surfaces (not inverted Solar); saturation reduced, shadows go black-based.
- **`--thread`:** Solar `#2dd4bf`, Torres `#5eead4`, C64 `#b9432f`. Token exists in `:root`/theme overrides (Loom A); not yet consumed by any element — reserved exclusively for "data in motion" (active syncs, progress, the loom animation). Never on buttons.

## Spacing
- **Base unit:** 4px. Scale: --space-1(4) 2(8) 3(12) 4(16) 5(20) 6(24) 8(32).
- **Density:** Comfortable. Table rows 10px vertical padding, open rows (border-bottom only, no cell grid).

## Layout
- **Approach:** Grid-disciplined wizard. `.step` visibility controlled by `nextStep()`; `.landing-only` elements exist only on step-0.
- **Breakpoints:** 720px (tablet), 599px (phone), 260px (help-dropdown min-width guard).
- **Border radius:** sm 5 · md 8 · lg 12 · pill 999px. C64 overrides to 0/0/2 — blockiness is the theme.
- **Elevation:** 3 levels (`--shadow-sm/md/lg`) built on the theme-aware `--shadow` color so dark/retro stay correct.
- **z-index (documented, keep as hierarchy):** `#statusToast` 11000 > `#debugCopiedToast` 10500 > `_showFallback` overlay 9999.

## Motion
- **Approach:** Minimal-functional. Transitions only where they aid comprehension (hover, theme switch, focus).
- **Durations:** fast 120ms (hovers, small state), base 180ms (background/theme shifts), tokenized as `--duration-fast`/`--duration-base`. NES button press stays a literal 80ms — the snap is the personality, intentionally not tokenized.
- **Easing:** `ease` throughout; no springs, no choreography.
- **Reduced motion:** `prefers-reduced-motion: reduce` guard exists and must be preserved for any new animation.
- **Loading:** skeleton shimmer (1.6s loop) for table loads.

## Accessibility invariants
- `:focus-visible` = 2px solid `var(--primary)` outline on all interactive elements.
- Buttons min-height 44px.
- ARIA menu contract: Arrows move, Tab closes, Escape closes + returns focus (see CLAUDE.md).
- Toasts: `role="status"` + `aria-live="polite"`; close buttons carry `aria-label="Dismiss notification"`.

## Sanctioned future direction ("The Loom")
Not built; approved as the direction for making the weaving identity an event:
1. **Thread animation** — on wizard completion, a 2px teal line weaves over-under through the dot grid and fills a cell. One second, once, then still.
2. **Loom status line** — quiet footer: "Next weave in 7 min · 142 rows woven this week", using `--thread`.
3. **`--thread` accent** — reserved data-in-motion color (values above).

## Decisions Log
| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-07-01 | DESIGN.md established from existing system | /design-consultation; refine-not-reinvent per owner |
| 2026-07-01 | Keep Inter despite ubiquity | Live app; coherence over novelty; recorded tradeoff |
| 2026-07-01 | Motion tokens (120/180ms) approved, NES 80ms exempt | Ad-hoc durations were the system's weakest part |
| 2026-07-01 | tabular-nums on counts/timestamps approved | Data product; numbers must not jitter |
| 2026-07-01 | "Loom" ideas recorded as future direction | Outside-voice proposals worth keeping, not scoping now |
