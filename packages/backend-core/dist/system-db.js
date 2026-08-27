import knex from 'knex';
import { assertDisposableTestDatabase } from './config/test-database-safety.js';
/**
 * Privileged maintenance connection.
 *
 * This module is intentionally separate from db.ts so HTTP controllers and
 * workers cannot accidentally import the migration identity alongside the
 * runtime client. Only explicit CLI/maintenance entry points may import it.
 */
const environment = process.env.NODE_ENV || 'development';
// TEST-DB-ISOLATION-11 — same fail-closed test-database identity check as
// database.config.ts, before the systemDb pool is constructed. No dotenv here
// (this module never loaded env itself).
if (environment === 'test') {
    assertDisposableTestDatabase(process.env.PGDATABASE, {
        harness: process.env.SYNCHROFLOW_DISPOSABLE_TEST_DB === '1',
    });
}
const systemConfig = {
    client: 'pg',
    connection: environment === 'production'
        ? process.env.DATABASE_URL
        : {
            host: process.env.PGHOST,
            port: Number(process.env.PGPORT),
            user: process.env.PGMIGRATION_USER ?? process.env.PGUSER,
            password: String(process.env.PGMIGRATION_PASSWORD ?? process.env.PGPASSWORD ?? ''),
            database: process.env.PGDATABASE,
        },
    pool: {
        min: 1,
        max: 5,
        acquireTimeoutMillis: 10000,
        idleTimeoutMillis: 30000,
    },
};
if (environment === 'production' && !process.env.DATABASE_URL) {
    throw new Error('FATAL: DATABASE_URL is required for privileged maintenance.');
}
export const systemDb = knex(systemConfig);
export default systemDb;
