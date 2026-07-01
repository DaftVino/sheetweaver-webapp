const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const failures = [];

function read(relPath) {
  return fs.readFileSync(path.join(root, relPath), 'utf8');
}

function check(name, condition, detail) {
  if (!condition) {
    failures.push(detail ? `${name}: ${detail}` : name);
    return;
  }
  console.log(`ok - ${name}`);
}

function parseJson(relPath) {
  try {
    return JSON.parse(read(relPath));
  } catch (error) {
    failures.push(`${relPath} parses as JSON: ${error.message}`);
    return null;
  }
}

function checkScriptSyntax(relPath, source) {
  try {
    new vm.Script(source, { filename: relPath });
    check(`${relPath} JavaScript syntax`, true);
  } catch (error) {
    check(`${relPath} JavaScript syntax`, false, error.message);
  }
}

function extractInlineScripts(html) {
  const scripts = [];
  const scriptPattern = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  let match;

  while ((match = scriptPattern.exec(html)) !== null) {
    const attrs = match[1] || '';
    if (/\bsrc\s*=/.test(attrs)) continue;
    scripts.push(match[2]);
  }

  return scripts;
}

function checkPhase3Helpers(codeSource) {
  function makeGasContext(searchReturn, registry) {
    const propStore = { 'capture_registry': JSON.stringify(registry) };

    const headers = ['Date Received', 'Message ID', 'Subject'];
    const notes = [
      'System Value',
      'System Value',
      'Capture Pattern:\nSubject:\n\nDelimiter:\nnewline\n\nFormat:\ntext'
    ];
    const sheet = {
      getLastColumn: () => 3,
      getLastRow: () => 1,
      getMaxColumns: () => 10,
      getMaxRows: () => 100,
      autoResizeColumns: () => {},
      getRange: () => ({
        getValues: () => [headers],
        getNotes: () => [notes],
        setValues: () => {},
        sort: () => {}
      })
    };

    const ctx = vm.createContext({
      console: { log: () => {} },
      Session: {
        getActiveUser: () => ({ getEmail: () => 'tester@example.com' }),
        getEffectiveUser: () => ({ getEmail: () => 'tester@example.com' })
      },
      Utilities: { getUuid: () => 'ffffffff-0000-0000-0000-000000000000' },
      PropertiesService: {
        getScriptProperties: () => ({
          getProperty: k => propStore[k] || null,
          setProperty: (k, v) => { propStore[k] = v; },
          deleteProperty: k => { delete propStore[k]; }
        }),
        getUserProperties: () => ({ getProperty: () => null, setProperty: () => {} })
      },
      LockService: {
        getScriptLock: () => ({ tryLock: () => true, releaseLock: () => {} })
      },
      ScriptApp: {
        getProjectTriggers: () => [],
        AuthMode: { FULL: 'FULL' },
        getAuthorizationInfo: () => ({
          getAuthorizationStatus: () => ({ toString: () => 'NOT_REQUIRED' }),
          getAuthorizationUrl: () => null
        }),
        newTrigger: () => ({ timeBased: () => ({ everyMinutes: () => ({ create: () => {} }) }) })
      },
      SpreadsheetApp: {
        openByUrl: () => ({ getSheetByName: () => sheet, insertSheet: () => sheet })
      },
      GmailApp: {
        search: () => searchReturn,
        getUserLabelByName: () => ({}),
        getUserLabels: () => []
      },
      HtmlService: {
        createHtmlOutputFromFile: () => ({ setTitle: () => ({}), setXFrameOptionsMode: () => ({}) }),
        XFrameOptionsMode: { ALLOWALL: 'ALLOWALL' }
      },
      _propStore: propStore
    });

    return ctx;
  }

  function makeThreads(count) {
    const threads = [];
    for (let i = 0; i < count; i++) {
      const id = 'msg_' + i;
      const subj = 'Test ' + i;
      threads.push({
        getMessages: () => [{
          getId: () => id,
          getDate: () => new Date('2024-01-01'),
          getPlainBody: () => 'Subject: ' + subj
        }]
      });
    }
    return threads;
  }

  // Test 1: recordConnectionRun sets expected fields
  try {
    const ctx1 = vm.createContext({
      console: { log: () => {} },
      Session: { getActiveUser: () => ({ getEmail: () => '' }), getEffectiveUser: () => ({ getEmail: () => '' }) },
      Utilities: { getUuid: () => 'aaaaaaaa-0000-0000-0000-000000000000' },
      PropertiesService: {
        getScriptProperties: () => ({ getProperty: () => null, setProperty: () => {}, deleteProperty: () => {} }),
        getUserProperties: () => ({ getProperty: () => null, setProperty: () => {} })
      },
      ScriptApp: { getProjectTriggers: () => [], AuthMode: { FULL: 'FULL' }, getAuthorizationInfo: () => ({ getAuthorizationStatus: () => ({ toString: () => 'NOT_REQUIRED' }), getAuthorizationUrl: () => null }), newTrigger: () => ({ timeBased: () => ({ everyMinutes: () => ({ create: () => {} }) }) }) },
      SpreadsheetApp: {}, LockService: {}, GmailApp: {},
      HtmlService: { createHtmlOutputFromFile: () => ({ setTitle: () => ({}), setXFrameOptionsMode: () => ({}) }), XFrameOptionsMode: { ALLOWALL: 'ALLOWALL' } }
    });
    vm.runInContext(codeSource, ctx1);
    vm.runInContext(
      'var _c = {}; recordConnectionRun(_c, { status: "ok", reportId: "r1", error: null, counts: { scanned: 5, new: 2, updated: 1 }, durationMs: 3000 });',
      ctx1
    );
    check('recordConnectionRun sets lastRunStatus', vm.runInContext('_c.lastRunStatus', ctx1) === 'ok');
    check('recordConnectionRun sets lastCounts', (function() {
      const c = vm.runInContext('_c.lastCounts', ctx1);
      return c && c.new === 2 && c.updated === 1 && c.scanned === 5;
    })());
    check('recordConnectionRun sets lastDurationMs', vm.runInContext('_c.lastDurationMs', ctx1) === 3000);
  } catch(e) {
    failures.push('Phase 3 recordConnectionRun: ' + e.message);
  }

  // Test 2: "all" sync with full batch (100) → cursor advances, lastSyncTime NOT set
  try {
    const registry2 = [{
      userEmail: 'tester@example.com', gmailLabel: 'TestLabel', tabName: 'TestTab',
      spreadsheetUrl: 'https://fake/sheet', isPaused: false,
      initialSync: 'all', lastSyncTime: null, syncCursor: 0
    }];
    const ctx2 = makeGasContext(makeThreads(100), registry2);
    vm.runInContext(codeSource, ctx2);
    vm.runInContext('processEmails()', ctx2);
    const fresh2 = JSON.parse(ctx2._propStore['capture_registry'])[0];
    check('all-sync full batch advances syncCursor to 100', fresh2.syncCursor === 100);
    check('all-sync full batch does not set lastSyncTime', fresh2.lastSyncTime === null);
  } catch(e) {
    failures.push('Phase 3 cursor-advance: ' + e.message);
  }

  // Test 3: "all" sync with final batch (< 100) → cursor cleared, lastSyncTime set, counts tracked
  try {
    const registry3 = [{
      userEmail: 'tester@example.com', gmailLabel: 'TestLabel', tabName: 'TestTab',
      spreadsheetUrl: 'https://fake/sheet', isPaused: false,
      initialSync: 'all', lastSyncTime: null, syncCursor: 100
    }];
    const ctx3 = makeGasContext(makeThreads(50), registry3);
    vm.runInContext(codeSource, ctx3);
    vm.runInContext('processEmails()', ctx3);
    const fresh3 = JSON.parse(ctx3._propStore['capture_registry'])[0];
    check('all-sync final batch clears syncCursor', fresh3.syncCursor === null);
    check('all-sync final batch sets lastSyncTime', typeof fresh3.lastSyncTime === 'number');
    check('all-sync final batch accumulates lastCounts.new', fresh3.lastCounts && fresh3.lastCounts.new === 50);
  } catch(e) {
    failures.push('Phase 3 cursor-complete: ' + e.message);
  }
}

