/**
 * TEST-DB-ISOLATION-11 Slice 2 — ACTUAL DB-target canary.
 *
 * Proves that a `npm run test:integration` run does not merely CREATE a
 * disposable `synchroflow_test_*` database (the `TEST_DB_*` markers) but that the
 * backend-core connection pools actually QUERY it. The AUDIT proved these two
 * facts had diverged: PGDATABASE=synchroflow_test_* in the harness, yet fixture
 * writes landed in `synchroflow_db`.
 *
 * NO fixture writes: no shop/tenant/install, no domain_events, no cursor change,
 * no table mutation. Only `SELECT current_database()` on both pools.
 */
import db, { systemQuery } from '@lasyncro/backend-core/db.js';
import { systemDb } from '@lasyncro/backend-core/system-db.js';

const DISPOSABLE_RE = /^synchroflow_test_[A-Za-z0-9_]+$/;

describe('backend-integration DB target', () => {
  it('env + both pools resolve to the disposable synchroflow_test_* database', async () => {
    // A / B / C — invoking environment
    expect(process.env.NODE_ENV).toBe('test');
    expect(process.env.SYNCHROFLOW_DISPOSABLE_TEST_DB).toBe('1');
    expect(process.env.PGDATABASE).toMatch(DISPOSABLE_RE);

    // D — normal backend-core `db` pool (systemQuery bypasses the tenant guard
    //     for this infrastructure check — the existing approved mechanism)
    const viaDb = await systemQuery(
      db.raw('SELECT current_database() AS db')
    );
    expect(viaDb.rows[0].db).toBe(process.env.PGDATABASE);
    expect(viaDb.rows[0].db).toMatch(DISPOSABLE_RE);

    // E — privileged `systemDb` pool
    const viaSystemDb = await systemDb.raw('SELECT current_database() AS db');
    expect(viaSystemDb.rows[0].db).toBe(process.env.PGDATABASE);
    expect(viaSystemDb.rows[0].db).toMatch(DISPOSABLE_RE);
  });
});
