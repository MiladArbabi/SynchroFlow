import knex, { Knex } from 'knex';
// Use this import syntax for files that use `module.exports`
import knexfile = require('../knexfile');

// Define the shape of the config object
type KnexConfig = { [key: string]: Knex.Config };
const config = knexfile as KnexConfig;

// 1. Determine the environment
// The Dockerfile sets this to "production" on Fly.io
const environment = process.env.NODE_ENV || 'development';

// 2. Select the correct configuration
const dbConfig = config[environment];

if (!dbConfig) {
  throw new Error(`FATAL: Knex config for environment "${environment}" not found.`);
}

// 3. Add a check for the *actual* production variable
if (environment === 'production' && !process.env.DATABASE_URL) {
  throw new Error('FATAL: DATABASE_URL environment variable is not set for production.');
}

// 4. Initialize Knex with the *correct* config
const db = knex(dbConfig);

// 5. Run the connection test (with better logging)
db.raw('SELECT 1+1 AS result').then(() => {
    console.log(`Database connected successfully in ${environment} mode.`);
}).catch((err) => {
    console.error('!!!!!!!!!!!! DATABASE CONNECTION FAILED !!!!!!!!!!!!');
    console.error(err);
    process.exit(1); // Exit if connection fails
});

export default db;