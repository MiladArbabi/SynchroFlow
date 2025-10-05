import * as dotenv from 'dotenv';
import { Knex } from 'knex';
import path from 'path';

// Load environment variables from .env file
dotenv.config({ path: '../../.env' });

const config: { [key: string]: Knex.Config } = {
  development: {
    client: 'pg',
    connection: {
      host: process.env.PG_HOST || 'localhost',
      port: Number(process.env.PG_PORT) || 5432,
      user: process.env.PG_USER || 'sf_user',
      password: process.env.PG_PASSWORD || 'sf_pass',
      database: process.env.PG_DATABASE || 'synchroflow_db',
    },
    migrations: {
      tableName: 'knex_migrations',
      directory: path.join(__dirname, './migrations'),
    },
    seeds: {
      directory: path.join(__dirname, './seeds'),
    },
  },
};

module.exports = config;