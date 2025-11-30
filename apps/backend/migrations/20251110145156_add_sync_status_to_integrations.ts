//packages/api/migrations/20251110145156_add_sync_status_to_integrations.ts
import { Knex } from 'knex';

const TABLE_NAME = 'integrations';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable(TABLE_NAME, (table) => {
    // The "Pizza Tracker" status: 'PENDING', 'SYNCING_PRODUCTS', 'COMPLETED', 'FAILED'
    table.string('sync_status').notNullable().defaultTo('PENDING').index();
    
    // e.g., "50"
    table.integer('sync_progress_current').notNullable().defaultTo(0);
    
    // e.g., "500" (total products)
    table.integer('sync_progress_total').notNullable().defaultTo(0);
    
    // Store the error message if the sync fails
    table.text('sync_last_error');
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable(TABLE_NAME, (table) => {
    table.dropColumn('sync_status');
    table.dropColumn('sync_progress_current');
    table.dropColumn('sync_progress_total');
    table.dropColumn('sync_last_error');
  });
}