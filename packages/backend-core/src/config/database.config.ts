// apps/backend/src/config/database.config.ts

import { Knex } from 'knex';

const environment = process.env.NODE_ENV || 'development';

if (environment === 'production' && !process.env.DATABASE_URL) {
  throw new Error('FATAL: DATABASE_URL must be set in production.');
}

const baseConfig: Knex.Config = {
  client: 'pg',
};

const config: Record<string, Knex.Config> = {
  development: {
    ...baseConfig,
    connection: {
      host: process.env.PGHOST,
      port: Number(process.env.PGPORT),
      user: process.env.PGUSER,
      password: process.env.PGPASSWORD,
      database: process.env.PGDATABASE,
    },
  },
  test: {
    ...baseConfig,
    connection: {
      host: process.env.PGHOST,
      port: Number(process.env.PGPORT),
      user: process.env.PGUSER,
      password: process.env.PGPASSWORD,
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

export default dbConfig;
