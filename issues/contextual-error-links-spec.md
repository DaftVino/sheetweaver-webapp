# Spec: Contextual "?" error links on dashboard error states (Loom Phase 5)

Status: READY FOR ENG REVIEW
Source TODO: `issues/TODOS.md` → "Contextual '?' links on dashboard error states"
Design doc: `~/.gstack/projects/DaftVino-SheetWeaver-Webapp/jm3ak-chore-repo-rename-references-design-20260703-064124.md` (Phase 5)
Author: /spec, 2026-07-03
Depends on: Phase 4 (docs standardization, shipped `f009d87`) — troubleshooting.md anchors are stable.

## Context

Users who hit a dashboard error today have a three-step path to help: open the Help
dropdown, find "Troubleshooting Guide," then Ctrl+F for their error. The Help dropdown
(shipped earlier) covers the gap acceptably but not contextually. This phase adds an
inline "?" affordance next to each error state that deep-links straight to the matching
`troubleshooting.md` section, cutting time-to-resolution to one click. It is the final
phase of the five-phase fixes-and-upgrades plan; Phases 1-4 shipped.

Stakeholders: **office staff** hitting a broken connection or an auth error mid-task
(the people this saves time for); **the admin** (fewer "what does this error mean" pings);
**the future Gmail add-on port** (the same error surfaces carry over, so the affordance
must survive the 599px/360px viewports every Loom child already targets).

## Current State (verified 2026-07-03 against `Index.html`)

Five distinct error/problem states render on the dashboard or in the setup wizard. Three
of them render the error text inside a native `title=` tooltip on an icon/span, which
**cannot contain a clickable link** — covering those requires adding a visible sibling
element. Line numbers drift as this ~2,200-line file changes; the function/selector
anchors below are the durable references.

| # | Error state | Render site (function / selector) | Current form | Linkable as-is? |
|---|-------------|-----------------------------------|--------------|-----------------|
| 1 | Setup: "Label not found" / authorization error | `showLabelError()` → `#labelError` div (~1674) | full DOM container with buttons + external link | ✅ yes |
| 2 | Broken Connection – Gmail label missing | connection-row render, `tdGmail` `statusIcon('unlink','Broken Connection - Label missing in Gmail')` (~1285) | native `title=` tooltip | ❌ add sibling |
| 3 | Broken Connection – sheet tab missing | connection-row render, `tdSheet` `statusIcon('unlink','Broken Connection - Spreadsheet tab missing')` (~1305; compact `'Broken'` variant ~1296) | native `title=` tooltip | ❌ add sibling |
| 4 | Sync run errored (`lastRunStatus === 'error'`, ⚠ badge + `lastError`) | connection-row render, `lastSyncTd` (~1326-1328) | native `title=` tooltip | ❌ add sibling |
| 5 | Auto-sync OFF ("The Loom is Idle") warning | `.sync-banner` idle branch (~1222) | DOM container | ✅ yes |

Existing pattern to reuse (do NOT invent a new one): `Index.html:660` (debug-toast footer)
and `Index.html:700` (Help dropdown menu item) both link to
`https://github.com/DaftVino/sheetweaver-webapp/blob/main/docs/troubleshooting.md`
with `target="_blank" rel="noopener"`. Contextual links extend this by appending an
`#anchor` fragment.

`troubleshooting.md` has 15 `##` headings today. Four of the five states map to an
existing section; the two "Broken Connection" states (2, 3) have **no dedicated section**
and get one added by this phase.

## Proposed Change

Add a single reusable helper that builds a circled-"?" anchor element, and call it at the
five render sites. Add one new section to `troubleshooting.md` for the broken-connection
states. Add one mechanical anchor-existence check to `scripts/local-verify.js`.

### Decisions locked (via /spec interrogation, 2026-07-03)

1. **Target:** external GitHub-hosted `troubleshooting.md#anchor`, new tab — reuses the
   existing convention (lines 660/700), zero new in-app UI or infra. [Layer 1]
2. **Scope:** all 5 states, including converting the 3 tooltip states to carry a visible
   "?" sibling. Boil the ocean — the broken-connection states are the highest-signal
   dashboard errors.
3. **Affordance:** a compact circled "?" glyph link (not a text link), so it fits the
   dense connection table at 360px. `aria-label` carries the accessible name (the glyph
   has none), per CLAUDE.md ARIA rule.
4. **Broken-connection anchor:** add one `## Broken Connection ...` section to
   `troubleshooting.md`; states 2 and 3 both point there.

