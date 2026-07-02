# Spec: Standardize documentation — single source of truth, resolved cross-links, plain-language user docs

## Context

SheetWeaver is moving from "playing with it" to users actively relying on it. The docs grew organically and now repeat the same material in up to four places, which guarantees drift (the `setup-guide.md` First-Time User section already parallels `first-time-user-flow.md`). Three doc files are hard-linked from the app UI (`Index.html`), so their **names and purposes are locked** — only their content can change. Goal: every fact lives in exactly one doc, all cross-links resolve, and the docs a stuck end user reads are at roughly a 7th-grade reading level (judgment call, not a hard metric).

Decisions made with the user (2026-07-01):
- **Scope:** all docs except `CHANGELOG.md` and `docs/TODOS.md`.
- **7th-grade bar:** applies to `docs/first-time-user-flow.md` and `docs/troubleshooting.md` only. `docs/setup-guide.md` gets "plain sentences, technical terms allowed." Dev/contributor docs stay technical but clear.
- **Canonical update procedure lives in `setup-guide.md`** §Update Instructions; all other copies become pointers.
- One-time judgment review for reading level — no automated readability tooling.

## Verified Current State (audited 2026-07-01)

### Code-locked files (name + purpose immutable)

| File | Referenced from |
|------|-----------------|
| `docs/troubleshooting.md` | `Index.html:650` (debug toast footer), `Index.html:690` (Help menu) |
| `docs/setup-guide.md` | `Index.html:691` (Help menu) |
| `docs/first-time-user-flow.md` | `Index.html:692` (Help menu), `Index.html:711` (welcome tip) |

Links in `Index.html` are absolute GitHub URLs to `blob/main/docs/...`. **Index.html is not touched by this work.**

### Doc inventory and disposition

| File | Lines | Audience | Disposition |
|------|-------|----------|-------------|
| `README.md` | 163 | Everyone (GitHub landing) | De-dupe against setup-guide; keep pitch complete |
| `docs/setup-guide.md` | 333 | Installer/admin | Owns install + update; de-dupe internal repeat; plain language |
| `docs/first-time-user-flow.md` | 120 | End user | Already near 7th grade; light pass only |
| `docs/troubleshooting.md` | 231 | End user + admin | De-dupe update sections; 7th-grade pass |
| `docs/ARCHITECTURE.md` | 202 | Developer | Accuracy check only; stays technical |
| `docs/qa-runbook.md` | 141 | Developer | Accuracy check only |
| `.github/CONTRIBUTING.md` | 64 | Contributor | Fix broken link; minor cleanup |
| `.github/SUPPORT.md` | 34 | User seeking help | Fix stale pointer; de-dupe Copy Debug |
| `.github/SECURITY.md`, `CODE_OF_CONDUCT.md`, PR/issue templates | ~124 | Contributor | Verify links/consistency only |
| `CHANGELOG.md`, `docs/TODOS.md` | — | — | **Out of scope** |

### Defects found

**Duplication (the same material written out in full in multiple places):**

1. **Update procedure appears 4×** — `setup-guide.md:248-303` (§Update Instructions), `setup-guide.md:311-321` (§Re-Deploying After Changes, duplicating its own doc), `troubleshooting.md:162-193` (§Update Available Banner), `troubleshooting.md:196-218` (§Update Did Not Take Effect). Same `git pull → npm run verify:local → clasp push → edit live deployment → Version: New version` block each time.
2. **First-Time User Flow duplicated** — `setup-guide.md:219-229` parallels `docs/first-time-user-flow.md`.
3. **README duplicates setup-guide** — Prerequisites + clasp install commands (`README.md:24-46` ≈ `setup-guide.md:15-43`, near-verbatim incl. the `npx clasp` note), Install Checklist (`README.md:48-60` ≈ Path A steps), Workspace-only `DOMAIN` instructions (`README.md:82` ≈ `setup-guide.md:141-149`), `default_spreadsheet_url` (`README.md:90-94` ≈ `setup-guide.md:233-244`).
4. **Copy Debug explained 3× for users** — `README.md:155-163`, `troubleshooting.md:7-9`, `.github/SUPPORT.md` §Self-service #3.
5. **9 KB registry limit in 3 docs** — `README.md:140`, `docs/ARCHITECTURE.md:199`, `troubleshooting.md:222-231` (acceptable: different audiences/depth; see execution plan).

**Broken/stale links:**

6. `.github/CONTRIBUTING.md:60` links `(.github/ISSUE_TEMPLATE/bug_report.md)` — resolves to `.github/.github/ISSUE_TEMPLATE/bug_report.md`, a 404. Must be `ISSUE_TEMPLATE/bug_report.md`.
7. `.github/SUPPORT.md:9` says "README.md covers setup and usage" — README defers setup to `docs/setup-guide.md`; pointer is stale.

