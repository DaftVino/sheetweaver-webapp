# Support

Where to get help with SheetWeaver, for users and admins. For contributing code changes see [CONTRIBUTING.md](CONTRIBUTING.md).

## Getting Help

SheetWeaver runs on Google Apps Script, for both consumer `@gmail.com` and Google Workspace accounts. Support channels depend on how your organization has deployed it.

### Self-service

1. **Read the docs** — [Setup Guide](../docs/setup-guide.md) covers install and update; [First-Time User Guide](../docs/first-time-user-flow.md) covers everyday usage; [ARCHITECTURE.md](../docs/ARCHITECTURE.md) covers how it works internally.
2. **Check execution logs** — In the Apps Script editor, go to **Executions** to see recent runs and any error stack traces. Detailed logs are also in **Google Cloud Console → Logging** (search for the script project).
3. **Copy Debug** — click the button in the header and paste the output into your report. Full explanation: [Troubleshooting Guide](../docs/troubleshooting.md).

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
