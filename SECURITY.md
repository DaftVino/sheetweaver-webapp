# Security Policy

## Supported Versions

Only the latest deployed version of this script is actively maintained.

## Reporting a Vulnerability

**Do not open a public GitHub issue for security vulnerabilities.**

To report a vulnerability, email the maintainer directly or use GitHub's private [security advisory](../../security/advisories/new) feature.

Please include:
- A description of the vulnerability and its potential impact
- Steps to reproduce or a proof-of-concept
- Any suggested remediation if you have one

You can expect an acknowledgment within 5 business days and a resolution or status update within 30 days.

## Scope

This project runs entirely on Google's infrastructure as a Google Apps Script web app. The attack surface is limited, but relevant concerns include:

- **Cross-user data leakage** — the shared `capture_registry` property stores connection metadata for all users. A bug here could expose another user's label names or spreadsheet URLs. The `getDebugSnapshot()` function mitigates this by filtering the registry to the caller's own connections only and is safe to call as a non-admin; it does not expose other users' data.
- **XSS in the web UI** — `Index.html` renders user-supplied values (label names, tab names). Improperly escaped output could allow script injection. All user-data values are assigned via `textContent` or safe DOM properties, never via `innerHTML`.
- **Scope creep** — the Apps Script OAuth scopes (`gmail.readonly`, `spreadsheets`, `script.projects`) should remain minimal. Adding unnecessary scopes is a security concern.
- **Credential exposure** — `.clasprc.json` contains OAuth refresh tokens. It must never be committed to version control (it is listed in `.gitignore`).

## Out of Scope

- Google's own infrastructure, APIs, and OAuth system
- Vulnerabilities in `@google/clasp` itself (report those to the clasp project)
- Social engineering attacks against Google account holders
