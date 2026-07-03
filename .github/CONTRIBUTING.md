# Contributing

Thank you for taking the time to contribute. This doc is for developers changing `Code.js` or `Index.html`; for using the app see the [First-Time User Guide](../docs/first-time-user-flow.md).

## Before You Start

- Check [open issues](../../issues) to see if your bug or idea is already tracked.
- For significant changes, open an issue first to discuss the approach before writing code.

## Development Setup

```bash
npm install          # install @google/clasp
npx clasp login      # authenticate with your Google account
npx clasp push       # deploy to the bound Apps Script project
```

You need a Google account (consumer `@gmail.com` or Google Workspace) that has edit access to the script project. Ask a maintainer to share the script with you.

## Making Changes

1. Fork the repo and create a branch from `main`.
2. Edit `Code.js` (backend) or `Index.html` (frontend).
3. Push with `clasp push` and test manually in the deployed web app.
4. Keep changes focused — one concern per pull request.

## Testing

Run the local static gate first:

```bash
npm run verify:local
```

Then manual testing in the deployed web app:

- Open the deployed web app URL after pushing.
- Walk through the full setup flow: verify a Gmail label, configure fields, save, confirm the tab is created.
- Check the dashboard: edit, rest, delete, and mend a thread.
- Wait for or manually trigger `processEmails()` via **Apps Script → Run function** and confirm rows appear in the sheet.
- Test with labels that have special characters, empty labels, and labels with no emails.
- Click **Copy Debug** after each key action and verify the snapshot includes your thread status and recent events. Include the Copy Debug output in your PR description as evidence of manual testing.

## Pull Request Checklist

- [ ] No unrelated changes or reformatting mixed in
- [ ] Manually tested the affected flows
- [ ] `clasp push` succeeds without errors
- [ ] No credentials, tokens, or personal Sheet URLs committed
- [ ] PR description explains what changed and why

## Code Style

- Vanilla JavaScript only — no frameworks or bundlers.
- Match the existing indentation and naming conventions in `Code.js` and `Index.html`.
- Keep server-side and client-side code clearly separated; do not add `<script>` tags that call Apps Script services directly.

## Reporting Bugs

Use the [bug report template](ISSUE_TEMPLATE/bug_report.md). Include:
- Steps to reproduce
- Expected vs. actual behavior
- Your Google Workspace domain type (if known)
- Any errors visible in **Apps Script → Executions**