**Reading level:** `troubleshooting.md` is mixed — e.g. §"Could not read your Google identity" (line 97) leads with `Session.getActiveUser().getEmail()` instead of plain English; §Login/Permission Loop (106-131) is already excellent plain style and is the model to follow.

### What's accurate (verified, do not "fix")

- All UI strings cited in docs match `Index.html` exactly: "+ Add a new capture" (1392), "Verify & Scan Label" (1808), "Enable 15-Min Auto-Sync" (1212), "Auto-Sync is Active/Off" (1208/1211), "Configure Spreadsheet Data" (794), "Custom Tab Name" (804), "First Sync Fetch" + the three options (809-813), "Copy Debug" (698), "Recheck Permissions" (1703), "Open Authorization" (1709), "Active Connections" (716), "Enable Auto-Sync" (1513).
- `APP_VERSION = '2.0.5'` (`Code.js:1`) matches README's `v2.0.5` example.
- Help menu contents described in `README.md:124` match `Index.html:689-697` (incl. Changelog → GitHub Releases).
- ARCHITECTURE.md registry structure, lock coverage, and diagnostics description match Code.js behavior (spot-checked).
- All 9 other cross-links resolve.

## Standardization rules (the "standard" being applied)

1. **Header block:** every in-scope doc opens with 1-3 sentences stating what the doc covers, who it's for, and links to the sibling docs for adjacent topics. (`first-time-user-flow.md:1-9` already does this; it's the template.)
2. **Single source of truth:** each procedure/fact lives in exactly one doc. Other docs may name it in one sentence and link — never restate steps or command blocks.
3. **Canonical homes:**
   - Install + update + deploy procedures → `docs/setup-guide.md`
   - End-user walkthrough (wizard, dashboard, permissions) → `docs/first-time-user-flow.md`
   - Symptoms, causes, fixes, Copy Debug how-to → `docs/troubleshooting.md`
   - Internals (data flow, storage, concurrency, security) → `docs/ARCHITECTURE.md`
   - Test matrix → `docs/qa-runbook.md`
   - Contribution workflow → `.github/CONTRIBUTING.md`; support routing → `.github/SUPPORT.md`
   - `README.md` = pitch + orientation: what it does, tech stack, project structure, pointers. No full procedures.
4. **Links between docs are relative** (`setup-guide.md`, `../.github/SUPPORT.md`), never absolute GitHub URLs — absolute URLs are only for `Index.html` (untouched).
5. **Reading level:** `first-time-user-flow.md` and `troubleshooting.md` — short sentences, plain words, name the UI button/banner the user actually sees before any technical term; function names/log jargon only in clearly admin-marked passages. `setup-guide.md` — plain sentences, technical terms allowed. Dev docs unchanged in register.

## Execution Plan (per file)

### 1. `docs/setup-guide.md`
- Replace §First-Time User Flow (lines 219-229) body with a ≤3-line pointer to `first-time-user-flow.md` ("After deploying, send users the First-Time User Guide" + link). Keep the Copy Debug sentence only if not redundant with the pointer target.
- Merge §Re-Deploying After Changes (311-321) into §Update Instructions (248+) — it is the same procedure; keep one full copy, delete the other, keep the "URL stays the same" fact.
- Plain-language pass (terms allowed, sentences shortened).
- Do not change any heading anchors that other docs link to (`#update-instructions`, `#github-actions-ci-deploy`) — `troubleshooting.md:152` links one today and the new pointers will link the other.

### 2. `docs/troubleshooting.md`
- §Update Available Banner (162-193): keep symptom + meaning + "does not auto-update" explanation; replace the two command blocks and 5-step deployment edit with one link to `setup-guide.md#update-instructions`; keep the post-update verification lines.
- §Update Did Not Take Effect (196-218): keep symptom, cause ("clasp push alone doesn't bump the live version"), the wrong-path warning about `clasp pull`, and the verify list; replace repeated steps with the same link.
- 7th-grade pass across all sections: lead each with what the user sees and what to click; keep report-ID/function-name detail but move it after the plain-English fix, in admin-oriented sentences (model: the existing §Login/Permission Loop section).
- Keep §Registry Write Failures marked "(Advanced)" as the canonical user-visible explanation of the 9 KB limit.

### 3. `docs/first-time-user-flow.md`
- Already near target. Light pass: verify sentences stay short, confirm all UI strings still match (done — they do), keep as-is otherwise. This doc is the header-block template for the others.

