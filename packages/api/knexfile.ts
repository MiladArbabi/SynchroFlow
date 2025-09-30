
import * as dotenv from 'dotenv';
import { Knex } from 'knex';

// Load environment variables from .env file
dotenv.config();

const config: { [key: string]: Knex.Config } = {
  development: {
    client: 'pg',
    connection: {
      host: process.env.PG_HOST || 'localhost',
      port: Number(process.env.PG_PORT) || 5432,
      user: process.env.PG_USER || 'synchro_user',
      password: process.env.PG_PASSWORD || 'synchro_pass',
      database: process.env.PG_DATABASE || 'synchroflow_dev_db',
    },
    migrations: {
      tableName: 'knex_migrations',
      directory: './migrations',
    },
    seeds: {
      directory: './seeds',
    },
  },
  // Add staging and production configurations here later
  production: {
    // ... production configurations
  }
};

module.exports = config;