### Anchor mapping (final)

GitHub heading-slug rules: lowercase, spaces → `-`, punctuation (`"`, `(`, `)`, `/`, `.`,
`'`) stripped, ` / ` collapses to `--`.

| State | troubleshooting.md heading | Anchor slug |
|-------|----------------------------|-------------|
| 1 Setup label/auth error | `## "Label not found" or Authorization Error During Setup` | `label-not-found-or-authorization-error-during-setup` |
| 2 Broken – Gmail label | `## Broken Connection (Gmail Label or Sheet Tab Missing)` *(new)* | `broken-connection-gmail-label-or-sheet-tab-missing` |
| 3 Broken – sheet tab | `## Broken Connection (Gmail Label or Sheet Tab Missing)` *(new)* | `broken-connection-gmail-label-or-sheet-tab-missing` |
| 4 Sync errored | `## Emails Are Not Being Processed` | `emails-are-not-being-processed` |
| 5 Auto-sync OFF | `## Emails Are Not Being Processed` | `emails-are-not-being-processed` |

### Implementation Details

**1. Shared helper + anchor map (add near the other small DOM helpers, e.g. by `_makeActionBtn`).**

The anchor slugs live in ONE constant map (eng-review A1: single source of truth — a
heading rename touches the map + the doc, nothing else), and every call site references
the map, never a bare string literal. `scripts/local-verify.js` scans this map (T1).

```js
// Base URL already used at Index.html:660/700 — keep as a single source of truth.
var TROUBLESHOOT_URL = 'https://github.com/DaftVino/sheetweaver-webapp/blob/main/docs/troubleshooting.md';

// The 3 distinct troubleshooting.md anchors the dashboard deep-links to.
// Keep in sync with the ## headings in docs/troubleshooting.md — local-verify enforces it.
var TROUBLESHOOT_ANCHORS = {
  setupLabelAuth:   'label-not-found-or-authorization-error-during-setup',
  brokenConnection: 'broken-connection-gmail-label-or-sheet-tab-missing',
  notProcessing:    'emails-are-not-being-processed'
};

// Returns an <a> circled-"?" link to a troubleshooting.md section.
// anchor: slug without '#'. stateLabel: human phrase for the accessible name.
function _troubleshootLink(anchor, stateLabel) {
  var a = document.createElement('a');
  a.className = 'troubleshoot-link';
  a.href = TROUBLESHOOT_URL + '#' + anchor;
  a.target = '_blank';
  a.rel = 'noopener noreferrer';
  a.textContent = '?';
  a.setAttribute('aria-label', 'Troubleshoot: ' + stateLabel);
  a.title = 'Troubleshoot: ' + stateLabel; // hover parity with the aria name
  return a;
}
```

**2. CSS (token-only, both/all three themes inherit via `currentColor` + tokens).**
Add a `.troubleshoot-link` rule in the `<style>` block:

```css
.troubleshoot-link {
  display: inline-flex; align-items: center; justify-content: center;
  width: 1.15em; height: 1.15em; margin-left: var(--space-1);
  border: 1px solid currentColor; border-radius: var(--radius-pill);
  font-size: var(--font-xs); font-weight: bold; line-height: 1;
  text-decoration: none; color: inherit; opacity: 0.75; vertical-align: middle;
  flex: 0 0 auto;
}
.troubleshoot-link:hover, .troubleshoot-link:focus-visible { opacity: 1; }
```
`border-radius: var(--radius-pill)` on a square box yields a circle. `color: inherit`
means it adopts the danger/warning color of the error text it sits beside. NES/C64 theme:
`--radius-pill` already resolves to blocky corners there (per the C64 identity rule at
`Index.html:183`) — acceptable, the "?" stays legible; verify in QA.

**3. Five insertion sites** (append the helper's element; for the 3 tooltip states the
existing `title=` tooltip stays as-is for hover, the "?" adds the click path):

