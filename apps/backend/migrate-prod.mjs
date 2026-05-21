import knex from 'knex';

const db = knex({
  client: 'pg',
  connection: process.env.DATABASE_URL,
  migrations: {
    tableName: 'knex_migrations',
    directory: '/app/apps/backend/dist/migrations',
    extension: 'js',
  },
});

// Drop all tables and start fresh
await db.raw('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');

db.migrate.latest()
  .then(([batch, log]) => {
    console.log('Migrations complete', { batch, log });
    process.exit(0);
  })
  .catch(err => {
    console.error('Migration failed', err);
    process.exit(1);
  });