// tests/setup/backend-integration.global-setup.js
//
// PROJECTION-CURSOR-STALL-08 Slice 3 — fail-closed disposable-DB guard for the
// Jest `backend-integration` project, validated in the ORCHESTRATION context
// (runs once, before any test file or fixture loads).
//
// TEST-DB-ISOLATION-11 Slice 2 — the regex/assertion now lives in the shared
// tests/setup/backend-integration-db-safety.js (also used by the
// test-EXECUTION-context guard, backend-integration.runtime-db-guard.js).
//
// DB-free by contract: no knex, no dotenv, no backend source, no connection.

'use strict';

const {
  assertDisposableBackendIntegrationDb,
} = require('./backend-integration-db-safety');

async function globalSetup() {
  assertDisposableBackendIntegrationDb(
    process.env.PGDATABASE,
    'REFUSING_BACKEND_INTEGRATION_NON_DISPOSABLE_DB'
  );
}

module.exports = globalSetup;
// Re-exported so tests/contract/backend-integration-db-guard.test.ts (which
// drives the predicate with literal values) keeps a stable import path.
module.exports.assertDisposableBackendIntegrationDb =
  assertDisposableBackendIntegrationDb;