| Site | Where to insert | Call |
|------|-----------------|------|
| 1 `showLabelError()` | append into `actionRow` after the recheck/auth buttons (so it sits with the actions) | `actionRow.appendChild(_troubleshootLink(TROUBLESHOOT_ANCHORS.setupLabelAuth, 'Label not found or authorization error'))` |
| 2 `tdGmail` broken branch (owner-only) | after `tdGmail.innerHTML = statusIcon(...)` | `tdGmail.appendChild(_troubleshootLink(TROUBLESHOOT_ANCHORS.brokenConnection, 'Broken connection: Gmail label missing'))` |
| 3 `tdSheet` broken branch | after the `statusIcon('unlink', ...tab missing...)` assignment (both the `'Broken'` compact and full variants) | `tdSheet.appendChild(_troubleshootLink(TROUBLESHOOT_ANCHORS.brokenConnection, 'Broken connection: sheet tab missing'))` |
| 4 `lastSyncTd` error branch | inside `if (conn.lastRunStatus === 'error')`, after setting text/color | `lastSyncTd.appendChild(_troubleshootLink(TROUBLESHOOT_ANCHORS.notProcessing, 'Sync run errored'))` |
| 5 `.sync-banner` idle branch | after the `bannerContainer.innerHTML = ...` idle assignment (~1222; the idle `<div class="sync-banner">` has a `<span>` — verified) | `bannerContainer.querySelector('.sync-banner span').appendChild(_troubleshootLink(TROUBLESHOOT_ANCHORS.notProcessing, 'Auto-sync is off'))` |

Note on site 5: the idle banner is assembled as an HTML string, then the link is appended
to its `<span>` after render (one construction path). Do not hand-write anchor markup
inline and do not pass a bare slug string — every link routes through `_troubleshootLink`
with an anchor from `TROUBLESHOOT_ANCHORS`, so the anchor set is greppable and testable.

**4. New troubleshooting.md section** (insert after `## Emails Are Not Being Processed`,
before `## "Label not found"...`, keeping related sections adjacent):

```markdown
## Broken Connection (Gmail Label or Sheet Tab Missing)

The dashboard marks a connection **Broken** when the thing it watches has been
deleted or renamed after setup:

- **Gmail label missing** — the Gmail label this connection syncs no longer exists.
  Re-create the label with the exact original name (case-sensitive; nested labels use
  `/`), or delete the connection and set up a new one against the current label.
- **Sheet tab missing** — the spreadsheet tab this connection writes to was deleted or
  renamed. Restore the tab name to exactly what was entered at setup, or delete the
  connection and re-create it against the current tab.

Use the **Mend** button on the connection row to re-validate after you fix the label or
tab. If it stays broken, open the Admin Diagnostics panel for a report ID and share it
with your admin.
```
(Verify "Mend" is the current row-action label before shipping — Loom D renamed the
repair action; grep the button label in `Index.html`.)

**5. `scripts/local-verify.js` anchor guard** (new check, matches the file's
`read()` + `check(name, condition, detail)` style):

The anchors do NOT appear in `Index.html` as `troubleshooting.md#<slug>` literals — the
href is `TROUBLESHOOT_URL + '#' + anchor` at runtime and the slugs are passed as bare
args. So the check scans the `TROUBLESHOOT_ANCHORS` map values and the `_troubleshootLink`
call args, not the URL string (eng-review T1).

```js
function checkTroubleshootAnchors(htmlSource, tsSource) {
  // The 3 slugs declared in the TROUBLESHOOT_ANCHORS map object in Index.html.
  var mapBlock = (htmlSource.match(/TROUBLESHOOT_ANCHORS\s*=\s*\{[\s\S]*?\}/) || [''])[0];
  var declared = (mapBlock.match(/'([a-z0-9-]+)'/g) || []).map(function (s) { return s.replace(/'/g, ''); });

  // GitHub-style slugs of every ## heading in troubleshooting.md.
  var slugs = (tsSource.match(/^##\s+.+$/gm) || []).map(function (h) {
    return h.replace(/^##\s+/, '').toLowerCase()
      .replace(/[^\w\s-]/g, '')   // strip punctuation (", (, ), /, ., ')
      .trim().replace(/\s+/g, '-');
  });

  // T1: every declared anchor must resolve to a real heading (drift guard).
  var missing = declared.filter(function (a) { return slugs.indexOf(a) === -1; });
  check('every TROUBLESHOOT_ANCHORS slug resolves to a troubleshooting.md heading',
    declared.length === 3 && missing.length === 0,
    missing.length ? 'missing headings for: ' + missing.join(', ') : 'declared ' + declared.length + ' anchors');

  // T2: assert the exact expected anchor set is present (a dup can't hide a drop).
  var expected = ['label-not-found-or-authorization-error-during-setup',
                  'broken-connection-gmail-label-or-sheet-tab-missing',
                  'emails-are-not-being-processed'];
  var haveAll = expected.every(function (e) { return declared.indexOf(e) !== -1; });
  check('TROUBLESHOOT_ANCHORS declares exactly the 3 expected slugs', haveAll,
    'declared: ' + declared.join(', '));

  // All 5 error states wired: >=5 _troubleshootLink() call sites.
  var calls = (htmlSource.match(/_troubleshootLink\(/g) || []).length;
  check('all 5 contextual error links are wired (>=5 _troubleshootLink call sites)',
    calls >= 5, 'found ' + calls + ' call sites');
}
```
Wire it into the main runner alongside the existing checks, reading both `Index.html` and
`docs/troubleshooting.md`. Confirm the slugify regex reproduces GitHub's output for the two
multi-punctuation headings (`## "Label not found"...` and `## Broken Connection (Gmail
Label or Sheet Tab Missing)`) — the `expected` array above is the ground truth; if the
regex diverges from it the T1 check fails loudly, which is the intended backstop.

