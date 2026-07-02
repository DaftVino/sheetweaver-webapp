# CLAUDE.md

<!-- Starter template. Copy to repo root as CLAUDE.md, fill in the <angle-bracket> sections, delete this comment. Keep under ~60 lines — this is a router, not a manual. -->

## Project

<2–3 lines: what this app is, who uses it, the platform it runs on.>

## Key docs

- Architecture: `docs/architecture.md`
- Conventions: this repo follows [engineering-standards/repo-standards.md](<link to standards repo>)
- Decisions: `docs/adr/` — read before proposing architectural changes
- Active plans: `docs/designs/`

## Commands

```
<verify:   npm run verify / node scripts/local-verify.js>
<test:     npm test>
<deploy:   clasp push / …>
```

Run verify before every push. Never deploy without being asked.

## Workflow rules (non-negotiable)

1. Bugs/tasks live in GitHub Issues. `gh issue view N` before starting; `gh issue comment N` with findings.
2. Non-trivial work (multi-PR, persisted-data changes, risky) gets a design doc in `docs/designs/YYYY-MM-DD-slug.md` before code.
3. Never commit to `main`. Branch `type/N-slug`, Conventional Commits, PR with `Fixes #N`, squash-merge.
4. Tests are code in `tests/`, in the same PR as the change.
5. If a change conflicts with an ADR, stop and propose a superseding ADR — don't work around it.
6. Never commit secrets. Real keys live only in gitignored files with committed `*.example` twins. If a secret lands in history, say so immediately — the credential must be rotated.

## Repo-specific constraints

<hard limits agents must respect, e.g. "capture_registry property caps at ~9KB", "executeAs must stay USER_ACCESSING", "no new UrlFetch calls without quota-check">
