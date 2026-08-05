// apps/backend/src/config/database.config.ts
import dotenv from 'dotenv';
import path from 'path';
// --- LOAD ENV (MANDATORY FOR ALL RUNTIMES) ---
dotenv.config({
    path: path.resolve(process.cwd(), '.env'),
});
const environment = process.env.NODE_ENV || 'development';
if (environment === 'production' && !process.env.APP_DATABASE_URL) {
    throw new Error('FATAL: APP_DATABASE_URL must be set to the restricted sf_app connection in production.');
}
const baseConfig = {
    client: 'pg',
    /**
     * Explicit pool configuration
     * ----------------------------
     * Prevents uncontrolled worker concurrency from
     * exhausting database connections.
     *
     * Concurrency model:
     * - Worker prefetch will be capped separately.
     * - Pool must exceed worker concurrency.
     */
    pool: {
        min: 2,
        max: 20,
        acquireTimeoutMillis: 10000,
        idleTimeoutMillis: 30000,
    },
};
const config = {
    development: {
        ...baseConfig,
        connection: {
            host: process.env.PGHOST,
            port: Number(process.env.PGPORT),
            user: process.env.PGUSER,
            password: String(process.env.PGPASSWORD || ''),
            database: process.env.PGDATABASE,
        },
    },
    test: {
        ...baseConfig,
        connection: {
            host: process.env.PGHOST,
            port: Number(process.env.PGPORT),
            user: process.env.PGUSER,
            password: String(process.env.PGPASSWORD || ''),
            database: process.env.PGDATABASE,
        },
    },
    production: {
        ...baseConfig,
        // DATABASE_URL is reserved for the release-command migration runner.
        // Runtime processes must never inherit that privileged connection.
        connection: process.env.APP_DATABASE_URL,
    },
};
const dbConfig = config[environment];
if (!dbConfig) {
    throw new Error(`FATAL: DB config for "${environment}" not found.`);
}
// --- DB CONFIG VALIDATION (MANDATORY) ---
if (environment !== 'production' && (!process.env.PGUSER || !process.env.PGDATABASE)) {
    throw new Error('FATAL: Missing required DB env vars (PGUSER, PGDATABASE)');
}
if (process.env.PGPASSWORD === undefined) {
    console.warn('WARNING: PGPASSWORD is undefined → defaulting to empty string');
}
export default dbConfig;
