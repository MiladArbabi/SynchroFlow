// packages/integration-service/src/db.ts
import knex, { Knex } from 'knex';
import knexfile = require('../knexfile');

// This validation should exist in every service that connects to the DB.
const requiredEnvVars = ['PG_HOST', 'PG_PORT', 'PG_USER', 'PG_PASSWORD', 'PG_DATABASE'];
const missingVars = requiredEnvVars.filter(varName => !process.env[varName]);
if (missingVars.length > 0) {
  throw new Error(`FATAL: Missing required environment variables: ${missingVars.join(', ')}`);
}

type KnexConfig = { [key: string]: Knex.Config };
const config = knexfile as KnexConfig;

const db = knex(config.development);

export default db;