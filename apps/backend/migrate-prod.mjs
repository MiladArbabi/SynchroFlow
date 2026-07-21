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

db.migrate.latest()
  .then(async ([batch, log]) => {
    console.log('Migrations complete', { batch, log });

    // OV-04 CLEANUP: Remove lifecycle/ft2_confirmed events seeded directly into
    // domain_events without going through the proper lifecycle controller.
    // These cause a fatal "Invalid lifecycle transition: FT_MINUS_ONE->FT2" crash
    // in the projection worker because no ft0/completed event preceded them.
    // Safe to run on every deploy — only deletes rows matching this exact condition.
    const result = await db.raw(`
      DELETE FROM domain_events
      WHERE event_type = 'lifecycle/ft2_confirmed'
      AND shop_id NOT IN (
        SELECT DISTINCT shop_id FROM domain_events
        WHERE event_type = 'ft0/completed'
      )
      RETURNING id, shop_id, event_type
    `);
    if (result.rows.length > 0) {
      console.log('OV-04 cleanup: removed invalid ft2_confirmed events', result.rows);
    }

    process.exit(0);
  })
  .catch(err => {
    console.error('Migration failed', err);
    process.exit(1);
  });
