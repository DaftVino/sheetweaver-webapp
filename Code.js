const APP_VERSION = '2.0.0';

const DEFAULT_SPREADSHEET_URL = '';
const USER_DEFAULT_SPREADSHEET_URL_KEY = 'user_default_spreadsheet_url';
const ADMIN_DEFAULT_SPREADSHEET_URL_KEY = 'default_spreadsheet_url';

function getUserDefaultSpreadsheetUrl() {
  return PropertiesService.getUserProperties().getProperty(USER_DEFAULT_SPREADSHEET_URL_KEY)
    || PropertiesService.getScriptProperties().getProperty(ADMIN_DEFAULT_SPREADSHEET_URL_KEY)
    || DEFAULT_SPREADSHEET_URL;
}

function setUserDefaultSpreadsheetUrl(url) {
  if (!url) return;
  PropertiesService
    .getUserProperties()
    .setProperty(USER_DEFAULT_SPREADSHEET_URL_KEY, url);
}

function doGet() {
  // setFaviconUrl requires a public https URL — becomes active once the repo is public.
  return HtmlService.createHtmlOutputFromFile('Index')
      .setTitle('Ops Email Tracker Setup')
      // Must be set server-side: HtmlService ignores <meta> tags placed in the file's <head>.
      // Without this the mobile layout renders at desktop width and looks tiny on phones.
      .addMetaTag('viewport', 'width=device-width, initial-scale=1')
      .setFaviconUrl('https://raw.githubusercontent.com/DaftVino/SheetWeaver-Webapp/main/Logo/Flavicon/favicon-32x32.png')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function getActiveEmail() {
  return Session.getActiveUser().getEmail();
}

// ==========================================
// ADMIN & DIAGNOSTICS
// ==========================================
const ADMIN_EMAIL_KEY = 'admin_email';
const DIAG_INDEX_KEY = 'diag_index';
const DIAG_MAX = 50;

// Update-check endpoint — replace OWNER/REPO when the repo is public.
// The app handles fetch failures silently so a placeholder URL is safe.
const VERSION_ENDPOINT_URL = 'https://api.github.com/repos/DaftVino/SheetWeaver-Webapp/releases/latest';
const UPDATE_CHECK_RESULT_KEY = 'update_check_result';
const UPDATE_CHECK_TS_KEY = 'update_check_ts';
const UPDATE_CHECK_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const REGISTRY_KEY = 'capture_registry';

function isAdmin(email) {
  if (!email) return false;
  const admin = PropertiesService.getScriptProperties().getProperty(ADMIN_EMAIL_KEY) || '';
  return admin !== '' && email.toLowerCase() === admin.toLowerCase();
}

function bootstrapAdmin() {
  const props = PropertiesService.getScriptProperties();
  if (props.getProperty(ADMIN_EMAIL_KEY)) return { alreadySet: true };
  const effectiveEmail = Session.getEffectiveUser().getEmail();
  if (!effectiveEmail) return { success: false, error: 'Could not determine effective user.' };
  props.setProperty(ADMIN_EMAIL_KEY, effectiveEmail);
  return { success: true, adminEmail: effectiveEmail };
}

function setAdminEmail(email) {
  const caller = getActiveEmail();
  if (!isAdmin(caller)) return { success: false, error: 'Not authorized.' };
  if (!email) return { success: false, error: 'Email required.' };
  PropertiesService.getScriptProperties().setProperty(ADMIN_EMAIL_KEY, email.trim().toLowerCase());
  return { success: true };
}

function newReportId() {
  return Utilities.getUuid().slice(0, 8);
}

function logDiag(level, where, payload) {
  const reportId = newReportId();
  const user = getActiveEmail();
  const obj = Object.assign({ reportId: reportId, ts: new Date().toISOString(), user: user, where: where, level: level }, payload || {});
  console.log('[DIAG] ' + JSON.stringify(obj));
  try {
    const props = PropertiesService.getScriptProperties();
    props.setProperty('diag_' + reportId, JSON.stringify(obj)); // single-key write: no race
    const lock = LockService.getScriptLock();
    if (lock.tryLock(3000)) {
      try {
        let index = JSON.parse(props.getProperty(DIAG_INDEX_KEY) || '[]');
        index.unshift(reportId);
        if (index.length > DIAG_MAX) {
          const removed = index.splice(DIAG_MAX);
          removed.forEach(function(id) { try { props.deleteProperty('diag_' + id); } catch(e) {} });
        }
        props.setProperty(DIAG_INDEX_KEY, JSON.stringify(index));
      } finally {
        lock.releaseLock();
      }
    }
    // If lock timed out, diag_<reportId> is still stored and visible in Cloud Logging.
  } catch(e) {
    console.log('[logDiag:store] ' + e.toString());
  }
  return reportId;
}

function recordConnectionRun(conn, result) {
  conn.lastRunStatus = result.status;
  conn.lastRunAt = new Date().toISOString();
  conn.lastRunReportId = result.reportId || null;
  conn.lastError = result.error || null;
  conn.lastCounts = result.counts;
  conn.lastDurationMs = result.durationMs;
  if (result.bodyType) conn.lastBodyType = result.bodyType;
}

function looksLikeHtml(text) {
  return /<[a-z][\s\S]*?>/i.test(text.substring(0, 2000));
}

function stripHtmlToPlain(html) {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(?:p|div|tr|li|h[1-6])\s*>/gi, '\n')
    .replace(/<\/td\s*>/gi, '\t')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, function(m, n) { return String.fromCharCode(parseInt(n, 10)); })
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// Returns { text, type } — type is 'plain' | 'html' | 'empty'
function getEmailBody(msg) {
  var plain = msg.getPlainBody();
  if (!plain || plain.trim() === '') return { text: '', type: 'empty' };
  if (looksLikeHtml(plain)) return { text: stripHtmlToPlain(plain), type: 'html' };
  return { text: plain, type: 'plain' };
}

