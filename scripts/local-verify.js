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

// ==========================================
// Shared sharded-registry GAS mock context
// ==========================================
// Used by every registry-related check below. Supports getProperties()
// (required by _readRegistry's prefix scan) alongside the original
// getProperty/setProperty/deleteProperty trio, a configurable script lock
// (tryLockResult toggles migration/write lock-contention scenarios), and a
// deterministic Utilities.getUuid() so shard-key assertions are stable.
function makeUuidGenerator() {
  let counter = 0;
  return function() {
    counter += 1;
    return 'uuid-' + String(counter).padStart(4, '0') + '-test';
  };
}

function makeShardedContext(opts) {
  opts = opts || {};
  const propStore = opts.propStore || {};
  const activeEmail = opts.activeEmail !== undefined ? opts.activeEmail : 'tester@example.com';
  const tryLockResult = opts.tryLockResult !== undefined ? opts.tryLockResult : true;
  const searchReturn = opts.searchReturn || [];
  const uuidGen = opts.uuidGen || makeUuidGenerator();

  const headers = opts.sheetHeaders || ['Date Received', 'Message ID', 'Subject'];
  const notes = opts.sheetNotes || [
    'System Value',
    'System Value',
    'Capture Pattern:\nSubject:\n\nDelimiter:\nnewline\n\nFormat:\ntext'
  ];
  const range = {
    clearContent: () => range, clearNote: () => range,
    setValues: () => {}, setNotes: () => {}, setFontWeight: () => {},
    setNumberFormat: () => {}, sort: () => {},
    getValues: () => [headers], getNotes: () => [notes]
  };
  const sheet = {
    getLastColumn: () => headers.length,
    getLastRow: () => 1,
    getMaxColumns: () => 10,
    getMaxRows: () => 100,
    autoResizeColumns: () => {},
    getSheetId: () => 1,
    getRange: () => range
  };

  return vm.createContext({
    console: { log: () => {} },
    Session: {
      getActiveUser: () => ({ getEmail: () => activeEmail }),
      getEffectiveUser: () => ({ getEmail: () => activeEmail })
    },
    Utilities: { getUuid: uuidGen },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: k => (Object.prototype.hasOwnProperty.call(propStore, k) ? propStore[k] : null),
        setProperty: (k, v) => { propStore[k] = v; },
        deleteProperty: k => { delete propStore[k]; },
        getProperties: () => Object.assign({}, propStore)
      }),
      getUserProperties: () => ({ getProperty: () => null, setProperty: () => {} })
    },
    LockService: {
      getScriptLock: () => ({ tryLock: () => tryLockResult, releaseLock: () => {} })
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
}

function shardKeysIn(propStore) {
  return Object.keys(propStore).filter(k => k.indexOf('capture_conn_') === 0);
}

// ==========================================
// Registry helpers: _connKey, _connMatches, sorting, corrupt-shard tolerance,
// blob-fallback merge (D2 stored-UUID key, D8 stable sort, 2A corrupt tolerance)
// ==========================================
function checkRegistryHelpers(codeSource) {
  try {
    const ctx = makeShardedContext({});
    vm.runInContext(codeSource, ctx);
    vm.runInContext("var _c = {id:'abc-123'};", ctx);
    const key = vm.runInContext('_connKey(_c)', ctx);
    check('_connKey derives capture_conn_<id> from conn.id (D2 stored UUID)', key === 'capture_conn_abc-123');
  } catch (e) {
    failures.push('_connKey: ' + e.message);
  }

  try {
    const ctx = makeShardedContext({});
    vm.runInContext(codeSource, ctx);
    vm.runInContext(
      "var _c = {userEmail:'a@example.com', tabName:'Tab', spreadsheetUrl:'https://x'};",
      ctx
    );
    const matchTrue = vm.runInContext("_connMatches(_c, 'a@example.com', 'Tab', 'https://x')", ctx);
    const matchFalseEmail = vm.runInContext("_connMatches(_c, 'b@example.com', 'Tab', 'https://x')", ctx);
    const matchFalseTab = vm.runInContext("_connMatches(_c, 'a@example.com', 'Other', 'https://x')", ctx);
    check('_connMatches matches on the full identity triple', matchTrue === true);
    check('_connMatches rejects a different owner email', matchFalseEmail === false);
    check('_connMatches rejects a different tab name', matchFalseTab === false);
  } catch (e) {
    failures.push('_connMatches: ' + e.message);
  }

  // _readRegistry: shard read, stable sort by (userEmail, tabName), corrupt-shard
  // tolerance, and foreign-key exclusion (D8, 2A, D10)
  try {
    const propStore = {
      capture_conn_z: JSON.stringify({ id: 'z', userEmail: 'zoe@example.com', tabName: 'A', spreadsheetUrl: 'https://x' }),
      capture_conn_a: JSON.stringify({ id: 'a', userEmail: 'amy@example.com', tabName: 'B', spreadsheetUrl: 'https://x' }),
      capture_conn_corrupt: '{not valid json',
      diag_ffffffff: JSON.stringify({ reportId: 'ffffffff' }),
      admin_email: 'admin@example.com',
      update_check_result: JSON.stringify({ upToDate: true }),
      update_check_ts: '123456'
    };
    const ctx = makeShardedContext({ propStore });
    vm.runInContext(codeSource, ctx);
    const registry = vm.runInContext('_readRegistry(PropertiesService.getScriptProperties())', ctx);
    check('_readRegistry returns only connection shards, excluding foreign keys (D10)', Array.isArray(registry) && registry.length === 2);
    check('_readRegistry skips a corrupt shard instead of throwing (2A)', registry.every(c => c.id !== undefined));
    check('_readRegistry sorts by (userEmail, tabName) — amy before zoe (D8)',
      registry.length === 2 && registry[0].userEmail === 'amy@example.com' && registry[1].userEmail === 'zoe@example.com');
  } catch (e) {
    failures.push('_readRegistry corrupt-shard/sort/foreign-key: ' + e.message);
  }

  // _readRegistry blob-fallback merge: when capture_registry is still present
  // (migration pending/blocked), a blob record with no matching shard is
  // included; a blob record that DOES match an existing shard defers to the
  // shard (merge-only — the same rule migration itself uses).
  try {
    const liveShard = { id: 'live-1', userEmail: 'a@example.com', tabName: 'Live', spreadsheetUrl: 'https://x', lastSyncTime: 999 };
    const staleBlobDup = { userEmail: 'a@example.com', tabName: 'Live', spreadsheetUrl: 'https://x', lastSyncTime: 1 };
    const blobOnly = { userEmail: 'b@example.com', tabName: 'BlobOnly', spreadsheetUrl: 'https://x' };
    const propStore = {
      capture_conn_live1: JSON.stringify(liveShard),
      capture_registry: JSON.stringify([staleBlobDup, blobOnly])
    };
    const ctx = makeShardedContext({ propStore });
    vm.runInContext(codeSource, ctx);
    const registry = vm.runInContext('_readRegistry(PropertiesService.getScriptProperties())', ctx);
    check('_readRegistry blob-fallback merges an unmatched blob record when capture_registry still exists',
      registry.some(c => c.tabName === 'BlobOnly'));
    const liveRecord = registry.find(c => c.tabName === 'Live');
    check('_readRegistry blob-fallback: live shard wins over a stale blob duplicate (merge-only)',
      !!liveRecord && liveRecord.lastSyncTime === 999);
  } catch (e) {
    failures.push('_readRegistry blob-fallback merge: ' + e.message);
  }
}

