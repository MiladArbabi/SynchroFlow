// tests/setup/backend-integration-db-safety.js
//
// TEST-DB-ISOLATION-11 Slice 2 — one shared disposable-test-DB predicate for the
// backend-integration Jest project's boundary guards.
//
// Used by BOTH:
//   - tests/setup/backend-integration.global-setup.js  (orchestration context)
//   - tests/setup/backend-integration.runtime-db-guard.js (test-execution context)
//
// DB-free CommonJS: no knex, no dotenv, no fs, no backend-core, no connection.
// The predicate itself reads no process.env — the caller passes the value.

'use strict';

/** Approved disposable test-database naming contract. */
const DISPOSABLE_RE = /^synchroflow_test_[A-Za-z0-9_]+$/;

/**
 * Returns normally when `dbName` is a disposable `synchroflow_test_*` name.
 * Otherwise throws an Error whose message begins exactly with `errorPrefix`
 * and names the observed value (`<unset>` for missing / empty).
 */
function assertDisposableBackendIntegrationDb(
  dbName,
  errorPrefix = 'REFUSING_BACKEND_INTEGRATION_NON_DISPOSABLE_DB'
) {
  const observed =
    typeof dbName === 'string' && dbName.length > 0 ? dbName : '<unset>';

  if (typeof dbName === 'string' && DISPOSABLE_RE.test(dbName)) {
    return;
  }

  throw new Error(
    errorPrefix +
      ': PGDATABASE=' +
      observed +
      ' — backend-integration tests only run against a disposable ' +
      'synchroflow_test_* database created by scripts/with-test-db.js. ' +
      'Run `npm run test:integration`.'
  );
}

module.exports = { DISPOSABLE_RE, assertDisposableBackendIntegrationDb };
