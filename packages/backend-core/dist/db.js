// apps/backend/src/db.ts
import knex from 'knex';
import dbConfig from './config/database.config.js';
const db = knex(dbConfig);
const isJest = process.env.JEST_WORKER_ID !== undefined ||
    process.env.NODE_ENV === 'test';
if (!isJest) {
    db.raw(`
    SELECT current_database() as database,
           inet_server_addr() as host,
           inet_server_port() as port
  `)
        .then((r) => {
        console.log(`Database connected successfully in ${process.env.NODE_ENV || 'development'} mode.`);
        console.log('[DB_IDENTITY]', r.rows[0]);
    })
        .catch((err) => {
        console.error('DATABASE CONNECTION FAILED');
        console.error(err);
    });
}
export default db;