// ==========================================
// Migration: explicit pre-lock, merge-only, corrupt-blob-tolerant, idempotent
// (1A, D3 merge-only, D4 lock-failure, D5 corrupt blob)
// ==========================================
function checkMigration(codeSource) {
  // Basic migration: blob -> shards + backup + registry key deleted.
  try {
    const blob = [
      { userEmail: 'a@example.com', tabName: 'A', spreadsheetUrl: 'https://x', lastSyncTime: 111, headerConfigs: [{ name: 'H' }] },
      { userEmail: 'b@example.com', tabName: 'B', spreadsheetUrl: 'https://y', lastSyncTime: 222, headerConfigs: [{ name: 'H2' }] }
    ];
    const propStore = { capture_registry: JSON.stringify(blob) };
    const ctx = makeShardedContext({ propStore });
    vm.runInContext(codeSource, ctx);
    const result = vm.runInContext('_migrateRegistryIfNeeded(PropertiesService.getScriptProperties())', ctx);
    check('_migrateRegistryIfNeeded succeeds on a plain blob', result && result.ok === true);
    check('_migrateRegistryIfNeeded creates one shard per blob record', shardKeysIn(propStore).length === 2);
    check('_migrateRegistryIfNeeded deletes capture_registry after migrating', propStore.capture_registry === undefined);
    check('_migrateRegistryIfNeeded preserves the original blob under the backup key',
      propStore.capture_registry_backup_v1 === JSON.stringify(blob));
    const migrated = shardKeysIn(propStore).map(k => JSON.parse(propStore[k]));
    check('_migrateRegistryIfNeeded carries lastSyncTime/headerConfigs over byte-identical',
      migrated.some(c => c.lastSyncTime === 111 && c.headerConfigs[0].name === 'H'));
    check('_migrateRegistryIfNeeded assigns a real conn.id to each migrated record',
      migrated.every(c => typeof c.id === 'string' && c.id.length > 0));

    // Idempotent second call.
    const secondResult = vm.runInContext('_migrateRegistryIfNeeded(PropertiesService.getScriptProperties())', ctx);
    check('_migrateRegistryIfNeeded is idempotent — second call is a no-op', secondResult && secondResult.ok === true);
    check('_migrateRegistryIfNeeded does not re-create capture_registry on a repeat call', propStore.capture_registry === undefined);
    check('_migrateRegistryIfNeeded does not duplicate shards on a repeat call', shardKeysIn(propStore).length === 2);
  } catch (e) {
    failures.push('migration basic + idempotent: ' + e.message);
  }

  // Merge-only: a pre-existing shard for the same identity survives migration
  // untouched even though the blob has a stale duplicate — this is what makes
  // the mixed-version deployment window (OV#1/D3) safe.
  try {
    const liveShard = { id: 'keep-me', userEmail: 'a@example.com', tabName: 'A', spreadsheetUrl: 'https://x', lastSyncTime: 999 };
    const staleBlobRecord = { userEmail: 'a@example.com', tabName: 'A', spreadsheetUrl: 'https://x', lastSyncTime: 1 };
    const propStore = {
      capture_conn_keepme: JSON.stringify(liveShard),
      capture_registry: JSON.stringify([staleBlobRecord])
    };
    const ctx = makeShardedContext({ propStore });
    vm.runInContext(codeSource, ctx);
    vm.runInContext('_migrateRegistryIfNeeded(PropertiesService.getScriptProperties())', ctx);
    check('Merge-only migration: live shard is untouched when a stale blob duplicate exists (D3)',
      propStore.capture_conn_keepme === JSON.stringify(liveShard));
    check('Merge-only migration: no extra shard created for the stale duplicate',
      shardKeysIn(propStore).length === 1);
  } catch (e) {
    failures.push('migration merge-only: ' + e.message);
  }

  // Intra-blob dedup (ship review fix): two blob records sharing the same
  // identity triple — plausible residue from the pre-sharding hijack bug
  // (commit 1e6fc9f) — must collapse into ONE shard, not fork into two
  // permanent shards for one logical connection.
  try {
    const dupA = { userEmail: 'a@example.com', tabName: 'Dup', spreadsheetUrl: 'https://x', lastSyncTime: 1 };
    const dupB = { userEmail: 'a@example.com', tabName: 'Dup', spreadsheetUrl: 'https://x', lastSyncTime: 2 };
    const propStore = { capture_registry: JSON.stringify([dupA, dupB]) };
    const ctx = makeShardedContext({ propStore });
    vm.runInContext(codeSource, ctx);
    vm.runInContext('_migrateRegistryIfNeeded(PropertiesService.getScriptProperties())', ctx);
    check('Migration collapses duplicate-identity blob records into a single shard (ship review fix)',
      shardKeysIn(propStore).length === 1);
  } catch (e) {
    failures.push('migration intra-blob dedup: ' + e.message);
  }

  // Backup-write failure (ship review fix): if the raw blob itself is too
  // large for a single Script Property (the exact registries this migration
  // exists to help), the backup write must not block deleting the source key
  // — otherwise migration retries and re-throws forever.
  try {
    const blob = [{ userEmail: 'a@example.com', tabName: 'A', spreadsheetUrl: 'https://x' }];
    const rawBlob = JSON.stringify(blob);
    const propStore = { capture_registry: rawBlob };
    const ctx = makeShardedContext({ propStore });
    vm.runInContext(codeSource, ctx);
    // Wrap setProperty so only the backup-key write throws (simulating the
    // backup itself exceeding the per-property size cap).
    vm.runInContext(
      `(function() {
        var props = PropertiesService.getScriptProperties();
        var origSetProperty = props.setProperty;
        props.setProperty = function(k, v) {
          if (k === 'capture_registry_backup_v1') throw new Error('Argument too large: value');
          return origSetProperty(k, v);
        };
        globalThis._testProps = props;
      })();`,
      ctx
    );
    const result = vm.runInContext('_migrateRegistryIfNeeded(_testProps)', ctx);
    check('_migrateRegistryIfNeeded tolerates a backup-write failure instead of looping forever (ship review fix)',
      result && result.ok === true);
    check('_migrateRegistryIfNeeded still deletes capture_registry when only the backup write fails',
      propStore.capture_registry === undefined);
    check('_migrateRegistryIfNeeded still writes the shard when only the backup write fails',
      shardKeysIn(propStore).length === 1);
  } catch (e) {
    failures.push('migration backup-write failure: ' + e.message);
  }

  // Corrupt blob: parse failure is tolerated, not fatal (D5).
  try {
    const propStore = { capture_registry: '{not valid json at all' };
    const ctx = makeShardedContext({ propStore });
    vm.runInContext(codeSource, ctx);
    const result = vm.runInContext('_migrateRegistryIfNeeded(PropertiesService.getScriptProperties())', ctx);
    check('_migrateRegistryIfNeeded tolerates a corrupt blob instead of throwing (D5)', result && result.ok === true);
    check('_migrateRegistryIfNeeded backs up the raw corrupt text and deletes the registry key on corrupt blob',
      propStore.capture_registry === undefined && propStore.capture_registry_backup_v1 === '{not valid json at all');
  } catch (e) {
    failures.push('migration corrupt blob: ' + e.message);
  }

  // Lock failure: migration must not mutate the store, and must report lockFailed (D4).
  try {
    const blob = [{ userEmail: 'a@example.com', tabName: 'A', spreadsheetUrl: 'https://x' }];
    const propStore = { capture_registry: JSON.stringify(blob) };
    const ctx = makeShardedContext({ propStore, tryLockResult: false });
    vm.runInContext(codeSource, ctx);
    const result = vm.runInContext('_migrateRegistryIfNeeded(PropertiesService.getScriptProperties())', ctx);
    check('_migrateRegistryIfNeeded reports lockFailed when tryLock fails (D4)', result && result.ok === false && result.lockFailed === true);
    check('_migrateRegistryIfNeeded does not mutate the store on lock failure', propStore.capture_registry === JSON.stringify(blob));
    check('_migrateRegistryIfNeeded creates no shards on lock failure', shardKeysIn(propStore).length === 0);
  } catch (e) {
    failures.push('migration lock failure: ' + e.message);
  }
}