function getAdminDiagnostics() {
  const caller = getActiveEmail();
  if (!isAdmin(caller)) return { success: false, error: 'Not authorized.' };
  const props = PropertiesService.getScriptProperties();
  const index = JSON.parse(props.getProperty(DIAG_INDEX_KEY) || '[]');
  const events = index.map(function(id) {
    try {
      const raw = props.getProperty('diag_' + id);
      return raw ? JSON.parse(raw) : null;
    } catch(e) { return null; }
  }).filter(Boolean);
  const registryRaw = props.getProperty(REGISTRY_KEY) || '[]';
  const registry = JSON.parse(registryRaw);
  const registryByteSize = registryRaw.length;
  const perUserCounts = {};
  registry.forEach(function(conn) {
    perUserCounts[conn.userEmail] = (perUserCounts[conn.userEmail] || 0) + 1;
  });
  return {
    authorized: true,
    events: events,
    registryHealth: {
      connectionCount: registry.length,
      perUserCounts: perUserCounts,
      byteSize: registryByteSize,
      byteCap: 9000,
      byteUsedPct: Math.round(registryByteSize / 90),
      hasTrigger: checkUserTrigger()
    }
  };
}

function clearAdminDiagnostics() {
  const caller = getActiveEmail();
  if (!isAdmin(caller)) return { success: false, error: 'Not authorized.' };
  const props = PropertiesService.getScriptProperties();
  const index = JSON.parse(props.getProperty(DIAG_INDEX_KEY) || '[]');
  index.forEach(function(id) { try { props.deleteProperty('diag_' + id); } catch(e) {} });
  props.deleteProperty(DIAG_INDEX_KEY);
  return { success: true };
}

function logClientError(payload) {
  return logDiag('error', (payload && payload.where) || 'client', payload || {});
}

function getDebugSnapshot() {
  const email = getActiveEmail();
  const props = PropertiesService.getScriptProperties();
  const registry = JSON.parse(props.getProperty(REGISTRY_KEY) || '[]');
  const myConns = registry
    .filter(function(c) { return c.userEmail === email; })
    .map(function(c) {
      return {
        label: c.gmailLabel,
        tabName: c.tabName,
        paused: c.isPaused || false,
        lastRunStatus: c.lastRunStatus || null,
        lastRunAt: c.lastRunAt || null,
        lastRunReportId: c.lastRunReportId || null,
        lastError: c.lastError || null,
        lastCounts: c.lastCounts || null,
        lastBodyType: c.lastBodyType || null
      };
    });
  return {
    appVersion: APP_VERSION,
    serverTime: new Date().toISOString(),
    email: email,
    connections: myConns,
    triggerActive: checkUserTrigger()
  };
}

const UPDATE_CHECK_ERROR_BACKOFF_MS = 60 * 60 * 1000; // 1-hour backoff on fetch errors

function checkForUpdates() {
  const caller = getActiveEmail();
  if (!isAdmin(caller)) return { success: false, error: 'Not authorized.' };
  const props = PropertiesService.getScriptProperties();
  const cachedTs = parseInt(props.getProperty(UPDATE_CHECK_TS_KEY) || '0', 10);
  const now = Date.now();
  if (now - cachedTs < UPDATE_CHECK_TTL_MS) {
    try {
      const cached = JSON.parse(props.getProperty(UPDATE_CHECK_RESULT_KEY) || 'null');
      if (cached) return cached;
    } catch(e) {}
    // Inside TTL window but no valid cached result means backoff is active — skip live fetch.
    return { error: true };
  }
  // Write a short-TTL backoff timestamp before fetching so that concurrent or
  // repeated calls during an outage do not each fire a live network request.
  const backoffTs = String(now - UPDATE_CHECK_TTL_MS + UPDATE_CHECK_ERROR_BACKOFF_MS);
  try {
    props.setProperty(UPDATE_CHECK_TS_KEY, backoffTs);
    const response = UrlFetchApp.fetch(VERSION_ENDPOINT_URL, { muteHttpExceptions: true });
    if (response.getResponseCode() !== 200) return { error: true };
    const data = JSON.parse(response.getContentText());
    const latestTag = (data.tag_name || '').replace(/^v/, '');
    if (!latestTag) return { error: true }; // draft/tagless release — skip caching
    const currentTag = APP_VERSION.replace(/^v/, '');
    const result = {
      upToDate: latestTag === currentTag,
      currentVersion: APP_VERSION,
      latestVersion: latestTag,
      releaseUrl: data.html_url || null,
      checkedAt: new Date().toISOString()
    };
    props.setProperty(UPDATE_CHECK_RESULT_KEY, JSON.stringify(result));
    props.setProperty(UPDATE_CHECK_TS_KEY, String(now)); // full TTL on success
    return result;
  } catch(e) {
    return { error: true }; // backoffTs already written above
  }
}

function checkAuthorization() {
  var activeEmail = getActiveEmail();
  var authUrl = null;
  var status = 'NOT_REQUIRED';
  try {
    var authInfo = ScriptApp.getAuthorizationInfo(ScriptApp.AuthMode.FULL);
    status = authInfo.getAuthorizationStatus().toString();
    authUrl = authInfo.getAuthorizationUrl();
  } catch(e) {}
  var gmailOk = false;
  var sheetsOk = false;
  try { GmailApp.getUserLabels(); gmailOk = true; } catch(e) {}
  try { SpreadsheetApp.getActiveSpreadsheet(); sheetsOk = true; } catch(e) {}
  return { status: status, authUrl: authUrl, gmailOk: gmailOk, sheetsOk: sheetsOk, activeEmail: activeEmail };
}

