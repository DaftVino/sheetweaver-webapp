# SheetWeaver Webapp — Claude Code Instructions

## Project overview

Single-file Google Apps Script webapp. All HTML, CSS, and JS live in `Index.html` (~3200 lines). Server-side logic is in `Code.js`. There is no build step — deploy via `clasp push` or GitHub Actions.

## Architecture constraints

- **Single file**: Index.html contains everything. There is no bundler, no module system, no imports. All JS functions are at one global scope.
- **GAS quota**: Google Apps Script has a daily execution quota shared across all users. Never add a new on-load RPC — always piggyback metadata onto existing calls (see `getDashboardData()` pattern in Code.js).
- **CSS token system**: All visual values use CSS custom properties (`var(--token-name)`). Never hardcode colors, spacing, or font sizes. Theme switching works via body class.
- **z-index hierarchy**: `#statusToast` = 11000, `#debugCopiedToast` = 10500, `_showFallback` overlay = 9999. Decorative background layers (`#loomBackdrop`, `#threadCanvas`, `#dotWave`) sit at -1 with `pointer-events: none`. Don't break this stack.

## Testing

No browser test framework. `npm run verify:local` (`scripts/local-verify.js`) runs static and vm-based behavioral checks and must pass before every push; all visual testing is manual. When adding features:
- Run the QA checklist manually (see `docs/qa-runbook.md` and the test plan in `~/.gstack/projects/DaftVino-SheetWeaver-Webapp/`)
- Test all three themes (Solar, Torres, C64/NES) for visual regressions
- Test keyboard-only navigation for any interactive elements
- Test in Safari private mode for localStorage failure paths (wrappers must not throw)
- Test with OS-level "reduce motion" enabled — the ambient background animations (Loom E/F) must stay off

## localStorage

Always use `_lsGet(key)` / `_lsSet(key, val)` helpers — never call `localStorage.getItem/setItem` directly. Safari private browsing throws `SecurityError`. The helpers wrap in try/catch and fail silently.

## CSS classes

- `.landing-only`: shown only on step-0 (dashboard), hidden on wizard steps 1-3. **Do NOT add to Help dropdown, welcome banner, or any element that should be visible on all steps.**
- `.step`: controlled by `nextStep(stepNumber)` — only the active step is visible. Welcome tip belongs INSIDE `#step-0`, not between steps.

## ARIA patterns

- `role="menu"` keyboard contract: Arrow keys move within menu, Tab closes menu (does not cycle), Escape closes and returns focus to trigger.
- `role="banner"` is a page-level landmark — do not use on in-page tips or banners.
- Toast elements: `role="status"` + `aria-live="polite"`. Close buttons: always `aria-label="Dismiss notification"` (× symbol has no accessible name).

## Skill routing

When the user's request matches an available skill, invoke it via the Skill tool.

Key routing rules:
- Product ideas/brainstorming → invoke /office-hours
- Strategy/scope → invoke /plan-ceo-review
- Architecture → invoke /plan-eng-review
- Design system/plan review → invoke /design-consultation or /plan-design-review
- Full review pipeline → invoke /autoplan
- Bugs/errors → invoke /investigate
- QA/testing site behavior → invoke /qa or /qa-only
- Code review/diff check → invoke /review
- Visual polish → invoke /design-review
- Ship/deploy/PR → invoke /ship or /land-and-deploy