// ==========================================
// Write-path entry points: migration gating, own-lock failure shapes,
// shard write isolation, size guard, id-threaded edit flow
// ==========================================
function checkWritePathEntryPoints(codeSource) {
  // togglePauseConnection / deleteConnection: migration lock failure returns a
  // retry error distinct from their own lock-failure message (D4, TODOS.md P1).
  try {
    const blob = [{ userEmail: 'tester@example.com', tabName: 'T1', spreadsheetUrl: 'https://x' }];
    const propStore = { capture_registry: JSON.stringify(blob) };
    const ctx = makeShardedContext({ propStore, tryLockResult: false });
    vm.runInContext(codeSource, ctx);
    const toggleResult = vm.runInContext("togglePauseConnection('T1', 'https://x')", ctx);
    check('togglePauseConnection returns a retry error when migration cannot acquire its lock (D4)',
      toggleResult && toggleResult.success === false && toggleResult.error === 'Update in progress, please retry.');
    const deleteResult = vm.runInContext("deleteConnection('T1', 'https://x')", ctx);
    check('deleteConnection returns a retry error when migration cannot acquire its lock (D4)',
      deleteResult && deleteResult.success === false && deleteResult.error === 'Update in progress, please retry.');
    check('Migration-blocked writes never mutate the store', propStore.capture_registry === JSON.stringify(blob));
  } catch (e) {
    failures.push('migration-gated write lock failure: ' + e.message);
  }

  // togglePauseConnection / deleteConnection own-lock failure (already-migrated
  // store, so migration is a no-op; the function's OWN tryLock is what fails).
  // This is the TODOS.md P1 regression: verify the exact required error shape
  // and that the shard is left unmodified.
  try {
    const conn = { id: 'own-lock-1', userEmail: 'tester@example.com', tabName: 'T1', spreadsheetUrl: 'https://x', isPaused: false };
    const propStore = { capture_conn_ownlock1: JSON.stringify(conn) };
    const ctx = makeShardedContext({ propStore, tryLockResult: false });
    vm.runInContext(codeSource, ctx);
    const toggleResult = vm.runInContext("togglePauseConnection('T1', 'https://x')", ctx);
    check('togglePauseConnection returns {success:false, error:"Could not acquire lock."} on its own lock failure (TODOS.md P1)',
      toggleResult && toggleResult.success === false && toggleResult.error === 'Could not acquire lock.');
    check('togglePauseConnection leaves the shard unmodified on its own lock failure',
      propStore.capture_conn_ownlock1 === JSON.stringify(conn));

    const deleteResult = vm.runInContext("deleteConnection('T1', 'https://x')", ctx);
    check('deleteConnection returns {success:false, error:"Could not acquire lock."} on its own lock failure (TODOS.md P1)',
      deleteResult && deleteResult.success === false && deleteResult.error === 'Could not acquire lock.');
    check('deleteConnection leaves the shard unmodified on its own lock failure',
      propStore.capture_conn_ownlock1 === JSON.stringify(conn));
  } catch (e) {
    failures.push('own-lock failure regression: ' + e.message);
  }

  // Shard write isolation: pause only rewrites its own shard; delete removes
  // only its own shard property; flush writes only the updated shards.
  try {
    const connA = { id: 'iso-a', userEmail: 'tester@example.com', tabName: 'A', spreadsheetUrl: 'https://x', isPaused: false };
    const connB = { id: 'iso-b', userEmail: 'tester@example.com', tabName: 'B', spreadsheetUrl: 'https://x', isPaused: false };
    const propStore = {
      'capture_conn_iso-a': JSON.stringify(connA),
      'capture_conn_iso-b': JSON.stringify(connB)
    };
    const ctx = makeShardedContext({ propStore });
    vm.runInContext(codeSource, ctx);
    vm.runInContext("togglePauseConnection('A', 'https://x')", ctx);
    check('togglePauseConnection writes only its own shard, leaving sibling shards untouched',
      propStore['capture_conn_iso-b'] === JSON.stringify(connB) &&
      JSON.parse(propStore['capture_conn_iso-a']).isPaused === true);
  } catch (e) {
    failures.push('pause shard isolation: ' + e.message);
  }

  try {
    const connA = { id: 'del-a', userEmail: 'tester@example.com', tabName: 'A', spreadsheetUrl: 'https://x' };
    const connB = { id: 'del-b', userEmail: 'tester@example.com', tabName: 'B', spreadsheetUrl: 'https://x' };
    const propStore = {
      'capture_conn_del-a': JSON.stringify(connA),
      'capture_conn_del-b': JSON.stringify(connB)
    };
    const ctx = makeShardedContext({ propStore });
    vm.runInContext(codeSource, ctx);
    vm.runInContext("deleteConnection('A', 'https://x')", ctx);
    check('deleteConnection removes only its own shard property', propStore['capture_conn_del-a'] === undefined);
    check('deleteConnection leaves sibling shards untouched', propStore['capture_conn_del-b'] === JSON.stringify(connB));
  } catch (e) {
    failures.push('delete shard isolation: ' + e.message);
  }

  // lastError 500-char cap; full text remains reachable via the diag entry.
  try {
    const ctx = makeShardedContext({});
    vm.runInContext(codeSource, ctx);
    const longError = 'E'.repeat(600);
    vm.runInContext('var _c = {};', ctx);
    vm.runInContext(
      `recordConnectionRun(_c, { status: 'error', reportId: 'r1', error: ${JSON.stringify(longError)}, counts: { scanned: 1, new: 0, updated: 0 }, durationMs: 10 });`,
      ctx
    );
    const stored = vm.runInContext('_c.lastError', ctx);
    check('recordConnectionRun truncates lastError to 500 chars', typeof stored === 'string' && stored.length === 500);
  } catch (e) {
    failures.push('lastError truncation: ' + e.message);
  }

  // 9KB per-connection size guard (D6).
  try {
    const propStore = {};
    const ctx = makeShardedContext({ propStore, activeEmail: 'tester@example.com' });
    vm.runInContext(codeSource, ctx);
    const hugeHeaderConfigs = [];
    for (let i = 0; i < 400; i++) {
      hugeHeaderConfigs.push({ name: 'Column ' + i, pattern: 'Pattern text that is fairly long ' + i, delimiter: 'newline', format: 'text' });
    }
    const result = vm.runInContext(
      `setupSpreadsheet('BigLabel', 'BigTab', 'https://big', ${JSON.stringify(hugeHeaderConfigs)}, '50', null, true)`,
      ctx
    );
    check('setupSpreadsheet rejects a connection record at/above the 9KB per-connection cap (D6)',
      result && result.success === false && /too many columns\/rules/.test(result.error));
    check('setupSpreadsheet does not write a shard when the size guard rejects', shardKeysIn(propStore).length === 0);
  } catch (e) {
    failures.push('9KB size guard: ' + e.message);
  }

  // id-threaded edit flow: getEditConfig returns id; setupSpreadsheet updates
  // the SAME shard in place even when the target URL changes (D9).
  try {
    const conn = {
      id: 'edit-flow-1', userEmail: 'tester@example.com', tabName: 'EditMe',
      spreadsheetUrl: 'https://old-url', sheetId: 1, isPaused: false, initialSync: '50',
      lastSyncTime: null, headerConfigs: [{ name: 'Subject', pattern: 'EMAIL_ID' }]
    };
    const propStore = { 'capture_conn_edit-flow-1': JSON.stringify(conn) };
    const ctx = makeShardedContext({ propStore, activeEmail: 'tester@example.com' });
    vm.runInContext(codeSource, ctx);
    const editConfig = vm.runInContext("getEditConfig('EditMe', 'https://old-url')", ctx);
    check('getEditConfig returns the connection id (D9)', editConfig && editConfig.success === true && editConfig.id === 'edit-flow-1');

    const saveResult = vm.runInContext(
      "setupSpreadsheet('Label', 'EditMe', 'https://new-url', [{name:'Subject',pattern:'EMAIL_ID'}], '50', 'EditMe', true, 'edit-flow-1')",
      ctx
    );
    check('setupSpreadsheet with a connId updates in place on a URL change', saveResult && saveResult.success === true);
    check('URL-change edit results in exactly one shard for this connection (no ghost, D9)', shardKeysIn(propStore).length === 1);
    const updated = JSON.parse(propStore[shardKeysIn(propStore)[0]]);
    check('URL-change edit updates the existing shard\'s spreadsheetUrl rather than creating a new id',
      updated.id === 'edit-flow-1' && updated.spreadsheetUrl === 'https://new-url');
  } catch (e) {
    failures.push('id-threaded edit flow: ' + e.message);
  }

  // Admin health panel shape (new metrics; old byteSize/byteCap/byteUsedPct gone).
  try {
    const connSmall = { id: 'health-1', userEmail: 'a@example.com', tabName: 'A', spreadsheetUrl: 'https://x' };
    const propStore = {
      admin_email: 'admin@example.com',
      capture_conn_health1: JSON.stringify(connSmall),
      diag_index: '[]'
    };
    const ctx = makeShardedContext({ propStore, activeEmail: 'admin@example.com' });
    vm.runInContext(codeSource, ctx);
    const diag = vm.runInContext('getAdminDiagnostics()', ctx);
    check('getAdminDiagnostics is authorized for the admin user', diag && diag.authorized === true);
    const h = diag.registryHealth;
    check('registryHealth has the new per-connection/total-store shape',
      h && typeof h.connectionCount === 'number' && typeof h.perUserCounts === 'object' &&
      typeof h.largestConnBytes === 'number' && typeof h.largestConnTab === 'string' &&
      h.perConnCap === 9000 && typeof h.totalStoreBytes === 'number' && h.totalStoreCap === 500000 &&
      typeof h.hasTrigger === 'boolean');
    check('registryHealth no longer reports the old single-blob byteSize/byteCap/byteUsedPct fields',
      h.byteSize === undefined && h.byteCap === undefined && h.byteUsedPct === undefined);
    const expectedTotalBytes = Object.keys(propStore).reduce((sum, k) => sum + k.length + propStore[k].length, 0);
    check('totalStoreBytes counts all property keys + values, including non-connection keys (D10)',
      h.totalStoreBytes === expectedTotalBytes);
  } catch (e) {
    failures.push('admin health shape: ' + e.message);
  }

  // largestConnBytes/-Tab selection across MULTIPLE shards — previously only
  // ever exercised with a single shard, so the actual max-comparison branch
  // (entryBytes > largestConnBytes) was never proven to pick correctly
  // rather than being coincidentally right with nothing to compare against
  // (ship coverage audit gap). The largest shard is inserted FIRST so the
  // comparison must correctly reject the smaller shards that follow it,
  // not just track "whatever came last".
  try {
    const connBig = { id: 'big', userEmail: 'a@example.com', tabName: 'BiggestOne', spreadsheetUrl: 'https://x', headerConfigs: [{ name: 'H1' }, { name: 'H2' }, { name: 'H3' }, { name: 'H4' }] };
    const connMedium = { id: 'medium', userEmail: 'a@example.com', tabName: 'Medium', spreadsheetUrl: 'https://x', headerConfigs: [{ name: 'H' }] };
    const connSmall = { id: 'small', userEmail: 'a@example.com', tabName: 'Small', spreadsheetUrl: 'https://x' };
    const propStore = {
      admin_email: 'admin@example.com',
      diag_index: '[]',
      capture_conn_big: JSON.stringify(connBig),
      capture_conn_medium: JSON.stringify(connMedium),
      capture_conn_small: JSON.stringify(connSmall)
    };
    const ctx = makeShardedContext({ propStore, activeEmail: 'admin@example.com' });
    vm.runInContext(codeSource, ctx);
    const diag = vm.runInContext('getAdminDiagnostics()', ctx);
    const h = diag.registryHealth;
    const expectedLargestBytes = 'capture_conn_big'.length + propStore.capture_conn_big.length;
    check('registryHealth picks the correct largest connection across multiple shards',
      h.largestConnTab === 'BiggestOne' && h.largestConnBytes === expectedLargestBytes);
    check('registryHealth does not let a smaller shard scanned later override the largest',
      h.largestConnTab !== 'Small' && h.largestConnTab !== 'Medium');
  } catch (e) {
    failures.push('registryHealth multi-shard largest-connection selection: ' + e.message);
  }

  // REGRESSION: _flushRegistryResults used to rewrite the whole registry blob
  // on every processEmails run; sharding changed this to selective per-shard
  // writes. With two connections and a sync result for only one, the other
  // connection's shard must be written zero times (ship coverage audit gap).
  try {
    const connWithResult = { id: 'flush-a', userEmail: 'tester@example.com', tabName: 'HasResult', spreadsheetUrl: 'https://x', lastSyncTime: null };
    const connWithoutResult = { id: 'flush-b', userEmail: 'tester@example.com', tabName: 'NoResult', spreadsheetUrl: 'https://x', lastSyncTime: 555 };
    const propStore = {
      'capture_conn_flush-a': JSON.stringify(connWithResult),
      'capture_conn_flush-b': JSON.stringify(connWithoutResult)
    };
    const untouchedSnapshot = propStore['capture_conn_flush-b'];
    const ctx = makeShardedContext({ propStore });
    vm.runInContext(codeSource, ctx);
    vm.runInContext(
      `_flushRegistryResults(PropertiesService.getScriptProperties(), [{ tabName: 'HasResult', url: 'https://x', userEmail: 'tester@example.com', status: 'ok', reportId: 'r1', counts: { scanned: 1, new: 1, updated: 0 }, durationMs: 5, advanceSyncTime: true, syncTime: 999, nextCursor: undefined }])`,
      ctx
    );
    const updated = JSON.parse(propStore['capture_conn_flush-a']);
    check('_flushRegistryResults writes the shard that has a sync result',
      updated.lastRunStatus === 'ok' && updated.lastSyncTime === 999);
    check('_flushRegistryResults leaves a shard with no sync result completely untouched (selective write regression)',
      propStore['capture_conn_flush-b'] === untouchedSnapshot);
  } catch (e) {
    failures.push('_flushRegistryResults selective write: ' + e.message);
  }

  // WRITE-FAILURE PATH: the inner try/catch around _writeConnection() (Code.js
  // comment: "Most likely cause: this connection's serialized size exceeds
  // the PropertiesService per-property size limit") was never forced to
  // actually throw. Force one shard's write to fail and verify (a) the
  // sibling shard's write still lands, (b) the error does not propagate out
  // of _flushRegistryResults, and (c) the failure is logged via
  // logDiag('ERROR', 'processEmails:flushWrite', ...) (ship coverage audit gap).
  try {
    const connGood = { id: 'flush-c', userEmail: 'tester@example.com', tabName: 'GoodOne', spreadsheetUrl: 'https://x' };
    const connBad = { id: 'flush-fail', userEmail: 'tester@example.com', tabName: 'FailOne', spreadsheetUrl: 'https://x' };
    const propStore = {
      'capture_conn_flush-c': JSON.stringify(connGood),
      'capture_conn_flush-fail': JSON.stringify(connBad)
    };
    const ctx = makeShardedContext({ propStore });
    const originalGetScriptProperties = ctx.PropertiesService.getScriptProperties;
    ctx.PropertiesService.getScriptProperties = function() {
      const real = originalGetScriptProperties();
      return Object.assign({}, real, {
        setProperty: function(k, v) {
          if (k === 'capture_conn_flush-fail') throw new RangeError('Value is too large: ' + k);
          real.setProperty(k, v);
        }
      });
    };
    vm.runInContext(codeSource, ctx);
    let threw = false;
    try {
      vm.runInContext(
        `_flushRegistryResults(PropertiesService.getScriptProperties(), [
          { tabName: 'GoodOne', url: 'https://x', userEmail: 'tester@example.com', status: 'ok', reportId: 'rg', counts: { scanned: 1, new: 1, updated: 0 }, durationMs: 5, advanceSyncTime: true, syncTime: 111 },
          { tabName: 'FailOne', url: 'https://x', userEmail: 'tester@example.com', status: 'ok', reportId: 'rf', counts: { scanned: 1, new: 1, updated: 0 }, durationMs: 5, advanceSyncTime: true, syncTime: 222 }
        ])`,
        ctx
      );
    } catch (inner) {
      threw = true;
    }
    check('_flushRegistryResults does not propagate a per-shard write error out of the flush (own try/catch holds)', threw === false);
    const goodUpdated = JSON.parse(propStore['capture_conn_flush-c']);
    check('_flushRegistryResults writes the sibling shard even when another shard write throws',
      goodUpdated.lastRunStatus === 'ok' && goodUpdated.lastSyncTime === 111);
    const diagEntries = Object.keys(propStore).filter(k => k.indexOf('diag_') === 0).map(k => JSON.parse(propStore[k]));
    const flushFailureDiag = diagEntries.find(d => d.where === 'processEmails:flushWrite');
    check('_flushRegistryResults logs the write failure via logDiag(ERROR, processEmails:flushWrite, ...)',
      !!flushFailureDiag && flushFailureDiag.tabName === 'FailOne' && flushFailureDiag.level === 'ERROR');
  } catch (e) {
    failures.push('_flushRegistryResults write-failure path: ' + e.message);
  }
}