function checkPureHelpers(codeSource) {
  const context = vm.createContext({ console });

  try {
    vm.runInContext(codeSource, context, { filename: 'Code.js' });
    const escaped = vm.runInContext("sanitizeGmailLabel('John\\\\ \"Inbox\"')", context);
    check('sanitizeGmailLabel escapes search-sensitive characters', escaped === 'John\\\\ \\"Inbox\\"');

    const currency = vm.runInContext("applyRules('Total: $12.34\\nName: Jane', 'Total:', 'newline', 'currency')", context);
    check('applyRules extracts currency numbers', currency === 12.34);

    const after = vm.runInContext("applyRules('Status: ready for review', 'Status:', 'after', 'text')", context);
    check('applyRules supports after delimiter', after === 'ready for review');

    const missing = vm.runInContext("applyRules('No matching field', 'Total:', 'newline', 'text')", context);
    check('applyRules returns empty string for missing pattern', missing === '');
  } catch (error) {
    failures.push(`pure helper checks: ${error.message}`);
  }
}

function checkIsAdmin(codeSource) {
  function makeCtx(adminProperty) {
    return vm.createContext({
      console: { log: () => {} },
      PropertiesService: {
        getScriptProperties: () => ({ getProperty: () => adminProperty, setProperty: () => {}, deleteProperty: () => {} }),
        getUserProperties: () => ({ getProperty: () => null, setProperty: () => {} })
      },
      Session: { getActiveUser: () => ({ getEmail: () => '' }), getEffectiveUser: () => ({ getEmail: () => '' }) },
      Utilities: { getUuid: () => 'bbbbbbbb-0000-0000-0000-000000000000' },
      ScriptApp: { getProjectTriggers: () => [], AuthMode: { FULL: 'FULL' }, getAuthorizationInfo: () => ({ getAuthorizationStatus: () => ({ toString: () => 'NOT_REQUIRED' }), getAuthorizationUrl: () => null }), newTrigger: () => ({ timeBased: () => ({ everyMinutes: () => ({ create: () => {} }) }) }) },
      SpreadsheetApp: {}, LockService: {}, GmailApp: {},
      HtmlService: { createHtmlOutputFromFile: () => ({ setTitle: () => ({}), setXFrameOptionsMode: () => ({}) }), XFrameOptionsMode: { ALLOWALL: 'ALLOWALL' } }
    });
  }

  try {
    const ctxMatch = makeCtx('Admin@Example.com');
    vm.runInContext(codeSource, ctxMatch);
    check('isAdmin exact-case match returns true', vm.runInContext("isAdmin('Admin@Example.com')", ctxMatch) === true);
    check('isAdmin is case-insensitive', vm.runInContext("isAdmin('admin@example.com')", ctxMatch) === true);
    check('isAdmin rejects non-matching email', vm.runInContext("isAdmin('someone-else@example.com')", ctxMatch) === false);

    const ctxEmpty = makeCtx('');
    vm.runInContext(codeSource, ctxEmpty);
    check('isAdmin returns false when no admin is set', vm.runInContext("isAdmin('admin@example.com')", ctxEmpty) === false);
  } catch (error) {
    failures.push(`isAdmin checks: ${error.message}`);
  }
}