## Acceptance Criteria

1. A circled "?" link appears at all 5 error states: setup label/auth error, Gmail-label
   broken, sheet-tab broken, sync-run errored, auto-sync-off banner.
2. Each "?" opens the correct `troubleshooting.md#anchor` in a new tab per the mapping
   table; the target section exists and scrolls into view on GitHub.
3. Every "?" link has `target="_blank" rel="noopener noreferrer"` and a non-empty
   `aria-label` beginning "Troubleshoot:".
4. Every link is built through `_troubleshootLink()` (no hand-written anchor markup at the
   call sites) — `grep -c "_troubleshootLink(" Index.html` returns ≥ 5.
5. `troubleshooting.md` has a `## Broken Connection (Gmail Label or Sheet Tab Missing)`
   section; states 2 and 3 both link to its slug.
6. `scripts/local-verify.js` fails if any `TROUBLESHOOT_ANCHORS` slug has no matching
   `troubleshooting.md` heading, if the map isn't exactly the 3 expected slugs, or if
   fewer than 5 `_troubleshootLink` call sites exist. `npm run verify:local` passes on the
   finished change.
7. The three converted tooltip states keep their existing `title=` hover text (the "?" is
   additive, not a replacement).
8. Keyboard: each "?" is reachable by Tab and activates with Enter (native `<a href>`).
9. No new on-load RPC; no change to `getDashboardData` payload (links are built from data
   already present). No z-index changes (inline elements).
10. Visual: "?" is legible and not clipped in Solar, Torres, and C64/NES themes at
    desktop, 599px, and 360px; it does not wrap or overflow the connection table cells.

## Testing Plan

No automated test framework (CLAUDE.md: manual QA only) except the static
`scripts/local-verify.js` guard.

| Layer | What | Count |
|-------|------|-------|
| Static (local-verify) | anchor resolves to heading; ≥5 refs present | +2 checks |
| Manual — functional | click each of 5 "?" links, confirm correct section opens on GitHub | 5 |
| Manual — a11y | Tab to each "?", Enter opens; screen-reader reads the aria-label | 5 |
| Manual — themes × viewports | "?" legible/unclipped in 3 themes × {desktop, 599px, 360px} | 9 |
| Manual — regression | tooltip hover text still present on the 3 converted states; no layout shift in the connection table | 1 |

To exercise the broken/error states without waiting for a real failure: temporarily set
`conn.gmailActive=false` / `conn.sheetActive=false` / `conn.lastRunStatus='error'` in a
local render, or point at a connection whose label/tab was deliberately removed.

## Rollback Plan

Single-PR, additive change. Revert the PR to remove all links, the CSS rule, the
troubleshooting.md section, and the local-verify check together. No data, deployment, or
shared-state impact. The added troubleshooting.md section is harmless if left behind.

## Effort Estimate

