require('ts-node/register');
require('dotenv').config({ path: require('path').join(__dirname, '../../.env'), override: true });

import { Knex } from 'knex';
import path from 'path';

const config: { [key: string]: Knex.Config } = {
  development: {
    client: 'pg',
    connection: {
      host: process.env.PG_HOST,
      port: Number(process.env.PG_PORT),
      user: process.env.PG_USER,
      password: process.env.PG_PASSWORD,
      database: process.env.PG_DATABASE,
    },
    migrations: {
      tableName: 'knex_migrations',
      directory: path.join(__dirname, './migrations'),
    },
  },
  test: {
    client: 'pg',
    connection: {
      host: process.env.PG_HOST,
      port: Number(process.env.PG_PORT),
      user: process.env.PG_USER,
      password: process.env.PG_PASSWORD,
      database: process.env.PG_DATABASE,
    },
    migrations: {
      tableName: 'knex_migrations',
      directory: path.join(__dirname, './migrations'),
    },
  },
};

module.exports = config;