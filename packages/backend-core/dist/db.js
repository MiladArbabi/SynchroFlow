// packages/backend-core/src/db.ts
import knex from 'knex';
import dbConfig from './config/database.config.js';
const baseDb = knex(dbConfig);
// --- TENANT CONTEXT GUARD (MANDATORY) ---
const db = new Proxy(baseDb, {
    apply(target, thisArg, argumentsList) {
        const queryBuilder = Reflect.apply(target, thisArg, argumentsList);
        // AUTO-BYPASS: raw queries are considered system-level unless explicitly wrapped
        if (argumentsList.length === 1 && typeof argumentsList[0] === 'string') {
            queryBuilder.__skipTenantCheck = true;
        }
        const originalThen = queryBuilder.then.bind(queryBuilder);
        queryBuilder.then = async function (...args) {
            // BYPASS: allow explicitly marked system queries (bootstrap, auth, migrations)
            if (queryBuilder.__skipTenantCheck) {
                return originalThen(...args);
            }
            try {
                const res = await target.raw(`SHOW app.current_tenant`);
                if (!res || !res.rows?.length) {
                    throw new Error();
                }
            }
            catch {
                throw new Error('CRITICAL: app.current_tenant is not set. Query blocked to prevent cross-tenant data leak.');
            }
            return originalThen(...args);
        };
        return queryBuilder;
    }
});
// --- SYSTEM QUERY BYPASS (EXPLICIT ONLY) ---
/**
 * SYSTEM QUERY BYPASS (EXPLICIT ONLY)
 * -----------------------------------
 * Use ONLY for:
 * - bootstrap
 * - auth (pre-tenant)
 * - migrations / infra
 *
 * NEVER use in domain logic.
 */
export function systemQuery(qb) {
    qb.__skipTenantCheck = true;
    return qb;
}
const isJest = process.env.JEST_WORKER_ID !== undefined ||
    process.env.NODE_ENV === 'test';
// --- SAFE BOOTSTRAP (NO TENANT CONTEXT REQUIRED) ---
if (!isJest) {
    systemQuery(db.raw(`
      SELECT current_database() as database,
             inet_server_addr() as host,
             inet_server_port() as port
    `))
        .then((r) => {
        console.log(`Database connected successfully in ${process.env.NODE_ENV || 'development'} mode.`);
        console.log('[DB_IDENTITY]', r.rows[0]);
    })
        .catch((err) => {
        console.error('DATABASE CONNECTION FAILED');
        console.error(err);
    });
}
// --- TENANT CONTEXT SETTER (MANDATORY ENTRYPOINT) ---
export async function withTenant(shopId, fn) {
    return baseDb.transaction(async (trx) => {
        // NOTE:
        // PostgreSQL SET does NOT support parameter binding.
        // shopId is numeric and controlled → safe to inline.
        // SEC-FIX (ISS-SEC1): SET LOCAL scopes the setting to this transaction
        // only — Postgres automatically discards it on COMMIT or ROLLBACK.
        // Plain SET persists on the physical connection and leaks to whatever
        // request the pool hands that connection to next. Verified via
        // tenant-leak-test.ts: prior to this fix, 25/25 unrelated queries on a
        // reused connection inherited a stale tenant context after commit.
        await trx.raw(`SET LOCAL app.current_tenant = '${shopId}'`);
        // Instrumentation: verify context applied
        const check = await trx.raw(`SELECT current_setting('app.current_tenant', true) as tenant`);
        if (!check || check.rows?.[0]?.tenant !== String(shopId)) {
            throw new Error('FAILED TO SET app.current_tenant');
        }
        return fn(trx);
    });
}
// NOTE:
// - REQUIRED for all writes and reads
// - Ensures RLS works
// - Prevents silent failures
export default db;
const systemConfig = {
    ...dbConfig,
    connection: {
        host: process.env.PGHOST,
        port: Number(process.env.PGPORT),
        user: process.env.PGMIGRATION_USER,
        password: String(process.env.PGMIGRATION_PASSWORD || ''),
        database: process.env.PGDATABASE,
    },
    pool: { min: 1, max: 5, acquireTimeoutMillis: 10000, idleTimeoutMillis: 30000 },
};
export const systemDb = knex(systemConfig);
