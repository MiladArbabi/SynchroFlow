// packages/backend-core/src/config/test-database-safety.ts
//
// TEST-DB-ISOLATION-11 Slice 1 — fail-closed test-database identity check.
//
// backend-core's DB config used to silently fall back to root `.env`
// (`PGDATABASE=synchroflow_db`) whenever `process.env.PGDATABASE` was absent at
// module-eval time, so `npm run test:integration` runs contaminated the shared
// dev database. Under `NODE_ENV=test`, `database.config.ts` and `system-db.ts`
// now call this pure check BEFORE any `dotenv` fallback and before constructing
// a knex pool.
//
// PURE: no `process.env`, no dotenv, no filesystem, no DB, no logging. Both
// inputs are arguments.

/** Approved disposable test-database naming contract. */
export const DISPOSABLE_TEST_DB_RE = /^synchroflow_test_[A-Za-z0-9_]+$/;

function refusal(observed: string): Error {
  return new Error(
    `REFUSING_BACKEND_CORE_NON_DISPOSABLE_TEST_DB: PGDATABASE=${observed} — ` +
      'backend-integration must run against a disposable synchroflow_test_* ' +
      'database created by scripts/with-test-db.js (`npm run test:integration`).'
  );
}

/**
 * Throws unless `dbName` is safe to point a `NODE_ENV=test` backend-core pool at.
 *
 * - a disposable `synchroflow_test_*` name          → always allowed
 * - an explicit, non-empty, non-disposable name     → always THROW
 * - missing / empty AND the disposable-DB harness is running (`harness`)
 *                                                   → THROW (the disposable DB
 *                                                     was lost — fail closed)
 * - missing / empty AND no harness                  → return (the caller keeps
 *                                                     its legacy `.env`-fallback
 *                                                     behaviour; TEST-INFRA-
 *                                                     FOUNDATION-12 owns that)
 */
export function assertDisposableTestDatabase(
  dbName: string | undefined,
  opts: { harness: boolean }
): void {
  const observed =
    typeof dbName === 'string' && dbName.length > 0 ? dbName : '<unset>';

  if (typeof dbName === 'string' && DISPOSABLE_TEST_DB_RE.test(dbName)) {
    return;
  }

  const missing = dbName === undefined || dbName === '';

  if (!missing) {
    throw refusal(observed);
  }

  if (opts.harness) {
    throw refusal(observed);
  }
}