// ==========================================
// Entry-point migration gating for read-only functions: getDashboardData and
// getDebugSnapshot used to be pure reads; sharding adds a migration call at
// their entry, a behavior change on existing functions (ship coverage gap).
// ==========================================
function checkReadEntryPointMigration(codeSource) {
  try {
    const blobConn = { userEmail: 'tester@example.com', gmailLabel: 'L', tabName: 'DashTab', spreadsheetUrl: 'https://x', isPaused: false, initialSync: '50', lastSyncTime: null };
    const propStore = { capture_registry: JSON.stringify([blobConn]) };
    const ctx = makeShardedContext({ propStore, activeEmail: 'tester@example.com' });
    vm.runInContext(codeSource, ctx);
    const data = vm.runInContext('getDashboardData()', ctx);
    check('getDashboardData migrates a legacy blob at entry', propStore.capture_registry === undefined && shardKeysIn(propStore).length === 1);
    check('getDashboardData still returns the migrated connection', data.connections.length === 1 && data.connections[0].tabName === 'DashTab');
  } catch (e) {
    failures.push('getDashboardData migration-at-entry: ' + e.message);
  }

  try {
    const blobConn = { userEmail: 'tester@example.com', gmailLabel: 'L', tabName: 'DebugTab', spreadsheetUrl: 'https://x', isPaused: false, initialSync: '50', lastSyncTime: null };
    const propStore = { capture_registry: JSON.stringify([blobConn]) };
    const ctx = makeShardedContext({ propStore, activeEmail: 'tester@example.com' });
    vm.runInContext(codeSource, ctx);
    const snapshot = vm.runInContext('getDebugSnapshot()', ctx);
    check('getDebugSnapshot migrates a legacy blob at entry', propStore.capture_registry === undefined && shardKeysIn(propStore).length === 1);
    check('getDebugSnapshot still returns the migrated connection', snapshot.connections.length === 1 && snapshot.connections[0].tabName === 'DebugTab');
  } catch (e) {
    failures.push('getDebugSnapshot migration-at-entry: ' + e.message);
  }
}