- `_troubleshootLink` helper + CSS: ~15 min
- 5 insertion sites: ~30 min (site 5's innerHTML path is the fiddly one)
- troubleshooting.md new section: ~10 min
- local-verify anchor check: ~20 min
- Manual QA (3 themes × 3 viewports + a11y): ~40 min

Total: ~2 h (CC-assisted; human-team equivalent ~half a day).

## Files Reference

| File | Change |
|------|--------|
| `Index.html` (`<style>`) | Add `.troubleshoot-link` rule |
| `Index.html` (`_troubleshootLink` helper) | New helper + `TROUBLESHOOT_URL` const |
| `Index.html` (`showLabelError`) | Append "?" link to `actionRow` |
| `Index.html` (connection-row render: `tdGmail`, `tdSheet`, `lastSyncTd`) | Append "?" link on the broken/error branches |
| `Index.html` (`.sync-banner` idle branch) | Append "?" link to the idle banner span |
| `docs/troubleshooting.md` | Add `## Broken Connection (Gmail Label or Sheet Tab Missing)` |
| `scripts/local-verify.js` | Add `checkTroubleshootAnchors` + wire into runner |
| `CHANGELOG.md` | Entry per repo standard |

## Out of Scope

- In-app rendering of troubleshooting content (modal/panel) — links go to GitHub, matching
  the existing Help dropdown convention.
- New error states or new troubleshooting sections beyond the one broken-connection section.
- Restructuring the 3 `title=` tooltip states into fully visible messages — the "?" is an
  additive click path; the tooltip stays.
- Non-owner / team rows — broken-connection alerts are owner-only (`hasAlert` at ~1233);
  team members don't see or act on another user's broken connection.
- Any change to `getDashboardData` or server code (`Code.js`).

## Related

- `issues/loom-epic.md` — parent Loom epic (Phase 5 is the last child).
- Design doc Phase 5, `issues/TODOS.md` (source TODO, to be marked complete on ship).

## GSTACK REVIEW REPORT

Scope: Phase 5 only (contextual "?" error links). Produced by `/spec` then reviewed by
`/plan-eng-review` in one session, 2026-07-03. Phases 1-4 already shipped. Step 0 scope
challenge: 3 files (`Index.html`, `docs/troubleshooting.md`, `scripts/local-verify.js`),
additive UI, 0 new classes/services, 0 new RPC — well under the 8-file complexity smell;
scope accepted as-is.

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 0 | — | — |
| Codex Review | `/codex review` | Independent 2nd opinion | 0 | not installed | — |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 1 | CLEAR | 3 issues (3 resolved) |
| Design Review | `/plan-design-review` | UI/UX gaps | 0 | — | — |
| DX Review | `/plan-devex-review` | Developer experience gaps | 0 | — | — |

**Findings (all folded into this spec):**
1. **[Architecture A1] Scattered anchor literals.** The 3 anchor slugs were string
   literals across 5 call sites + the heading + the mapping table — a rename-drift DRY
   smell. Fix applied: single `TROUBLESHOOT_ANCHORS` map; all call sites reference it.
2. **[Tests T1, CONFIRMED — would ship broken] `local-verify` check matched nothing.**
   The draft regex scanned for `troubleshooting.md#<slug>` literals, but the href is
   concatenated at runtime and slugs are bare `_troubleshootLink` args — zero matches,
   so acceptance criterion 6 would fail permanently and the drift guard validated
   nothing. Fix applied: the check now scans the `TROUBLESHOOT_ANCHORS` map values +
   `_troubleshootLink` call count, and asserts the exact expected 3-slug set.
3. **[Tests T2] Ref count didn't catch a dropped state.** A duplicated anchor could pass
   a bare count while silently dropping a state. Fix applied: explicit expected-set
   membership assertion.

**CODEX:** not run — Codex CLI not installed on this machine.

**CROSS-MODEL:** no independent second model ran. Codex unavailable; a Claude subagent was
not spawned (small additive spec; agents aren't spawned without an explicit ask). The
review is single-model — weight accordingly.

**Test coverage:** No automated framework (CLAUDE.md: manual QA only) beyond the static
`scripts/local-verify.js` guard. The spec's Testing Plan (2 static checks + 20 manual
checkpoints across 5 links × functional/a11y and 3 themes × 3 viewports) is the test plan;
findings 2 and 3 fixed the static guard that would otherwise have shipped inert.

**NOT in scope (this review):** in-app help rendering, new error states beyond the one
broken-connection section, tooltip-to-visible restructuring, team/non-owner rows, any
`Code.js` change. All enumerated in the spec's Out of Scope.

**Failure modes:**
- Anchor drift (a heading rename orphans a link): now guarded by the corrected
  local-verify check (finding 2/3) — mechanical, fails the build.
- Site-5 append target missing: verified present (`.sync-banner span` exists at
  Index.html:1223) — not a risk.
- C64/NES blocky `--radius-pill` on the circled "?": low severity, legibility preserved;
  covered by the 3-theme QA checkpoint. Noted, not blocking.

**VERDICT:** Eng Review CLEARED — 3 findings, all resolved in-spec. Phase 5 is ready to
implement (`/ship` after build + manual QA). Single-model review (no codex/cross-model);
the one open caveat is that no independent second opinion ran.

NO UNRESOLVED DECISIONS