function checkLocalStorageConvention(htmlSrc) {
  // CLAUDE.md mandates all localStorage access goes through _lsGet/_lsSet
  // (their try/catch wrappers keep Safari private-mode SecurityErrors from
  // throwing). This guards against a future call site bypassing them.
  const directCalls = (htmlSrc.match(/localStorage\.(getItem|setItem)\s*\(/g) || []).length;
  const wrapperDefinitions = (htmlSrc.match(/function _ls(Get|Set)\([^)]*\)\s*\{[^}]*localStorage\.(getItem|setItem)/g) || []).length;
  check('localStorage accessed only via _lsGet/_lsSet wrappers', directCalls === wrapperDefinitions,
    `found ${directCalls} localStorage.getItem/setItem call(s), expected ${wrapperDefinitions} (inside the wrapper definitions only)`);
}

function checkAdminUnauthorizedShape(codeSource) {
  // loadAdminPanel (Index.html) branches on `.success === false`, not the old
  // `{authorized: false}` shape — a regression here silently breaks the admin panel.
  const unauthorizedShapePattern = /if\s*\(!isAdmin\(caller\)\)\s*return\s*\{\s*success:\s*false,\s*error:/;
  const matches = codeSource.match(/if\s*\(!isAdmin\(caller\)\)\s*return\s*\{[^}]*\}/g) || [];
  check('getAdminDiagnostics/checkForUpdates return {success:false,error:...} on unauthorized',
    matches.length >= 2 && matches.every(m => unauthorizedShapePattern.test(m)),
    `expected 2 unauthorized guards using {success:false,error:...}, found: ${JSON.stringify(matches)}`);
}