// ==========================================
// repairConnection threads conn.id through to setupSpreadsheet (D9) so a
// repair updates the same shard in place rather than creating a new one.
// ==========================================
function checkRepairConnectionIdThreading(codeSource) {
  try {
    const conn = {
      id: 'repair-1', userEmail: 'tester@example.com', gmailLabel: 'RepairLabel', tabName: 'RepairTab',
      spreadsheetUrl: 'https://x', sheetId: 1, isPaused: false, initialSync: '50', lastSyncTime: 12345,
      headerConfigs: [{ name: 'Subject', pattern: 'EMAIL_ID' }]
    };
    const propStore = { 'capture_conn_repair-1': JSON.stringify(conn) };
    const ctx = makeShardedContext({ propStore, activeEmail: 'tester@example.com' });
    vm.runInContext(codeSource, ctx);
    const result = vm.runInContext("repairConnection('RepairTab', 'https://x')", ctx);
    check('repairConnection succeeds against sharded storage', result && result.success === true);
    check('repairConnection updates the same shard in place (no ghost, D9)', shardKeysIn(propStore).length === 1);
    const rebuilt = JSON.parse(propStore[shardKeysIn(propStore)[0]]);
    check('repairConnection reuses the original conn.id', rebuilt.id === 'repair-1');
  } catch (e) {
    failures.push('repairConnection id threading: ' + e.message);
  }
}

