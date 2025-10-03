import knex, { Knex } from 'knex';
// Use this import syntax for files that use `module.exports`
import knexfile = require('../knexfile');

// Define the shape of the config object we expect to import.
// This tells TypeScript that it will have string keys (like "development").
type KnexConfig = { [key: string]: Knex.Config };

// Assert that our imported knexfile matches the shape we defined.
const config = knexfile as KnexConfig;

// Now, TypeScript knows that config.development is a valid property.
const db = knex(config.development);

export default db;