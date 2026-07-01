# Support

## Getting Help

This is an internal Google Workspace tool. Support channels depend on how your organization has deployed it.

### Self-service

1. **Read the docs** — [README.md](README.md) covers setup and usage. [ARCHITECTURE.md](ARCHITECTURE.md) covers how it works internally.
2. **Check execution logs** — In the Apps Script editor, go to **Executions** to see recent runs and any error stack traces. Detailed logs are also in **Google Cloud Console → Logging** (search for the script project).
3. **Copy Debug** — Click the **Copy Debug** button in the header of the web app. It produces a formatted snapshot (app version, your connections, recent error report IDs, browser context) that you can paste into a GitHub Issue or a support message. This is the fastest way to give the admin the exact detail they need.

### GitHub Issues

For bugs or feature requests, [open an issue](../../issues/new/choose) and use the appropriate template.

Before opening an issue, please check:
- [ ] The issue isn't already tracked in open issues
- [ ] You've checked the execution logs for error details
- [ ] You can reproduce the problem consistently

### What to Include in a Bug Report

- What you expected to happen
- What actually happened
- The Gmail label name and approximate number of emails in it
- Any error messages from the Apps Script Executions panel
- Whether the trigger is enabled (visible on the dashboard banner)

## Out of Scope for Support

- General Google Workspace or Gmail questions
- Issues with Google's own APIs (GmailApp, SpreadsheetApp)
- Problems caused by modifications to the code outside of this repository
