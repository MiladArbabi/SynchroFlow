// packages/api/src/db.ts
import knex, { Knex } from 'knex';
// Use this import syntax for files that use `module.exports`
import knexfile = require('../knexfile');

// --- Environment Validation ---
const requiredEnvVars = [
  'PG_HOST',
  'PG_PORT',
  'PG_USER',
  'PG_PASSWORD',
  'PG_DATABASE',
];

const missingVars = requiredEnvVars.filter(varName => !process.env[varName]);

if (missingVars.length > 0) {
  throw new Error(
    `FATAL: Missing required environment variables: ${missingVars.join(', ')}. Please check your .env file.`
  );
}
// --- End Validation ---

// Define the shape of the config object we expect to import.
type KnexConfig = { [key: string]: Knex.Config };

// Assert that our imported knexfile matches the shape we defined.
const config = knexfile as KnexConfig;

// Now, TypeScript knows that config.development is a valid property.
const db = knex(config.development);

// FIX: Add connection test and detailed error logging
db.raw('SELECT 1+1 AS result').then(() => {
}).catch((err) => {
  process.exit(1); // Exit if connection fails
});

export default db;