function checkPhase4Helpers(htmlSrc) {
  // Verify no user-data values appear inside onclick= attribute strings
  // These patterns were the stored-XSS vectors before Phase 4
  const onclickUserDataPattern = /onclick="[^"]*(?:conn\.|tabName|spreadsheetUrl|userEmail|gmailLabel)/;
  check('Phase 4: no user-data interpolation in onclick attributes', !onclickUserDataPattern.test(htmlSrc));

  // Verify the old tr.innerHTML bulk-row assignment is gone
  const bulkInnerHTMLPattern = /tr\.innerHTML\s*=\s*`[\s\S]{0,500}conn\.(userEmail|gmailLabel|tabName|spreadsheetUrl)/;
  check('Phase 4: tr.innerHTML does not interpolate user-data connection fields', !bulkInnerHTMLPattern.test(htmlSrc));

  // Verify DOM-safe patterns are present: textContent assigned to td elements
  check('Phase 4: textContent used for connection fields in dashboard rows',
    /tdEmail\.textContent\s*=/.test(htmlSrc) && /tdLabel\.textContent\s*=/.test(htmlSrc));

  // Verify addEventListener is used for action links (replaces inline onclick)
  check('Phase 4: addEventListener used for action buttons', /addEventListener\s*\(\s*'click'/.test(htmlSrc));

  // Simulate DOM rendering with jsdom-lite: verify special chars in tabName/spreadsheetUrl
  // don't break by checking that textContent and href assignment are the only insertion points.
  // We can verify this statically: conn.tabName must only appear as .textContent or a.href or s.title.
  // [^\n;]* is line-scoped: prevents matching across unrelated lines
  const dangerousTabNameInHTML = /innerHTML[^\n;]*conn\.tabName|conn\.tabName[^\n;]*innerHTML/;
  check('Phase 4: conn.tabName never assigned via innerHTML', !dangerousTabNameInHTML.test(htmlSrc));

  const dangerousUrlInHTML = /innerHTML[^\n;]*conn\.spreadsheetUrl|conn\.spreadsheetUrl[^\n;]*innerHTML/;
  check('Phase 4: conn.spreadsheetUrl never assigned via innerHTML', !dangerousUrlInHTML.test(htmlSrc));

  const dangerousEmailInHTML = /innerHTML[^;]*conn\.userEmail(?!\s*\+\s*['"])|conn\.userEmail(?!\s*\+\s*['"])[^;]*innerHTML/;
  check('Phase 4: conn.userEmail never assigned directly via innerHTML', !dangerousEmailInHTML.test(htmlSrc));
}

const requiredFiles = [
  'Code.js',
  'Index.html',
  'appsscript.json',
  'package.json',
  'docs/setup-guide.md',
  'docs/troubleshooting.md',
  'docs/qa-runbook.md'
];

for (const relPath of requiredFiles) {
  check(`${relPath} exists`, fs.existsSync(path.join(root, relPath)));
}

const appsscript = parseJson('appsscript.json');
if (appsscript) {
  check('appsscript uses V8 runtime', appsscript.runtimeVersion === 'V8');
  check('appsscript logs to Stackdriver', appsscript.exceptionLogging === 'STACKDRIVER');
  check('web app runs as accessing user', appsscript.webapp && appsscript.webapp.executeAs === 'USER_ACCESSING');
  check('web app access is declared', Boolean(appsscript.webapp && appsscript.webapp.access));
  check('web app access is ANYONE (signed-in Google accounts)', appsscript.webapp && appsscript.webapp.access === 'ANYONE');
}

const packageJson = parseJson('package.json');
if (packageJson) {
  check('npm verify:local script is configured', packageJson.scripts && packageJson.scripts['verify:local'] === 'node scripts/local-verify.js');
  check('@google/clasp dev dependency is present', Boolean(packageJson.devDependencies && packageJson.devDependencies['@google/clasp']));
}

const codeSource = read('Code.js');
checkScriptSyntax('Code.js', codeSource);
checkPureHelpers(codeSource);
checkPhase3Helpers(codeSource);
checkIsAdmin(codeSource);
checkAdminUnauthorizedShape(codeSource);

const htmlSource = read('Index.html');
const inlineScripts = extractInlineScripts(htmlSource);
check('Index.html has inline app script', inlineScripts.length > 0);
inlineScripts.forEach((script, index) => {
  checkScriptSyntax(`Index.html <script #${index + 1}>`, script);
});
checkPhase4Helpers(htmlSource);
checkLocalStorageConvention(htmlSource);

// Phase 4 (branding): branding presence checks
check('Phase 4 (branding): Index.html contains app-logo img', htmlSource.includes('class="app-logo"'));
check('Phase 4 (branding): Index.html no longer has plain h2 title', !htmlSource.includes('<h2>Email Tracker Setup</h2>'));

// Phase 1 (debug surfacing): new surface checks
check('Phase 1: Code.js defines logClientError', /function logClientError\s*\(/.test(codeSource));
check('Phase 1: Code.js defines getDebugSnapshot', /function getDebugSnapshot\s*\(/.test(codeSource));
check('Phase 1: Index.html has Copy Debug button', htmlSource.includes('id="copyDebugBtn"'));
check('Phase 1: Index.html defines copyDebugInfo function', htmlSource.includes('function copyDebugInfo('));
check('Phase 1: Index.html defines _logFailure helper', htmlSource.includes('function _logFailure('));
check('Phase 1: Index.html has client debug buffer', htmlSource.includes('const _dbg = '));

if (failures.length > 0) {
  console.error('\nLocal verification failed:');
  failures.forEach(failure => console.error(`- ${failure}`));
  process.exit(1);
}

console.log('\nLocal verification passed.');
console.log('Note: Gmail, Sheets, OAuth, triggers, Cloud Logging, and non-owner identity require Apps Script integration testing.');
