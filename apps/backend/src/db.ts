//apps/backend/src/db.ts
import knex, { Knex } from 'knex';
// Import compiled knexfile.js so TS doesn't try to treat knexfile.ts as a source file
// eslint-disable-next-line @typescript-eslint/no-var-requires
const knexfile = require('../knexfile.js') as { [key: string]: Knex.Config };

// Define the shape of the config object
type KnexConfig = { [key: string]: Knex.Config };
const config: KnexConfig = knexfile;
   
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
// Skip this in test to avoid async logs after Jest teardown.
if (environment !== 'test') {
  db.raw('SELECT 1+1 AS result')
    .then(() => {
      console.log(`Database connected successfully in ${environment} mode.`);
    })
    .catch((err) => {
      console.error('!!!!!!!!!!!! DATABASE CONNECTION FAILED !!!!!!!!!!!!');
      console.error(err);
    });
}

export default db;