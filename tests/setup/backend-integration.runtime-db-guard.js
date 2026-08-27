// tests/setup/backend-integration.runtime-db-guard.js
//
// TEST-DB-ISOLATION-11 Slice 2 — fail-closed disposable-DB guard for the Jest
// `backend-integration` project, validated in the TEST-EXECUTION context.
//
// Wired as a `setupFiles` entry (after tests/setup/jest.node.js, before any test
// module), so it runs inside the same Jest runtime that the AUDIT proved could
// lose PGDATABASE — the context that actually constructs the backend-core pools.
// globalSetup covers the orchestration context; this covers the runtime context.
//
// DB-free: no knex, no dotenv, no backend source, no connection.

'use strict';

const {
  assertDisposableBackendIntegrationDb,
} = require('./backend-integration-db-safety');

assertDisposableBackendIntegrationDb(
  process.env.PGDATABASE,
  'REFUSING_BACKEND_INTEGRATION_RUNTIME_NON_DISPOSABLE_DB'
);
