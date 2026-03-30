// apps/backend/src/db.ts
import knex from 'knex';
import dbConfig from './config/database.config.js';
const baseDb = knex(dbConfig);
// --- TENANT CONTEXT GUARD (MANDATORY) ---
const db = new Proxy(baseDb, {
    apply(target, thisArg, argumentsList) {
        const queryBuilder = Reflect.apply(target, thisArg, argumentsList);
        const originalThen = queryBuilder.then.bind(queryBuilder);
        queryBuilder.then = async function (...args) {
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
const isJest = process.env.JEST_WORKER_ID !== undefined ||
    process.env.NODE_ENV === 'test';
if (!isJest) {
    db.raw(`
    SELECT current_database() as database,
           inet_server_addr() as host,
           inet_server_port() as port
  `)
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
        await trx.raw(`SET app.current_tenant = '${shopId}'`);
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