// ==========================================
// Phase 3: processEmails cursor/sync-state behavior against sharded storage
// ==========================================
function checkPhase3Helpers(codeSource) {
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
    const ctx1 = makeShardedContext({});
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
    const conn2 = {
      id: 'phase3-2', userEmail: 'tester@example.com', gmailLabel: 'TestLabel', tabName: 'TestTab',
      spreadsheetUrl: 'https://fake/sheet', isPaused: false,
      initialSync: 'all', lastSyncTime: null, syncCursor: 0
    };
    const propStore = { 'capture_conn_phase3-2': JSON.stringify(conn2) };
    const ctx2 = makeShardedContext({ propStore, activeEmail: 'tester@example.com', searchReturn: makeThreads(100) });
    vm.runInContext(codeSource, ctx2);
    vm.runInContext('processEmails()', ctx2);
    const fresh2 = JSON.parse(propStore[shardKeysIn(propStore)[0]]);
    check('all-sync full batch advances syncCursor to 100', fresh2.syncCursor === 100);
    check('all-sync full batch does not set lastSyncTime', fresh2.lastSyncTime === null);
  } catch(e) {
    failures.push('Phase 3 cursor-advance: ' + e.message);
  }

  // Test 3: "all" sync with final batch (< 100) → cursor cleared, lastSyncTime set, counts tracked
  try {
    const conn3 = {
      id: 'phase3-3', userEmail: 'tester@example.com', gmailLabel: 'TestLabel', tabName: 'TestTab',
      spreadsheetUrl: 'https://fake/sheet', isPaused: false,
      initialSync: 'all', lastSyncTime: null, syncCursor: 100
    };
    const propStore = { 'capture_conn_phase3-3': JSON.stringify(conn3) };
    const ctx3 = makeShardedContext({ propStore, activeEmail: 'tester@example.com', searchReturn: makeThreads(50) });
    vm.runInContext(codeSource, ctx3);
    vm.runInContext('processEmails()', ctx3);
    const fresh3 = JSON.parse(propStore[shardKeysIn(propStore)[0]]);
    check('all-sync final batch clears syncCursor', fresh3.syncCursor === null);
    check('all-sync final batch sets lastSyncTime', typeof fresh3.lastSyncTime === 'number');
    check('all-sync final batch accumulates lastCounts.new', fresh3.lastCounts && fresh3.lastCounts.new === 50);
  } catch(e) {
    failures.push('Phase 3 cursor-complete: ' + e.message);
  }

  // Test 4: migration runs ahead of processEmails and the run still succeeds
  // against the freshly-migrated shard (entry-point migration gating).
  try {
    const blobConn = {
      userEmail: 'tester@example.com', gmailLabel: 'TestLabel', tabName: 'MigratedTab',
      spreadsheetUrl: 'https://fake/sheet', isPaused: false,
      initialSync: '50', lastSyncTime: null
    };
    const propStore = { capture_registry: JSON.stringify([blobConn]) };
    const ctx4 = makeShardedContext({ propStore, activeEmail: 'tester@example.com', searchReturn: makeThreads(3) });
    vm.runInContext(codeSource, ctx4);
    vm.runInContext('processEmails()', ctx4);
    check('processEmails migrates a legacy blob at entry before syncing (1A entry-point gating)',
      propStore.capture_registry === undefined && shardKeysIn(propStore).length === 1);
  } catch (e) {
    failures.push('Phase 3 migration-at-entry: ' + e.message);
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

function checkRegistryOwnership(codeSource) {
  // Regression test for the red-team finding (commit 1e6fc9f): setupSpreadsheet
  // used to delete any existing registry entry matching (tabName, spreadsheetUrl)
  // with no ownership check, letting one user silently hijack another user's
  // connection on a shared spreadsheet by reusing the same tab name. Re-pointed
  // to sharded storage per plan amendment 4A — the regression must stay green.
  try {
    const victimEntry = {
      id: 'victim-1', userEmail: 'victim@example.com', gmailLabel: 'VictimLabel', tabName: 'Shared',
      spreadsheetUrl: 'https://fake/shared-sheet', sheetId: 1, isPaused: false,
      initialSync: '50', lastSyncTime: null, headerConfigs: [{ name: 'Subject', pattern: 'EMAIL_ID' }]
    };
    const propStore = { capture_conn_victim1: JSON.stringify(victimEntry) };
    const ctx = makeShardedContext({ propStore, activeEmail: 'attacker@example.com' });
    vm.runInContext(codeSource, ctx);
    const result = vm.runInContext(
      "setupSpreadsheet('AttackerLabel', 'Shared', 'https://fake/shared-sheet', [{name:'Subject',pattern:'EMAIL_ID'}], '50', null, true)",
      ctx
    );
    check('setupSpreadsheet rejects hijacking another user\'s tab-name/URL combo (sharded)', result && result.success === false);
    check('setupSpreadsheet leaves the victim\'s shard untouched on a rejected hijack attempt',
      propStore.capture_conn_victim1 === JSON.stringify(victimEntry));
    check('setupSpreadsheet creates no new shard for the rejected hijack attempt', shardKeysIn(propStore).length === 1);
  } catch (error) {
    failures.push(`registry ownership checks: ${error.message}`);
  }

  // A hijack attempt via a forged connId (belonging to another user) must also
  // be rejected without mutating that user's shard.
  try {
    const victimEntry = {
      id: 'victim-2', userEmail: 'victim2@example.com', tabName: 'Owned',
      spreadsheetUrl: 'https://fake/owned-sheet', sheetId: 2, isPaused: false,
      initialSync: '50', lastSyncTime: null, headerConfigs: []
    };
    const propStore = { capture_conn_victim2: JSON.stringify(victimEntry) };
    const ctx = makeShardedContext({ propStore, activeEmail: 'attacker@example.com' });
    vm.runInContext(codeSource, ctx);
    const result = vm.runInContext(
      "setupSpreadsheet('AttackerLabel', 'Owned', 'https://fake/owned-sheet', [], '50', null, true, 'victim-2')",
      ctx
    );
    check('setupSpreadsheet rejects a save using a connId owned by another user', result && result.success === false);
    check('setupSpreadsheet leaves the other user\'s shard untouched on a forged-id attempt',
      propStore.capture_conn_victim2 === JSON.stringify(victimEntry));
  } catch (error) {
    failures.push(`registry ownership via forged connId: ${error.message}`);
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
checkRegistryHelpers(codeSource);
checkMigration(codeSource);
checkWritePathEntryPoints(codeSource);
checkPhase3Helpers(codeSource);
checkIsAdmin(codeSource);
checkAdminUnauthorizedShape(codeSource);
checkRegistryOwnership(codeSource);
checkReadEntryPointMigration(codeSource);
checkRepairConnectionIdThreading(codeSource);

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
