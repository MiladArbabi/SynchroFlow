// apps/backend/src/config/database.config.ts

import { Knex } from 'knex';
import dotenv from 'dotenv';
import path from 'path';

// --- LOAD ENV (MANDATORY FOR ALL RUNTIMES) ---
dotenv.config({
  path: path.resolve(process.cwd(), '.env'),
});

const environment = process.env.NODE_ENV || 'development';

if (environment === 'production' && !process.env.DATABASE_URL) {
  throw new Error('FATAL: DATABASE_URL must be set in production.');
}

const baseConfig: Knex.Config = {
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

const config: Record<string, Knex.Config> = {
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
    connection: process.env.DATABASE_URL,
  },
};

const dbConfig = config[environment];

if (!dbConfig) {
  throw new Error(`FATAL: DB config for "${environment}" not found.`);
}

// --- DB CONFIG VALIDATION (MANDATORY) ---
if (!process.env.PGUSER || !process.env.PGDATABASE) {
  throw new Error('FATAL: Missing required DB env vars (PGUSER, PGDATABASE)');
}

if (process.env.PGPASSWORD === undefined) {
  console.warn('WARNING: PGPASSWORD is undefined → defaulting to empty string');
}

export default dbConfig;
