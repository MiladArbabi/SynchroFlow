/**
 * SOURCE OF TRUTH
 * This file is used by Knex CLI in dev/test.
 * DO NOT run Knex CLI against knexfile.js.
 */

if (process.env.NODE_ENV !== 'production') {
  require('ts-node/register');
}
require('dotenv').config({ path: require('path').join(__dirname, '../../.env'), override: true });

import { Knex } from 'knex';
import path from 'path';

const config: { [key: string]: Knex.Config } = {
  development: {
    client: 'pg',
    connection: {
      host: process.env.PGHOST,
      port: Number(process.env.PGPORT),
      user: process.env.PGUSER,
      password: process.env.PGPASSWORD,
      database: process.env.PGDATABASE,
    },
    migrations: {
      directory: path.join(__dirname, './migrations'),
      tableName: 'knex_migrations',
      extension: process.env.NODE_ENV === 'production' ? 'js' : 'ts'
    },
  },

  test: {
    client: 'pg',
    connection: {
      host: process.env.PGHOST,
      port: Number(process.env.PGPORT),
      user: process.env.PGUSER,
      password: process.env.PGPASSWORD,
      database: process.env.PGDATABASE,
    },
    migrations: {
      directory: path.join(__dirname, './migrations'),
      tableName: 'knex_migrations',
      extension: process.env.NODE_ENV === 'production' ? 'js' : 'ts'
    },
  },

  production: {
    client: 'pg',
    connection: process.env.DATABASE_URL, // Let the secret handle everything
    migrations: {
      directory: path.join(__dirname, './migrations'),
      tableName: 'knex_migrations',
      extension: process.env.NODE_ENV === 'production' ? 'js' : 'ts'
    }
  }
};

module.exports = config;