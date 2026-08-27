/** Approved disposable test-database naming contract. */
export declare const DISPOSABLE_TEST_DB_RE: RegExp;
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
export declare function assertDisposableTestDatabase(dbName: string | undefined, opts: {
    harness: boolean;
}): void;