function sanitizeGmailLabel(label) {
  if (!label) return '';
  // Escape backslashes first, then double quotes — order matters
  return String(label).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

// ==========================================
// USER THEME PREFERENCE
// ==========================================
function getUserThemePreference() {
  const theme = PropertiesService.getUserProperties().getProperty('ui_theme');
  const allowedThemes = ['solar', 'torres', 'nes'];
  return allowedThemes.includes(theme) ? theme : 'solar';
}

function setUserThemePreference(themeName) {
  const allowedThemes = ['solar', 'torres', 'nes'];
  const safeTheme = allowedThemes.includes(themeName) ? themeName : 'solar';
  PropertiesService.getUserProperties().setProperty('ui_theme', safeTheme);
  return safeTheme;
}

// ==========================================
// TRIGGER MANAGEMENT
// ==========================================
function checkUserTrigger() {
  const triggers = ScriptApp.getProjectTriggers();
  return triggers.some(t => t.getHandlerFunction() === 'processEmails');
}

function enableUserTrigger() {
  const triggers = ScriptApp.getProjectTriggers();
  const processTriggers = triggers.filter(t => t.getHandlerFunction() === 'processEmails');

  if (processTriggers.length > 1) {
    // Keep the first one, delete any duplicates
    for (let i = 1; i < processTriggers.length; i++) {
      try {
        ScriptApp.deleteTrigger(processTriggers[i]);
      } catch (e) {
        console.log('[enableUserTrigger:deleteDuplicate] ' + e.toString());
      }
    }
  } else if (processTriggers.length === 0) {
    ScriptApp.newTrigger('processEmails')
             .timeBased()
             .everyMinutes(15)
             .create();
  }
  return true;
}

// ==========================================
// REGISTRY & DASHBOARD LOGIC 
// ==========================================
function getDashboardData() {
  try {
  const email = getActiveEmail();
  const props = PropertiesService.getScriptProperties();

  let registry = JSON.parse(props.getProperty(REGISTRY_KEY) || '[]');
  let connections = [];

  registry.forEach(conn => {
    let isOwner = (conn.userEmail === email);
    let gmailActive = true;
    let sheetActive = true;
    let accessDenied = false;

    // Only run health checks if the user actually owns the connection
    if (isOwner) {
      gmailActive = false;
      try {
        if (GmailApp.getUserLabelByName(conn.gmailLabel) !== null) gmailActive = true;
      } catch(e) {
        logDiag('WARN', 'getDashboardData:gmailLabel', { errorClass: e.name, message: e.message, gmailLabel: conn.gmailLabel });
      }

      try {
        const ss = SpreadsheetApp.openByUrl(conn.spreadsheetUrl);
        const sheet = ss.getSheetByName(conn.tabName);
        if (sheet) sheetActive = true;
      } catch(e) {
        logDiag('WARN', 'getDashboardData:sheet', { errorClass: e.name, message: e.message, tabName: conn.tabName });
        accessDenied = true;
      }
    }

    connections.push({
      userEmail: conn.userEmail,
      gmailLabel: conn.gmailLabel,
      tabName: conn.tabName,
      sheetId: conn.sheetId,
      spreadsheetUrl: conn.spreadsheetUrl,
      gmailActive: gmailActive,
      sheetActive: sheetActive,
      accessDenied: accessDenied,
      isPaused: conn.isPaused || false,
      isOwner: isOwner,
      lastSyncTime: conn.lastSyncTime || null,
      lastRunStatus: conn.lastRunStatus || null,
      lastRunAt: conn.lastRunAt || null,
      lastRunReportId: conn.lastRunReportId || null,
      lastError: conn.lastError || null,
      lastCounts: conn.lastCounts || null,
      lastDurationMs: conn.lastDurationMs || null
    });
  });

  const hasTrigger = checkUserTrigger();
  return { connections: connections, activeEmail: email, hasTrigger: hasTrigger };
  } catch(e) {
    logDiag('ERROR', 'getDashboardData', { errorClass: e.name, message: e.message });
    throw e;
  }
}

// === togglePauseConnection() — REPLACE FUNCTION ===
function togglePauseConnection(tabName, url) {
  try {
    const props = PropertiesService.getScriptProperties();
    let registry = JSON.parse(props.getProperty(REGISTRY_KEY) || '[]');

    // GS-1: Authorization guard
    const activeEmail = getActiveEmail();
    const targetConn = registry.find(c => c.tabName === tabName && c.spreadsheetUrl === url);
    if (!targetConn || targetConn.userEmail !== activeEmail) {
      return { success: false, error: "Not authorized." };
    }

    registry = registry.map(conn => {
      if (conn.tabName === tabName && conn.spreadsheetUrl === url) {
        conn.isPaused = !conn.isPaused;
      }
      return conn;
    });
    props.setProperty(REGISTRY_KEY, JSON.stringify(registry));

    try {
      const ss = SpreadsheetApp.openByUrl(url);
      const sheet = ss.getSheetByName(tabName);
      if (sheet) {
        const cell = sheet.getRange(1, 1);
        let note = cell.getNote() || "";
        if (note.includes("[PAUSED]")) {
          note = note.replace("\n\n[PAUSED]", "").replace("[PAUSED]", "");
        } else {
          note += "\n\n[PAUSED]";
        }
        cell.setNote(note);
      }
    } catch (e) {
      console.log('[togglePauseConnection:sheetNote] ' + e.toString()); // GS-4
    }

    return { success: true };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
}

// === deleteConnection() — REPLACE FUNCTION ===
function deleteConnection(tabName, url) {
  try {
    const props = PropertiesService.getScriptProperties();
    let registry = JSON.parse(props.getProperty(REGISTRY_KEY) || '[]');

    // GS-1: Authorization guard
    const activeEmail = getActiveEmail();
    const targetConn = registry.find(c => c.tabName === tabName && c.spreadsheetUrl === url);
    if (!targetConn || targetConn.userEmail !== activeEmail) {
      return { success: false, error: "Not authorized." };
    }

    registry = registry.filter(conn => !(conn.tabName === tabName && conn.spreadsheetUrl === url));
    props.setProperty(REGISTRY_KEY, JSON.stringify(registry));

    try {
      const ss = SpreadsheetApp.openByUrl(url);
      const sheet = ss.getSheetByName(tabName);
      if (sheet) {
        const lastCol = sheet.getLastColumn();
        if (lastCol > 0) sheet.getRange(1, 1, 1, lastCol).clearNote();
      }
    } catch(e) {
      console.log('[deleteConnection:clearNotes] ' + e.toString()); // GS-4
    }

    return { success: true };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
}

// NEW: Repair a deleted tab
function repairConnection(tabName, url) {
  try {
    const props = PropertiesService.getScriptProperties();
    let registry = JSON.parse(props.getProperty(REGISTRY_KEY) || '[]');
    let conn = registry.find(c => c.tabName === tabName && c.spreadsheetUrl === url);
    
    if (!conn) return { success: false, error: "Connection not found in registry." };

    // GS-C: Authorization guard — only the owner may repair their own connection
    const activeEmail = getActiveEmail();
    if (conn.userEmail !== activeEmail) {
      return { success: false, error: "Not authorized." };
    }

    if (!conn.headerConfigs) {
      return { success: false, error: "This is an older connection that didn't back up its rules. Please delete it and set it up as a new capture." };
    }
    
    // GS-B: pass skipDefaultUpdate=true so repair does not silently change the
    // user's saved default spreadsheet URL.
    return setupSpreadsheet(conn.gmailLabel, conn.tabName, conn.spreadsheetUrl, conn.headerConfigs, conn.initialSync, null, true);
  } catch(e) {
    return { success: false, error: e.toString() };
  }
}

function getEditConfig(tabName, url) {
  const activeEmail = getActiveEmail();
  const _props = PropertiesService.getScriptProperties();
  const _registry = JSON.parse(_props.getProperty(REGISTRY_KEY) || '[]');
  const _conn = _registry.find(c => c.tabName === tabName && c.spreadsheetUrl === url);
  if (!_conn || _conn.userEmail !== activeEmail) {
    const reportId = logDiag('WARN', 'getEditConfig', { message: 'unauthorized access attempt', tabName: tabName, userEmail: activeEmail });
    return { success: false, error: 'Not authorized.', reportId: reportId };
  }
  try {
    const props = PropertiesService.getScriptProperties();
    const registry = JSON.parse(props.getProperty(REGISTRY_KEY) || '[]');
    const connData = registry.find(c => c.tabName === tabName && c.spreadsheetUrl === url);
    
    let initialSync = connData ? connData.initialSync : '50';
    let gmailLabel = connData ? connData.gmailLabel : '';
    
    const ss = SpreadsheetApp.openByUrl(url);
    const sheet = ss.getSheetByName(tabName);
    if (!sheet) return { success: false, error: "Spreadsheet tab not found. You may need to recreate it." };
    
    const lastCol = sheet.getLastColumn();
    const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
    const notes = sheet.getRange(1, 1, 1, lastCol).getNotes()[0];
    
    let headerConfigs = [];
    
    for (let i = 0; i < headers.length; i++) {
      if (!notes[i]) continue;
      let cellNote = notes[i];

      // Preserve original behavior: pull gmailLabel from col-0 note BEFORE stripping
      if (i === 0 && !gmailLabel) {
         if (cellNote.includes("Gmail Label:\n")) {
            gmailLabel = cellNote.split("Gmail Label:\n")[1].split("\n\n")[0].trim();
         }
      }

      const cfg = parseHeaderNoteToConfig(cellNote, headers[i]);

      // Map canonical config -> getEditConfig's frontend-facing shape
      if (cfg.type === 'system') {
        if (cfg.key === 'date') {
          headerConfigs.push({ name: headers[i], pattern: "EMAIL_DATE", delimiter: "none", format: "date", example: "" });
        } else if (cfg.key === 'id') {
          headerConfigs.push({ name: headers[i], pattern: "EMAIL_ID", delimiter: "none", format: "text", example: "" });
        }
        // empty key => skip, matches original behavior
      } else if (cfg.type === 'custom') {
        headerConfigs.push({ name: headers[i], pattern: cfg.pattern, delimiter: cfg.delimiter, format: cfg.format, example: "" });
      }
      // 'ignore' => skip
    }
    
    let emailBodies = [];
    if (gmailLabel) {
       const threads = GmailApp.search(`label:"${sanitizeGmailLabel(gmailLabel)}"`, 0, 5);
       threads.forEach(t => {
         const msgs = t.getMessages();
         emailBodies.push(getEmailBody(msgs[msgs.length - 1]).text);
       });
    }
    
    if (emailBodies.length === 0) emailBodies.push("No recent emails found in this label to preview.");

    return {
      success: true,
      gmailLabel: gmailLabel,
      tabName: tabName,
      targetUrl: url,
      initialSync: initialSync,
      headerConfigs: headerConfigs,
      bodyPreviews: emailBodies
    };
  } catch(e) {
    const reportId = logDiag('ERROR', 'getEditConfig', { errorClass: e.name, message: e.message, tabName: tabName });
    return { success: false, error: e.toString(), reportId: reportId };
  }
}

// ==========================================
// SETUP FUNCTIONS
// ==========================================
var SYSTEM_LABELS = ['inbox', 'sent', 'spam', 'trash', 'drafts', 'draft', 'starred', 'important', 'unread', 'chat'];

function verifyLabelDetailed(labelName) {
  var activeEmail = getActiveEmail();

  if (!activeEmail) {
    var reportId = logDiag('WARN', 'verifyLabelDetailed', { message: 'empty identity' });
    return {
      success: false, status: 'identity_empty',
      message: "We couldn't read your Google identity — you may be signed in to multiple accounts or outside the allowed domain. Try opening this page in a fresh Incognito window with only one Google account.",
      reportId: reportId, activeEmail: '', authUrl: null
    };
  }

  if (!labelName || !labelName.trim()) {
    return { success: false, status: 'empty_input', message: 'Please enter a label name.', activeEmail: activeEmail, authUrl: null };
  }

  var authUrl = null;
  try {
    var authInfo = ScriptApp.getAuthorizationInfo(ScriptApp.AuthMode.FULL);
    authUrl = authInfo.getAuthorizationUrl();
  } catch(e) {}

  if (SYSTEM_LABELS.indexOf(labelName.trim().toLowerCase()) !== -1) {
    return {
      success: false, status: 'system_label',
      message: '"' + labelName + '" is a Gmail system label (Inbox, Sent, Spam, etc.). This tool only works with user-created labels. Set up a Gmail filter that applies a custom label to the emails you want to capture, then enter that label name here.',
      activeEmail: activeEmail, authUrl: authUrl
    };
  }

  try {
    GmailApp.getUserLabels();
  } catch(e) {
    var reportId = logDiag('WARN', 'verifyLabelDetailed', { errorClass: e.name, message: e.message, labelName: labelName });
    var msg = (e.message || '').toLowerCase();
    var isAuthError = e.name === 'AuthorizationRequiredException'
      || msg.indexOf('authorization') !== -1
      || msg.indexOf('not have permission') !== -1
      || msg.indexOf('access denied') !== -1;
    if (isAuthError) {
      return {
        success: false, status: 'gmail_scope_denied',
        message: 'Gmail access is not authorized. Click "Open Authorization" below to grant this app permission to read your labels.',
        reportId: reportId, activeEmail: activeEmail, authUrl: authUrl
      };
    }
    return {
      success: false, status: 'error',
      message: 'Could not reach Gmail (' + e.name + '). This may be a temporary issue — please try again in a moment.',
      reportId: reportId, activeEmail: activeEmail, authUrl: authUrl
    };
  }

  try {
    var label = GmailApp.getUserLabelByName(labelName.trim());
    if (!label) {
      return {
        success: false, status: 'not_found',
        message: '"' + labelName + '" was not found in your Gmail. Check spelling and use the full path for nested labels (e.g. "Parent/Child Label").',
        activeEmail: activeEmail, authUrl: authUrl
      };
    }
    var threads = GmailApp.search('label:"' + sanitizeGmailLabel(labelName.trim()) + '"', 0, 1);
    if (threads.length === 0) {
      return {
        success: false, status: 'empty_label',
        message: 'The label "' + labelName + '" exists but has no emails. Apply it to at least one email before setting up a capture.',
        activeEmail: activeEmail, authUrl: authUrl
      };
    }
    return { success: true, status: 'ok', activeEmail: activeEmail, authUrl: authUrl };
  } catch(e) {
    var reportId = logDiag('ERROR', 'verifyLabelDetailed', { errorClass: e.name, message: e.message, labelName: labelName });
    return {
      success: false, status: 'error',
      message: 'Unexpected error while verifying label: ' + e.message,
      reportId: reportId, activeEmail: activeEmail, authUrl: authUrl
    };
  }
}

function scanEmailForSuggestions(labelName) {
  try {
  const threads = GmailApp.search(`label:"${sanitizeGmailLabel(labelName)}"`, 0, 5);
  if (threads.length === 0) {
    return { success: false, message: "Label exists, but no emails were found to scan." };
  }

  let emailBodies = [];
  threads.forEach(t => {
    const msgs = t.getMessages();
    emailBodies.push(getEmailBody(msgs[msgs.length - 1]).text);
  });

  const message = threads[0].getMessages()[threads[0].getMessages().length - 1];
  const body = emailBodies[0]; 
  const lines = body.split('\n');
  
  let suggestedHeaders = [];
  
  suggestedHeaders.push({ name: "Date Received", pattern: "EMAIL_DATE", delimiter: "none", example: message.getDate().toLocaleString(), format: "date" });
  suggestedHeaders.push({ name: "Message ID", pattern: "EMAIL_ID", delimiter: "none", example: message.getId(), format: "text" });
  
  lines.forEach(line => {
    const trimmed = line.trim();
    if (trimmed.includes(':') && trimmed.length < 150) {
      const parts = trimmed.split(':');
      const key = parts[0].trim();
      const val = parts.slice(1).join(':').trim(); 
      
      if (key.length > 0 && key.length < 40 && val.length > 0) {
        let guessedFormat = "text";
        if (val.startsWith('$')) guessedFormat = "currency";
        else if (val.endsWith('%')) guessedFormat = "percent";
        else if (!isNaN(Date.parse(val)) && val.length > 5) guessedFormat = "date";
        else if (!isNaN(parseFloat(val.replace(/,/g, '')))) guessedFormat = "number";

        suggestedHeaders.push({ name: key, pattern: key + ":", delimiter: "newline", example: val, format: guessedFormat });
      }
    }
  });

  let uniqueHeaders = [];
  let seenNames = new Set();
  for (let h of suggestedHeaders) {
    if (!seenNames.has(h.name)) {
      seenNames.add(h.name);
      uniqueHeaders.push(h);
    }
  }

  if (uniqueHeaders.length <= 2) {
    uniqueHeaders.push({ name: "Resolution", pattern: "The resolution was as follows:", delimiter: "newline", example: "Please login...", format: "text" });
  }

  return {
    success: true,
    headers: uniqueHeaders,
    bodyPreviews: emailBodies,
    defaultUrl: getUserDefaultSpreadsheetUrl()
  };
  } catch(e) {
    const reportId = logDiag('ERROR', 'scanEmailForSuggestions', { errorClass: e.name, message: e.message, labelName: labelName });
    return { success: false, message: e.toString(), reportId: reportId };
  }
}

function setupSpreadsheet(labelName, tabName, targetUrl, headerConfigs, initialSync, originalTabName, skipDefaultUpdate) {
  try {
    if (skipDefaultUpdate === undefined) skipDefaultUpdate = false;
    targetUrl = targetUrl || getUserDefaultSpreadsheetUrl();

    if (!targetUrl) {
      return { success: false, error: 'Please enter a Google Sheet URL before saving.' };
    }

    const activeEmail = getActiveEmail();

    const ss = SpreadsheetApp.openByUrl(targetUrl);

    // GS-A/GS-B: Persist the user's default URL only AFTER openByUrl succeeds,
    // and only when this is a normal save (not a repair).
    if (!skipDefaultUpdate) setUserDefaultSpreadsheetUrl(targetUrl);

    let sheet;
    
    if (originalTabName && originalTabName !== tabName) {
       sheet = ss.getSheetByName(originalTabName);
       if (sheet) sheet.setName(tabName);
    }
    
    if (!sheet) sheet = ss.getSheetByName(tabName);
    if (!sheet) sheet = ss.insertSheet(tabName);
    
    const names = headerConfigs.map(h => h.name);
    const notes = headerConfigs.map((h, i) => {
      let noteText = "";
      if (i === 0) {
        noteText += `User Email:\n${activeEmail}\n\n`;
        noteText += `Gmail Label:\n${labelName}\n\n`;
      }
      if (h.pattern === "EMAIL_DATE" || h.pattern === "EMAIL_ID") {
        noteText += "System Value";
      } else {
        noteText += `Capture Pattern:\n${h.pattern}\n\nDelimiter:\n${h.delimiter}\n\nFormat:\n${h.format}`;
      }
      return noteText;
    });
    
    sheet.getRange(1, 1, 1, sheet.getMaxColumns()).clearContent().clearNote();
    
    const headerRange = sheet.getRange(1, 1, 1, names.length);
    headerRange.setValues([names]);
    headerRange.setNotes([notes]); 
    headerRange.setFontWeight("bold");
    
    const maxRows = sheet.getMaxRows();
    headerConfigs.forEach((config, index) => {
      const colIndex = index + 1;
      const formatRange = sheet.getRange(2, colIndex, maxRows - 1, 1);
      switch (config.format) {
        case 'number': formatRange.setNumberFormat('0.##'); break;
        case 'currency': formatRange.setNumberFormat('"$ "#,##0.00'); break;
        case 'percent': formatRange.setNumberFormat('0.00%'); break;
        case 'date': formatRange.setNumberFormat('M/d/yyyy H:mm:ss'); break;
        case 'text': default: formatRange.setNumberFormat('@'); break;
      }
    });
    sheet.autoResizeColumns(1, names.length);

    const props = PropertiesService.getScriptProperties();
    let registry = JSON.parse(props.getProperty(REGISTRY_KEY) || '[]');
    
    let filterTabName = originalTabName ? originalTabName : tabName;
    registry = registry.filter(conn => !(conn.tabName === filterTabName && conn.spreadsheetUrl === targetUrl));
    
    registry.push({
      userEmail: activeEmail,
      gmailLabel: labelName,
      tabName: tabName,
      spreadsheetUrl: targetUrl,
      sheetId: sheet.getSheetId(),
      isPaused: false,
      initialSync: initialSync || '50',
      lastSyncTime: null,
      headerConfigs: headerConfigs // NEW: Backup configurations to enable repairs
    });
    props.setProperty(REGISTRY_KEY, JSON.stringify(registry));

    let triggerEnabled = false;
    try {
      enableUserTrigger();
      triggerEnabled = true;
    } catch(e) {
      logDiag('WARN', 'setupSpreadsheet:enableTrigger', { errorClass: e.name, message: e.message });
    }
    return { success: true, triggerEnabled: triggerEnabled };
  } catch (e) {
    const reportId = logDiag('ERROR', 'setupSpreadsheet', { errorClass: e.name, message: e.message, labelName: labelName, tabName: tabName });
    return { success: false, error: e.toString(), reportId: reportId };
  }
}

// ==========================================
// EMAIL PROCESSING ENGINE (SMART UPDATE)
// ==========================================
function parseHeaderNoteToConfig(cellNote, headerName) {
  if (!cellNote) return { type: 'ignore' };

  let stripped = cellNote;
  stripped = stripped.replace(/User Email:\n[\s\S]*?\n\n/, "");
  stripped = stripped.replace(/Gmail Label:\n[\s\S]*?\n\n/, "");
  stripped = stripped.replace(/\[PAUSED\]/g, "").trim();

  if (stripped === "System Value") {
    return {
      type: 'system',
      key: headerName === "Date Received" ? "date"
         : headerName === "Message ID"    ? "id"
         : ""
    };
  }

  if (stripped.includes("Capture Pattern:")) {
    const parts = stripped.split('\n\n');
    return {
      type: 'custom',
      pattern: parts[0] ? parts[0].replace("Capture Pattern:\n", "") : "",
      delimiter: parts[1] ? parts[1].replace("Delimiter:\n", "") : "none",
      format: parts[2] ? parts[2].replace("Format:\n", "") : "text"
    };
  }

  return { type: 'ignore' };
}

function processEmails() {
  const DEADLINE_MS = 4.5 * 60 * 1000;
  const CURSOR_BATCH = 100;
  const startTime = Date.now();
  const activeEmail = getActiveEmail();
  const props = PropertiesService.getScriptProperties();
  const registry = JSON.parse(props.getProperty(REGISTRY_KEY) || '[]');

  let syncResults = [];

  registry.forEach(conn => {
    if (conn.userEmail !== activeEmail) return;
    if (conn.isPaused) return;

    if (Date.now() - startTime > DEADLINE_MS) {
      logDiag('WARN', 'processEmails:deadline', { message: 'Skipping connection — wall-clock deadline exceeded', tabName: conn.tabName });
      return;
    }

    const connStart = Date.now();
    let counts = { scanned: 0, new: 0, updated: 0 };
    let runStatus = 'ok';
    let runReportId = null;
    let advanceSyncTime = true;
    let nextCursor = undefined;

    try {
      const ss = SpreadsheetApp.openByUrl(conn.spreadsheetUrl);
      const sheet = ss.getSheetByName(conn.tabName);
      if (!sheet) return;

      const lastCol = sheet.getLastColumn();
      if (lastCol === 0) return;

      const headerRange = sheet.getRange(1, 1, 1, lastCol);
      const headers = headerRange.getValues()[0];
      const notes = headerRange.getNotes()[0];

      let configs = [];
      let hasRules = false;

      for (let i = 0; i < headers.length; i++) {
        const cfg = parseHeaderNoteToConfig(notes[i], headers[i]);
        if (cfg.type === 'system' && cfg.key === '') {
          configs.push({ type: 'ignore' });
        } else {
          configs.push(cfg);
          if (cfg.type !== 'ignore') hasRules = true;
        }
      }

      if (!hasRules) return;

      const idColIndex = headers.indexOf('Message ID');
      const dateColIndex = headers.indexOf('Date Received');

      if (idColIndex === -1) {
        runReportId = logDiag('WARN', 'processEmails:missingMsgIdCol', {
          message: 'Message ID column missing — dedup disabled for this connection',
          tabName: conn.tabName
        });
        if (runStatus === 'ok') runStatus = 'warn';
      }

      if (dateColIndex === -1) {
        logDiag('WARN', 'processEmails:missingDateCol', {
          message: 'Date Received column missing — sort skipped for this connection',
          tabName: conn.tabName
        });
        if (runStatus === 'ok') runStatus = 'warn';
      }

      let existingIds = new Map();
      let existingData = [];
      let hasUpdates = false;

      if (idColIndex > -1 && sheet.getLastRow() > 1) {
        existingData = sheet.getRange(2, 1, sheet.getLastRow() - 1, lastCol).getValues();
        existingData.forEach((row, index) => {
          if (row[idColIndex]) existingIds.set(row[idColIndex].toString(), index);
        });
      }

      const searchQuery = `label:"${sanitizeGmailLabel(conn.gmailLabel)}"`;
      let threads = [];
      let timedOut = false;

      if (!conn.lastSyncTime) {
        if (conn.initialSync === '30days') {
          threads = GmailApp.search(searchQuery + ' newer_than:30d', 0, 500);
        } else if (conn.initialSync === 'all') {
          const cursor = typeof conn.syncCursor === 'number' ? conn.syncCursor : 0;
          const batch = GmailApp.search(searchQuery, cursor, CURSOR_BATCH);
          threads = batch;
          if (batch.length === CURSOR_BATCH) {
            nextCursor = cursor + CURSOR_BATCH;
            advanceSyncTime = false;
          } else {
            nextCursor = null;
          }
        } else {
          threads = GmailApp.search(searchQuery, 0, 50);
        }
      } else {
        const safeAfter = conn.lastSyncTime - 86400;
        threads = GmailApp.search(searchQuery + ` after:${safeAfter}`, 0, 100);
      }

      let newRows = [];
      let htmlBodySeen = false;

      for (let t = threads.length - 1; t >= 0; t--) {
        if (Date.now() - startTime > DEADLINE_MS) {
          timedOut = true;
          logDiag('WARN', 'processEmails:threadDeadline', {
            message: 'Thread loop interrupted — deadline exceeded',
            tabName: conn.tabName,
            threadsRemaining: t + 1
          });
          break;
        }

        const messages = threads[t].getMessages();
        messages.forEach(msg => {
          counts.scanned++;
          const msgId = msg.getId();
          const bodyResult = getEmailBody(msg);
          if (bodyResult.type === 'html') htmlBodySeen = true;
          const rowData = extractDataFromEmail(bodyResult.text, msg, configs);

          if (idColIndex > -1 && existingIds.has(msgId)) {
            const dataIndex = existingIds.get(msgId);
            if (dataIndex !== -1) {
              const oldRow = existingData[dataIndex];
              for (let c = 0; c < configs.length; c++) {
                if (configs[c].type !== 'ignore') oldRow[c] = rowData[c] !== undefined ? rowData[c] : '';
              }
              existingData[dataIndex] = oldRow;
              hasUpdates = true;
              counts.updated++;
              existingIds.set(msgId, -1);
            }
          } else {
            newRows.push(rowData);
            if (idColIndex > -1) existingIds.set(msgId, -1);
            counts.new++;
          }
        });
      }

      if (hasUpdates) {
        sheet.getRange(2, 1, existingData.length, existingData[0].length).setValues(existingData);
      }

      if (newRows.length > 0) {
        sheet.getRange(sheet.getLastRow() + 1, 1, newRows.length, headers.length).setValues(newRows);
        if (dateColIndex > -1 && sheet.getLastRow() > 1) {
          sheet.getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn())
               .sort({ column: dateColIndex + 1, ascending: false });
        }
      }

      if (timedOut && runStatus === 'ok') runStatus = 'partial';

      if (htmlBodySeen) {
        const warnId = logDiag('WARN', 'processEmails:htmlBody', {
          message: 'HTML-only email(s) detected — body stripped to plain text',
          tabName: conn.tabName
        });
        if (runStatus === 'ok') runStatus = 'warn';
        if (!runReportId) runReportId = warnId;
      }

      // If any first-run sync timed out, do NOT advance lastSyncTime — the next
      // trigger run must retry the same window. Dedup via Message ID makes
      // re-processing idempotent for connections that have the column.
      // For 'all' mode also preserve the cursor so we re-run the same batch.
      if (timedOut && !conn.lastSyncTime) {
        advanceSyncTime = false;
        if (conn.initialSync === 'all') {
          nextCursor = undefined; // leave conn.syncCursor unchanged
        }
      }

      syncResults.push({
        tabName: conn.tabName,
        url: conn.spreadsheetUrl,
        syncTime: Math.floor(Date.now() / 1000),
        status: runStatus,
        counts: counts,
        reportId: runReportId,
        error: null,
        durationMs: Date.now() - connStart,
        advanceSyncTime: advanceSyncTime,
        nextCursor: nextCursor,
        bodyType: htmlBodySeen ? 'html' : (counts.scanned > 0 ? 'plain' : 'empty')
      });

    } catch(e) {
      const errReportId = logDiag('ERROR', 'processEmails', { errorClass: e.name, message: e.message, tabName: conn && conn.tabName, userEmail: conn && conn.userEmail });
      syncResults.push({
        tabName: conn.tabName,
        url: conn.spreadsheetUrl,
        syncTime: Math.floor(Date.now() / 1000),
        status: 'error',
        counts: counts,
        reportId: errReportId,
        error: e.message,
        durationMs: Date.now() - connStart,
        advanceSyncTime: false,
        nextCursor: undefined
      });
    }
  });

  if (syncResults.length > 0) {
    const lock = LockService.getScriptLock();
    if (lock.tryLock(10000)) {
      try {
        let freshRegistry = JSON.parse(props.getProperty(REGISTRY_KEY) || '[]');
        freshRegistry.forEach(c => {
          const result = syncResults.find(u => u.tabName === c.tabName && u.url === c.spreadsheetUrl);
          if (result) {
            recordConnectionRun(c, result);
            if (result.advanceSyncTime) c.lastSyncTime = result.syncTime;
            if (result.nextCursor !== undefined) c.syncCursor = result.nextCursor;
          }
        });
        props.setProperty(REGISTRY_KEY, JSON.stringify(freshRegistry));
      } finally {
        lock.releaseLock();
      }
    }
  }
}

function extractDataFromEmail(body, msg, configs) {
  let row = [];
  
  configs.forEach(config => {
    if (config.type === 'system') {
      if (config.key === 'date') row.push(msg.getDate());
      else if (config.key === 'id') row.push(msg.getId());
      else row.push('');
    } else if (config.type === 'custom') {
      let val = applyRules(body, config.pattern, config.delimiter, config.format);
      row.push(val);
    } else {
      row.push('');
    }
  });
  return row;
}

function applyRules(fullText, pattern, delimiter, format) {
  if (delimiter === 'email') return fullText;
  
  const idx = fullText.toLowerCase().indexOf(pattern.toLowerCase());
  if (idx === -1) return ""; 
  
  let remaining = fullText.substring(idx + pattern.length).trimStart();
  let endIdx = -1;
  
  if (delimiter === 'newline') endIdx = remaining.indexOf('\n');
  else if (delimiter === 'space') endIdx = remaining.indexOf(' ');
  else if (delimiter === 'comma') endIdx = remaining.indexOf(',');
  else if (delimiter === 'period') endIdx = remaining.indexOf('.');
  else if (delimiter === 'paragraph') {
    let pIdx1 = remaining.indexOf('\n\n');
    let pIdx2 = remaining.indexOf('\r\n\r\n');
    // GS-2: Use whichever index is valid; only -1 if both are -1
    if (pIdx1 > -1 && pIdx2 > -1) endIdx = Math.min(pIdx1, pIdx2);
    else if (pIdx1 > -1) endIdx = pIdx1;
    else if (pIdx2 > -1) endIdx = pIdx2;
    // else endIdx remains -1
  }
  // GS-D: 'after' means everything after the pattern; endIdx stays -1
  // (extracted = remaining, which is full trailing text after the pattern)
  else if (delimiter === 'after') {
    // intentional no-op: endIdx stays -1
  }
  // NEW: Handles the custom symbol
  else if (delimiter.startsWith('custom:')) {
    let customChar = delimiter.substring(7);
    if (customChar !== "") endIdx = remaining.indexOf(customChar);
  }
  
  let extracted = remaining;
  if (endIdx !== -1) extracted = remaining.substring(0, endIdx);
  extracted = extracted.trim();
  
  if (extracted === "" && delimiter === 'newline') {
    let nextLines = remaining.split('\n').filter(l => l.trim() !== "");
    if (nextLines.length > 0) extracted = nextLines[0].trim();
  }
  
  if (format === 'number' || format === 'currency' || format === 'percent') {
    let match = extracted.match(/-?\d+(?:\.\d+)?/);
    if (match) return parseFloat(match[0]); 
    return "";
  }
  
  return extracted;
}