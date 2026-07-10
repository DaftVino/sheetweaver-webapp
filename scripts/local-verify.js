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

  // _flushCorruptShardLogs: previously only asserted that a corrupt shard is
  // excluded from the returned registry, never that the deferred logDiag call
  // actually fires once the caller's lock is released (ship pre-landing
  // review testing gap).
  try {
    const propStore = {
      capture_conn_ok: JSON.stringify({ id: 'ok', userEmail: 'a@example.com', tabName: 'A', spreadsheetUrl: 'https://x' }),
      capture_conn_bad: '{not valid json'
    };
    const ctx = makeShardedContext({ propStore });
    vm.runInContext(codeSource, ctx);
    vm.runInContext('_readRegistry(PropertiesService.getScriptProperties())', ctx);
    const diagCountBefore = Object.keys(propStore).filter(k => k.indexOf('diag_') === 0).length;
    check('_flushCorruptShardLogs has not logged yet — _readRegistry alone only queues (2A)', diagCountBefore === 0);
    vm.runInContext('_flushCorruptShardLogs()', ctx);
    const diagEntries = Object.keys(propStore).filter(k => k.indexOf('diag_') === 0).map(k => JSON.parse(propStore[k]));
    const corruptShardDiag = diagEntries.find(d => d.where === '_readRegistry:corruptShard');
    check('_flushCorruptShardLogs logs the corrupt shard via logDiag(ERROR, _readRegistry:corruptShard, ...)',
      !!corruptShardDiag && corruptShardDiag.key === 'capture_conn_bad' && corruptShardDiag.level === 'ERROR');
  } catch (e) {
    failures.push('_flushCorruptShardLogs actually logs: ' + e.message);
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
// Bug C fix (2026-07-03): a per-record migration shard-write failure must be
// (a) logged with enough identity (userEmail) to actually find the affected
// user, and (b) surfaced in getAdminDiagnostics()'s registryHealth without a
// new RPC — derived from the already-fetched diag events array.
// ==========================================
function checkMigrationFailureVisibility(codeSource) {
  try {
    const blob = [{ userEmail: 'failuser@example.com', tabName: 'FailTab', spreadsheetUrl: 'https://big' }];
    const propStore = { capture_registry: JSON.stringify(blob), admin_email: 'admin@example.com' };
    const ctx = makeShardedContext({ propStore, activeEmail: 'admin@example.com' });
    vm.runInContext(codeSource, ctx);
    // Wrap setProperty so only the shard write throws (simulating an
    // oversized migrated record exceeding the per-property size cap).
    vm.runInContext(
      `(function() {
        var props = PropertiesService.getScriptProperties();
        var origSetProperty = props.setProperty;
        props.setProperty = function(k, v) {
          if (k.indexOf('capture_conn_') === 0) throw new RangeError('Value is too large: ' + k);
          return origSetProperty(k, v);
        };
        globalThis._testProps = props;
      })();`,
      ctx
    );
    vm.runInContext('_migrateRegistryIfNeeded(_testProps)', ctx);

    const diagEntries = Object.keys(propStore).filter(k => k.indexOf('diag_') === 0).map(k => JSON.parse(propStore[k]));
    const failureDiag = diagEntries.find(d => d.where === '_migrateRegistryIfNeeded:writeFailed');
    check('_migrateRegistryIfNeeded logs userEmail in the writeFailed payload (Bug C part 1)',
      !!failureDiag && failureDiag.userEmail === 'failuser@example.com' && failureDiag.tabName === 'FailTab');

    const diag = vm.runInContext('getAdminDiagnostics()', ctx);
    check('getAdminDiagnostics surfaces registryHealth.migrationFailures from the already-fetched events array (Bug C part 2)',
      !!diag.registryHealth && !!diag.registryHealth.migrationFailures &&
      diag.registryHealth.migrationFailures.count >= 1 &&
      diag.registryHealth.migrationFailures.records.some(r => r.userEmail === 'failuser@example.com' && r.tabName === 'FailTab'));
  } catch (e) {
    failures.push('migration failure visibility: ' + e.message);
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

  // setupSpreadsheet shares the same migration-gated retry-error shape as
  // togglePauseConnection/deleteConnection (D4) — previously only the latter
  // two were covered (ship pre-landing review testing gap).
  try {
    const blob = [{ userEmail: 'tester@example.com', tabName: 'T1', spreadsheetUrl: 'https://x' }];
    const propStore = { capture_registry: JSON.stringify(blob) };
    const ctx = makeShardedContext({ propStore, tryLockResult: false, activeEmail: 'tester@example.com' });
    vm.runInContext(codeSource, ctx);
    const setupResult = vm.runInContext(
      "setupSpreadsheet('Label', 'NewTab', 'https://y', [{name:'Subject',pattern:'EMAIL_ID'}], '50', null, true)",
      ctx
    );
    check('setupSpreadsheet returns a retry error when migration cannot acquire its lock (D4)',
      setupResult && setupResult.success === false && setupResult.error === 'Update in progress, please retry.');
    check('setupSpreadsheet migration-lock-failure creates no shard', shardKeysIn(propStore).length === 0);
  } catch (e) {
    failures.push('setupSpreadsheet migration-gated lock failure: ' + e.message);
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

  // _utf8ByteLength: the size guard must measure real UTF-8 bytes, not JS
  // string .length (UTF-16 code units), or multi-byte characters (CJK, emoji)
  // slip past the guard undercounted (ship pre-landing review, Claude
  // adversarial subagent).
  try {
    const ctx = makeShardedContext({});
    vm.runInContext(codeSource, ctx);
    const asciiLen = vm.runInContext("_utf8ByteLength('hello')", ctx);
    check('_utf8ByteLength matches .length for pure ASCII', asciiLen === 5);
    const cjkLen = vm.runInContext("_utf8ByteLength('日本語')", ctx);
    check('_utf8ByteLength counts 3 bytes per CJK character, not 1 (UTF-16 .length would say 3, real UTF-8 is 9)', cjkLen === 9);
  } catch (e) {
    failures.push('_utf8ByteLength: ' + e.message);
  }

  // setupSpreadsheet's size guard must reject based on real UTF-8 bytes: a
  // tabName packed with multi-byte characters can be small by .length but
  // large by UTF-8 byte count.
  try {
    const propStore = {};
    const ctx = makeShardedContext({ propStore, activeEmail: 'tester@example.com' });
    vm.runInContext(codeSource, ctx);
    const wideHeaderConfigs = [];
    for (let i = 0; i < 200; i++) {
      wideHeaderConfigs.push({ name: '列名' + i, pattern: '日本語のパターン文字列' + i, delimiter: 'newline', format: 'text' });
    }
    const result = vm.runInContext(
      `setupSpreadsheet('宽标签', '宽标签页', 'https://wide', ${JSON.stringify(wideHeaderConfigs)}, '50', null, true)`,
      ctx
    );
    check('setupSpreadsheet rejects a multi-byte-heavy record whose UTF-8 size exceeds the cap even though .length alone would not',
      result && result.success === false && /too many columns\/rules/.test(result.error));
  } catch (e) {
    failures.push('9KB size guard UTF-8 byte counting: ' + e.message);
  }

  // 500KB total-store guard (Bug B, 2026-07-03): a new-connection save that
  // would push the total store over MAX_TOTAL_STORE_BYTES is rejected.
  try {
    const bigValue = 'x'.repeat(499800);
    const propStore = { padding_key: bigValue };
    const ctx = makeShardedContext({ propStore, activeEmail: 'tester@example.com' });
    vm.runInContext(codeSource, ctx);
    const result = vm.runInContext(
      "setupSpreadsheet('Label', 'NewTab', 'https://x', [{name:'Subject',pattern:'EMAIL_ID'}], '50', null, true)",
      ctx
    );
    check('setupSpreadsheet rejects a new connection that would push the total store over MAX_TOTAL_STORE_BYTES (Bug B)',
      result && result.success === false && /storage is full/i.test(result.error));
    check('setupSpreadsheet writes no shard when the total-store guard rejects', shardKeysIn(propStore).length === 0);
  } catch (e) {
    failures.push('total-store guard, new connection rejected: ' + e.message);
  }

  // An in-place edit of an existing connection at the same size still
  // succeeds even when the store is already at/over cap, since it isn't net
  // growth (Bug B guard must only block growth, never edits).
  try {
    const existingConn = {
      id: 'edit-under-cap', userEmail: 'tester@example.com', gmailLabel: 'Label', tabName: 'EditMe',
      spreadsheetUrl: 'https://x', sheetId: 1, isPaused: false, initialSync: '50',
      lastSyncTime: null, headerConfigs: [{ name: 'Subject', pattern: 'EMAIL_ID' }]
    };
    const bigValue = 'x'.repeat(499800);
    const propStore = {
      padding_key: bigValue,
      'capture_conn_edit-under-cap': JSON.stringify(existingConn)
    };
    const ctx = makeShardedContext({ propStore, activeEmail: 'tester@example.com' });
    vm.runInContext(codeSource, ctx);
    const result = vm.runInContext(
      "setupSpreadsheet('Label', 'EditMe', 'https://x', [{name:'Subject',pattern:'EMAIL_ID'}], '50', 'EditMe', true, 'edit-under-cap')",
      ctx
    );
    check('setupSpreadsheet allows an in-place edit that does not grow the store even when already over cap (Bug B)',
      result && result.success === true);
  } catch (e) {
    failures.push('total-store guard, edit-in-place allowed: ' + e.message);
  }

  // Comfortably under the cap: succeeds normally, one shard written.
  try {
    const propStore = {};
    const ctx = makeShardedContext({ propStore, activeEmail: 'tester@example.com' });
    vm.runInContext(codeSource, ctx);
    const result = vm.runInContext(
      "setupSpreadsheet('Label', 'FreshTab', 'https://x', [{name:'Subject',pattern:'EMAIL_ID'}], '50', null, true)",
      ctx
    );
    check('setupSpreadsheet succeeds normally when comfortably under MAX_TOTAL_STORE_BYTES (Bug B)',
      result && result.success === true);
    check('setupSpreadsheet writes exactly one shard for the normal case', shardKeysIn(propStore).length === 1);
  } catch (e) {
    failures.push('total-store guard, comfortably-under-cap succeeds: ' + e.message);
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

  // REGRESSION (ship pre-landing review, Claude adversarial subagent):
  // _writeConnection must refuse an id-less connection (an unmigrated legacy
  // blob-fallback record) instead of writing it to the fixed, shared key
  // "capture_conn_undefined" — which would silently collide with any other
  // id-less connection written in the same migration-lock-contention window.
  try {
    const ctx = makeShardedContext({});
    vm.runInContext(codeSource, ctx);
    let threw = false;
    let message = '';
    try {
      vm.runInContext(
        "_writeConnection(PropertiesService.getScriptProperties(), { userEmail: 'a@example.com', tabName: 'NoId', spreadsheetUrl: 'https://x' })",
        ctx
      );
    } catch (inner) {
      threw = true;
      message = String(inner.message || inner);
    }
    check('_writeConnection throws instead of writing an id-less connection', threw === true);
    check('_writeConnection never creates a "capture_conn_undefined" key', message.length > 0);
  } catch (e) {
    failures.push('_writeConnection id-less guard: ' + e.message);
  }

  // _flushRegistryResults must handle an id-less legacy record (reachable via
  // _readRegistry's blob-fallback merge when migration hasn't completed) the
  // same way it handles any other write failure: skip, log, and leave every
  // other shard's write unaffected.
  try {
    const connGood = { id: 'flush-good', userEmail: 'tester@example.com', tabName: 'GoodOne', spreadsheetUrl: 'https://x' };
    const legacyBlobConn = { userEmail: 'tester@example.com', tabName: 'LegacyOne', spreadsheetUrl: 'https://y' };
    const propStore = {
      'capture_conn_flush-good': JSON.stringify(connGood),
      capture_registry: JSON.stringify([legacyBlobConn])
    };
    const ctx = makeShardedContext({ propStore });
    vm.runInContext(codeSource, ctx);
    let threw = false;
    try {
      vm.runInContext(
        `_flushRegistryResults(PropertiesService.getScriptProperties(), [
          { tabName: 'GoodOne', url: 'https://x', userEmail: 'tester@example.com', status: 'ok', reportId: 'rg', counts: { scanned: 1, new: 1, updated: 0 }, durationMs: 5, advanceSyncTime: true, syncTime: 111 },
          { tabName: 'LegacyOne', url: 'https://y', userEmail: 'tester@example.com', status: 'ok', reportId: 'rl', counts: { scanned: 1, new: 1, updated: 0 }, durationMs: 5, advanceSyncTime: true, syncTime: 222 }
        ])`,
        ctx
      );
    } catch (inner) {
      threw = true;
    }
    check('_flushRegistryResults does not propagate when a legacy id-less record is in the flush', threw === false);
    check('_flushRegistryResults never creates a capture_conn_undefined key', propStore['capture_conn_undefined'] === undefined);
    const goodUpdated = JSON.parse(propStore['capture_conn_flush-good']);
    check('_flushRegistryResults still writes the properly-shard-backed connection', goodUpdated.lastRunStatus === 'ok' && goodUpdated.lastSyncTime === 111);
  } catch (e) {
    failures.push('_flushRegistryResults id-less legacy record: ' + e.message);
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
// Loom B: rows-woven counter + dashboard fields (ship coverage audit gap —
// Phase 3 diff had zero assertions on _getIntProp, the counter write path,
// or the two new getDashboardData fields before this).
// ==========================================
function checkLoomBHelpers(codeSource) {
  try {
    const ctx = makeShardedContext({});
    vm.runInContext(codeSource, ctx);
    const absent = vm.runInContext("_getIntProp(PropertiesService.getScriptProperties(), 'nope')", ctx);
    check('_getIntProp returns 0 when the key is absent', absent === 0);
    const propStore = { loom_total_rows_woven: '42' };
    const ctxValid = makeShardedContext({ propStore });
    vm.runInContext(codeSource, ctxValid);
    const valid = vm.runInContext("_getIntProp(PropertiesService.getScriptProperties(), 'loom_total_rows_woven')", ctxValid);
    check('_getIntProp parses a valid integer string', valid === 42);
    const propStoreGarbage = { loom_total_rows_woven: 'not-a-number' };
    const ctxGarbage = makeShardedContext({ propStore: propStoreGarbage });
    vm.runInContext(codeSource, ctxGarbage);
    const garbage = vm.runInContext("_getIntProp(PropertiesService.getScriptProperties(), 'loom_total_rows_woven')", ctxGarbage);
    check('_getIntProp falls back to 0 on a non-numeric stored value', garbage === 0);
  } catch (e) {
    failures.push('_getIntProp: ' + e.message);
  }

  try {
    const conn = { id: 'loom-b', userEmail: 'tester@example.com', tabName: 'RowsTab', spreadsheetUrl: 'https://x' };
    const propStore = { 'capture_conn_loom-b': JSON.stringify(conn), loom_total_rows_woven: '10' };
    const ctx = makeShardedContext({ propStore });
    vm.runInContext(codeSource, ctx);
    vm.runInContext(
      `_flushRegistryResults(PropertiesService.getScriptProperties(), [{ tabName: 'RowsTab', url: 'https://x', userEmail: 'tester@example.com', status: 'ok', reportId: 'r1', counts: { scanned: 5, new: 3, updated: 0 }, durationMs: 5, advanceSyncTime: true, syncTime: 999 }])`,
      ctx
    );
    check('_flushRegistryResults increments the rows-woven counter by the sum of counts.new', propStore.loom_total_rows_woven === '13');
  } catch (e) {
    failures.push('rows-woven counter increment: ' + e.message);
  }

  try {
    const conn1 = { id: 'loom-multi-1', userEmail: 'tester@example.com', tabName: 'TabA', spreadsheetUrl: 'https://x' };
    const conn2 = { id: 'loom-multi-2', userEmail: 'tester@example.com', tabName: 'TabB', spreadsheetUrl: 'https://x' };
    const propStore = {
      'capture_conn_loom-multi-1': JSON.stringify(conn1),
      'capture_conn_loom-multi-2': JSON.stringify(conn2),
      loom_total_rows_woven: '0'
    };
    const ctx = makeShardedContext({ propStore });
    vm.runInContext(codeSource, ctx);
    vm.runInContext(
      `_flushRegistryResults(PropertiesService.getScriptProperties(), [
        { tabName: 'TabA', url: 'https://x', userEmail: 'tester@example.com', status: 'ok', reportId: 'r1', counts: { scanned: 5, new: 3, updated: 0 }, durationMs: 5, advanceSyncTime: true, syncTime: 999 },
        { tabName: 'TabB', url: 'https://x', userEmail: 'tester@example.com', status: 'ok', reportId: 'r2', counts: { scanned: 2, new: 2, updated: 0 }, durationMs: 5, advanceSyncTime: true, syncTime: 999 }
      ])`,
      ctx
    );
    check('_flushRegistryResults sums counts.new across multiple connections in one flush (pre-landing review finding)', propStore.loom_total_rows_woven === '5');
  } catch (e) {
    failures.push('rows-woven counter multi-connection sum: ' + e.message);
  }

  try {
    const conn = { id: 'loom-b0', userEmail: 'tester@example.com', tabName: 'ZeroTab', spreadsheetUrl: 'https://x' };
    const propStore = { 'capture_conn_loom-b0': JSON.stringify(conn), loom_total_rows_woven: '7' };
    const ctx = makeShardedContext({ propStore });
    vm.runInContext(codeSource, ctx);
    vm.runInContext(
      `_flushRegistryResults(PropertiesService.getScriptProperties(), [{ tabName: 'ZeroTab', url: 'https://x', userEmail: 'tester@example.com', status: 'ok', reportId: 'r2', counts: { scanned: 5, new: 0, updated: 0 }, durationMs: 5, advanceSyncTime: true, syncTime: 999 }])`,
      ctx
    );
    check('_flushRegistryResults does not write the counter when no new rows were found', propStore.loom_total_rows_woven === '7');
  } catch (e) {
    failures.push('rows-woven counter no-op: ' + e.message);
  }

  try {
    const conn = { id: 'loom-bf', userEmail: 'tester@example.com', tabName: 'FailCounterTab', spreadsheetUrl: 'https://x' };
    const propStore = { 'capture_conn_loom-bf': JSON.stringify(conn), loom_total_rows_woven: '5' };
    const ctx = makeShardedContext({ propStore });
    const originalGetScriptProperties = ctx.PropertiesService.getScriptProperties;
    ctx.PropertiesService.getScriptProperties = function() {
      const real = originalGetScriptProperties();
      return Object.assign({}, real, {
        setProperty: function(k, v) {
          if (k === 'loom_total_rows_woven') throw new Error('quota exceeded');
          real.setProperty(k, v);
        }
      });
    };
    vm.runInContext(codeSource, ctx);
    let threw = false;
    try {
      vm.runInContext(
        `_flushRegistryResults(PropertiesService.getScriptProperties(), [{ tabName: 'FailCounterTab', url: 'https://x', userEmail: 'tester@example.com', status: 'ok', reportId: 'r3', counts: { scanned: 5, new: 4, updated: 0 }, durationMs: 5, advanceSyncTime: true, syncTime: 999 }])`,
        ctx
      );
    } catch (inner) {
      threw = true;
    }
    check('_flushRegistryResults does not propagate when the counter write throws (fail-silent by design)', threw === false);
    const updatedConn = JSON.parse(propStore['capture_conn_loom-bf']);
    check('_flushRegistryResults still writes the connection shard when only the counter write fails', updatedConn.lastRunStatus === 'ok');
  } catch (e) {
    failures.push('rows-woven counter write-failure path: ' + e.message);
  }

  try {
    const conn = { id: 'loom-b2', userEmail: 'tester@example.com', tabName: 'DashFieldsTab', spreadsheetUrl: 'https://x' };
    const propStore = { 'capture_conn_loom-b2': JSON.stringify(conn), loom_total_rows_woven: '99' };
    const ctx = makeShardedContext({ propStore, activeEmail: 'tester@example.com' });
    vm.runInContext(codeSource, ctx);
    const data = vm.runInContext('getDashboardData()', ctx);
    check('getDashboardData exposes totalRowsWoven from the loom_total_rows_woven property', data.totalRowsWoven === 99);
    check('getDashboardData exposes triggerIntervalMinutes matching TRIGGER_INTERVAL_MINUTES', data.triggerIntervalMinutes === 15);
  } catch (e) {
    failures.push('getDashboardData Loom B fields: ' + e.message);
  }

  // Pre-landing review finding: getDashboardData().triggerIntervalMinutes (the
  // displayed cadence) was tested, but the actual scheduled cadence passed to
  // ScriptApp's trigger builder never was — a regression that desyncs the two
  // would pass every other test.
  try {
    const ctx = makeShardedContext({});
    vm.runInContext(codeSource, ctx);
    let capturedInterval = null;
    ctx.ScriptApp.newTrigger = () => ({
      timeBased: () => ({
        everyMinutes: (n) => { capturedInterval = n; return { create: () => {} }; }
      })
    });
    vm.runInContext('enableUserTrigger()', ctx);
    check('enableUserTrigger schedules processEmails using TRIGGER_INTERVAL_MINUTES (not a stray literal)', capturedInterval === 15);
  } catch (e) {
    failures.push('enableUserTrigger interval wiring: ' + e.message);
  }
}

// ==========================================
// Bug A (security review, 2026-07-03): getDashboardData() must not include
// lastRunReportId/lastDurationMs for a connection the caller doesn't own —
// those two fields are never rendered for a non-owned row anywhere in
// Index.html, unlike userEmail/gmailLabel/spreadsheetUrl/lastError/lastCounts
// which are actively shown for every row (the dashboard's team-visibility
// feature) and are intentionally NOT stripped here.
// ==========================================
function checkDashboardDataFieldMinimization(codeSource) {
  try {
    const ownerConn = {
      id: 'own-1', userEmail: 'owner@example.com', gmailLabel: 'L', tabName: 'OwnerTab',
      spreadsheetUrl: 'https://x', sheetId: 1, isPaused: false,
      lastRunReportId: 'rep-1', lastError: 'boom', lastCounts: { scanned: 1, new: 1, updated: 0 }, lastDurationMs: 42
    };
    const otherConn = {
      id: 'other-1', userEmail: 'other@example.com', gmailLabel: 'L2', tabName: 'OtherTab',
      spreadsheetUrl: 'https://y', sheetId: 2, isPaused: false,
      lastRunReportId: 'rep-2', lastError: 'boom2', lastCounts: { scanned: 2, new: 2, updated: 0 }, lastDurationMs: 99
    };
    const propStore = {
      'capture_conn_own-1': JSON.stringify(ownerConn),
      'capture_conn_other-1': JSON.stringify(otherConn)
    };
    const ctx = makeShardedContext({ propStore, activeEmail: 'owner@example.com' });
    vm.runInContext(codeSource, ctx);
    const data = vm.runInContext('getDashboardData()', ctx);
    const own = data.connections.find(c => c.tabName === 'OwnerTab');
    const other = data.connections.find(c => c.tabName === 'OtherTab');

    check('getDashboardData includes lastRunReportId/lastDurationMs for an owner\'s own connection',
      !!own && own.lastRunReportId === 'rep-1' && own.lastDurationMs === 42);
    check('getDashboardData strips lastRunReportId for a non-owned connection',
      !!other && !Object.prototype.hasOwnProperty.call(other, 'lastRunReportId'));
    check('getDashboardData strips lastDurationMs for a non-owned connection',
      !!other && !Object.prototype.hasOwnProperty.call(other, 'lastDurationMs'));
    check('getDashboardData still returns lastError/lastCounts for a non-owned connection (rendered in the dashboard today — not stripped without a product decision)',
      !!other && other.lastError === 'boom2' && other.lastCounts && other.lastCounts.new === 2);
  } catch (e) {
    failures.push('getDashboardData field minimization: ' + e.message);
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

  // getEditConfig / repairConnection migrate-at-entry: both moved to
  // _migrateAndReadRegistry in the sharding diff but were only ever tested
  // against an already-sharded store, unlike getDashboardData/getDebugSnapshot
  // which have dedicated migrate-at-entry tests (ship pre-landing review
  // testing gap).
  try {
    const blobConn = {
      userEmail: 'tester@example.com', gmailLabel: 'LegacyLabel', tabName: 'LegacyTab',
      spreadsheetUrl: 'https://legacy', isPaused: false, initialSync: '50', lastSyncTime: null,
      headerConfigs: [{ name: 'Subject', pattern: 'EMAIL_ID' }]
    };
    const propStore = { capture_registry: JSON.stringify([blobConn]) };
    const ctx = makeShardedContext({ propStore, activeEmail: 'tester@example.com' });
    vm.runInContext(codeSource, ctx);
    const editConfig = vm.runInContext("getEditConfig('LegacyTab', 'https://legacy')", ctx);
    check('getEditConfig migrates a legacy blob at entry', propStore.capture_registry === undefined && shardKeysIn(propStore).length === 1);
    check('getEditConfig still finds the migrated connection', editConfig && editConfig.success === true && editConfig.tabName === 'LegacyTab');
  } catch (e) {
    failures.push('getEditConfig migration-at-entry: ' + e.message);
  }

  try {
    const blobConn = {
      userEmail: 'tester@example.com', gmailLabel: 'LegacyLabel', tabName: 'LegacyRepair',
      spreadsheetUrl: 'https://legacy-repair', isPaused: false, initialSync: '50', lastSyncTime: null,
      headerConfigs: [{ name: 'Subject', pattern: 'EMAIL_ID' }]
    };
    const propStore = { capture_registry: JSON.stringify([blobConn]) };
    const ctx = makeShardedContext({ propStore, activeEmail: 'tester@example.com' });
    vm.runInContext(codeSource, ctx);
    const result = vm.runInContext("repairConnection('LegacyRepair', 'https://legacy-repair')", ctx);
    check('repairConnection migrates a legacy blob at entry', propStore.capture_registry === undefined && shardKeysIn(propStore).length === 1);
    check('repairConnection still succeeds against the freshly migrated shard', result && result.success === true);
  } catch (e) {
    failures.push('repairConnection migration-at-entry: ' + e.message);
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

  // REGRESSION (ship pre-landing review, red-team confirmed): editing one of
  // your OWN connections (via connId) into an identity match with ANOTHER of
  // your own connections used to sail through the hijack check (it only
  // rejected collisions belonging to a DIFFERENT user), silently creating two
  // shards sharing one (tabName, spreadsheetUrl) identity. The older shard
  // became a permanently unreachable "ghost" since togglePauseConnection/
  // deleteConnection/getEditConfig all look up by identity triple via
  // _connMatches + Array.find (first match wins). Verify the same-user
  // collision is now rejected too.
  try {
    const connA = {
      id: 'own-a', userEmail: 'tester@example.com', gmailLabel: 'LabelA', tabName: 'TabA',
      spreadsheetUrl: 'https://shared', sheetId: 1, isPaused: false, initialSync: '50',
      lastSyncTime: null, headerConfigs: [{ name: 'Subject', pattern: 'EMAIL_ID' }]
    };
    const connB = {
      id: 'own-b', userEmail: 'tester@example.com', gmailLabel: 'LabelB', tabName: 'TabB',
      spreadsheetUrl: 'https://shared', sheetId: 2, isPaused: false, initialSync: '50',
      lastSyncTime: null, headerConfigs: [{ name: 'Subject', pattern: 'EMAIL_ID' }]
    };
    const propStore = {
      capture_conn_owna: JSON.stringify(connA),
      capture_conn_ownb: JSON.stringify(connB)
    };
    const ctx = makeShardedContext({ propStore, activeEmail: 'tester@example.com' });
    vm.runInContext(codeSource, ctx);
    // Edit connB (via its connId) so its tabName collides with connA's identity.
    const result = vm.runInContext(
      "setupSpreadsheet('LabelB', 'TabA', 'https://shared', [{name:'Subject',pattern:'EMAIL_ID'}], '50', 'TabB', true, 'own-b')",
      ctx
    );
    check('setupSpreadsheet rejects a same-user identity collision (ghost-shard regression)', result && result.success === false);
    check('setupSpreadsheet leaves both of the user\'s own shards untouched on a rejected same-user collision',
      propStore.capture_conn_owna === JSON.stringify(connA) && propStore.capture_conn_ownb === JSON.stringify(connB));
  } catch (error) {
    failures.push(`same-user identity collision regression: ${error.message}`);
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

// GS-C (bad-URL fix): setupSpreadsheet's save handler adds a format check on
// top of the existing non-empty check, so a Drive file link or a bare
// spreadsheet id gets caught client-side with a friendly inline error before
// ever reaching the server (which now also reclassifies a bad openByUrl to
// WARN — see Code.js:setupSpreadsheet). The regex also accepts Google's
// account-scoped `/u/N/` URLs (secondary-account sessions, routine for this
// Gmail-integration app).
//
// The behavioral assertions below run against `urlFormatPattern`, a
// hand-typed duplicate of the implementation regex — NOT one extracted from
// htmlSrc. The literal-presence check is the single source of truth: it
// asserts the exact regex literal string appears in Index.html, and
// `regexLiteral` and `urlFormatPattern` are written to be byte-for-byte the
// same pattern, so a maintainer who changes one must change all three
// together or this check fails.
function checkTargetUrlFormatValidation(htmlSrc) {
  const regexLiteral = '/\\/spreadsheets\\/(u\\/\\d+\\/)?d\\/[A-Za-z0-9_-]+/';
  check('Index.html save handler defines the targetUrl format-check regex',
    htmlSrc.indexOf(regexLiteral) !== -1,
    `expected to find literal ${regexLiteral} in Index.html`);

  const urlFormatPattern = /\/spreadsheets\/(u\/\d+\/)?d\/[A-Za-z0-9_-]+/;
  check('targetUrl format regex rejects a Drive file link',
    !urlFormatPattern.test('https://drive.google.com/file/d/1abc/view'));
  check('targetUrl format regex rejects a bare spreadsheet id with no URL structure',
    !urlFormatPattern.test('1o_0D5JwtkmEOSLugtsewKdavqhmi4s55uCXIseqvfWE'));
  check('targetUrl format regex accepts a real Sheets edit URL',
    urlFormatPattern.test('https://docs.google.com/spreadsheets/d/1o_0D5JwtkmEOSLugtsewKdavqhmi4s55uCXIseqvfWE/edit#gid=0'));
  check('targetUrl format regex accepts an account-scoped (/u/N/) Sheets URL',
    urlFormatPattern.test('https://docs.google.com/spreadsheets/u/0/d/1o_0D5JwtkmEOSLugtsewKdavqhmi4s55uCXIseqvfWE/edit'));
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

// ==========================================
// Admin override on connection management: the admin may pause/delete any
// user's connection (the dashboard renders those buttons for the admin only);
// non-admins remain owner-scoped. getDashboardData piggybacks isCallerAdmin
// so the client can gate the buttons without a new on-load RPC.
// ==========================================
function checkAdminConnectionOverride(codeSource) {
  const victim = { id: 'adm-v', userEmail: 'victim@example.com', gmailLabel: 'L', tabName: 'V', spreadsheetUrl: 'https://x', isPaused: false };

  try {
    // Non-admin caller with no admin configured: rejected, shard untouched.
    let propStore = { 'capture_conn_adm-v': JSON.stringify(victim) };
    let ctx = makeShardedContext({ propStore, activeEmail: 'intruder@example.com' });
    vm.runInContext(codeSource, ctx);
    let res = vm.runInContext("deleteConnection('V', 'https://x')", ctx);
    check('deleteConnection still rejects a non-admin deleting another user\'s connection',
      res && res.success === false && res.error === 'Not authorized.' &&
      propStore['capture_conn_adm-v'] === JSON.stringify(victim));

    // Non-admin caller when an admin IS configured (but isn't the caller).
    propStore = { 'capture_conn_adm-v': JSON.stringify(victim), admin_email: 'admin@example.com' };
    ctx = makeShardedContext({ propStore, activeEmail: 'intruder@example.com' });
    vm.runInContext(codeSource, ctx);
    res = vm.runInContext("togglePauseConnection('V', 'https://x')", ctx);
    check('togglePauseConnection still rejects a non-admin pausing another user\'s connection',
      res && res.success === false && res.error === 'Not authorized.' &&
      JSON.parse(propStore['capture_conn_adm-v']).isPaused === false);

    // Admin caller: delete of another user's connection succeeds, shard removed.
    propStore = { 'capture_conn_adm-v': JSON.stringify(victim), admin_email: 'admin@example.com' };
    ctx = makeShardedContext({ propStore, activeEmail: 'admin@example.com' });
    vm.runInContext(codeSource, ctx);
    res = vm.runInContext("deleteConnection('V', 'https://x')", ctx);
    check('deleteConnection lets the admin delete another user\'s connection',
      res && res.success === true && propStore['capture_conn_adm-v'] === undefined);

    // Admin caller: pause toggle on another user's connection succeeds.
    propStore = { 'capture_conn_adm-v': JSON.stringify(victim), admin_email: 'admin@example.com' };
    ctx = makeShardedContext({ propStore, activeEmail: 'admin@example.com' });
    vm.runInContext(codeSource, ctx);
    res = vm.runInContext("togglePauseConnection('V', 'https://x')", ctx);
    check('togglePauseConnection lets the admin pause another user\'s connection',
      res && res.success === true && JSON.parse(propStore['capture_conn_adm-v']).isPaused === true);

    // getDashboardData piggybacks the caller's admin state.
    ctx = makeShardedContext({ propStore: { 'capture_conn_adm-v': JSON.stringify(victim), admin_email: 'admin@example.com' }, activeEmail: 'admin@example.com' });
    vm.runInContext(codeSource, ctx);
    let data = vm.runInContext('getDashboardData()', ctx);
    check('getDashboardData reports isCallerAdmin:true for the admin', data && data.isCallerAdmin === true);
    ctx = makeShardedContext({ propStore: { 'capture_conn_adm-v': JSON.stringify(victim), admin_email: 'admin@example.com' }, activeEmail: 'someone@example.com' });
    vm.runInContext(codeSource, ctx);
    data = vm.runInContext('getDashboardData()', ctx);
    check('getDashboardData reports isCallerAdmin:false for a non-admin', data && data.isCallerAdmin === false);
  } catch (e) {
    failures.push('admin connection override: ' + e.message);
  }
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

// REGRESSION (red-team pre-landing review, 2026-07-03): runWeave()'s double-fire
// guard used to call the combined _weaveTeardown(), which reveals the success
// title as a side effect — on every normal (non-double-fire) save this made the
// title visible at t=0, ~2.6s before the weave animation actually finishes,
// defeating the "resolves into the title" design. Statically verify the guard
// calls the DOM-only _weaveClearStaleDom() instead, and that that function never
// touches weave-pending/successTitle (no DOM/browser harness exists to run this
// behaviorally — see the Loom B/C client-side coverage gap noted elsewhere).
function checkWeaveTeardownSplit(htmlSrc) {
  check('Index.html defines _weaveClearStaleDom (DOM-only teardown, no title reveal)',
    /function _weaveClearStaleDom\s*\(/.test(htmlSrc));

  const clearStaleDomBody = htmlSrc.match(/function _weaveClearStaleDom\s*\([^)]*\)\s*\{([\s\S]*?)\n      \}/);
  check('_weaveClearStaleDom never references weave-pending or successTitle',
    !!clearStaleDomBody && !/weave-pending|successTitle/.test(clearStaleDomBody[1]));

  const doubleFireGuardRegion = htmlSrc.match(/Double-fire guard:[\s\S]{0,300}/);
  check('runWeave()\'s double-fire guard calls _weaveClearStaleDom(), not the title-revealing _weaveTeardown()',
    !!doubleFireGuardRegion && /_weaveClearStaleDom\s*\(\s*\)/.test(doubleFireGuardRegion[0]) && !/[^_]_weaveTeardown\s*\(\s*\)/.test(doubleFireGuardRegion[0]));
}

// Loom E (ambient thread weave) + Loom F (dot-glow wave): static invariants.
// No DOM/canvas harness exists (GAS webapp, manual QA), so verify the load-bearing
// contracts the eng + design reviews locked: both background layers sit behind the
// card (z-index -1), both are prefers-reduced-motion guarded, Loom E's lifecycle is
// idempotent, and Loom F's sweep is wired to the dashboard (step-0) trigger.
function checkLoomEF(htmlSrc, scripts) {
  check('Loom E: Index.html has the #threadCanvas element',
    /<canvas[^>]*id="threadCanvas"/.test(htmlSrc));
  check('Loom F: Index.html has the #dotWave element',
    /id="dotWave"/.test(htmlSrc));

  const canvasCss = htmlSrc.match(/#threadCanvas\s*\{[^}]*\}/);
  const dotWaveCss = htmlSrc.match(/#dotWave\s*\{[^}]*\}/);
  check('Loom E: #threadCanvas sits behind the card (z-index -1)',
    !!canvasCss && /z-index:\s*-1/.test(canvasCss[0]));
  check('Loom F: #dotWave sits behind the card (z-index -1)',
    !!dotWaveCss && /z-index:\s*-1/.test(dotWaveCss[0]));

  const eBody = scripts.find(s => s.includes('makeThread') && s.includes("getElementById('threadCanvas')")) || '';
  check('Loom E: engine block present', eBody.length > 0);
  check('Loom E: guards prefers-reduced-motion', /prefers-reduced-motion[^)]*reduce/.test(eBody));
  check('Loom E: defines idempotent teardown() and start()',
    /function teardown\s*\(/.test(eBody) && /function start\s*\(/.test(eBody));
  check('Loom E: uses a canvas 2D context', /getContext\(\s*['"]2d['"]\s*\)/.test(eBody));
  check('Loom E: has the clamped animation clock (AC7) — tick() + capped sleep-credit present',
    /function tick\s*\(/.test(eBody) && /sleepWall/.test(eBody) && /sleepCredit/.test(eBody));
  check('Loom E: draw-phase head progress is eased',
    /function ease\s*\(/.test(eBody) && /head = ease\(/.test(eBody));
  check('Loom E: applyTheme is wired to the weave theme hook',
    /window\._loomThemeChanged\s*=/.test(eBody) && /_loomThemeChanged\(\)/.test(htmlSrc));

  const fBody = scripts.find(s => s.includes('window._dotWavePlay')) || '';
  check('Loom F: engine block present', fBody.length > 0);
  check('Loom F: guards prefers-reduced-motion', /prefers-reduced-motion[^)]*reduce/.test(fBody));
  check('Loom F: exposes _dotWavePlay', /window\._dotWavePlay\s*=/.test(fBody));
  check('Loom F: sweep is triggered from nextStep(0)',
    /if \(stepNumber === 0[^\n]*_dotWavePlay\(\)/.test(htmlSrc));

  // Backdrop: the dot grid + bloom render as a fixed full-viewport layer so the
  // background always covers 100% of the screen on load (no content-height breaks)
  // and registers with the fixed thread/wave layers.
  check('Loom backdrop: Index.html has the #loomBackdrop element',
    /id="loomBackdrop"/.test(htmlSrc));
  const backdropCss = htmlSrc.match(/#loomBackdrop\s*\{[^}]*\}/);
  check('Loom backdrop: #loomBackdrop is fixed, full-viewport, z-index -2',
    !!backdropCss && /position:\s*fixed/.test(backdropCss[0]) &&
    /inset:\s*0/.test(backdropCss[0]) && /z-index:\s*-2/.test(backdropCss[0]) &&
    /radial-gradient/.test(backdropCss[0]));
  const bodyCss = htmlSrc.match(/\n\s*body\s*\{[^}]*\}/);
  check('Loom backdrop: <body> no longer paints the dot grid (moved to #loomBackdrop)',
    !!bodyCss && !/background-image/.test(bodyCss[0]));
}

// Loom E/F behavioral tests: execute the actual IIFEs in a vm sandbox with a
// stubbed DOM (getElementById/matchMedia/rAF/performance/timers) and drive
// their state machines. This covers the logic paths the static checks above
// cannot: debounce, teardown/start idempotency, reduced-motion transitions,
// DPR capping, and the null-getContext guard (ship coverage audit, 2026-07-03).
function makeLoomSandbox(opts) {
  opts = opts || {};
  const S = {
    now: 1000,
    rafCount: 0, rafCbs: [], cancelled: [],
    timeoutCount: 0, timers: [], clearedTimeouts: [],
    winListeners: {}, docListeners: {}, mqListeners: [],
    clearRectCalls: 0,
    dotWaveEl: { style: {} },
    mq: {
      matches: !!opts.reduced,
      addEventListener: function (type, fn) { S.mqListeners.push(fn); }
    }
  };
  S.nodeCalls = []; // node-draw centers recorded from ctx.arc/ctx.rect (thread endpoints)
  const ctx2d = {
    setTransform: () => {}, clearRect: () => { S.clearRectCalls++; },
    beginPath: () => {}, moveTo: () => {}, lineTo: () => {}, stroke: () => {},
    arc: (x, y) => { S.nodeCalls.push({ x: x, y: y }); },
    rect: (x, y, w, h) => { S.nodeCalls.push({ x: x + w / 2, y: y + h / 2 }); },
    fill: () => {}
  };
  const canvas = {
    style: {}, width: 0, height: 0,
    getContext: () => (opts.nullCtx ? null : ctx2d)
  };
  const sandbox = {
    console: { log: () => {} },
    document: {
      hidden: false,
      getElementById: function (id) {
        if (id === 'dotWave') return opts.hasDotWave === false ? null : S.dotWaveEl;
        if (id === 'threadCanvas') return opts.hasCanvas === false ? null : canvas;
        return null;
      },
      querySelector: function (sel) {
        if (sel === '.container' && opts.containerRect) {
          return { getBoundingClientRect: () => opts.containerRect };
        }
        return null;
      },
      body: { classList: { contains: () => false } },
      addEventListener: function (t, f) { S.docListeners[t] = f; }
    },
    getComputedStyle: () => ({ getPropertyValue: () => ' #2dd4bf ' }),
    performance: { now: () => S.now },
    requestAnimationFrame: function (cb) { S.rafCount++; S.rafCbs.push(cb); return S.rafCount; },
    cancelAnimationFrame: function (id) { S.cancelled.push(id); },
    setTimeout: function (fn, ms) { S.timeoutCount++; S.timers.push({ id: S.timeoutCount, fn: fn, ms: ms }); return S.timeoutCount; },
    clearTimeout: function (id) { if (id) S.clearedTimeouts.push(id); }
  };
  sandbox.window = {
    matchMedia: () => S.mq,
    innerWidth: opts.innerWidth || 1024,
    innerHeight: opts.innerHeight || 768,
    devicePixelRatio: opts.dpr || 1,
    addEventListener: function (t, f) { S.winListeners[t] = f; }
  };
  if (opts.seed !== undefined) {
    // Deterministic RNG so geometry assertions (card avoidance) are stable.
    let seed = opts.seed >>> 0;
    const seededMath = {};
    Object.getOwnPropertyNames(Math).forEach(k => { seededMath[k] = Math[k]; });
    seededMath.random = function () {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    sandbox.Math = seededMath;
  }
  return { ctx: vm.createContext(sandbox), sandbox, S, canvas };
}

function checkLoomEFBehavior(scripts) {
  const eBody = scripts.find(s => s.includes('makeThread') && s.includes("getElementById('threadCanvas')")) || '';
  const fBody = scripts.find(s => s.includes('window._dotWavePlay')) || '';

  // --- Loom F (dot-glow wave) ---
  try {
    const t = makeLoomSandbox({ reduced: true });
    vm.runInContext(fBody, t.ctx);
    check('Loom F vm: reduced-motion at load — play() schedules nothing',
      t.S.rafCount === 0 && t.S.dotWaveEl.style.backgroundImage === undefined);
  } catch (e) {
    failures.push('Loom F vm reduced-at-load: ' + e.message);
  }

  try {
    const t = makeLoomSandbox({ hasDotWave: false });
    vm.runInContext(fBody, t.ctx);
    check('Loom F vm: missing #dotWave — early return, no export, no throw',
      t.S.rafCount === 0 && t.sandbox.window._dotWavePlay === undefined);
  } catch (e) {
    failures.push('Loom F vm missing element: ' + e.message);
  }

  try {
    const t = makeLoomSandbox({});
    vm.runInContext(fBody, t.ctx);
    check('Loom F vm: initial auto-play starts one sweep on load', t.S.rafCount === 1);
    t.sandbox.window._dotWavePlay();
    check('Loom F vm: play() debounces while a sweep is running (no overlapping rAF chain)',
      t.S.rafCount === 1);
    t.S.rafCbs[0](t.S.now + 700);            // mid-sweep frame (p = 0.5)
    check('Loom F vm: mid-sweep frame keeps full opacity and schedules the next frame',
      Number(t.S.dotWaveEl.style.opacity) === 1 && t.S.rafCount === 2);
    t.S.rafCbs[1](t.S.now + 1500);           // past sweepMs — sweep completes
    check('Loom F vm: completed sweep fades to opacity 0 and stops the rAF chain',
      Number(t.S.dotWaveEl.style.opacity) === 0 && t.S.rafCount === 2);
    t.sandbox.window._dotWavePlay();
    check('Loom F vm: play() re-arms after a completed sweep (running flag reset)',
      t.S.rafCount === 3);
  } catch (e) {
    failures.push('Loom F vm debounce/completion: ' + e.message);
  }

  try {
    const t = makeLoomSandbox({});
    vm.runInContext(fBody, t.ctx);              // sweep running (raf id 1)
    t.S.mq.matches = true;
    t.S.mqListeners.forEach(f => f());
    check('Loom F vm: reduced-motion change mid-sweep cancels the rAF and zeroes opacity',
      t.S.cancelled.indexOf(1) !== -1 && Number(t.S.dotWaveEl.style.opacity) === 0);
    t.S.mq.matches = false;
    t.sandbox.window._dotWavePlay();
    check('Loom F vm: play() works again after a cancelled sweep (running flag reset by mq handler)',
      t.S.rafCount === 2);
  } catch (e) {
    failures.push('Loom F vm mq cancel: ' + e.message);
  }

  // --- Loom E (ambient thread weave) ---
  try {
    const t = makeLoomSandbox({ hasCanvas: false });
    vm.runInContext(eBody, t.ctx);
    check('Loom E vm: missing #threadCanvas — early return, no listeners, no throw',
      t.S.rafCount === 0 && t.S.winListeners.resize === undefined);
  } catch (e) {
    failures.push('Loom E vm missing canvas: ' + e.message);
  }

  try {
    const t = makeLoomSandbox({ nullCtx: true });
    vm.runInContext(eBody, t.ctx);
    check('Loom E vm: null getContext (canvas blocked) — early return, resize listener never registered (regression: unguarded ctx.setTransform on resize)',
      t.S.winListeners.resize === undefined && t.S.rafCount === 0);
  } catch (e) {
    failures.push('Loom E vm null ctx: ' + e.message);
  }

  try {
    const t = makeLoomSandbox({ reduced: true });
    vm.runInContext(eBody, t.ctx);
    check('Loom E vm: reduced-motion at load — start() is a no-op (no rAF, no spawn timer)',
      t.S.rafCount === 0 && t.S.timeoutCount === 0);
  } catch (e) {
    failures.push('Loom E vm reduced-at-load: ' + e.message);
  }

  try {
    const t = makeLoomSandbox({ dpr: 3, innerWidth: 800, innerHeight: 600 });
    vm.runInContext(eBody, t.ctx);
    check('Loom E vm: normal load starts the loop (rAF + spawn timer scheduled)',
      t.S.rafCount >= 1 && t.S.timeoutCount >= 1);
    check('Loom E vm: resize() caps devicePixelRatio at 2 (canvas.width = 800 * 2, not * 3)',
      t.canvas.width === 1600 && t.canvas.height === 1200);
    t.sandbox.window.innerWidth = 500; t.sandbox.window.innerHeight = 400;
    t.S.winListeners.resize();
    check('Loom E vm: resize is debounced — no synchronous canvas reallocation on the raw event',
      t.canvas.width === 1600);
    t.S.timers[t.S.timers.length - 1].fn();  // fire the trailing debounce
    check('Loom E vm: debounced resize re-measures the canvas with the capped DPR',
      t.canvas.width === 1000 && t.canvas.height === 800);
    t.S.now = 1100;                           // 100ms after birth — thread still drawing
    t.S.rafCbs[t.S.rafCbs.length - 1]();
    check('Loom E vm: frame loop draws without throwing and clears the canvas each frame',
      t.S.clearRectCalls >= 1);
  } catch (e) {
    failures.push('Loom E vm load/resize/frame: ' + e.message);
  }

  try {
    const t = makeLoomSandbox({});
    vm.runInContext(eBody, t.ctx);              // running: rAF id 1 pending, spawn timer set
    t.S.mq.matches = true;
    t.S.mqListeners.forEach(f => f());          // -> teardown()
    check('Loom E vm: reduced-motion ON tears down (rAF cancelled, canvas cleared)',
      t.S.cancelled.length >= 1 && t.S.clearRectCalls >= 1);
    let secondTeardownThrew = false;
    try { t.S.mqListeners.forEach(f => f()); } catch (e2) { secondTeardownThrew = true; }
    check('Loom E vm: teardown() is idempotent — a second reduced-motion event does not throw',
      secondTeardownThrew === false);
    t.S.mq.matches = false;
    t.S.mqListeners.forEach(f => f());          // -> start()
    const timeoutsAfterStart = t.S.timeoutCount;
    check('Loom E vm: reduced-motion OFF restarts the weave (new spawn timer)',
      timeoutsAfterStart >= 2);
    t.S.mqListeners.forEach(f => f());          // start() again while running
    check('Loom E vm: start() is guarded — a repeat start while running schedules nothing new',
      t.S.timeoutCount === timeoutsAfterStart);
  } catch (e) {
    failures.push('Loom E vm teardown/start idempotency: ' + e.message);
  }

  // Clamped animation clock (AC7): a giant rAF delta (background-tab throttle)
  // credits ~16ms of thread time, so the in-flight thread is still drawing —
  // it keeps requesting frames instead of expiring and going to sleep.
  try {
    const t = makeLoomSandbox({});
    vm.runInContext(eBody, t.ctx);              // thread born at clock 0, rAF pending
    const rafBefore = t.S.rafCount;
    t.S.now = 1000 + 60000;                     // tab was hidden for a minute
    t.S.rafCbs[t.S.rafCbs.length - 1]();
    check('Loom E vm: clamped clock — a 60s rAF gap credits ~16ms, in-flight thread survives and keeps animating (AC7)',
      t.S.rafCount > rafBefore);
  } catch (e) {
    failures.push('Loom E vm clamped clock: ' + e.message);
  }

  // Hold/idle sleep-wake: drive frames until the loop sleeps (thread in its
  // static hold), then fire the wake timer — it must credit exactly the
  // scheduled interval so the thread lands in its fade phase and re-arms rAF.
  try {
    const t = makeLoomSandbox({});
    vm.runInContext(eBody, t.ctx);
    let guard = 0;
    while (guard++ < 300) {                     // ≤100ms deltas credit fully
      const before = t.S.rafCount;
      t.S.now += 100;
      t.S.rafCbs[t.S.rafCbs.length - 1]();
      if (t.S.rafCount === before) break;       // frame didn't re-arm — loop is asleep
    }
    check('Loom E vm: gated rAF sleeps during the static hold (frame stops re-arming)', guard < 300);
    const wakeTimer = t.S.timers[t.S.timers.length - 1]; // scheduled by the sleeping frame
    const rafBeforeWake = t.S.rafCount;
    t.S.now += wakeTimer.ms + 50000;            // timer fired late (hidden-tab throttle)
    wakeTimer.fn();
    check('Loom E vm: wake timer re-arms the loop', t.S.rafCount === rafBeforeWake + 1);
    const rafBeforeFade = t.S.rafCount;
    t.S.now += 16;
    t.S.rafCbs[t.S.rafCbs.length - 1]();
    check('Loom E vm: wake credits exactly the scheduled sleep — thread lands in its fade and keeps animating (AC7)',
      t.S.rafCount > rafBeforeFade);
  } catch (e) {
    failures.push('Loom E vm sleep-wake credit: ' + e.message);
  }

  // Stale wake-timer regression (red-team, 2026-07-03): a spawn that wakes the
  // loop mid-sleep must clear the pending hold-fade wake timer, or the timer
  // later fires wakeAfter() and double-credits the clock by up to ~10s.
  try {
    const t = makeLoomSandbox({});
    vm.runInContext(eBody, t.ctx);
    let guard = 0;
    while (guard++ < 300) {
      const before = t.S.rafCount;
      t.S.now += 100;
      t.S.rafCbs[t.S.rafCbs.length - 1]();
      if (t.S.rafCount === before) break;       // asleep — wake timer just scheduled
    }
    const wakeTimer = t.S.timers[t.S.timers.length - 1];
    t.S.now += 500;
    t.S.timers[0].fn();                          // pending spawn timer fires → spawnTick → wake()
    check('Loom E vm: a spawn that wakes the sleeping loop clears the pending wake timer (stale double-credit regression)',
      t.S.clearedTimeouts.indexOf(wakeTimer.id) !== -1);
  } catch (e) {
    failures.push('Loom E vm stale wake timer: ' + e.message);
  }

  // spawnTick behavior: fires a real spawn + reschedules while visible; goes
  // silent (no reschedule) when the tab is hidden at fire time.
  try {
    const t = makeLoomSandbox({});
    vm.runInContext(eBody, t.ctx);
    const timeoutsBefore = t.S.timeoutCount;
    t.S.timers[0].fn();                          // spawn timer → spawnTick
    check('Loom E vm: spawnTick reschedules itself while the tab is visible',
      t.S.timeoutCount > timeoutsBefore);
    t.sandbox.document.hidden = true;
    const timeoutsHidden = t.S.timeoutCount;
    t.S.timers[t.S.timers.length - 1].fn();      // next spawn timer fires while hidden
    check('Loom E vm: spawnTick does not spawn or reschedule while the tab is hidden',
      t.S.timeoutCount === timeoutsHidden);
  } catch (e) {
    failures.push('Loom E vm spawnTick: ' + e.message);
  }

  // Card avoidance (AC6/AC15): with a card stub and a seeded RNG, the seed
  // thread's two endpoint nodes must never BOTH sit inside the padded card
  // rect. Runs across several seeds so the invariant isn't seed-luck.
  try {
    const card = { left: 362, top: 234, right: 662, bottom: 534 }; // 300x300 centered in 1024x768
    const pad = 14;
    const inCard = p => p.x >= card.left - pad && p.x <= card.right + pad &&
                        p.y >= card.top - pad && p.y <= card.bottom + pad;
    let allSeedsOk = true, pairsChecked = 0;
    for (const seed of [1, 7, 42, 1234, 99991]) {
      const t = makeLoomSandbox({ seed: seed, containerRect: card });
      vm.runInContext(eBody, t.ctx);
      let guard = 0;
      while (guard++ < 300) {                    // drive until both endpoint nodes render in one frame
        t.S.nodeCalls.length = 0;
        t.S.now += 100;
        t.S.rafCbs[t.S.rafCbs.length - 1]();
        if (t.S.nodeCalls.length >= 2) break;
      }
      if (t.S.nodeCalls.length >= 2) {
        pairsChecked++;
        if (inCard(t.S.nodeCalls[0]) && inCard(t.S.nodeCalls[1])) allSeedsOk = false;
      }
    }
    check('Loom E vm: card avoidance — no thread ever has both endpoints inside the padded card rect (5 seeds)',
      pairsChecked === 5 && allSeedsOk, `pairs checked: ${pairsChecked}, invariant held: ${allSeedsOk}`);
  } catch (e) {
    failures.push('Loom E vm card avoidance: ' + e.message);
  }

  // Interrupted-sleep credit (adversarial finding, 2026-07-03): a wake that
  // interrupts a hold-sleep must credit the wall time actually slept (capped
  // at the scheduled interval), or every spawn/theme/resize wake silently
  // discards hold time and threads hold far past their 10s. Observable: after
  // sleeping D-scheduled, waking 3s in via the theme hook, and re-sleeping,
  // the next wake timer must be scheduled ~3s sooner — not at ~D again.
  try {
    const t = makeLoomSandbox({});
    vm.runInContext(eBody, t.ctx);
    let guard = 0;
    while (guard++ < 300) {
      const before = t.S.rafCount;
      t.S.now += 100;
      t.S.rafCbs[t.S.rafCbs.length - 1]();
      if (t.S.rafCount === before) break;       // asleep mid-hold
    }
    const firstWake = t.S.timers[t.S.timers.length - 1];
    t.S.now += 3000;                             // 3s of real sleep, then an interrupting wake
    t.sandbox.window._loomThemeChanged();        // wakes without spawning a thread
    t.S.now += 16;
    t.S.rafCbs[t.S.rafCbs.length - 1]();         // hold frame: inactive — sleeps again
    const secondWake = t.S.timers[t.S.timers.length - 1];
    const drop = firstWake.ms - secondWake.ms;
    check('Loom E vm: a wake interrupting a hold-sleep credits the slept wall time (next wake ~3s sooner, not reset)',
      drop > 2800 && drop < 3300, `first=${firstWake.ms}ms second=${secondWake.ms}ms drop=${drop}ms`);
  } catch (e) {
    failures.push('Loom E vm interrupted-sleep credit: ' + e.message);
  }

  // Reduced-motion resize guard (adversarial finding): with reduced-motion ON
  // the feature is fully off — a debounced resize must not reallocate the canvas.
  try {
    const t = makeLoomSandbox({ reduced: true });
    vm.runInContext(eBody, t.ctx);
    t.sandbox.window.innerWidth = 500; t.sandbox.window.innerHeight = 400;
    t.S.winListeners.resize();
    t.S.timers[t.S.timers.length - 1].fn();      // fire the debounce
    check('Loom E vm: reduced-motion blocks the debounced resize from touching the canvas',
      t.canvas.width === 0);
  } catch (e) {
    failures.push('Loom E vm reduced resize guard: ' + e.message);
  }

  // Theme-change hook: applyTheme() calls window._loomThemeChanged so held
  // threads repaint in the new theme even while the gated loop sleeps.
  try {
    const t = makeLoomSandbox({});
    vm.runInContext(eBody, t.ctx);
    check('Loom E vm: exposes window._loomThemeChanged', typeof t.sandbox.window._loomThemeChanged === 'function');
    let guard = 0;
    while (guard++ < 300) {
      const before = t.S.rafCount;
      t.S.now += 100;
      t.S.rafCbs[t.S.rafCbs.length - 1]();
      if (t.S.rafCount === before) break;       // asleep mid-hold
    }
    const rafBefore = t.S.rafCount;
    t.sandbox.window._loomThemeChanged();
    check('Loom E vm: _loomThemeChanged wakes the sleeping loop for a one-shot repaint',
      t.S.rafCount === rafBefore + 1);
  } catch (e) {
    failures.push('Loom E vm theme-change hook: ' + e.message);
  }

  try {
    const t = makeLoomSandbox({});
    vm.runInContext(eBody, t.ctx);
    const clearedBefore = t.S.clearedTimeouts.length;
    t.sandbox.document.hidden = true;
    t.S.docListeners.visibilitychange();
    check('Loom E vm: tab hidden clears the spawn timer (stops spawning)',
      t.S.clearedTimeouts.length > clearedBefore);
    const timeoutsBefore = t.S.timeoutCount;
    t.sandbox.document.hidden = false;
    t.S.docListeners.visibilitychange();
    check('Loom E vm: tab visible again reschedules spawning',
      t.S.timeoutCount > timeoutsBefore);
  } catch (e) {
    failures.push('Loom E vm visibilitychange: ' + e.message);
  }
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
  const appVersionMatch = read('Code.js').match(/const APP_VERSION = '([^']+)'/);
  check('APP_VERSION in Code.js matches package.json version (version drift guard)',
    !!appVersionMatch && appVersionMatch[1] === packageJson.version,
    appVersionMatch ? `Code.js=${appVersionMatch[1]} package.json=${packageJson.version}` : 'APP_VERSION not found');
}

const codeSource = read('Code.js');
checkScriptSyntax('Code.js', codeSource);
checkPureHelpers(codeSource);
checkRegistryHelpers(codeSource);
checkMigration(codeSource);
checkMigrationFailureVisibility(codeSource);
checkWritePathEntryPoints(codeSource);
checkPhase3Helpers(codeSource);
checkIsAdmin(codeSource);
checkAdminUnauthorizedShape(codeSource);
checkAdminConnectionOverride(codeSource);
checkRegistryOwnership(codeSource);
checkReadEntryPointMigration(codeSource);
checkLoomBHelpers(codeSource);
checkDashboardDataFieldMinimization(codeSource);
checkRepairConnectionIdThreading(codeSource);

const htmlSource = read('Index.html');
const inlineScripts = extractInlineScripts(htmlSource);
check('Index.html has inline app script', inlineScripts.length > 0);
inlineScripts.forEach((script, index) => {
  checkScriptSyntax(`Index.html <script #${index + 1}>`, script);
});
checkPhase4Helpers(htmlSource);
checkWeaveTeardownSplit(htmlSource);
checkLoomEF(htmlSource, inlineScripts);
checkLoomEFBehavior(inlineScripts);
checkLocalStorageConvention(htmlSource);
checkTargetUrlFormatValidation(htmlSource);

// Admin override (client side): non-owner Rest/Delete buttons are admin-gated,
// driven by the isCallerAdmin flag piggybacked on getDashboardData.
check('dashboard stores _isCallerAdmin from the getDashboardData payload',
  /_isCallerAdmin\s*=\s*!!data\.isCallerAdmin/.test(htmlSource));
check('non-owner action buttons are gated on _isCallerAdmin',
  htmlSource.includes('if (_isCallerAdmin)'));

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

// Phase 5: contextual "?" troubleshooting links. The anchors live in the
// TROUBLESHOOT_ANCHORS map in Index.html (NOT as literal troubleshooting.md#slug
// strings — the href is concatenated at runtime), so scan the map + call sites and
// validate every declared slug against a real docs/troubleshooting.md heading.
function checkTroubleshootAnchors(htmlSrc, tsSrc) {
  const mapBlock = (htmlSrc.match(/TROUBLESHOOT_ANCHORS\s*=\s*\{[\s\S]*?\}/) || [''])[0];
  const declared = (mapBlock.match(/'([a-z0-9-]+)'/g) || []).map(s => s.replace(/'/g, ''));

  // GitHub-style slugs of every ## heading in troubleshooting.md.
  const slugs = (tsSrc.match(/^##\s+.+$/gm) || []).map(h =>
    h.replace(/^##\s+/, '').toLowerCase().replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-'));

  const missing = declared.filter(a => slugs.indexOf(a) === -1);
  check('Phase 5: every TROUBLESHOOT_ANCHORS slug resolves to a troubleshooting.md heading',
    declared.length === 3 && missing.length === 0,
    missing.length ? `missing headings for: ${missing.join(', ')}` : `declared ${declared.length} anchors`);

  const expected = ['label-not-found-or-authorization-error-during-setup',
                    'broken-connection-gmail-label-or-sheet-tab-missing',
                    'emails-are-not-being-processed'];
  check('Phase 5: TROUBLESHOOT_ANCHORS declares exactly the 3 expected slugs',
    expected.every(e => declared.indexOf(e) !== -1), `declared: ${declared.join(', ')}`);

  const calls = (htmlSrc.match(/_troubleshootLink\(/g) || []).length;
  check('Phase 5: all 5 contextual error links are wired (5 call sites + 1 helper def = >=6)',
    calls >= 6, `found ${calls} occurrences`);
}
checkTroubleshootAnchors(htmlSource, read('docs/troubleshooting.md'));

if (failures.length > 0) {
  console.error('\nLocal verification failed:');
  failures.forEach(failure => console.error(`- ${failure}`));
  process.exit(1);
}

console.log('\nLocal verification passed.');
console.log('Note: Gmail, Sheets, OAuth, triggers, Cloud Logging, and non-owner identity require Apps Script integration testing.');