### 4. `README.md`
- §Prerequisites (24-46): shrink to the 3-bullet requirement list; delete both install command blocks and the `npx clasp` note (canonical: setup-guide §Prerequisites); link there.
- §Install Checklist (48-60): keep — it's a genuinely useful overview — but strip it to checklist items only, each ≤1 line, with a lead-in "full commands in the Setup Guide". No command syntax, no dialog-setting detail duplicated from Path A.
- §Configuration: keep the `appsscript.json` table and the personal-install warning (safety-relevant, lives only here — actually move nothing; verify no full duplicate of setup-guide §8 remains: replace the Workspace-only paragraph (82) with one line + link).
- §Default Spreadsheet URL (90-94): shrink to 1-2 lines + link to `setup-guide.md#optional-org-wide-default-sheet-url`.
- §Copy Debug (155-163): shrink to 2-3 lines (what it is, where the button is) + link to `troubleshooting.md` as canonical.
- Keep intact: pitch, What It Does, Tech Stack, Project Structure, Usage Flow (high-level, complements rather than duplicates the wizard walkthrough — trim only if a sentence restates first-time-user-flow verbatim), Themes, Known Limitations, Logs & Debugging intro.

### 5. `.github/SUPPORT.md`
- Fix line 9: point setup → `docs/setup-guide.md`, usage → `docs/first-time-user-flow.md` (relative: `../docs/...`), keep ARCHITECTURE pointer.
- §Copy Debug: shrink to 1-2 lines + link to troubleshooting.
- Reconsider "internal Google Workspace tool" phrasing — app supports consumer accounts too (`README.md:26`); reword to match.

### 6. `.github/CONTRIBUTING.md`
- Fix line 60 link: `.github/ISSUE_TEMPLATE/bug_report.md` → `ISSUE_TEMPLATE/bug_report.md`.
- Consistency check only otherwise (it correctly defers testing detail elsewhere already).

### 7. `docs/ARCHITECTURE.md`, `docs/qa-runbook.md`, `.github/SECURITY.md`, `CODE_OF_CONDUCT.md`, templates
- Accuracy/consistency audit only (largely verified accurate already). Add the 1-3 sentence header block where missing (ARCHITECTURE and qa-runbook lack an audience line). No register change.

### 8. All in-scope docs
- Add/normalize the header block (purpose, audience, sibling links).
- Verify every relative link resolves after edits (see Verification).

## Acceptance Criteria

1. Every markdown link in the 11 in-scope files resolves to an existing file/anchor (checked by grep + manual anchor verification).
2. The update procedure's full command blocks + deployment-edit steps appear in exactly **one** place: `setup-guide.md` §Update Instructions. The other three former locations contain symptom/context text and a link, with zero command blocks.
3. `setup-guide.md` §First-Time User Flow is ≤3 lines and contains a link to `first-time-user-flow.md`; no wizard steps remain in it.
4. `README.md` contains no install/update command blocks (the `git clone`/`npm install -g`/`clasp` blocks are gone); Install Checklist items are single lines.
5. Copy Debug is fully explained only in `troubleshooting.md`; README and SUPPORT reference it in ≤3 lines each.
6. `CONTRIBUTING.md:60` link resolves; `SUPPORT.md` setup/usage pointers name the correct docs.
7. `first-time-user-flow.md` and `troubleshooting.md` pass a judgment read-through at ~7th-grade level: UI-visible words before jargon, short sentences, admin-only detail clearly framed as such.
8. Every in-scope doc opens with a purpose/audience header block.
9. The three code-linked filenames, their locations, and their purposes are unchanged; `Index.html`, `Code.js`, `CHANGELOG.md`, `docs/TODOS.md` have zero diff.
10. No factual content is deleted outright — everything removed as a duplicate has a surviving canonical copy that the pointer reaches in one click.

## Out of Scope

- Any change to `Index.html` or `Code.js` (including the absolute GitHub URLs in the Help menu).
- `CHANGELOG.md` and `docs/TODOS.md`.
- Automated readability tooling or CI link-checking (explicitly declined — one-time judgment review).
- Renaming, moving, splitting, or merging any doc file.
- New documentation (e.g., an FAQ) — this is consolidation and polish only.

## Verification

1. **Link check:** `grep -rnoE '\]\(([^)]+\.md[^)]*)\)' README.md docs/*.md .github/**/*.md`, then confirm each target file and `#anchor` exists (anchors: compare against `grep -n '^#' <target>`).
2. **De-dupe check:** `grep -c 'clasp push' docs/troubleshooting.md README.md` — troubleshooting may mention the command in prose but must contain no fenced update-command blocks; README must contain none.
3. **Read-through:** full pass of `first-time-user-flow.md` and `troubleshooting.md` for reading level; full pass of every edited doc for factual survival (criterion 10).
4. **Git diff review** confirming zero changes to `Index.html`, `Code.js`, `CHANGELOG.md`, `docs/TODOS.md`.
5. No build/tests apply — docs only. `npm run verify:local` still passes (it doesn't inspect docs, but confirms nothing else broke).

## Effort

Docs-only, ~1-2 h CC: setup-guide 20 min, troubleshooting 30 min (7th-grade rewrite is the bulk), README 20 min, .github files 10 min, header blocks + link verification 20 min.
