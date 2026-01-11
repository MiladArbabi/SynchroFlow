// apps/backend/migrations/20260111153957_add_unique_constraint_to_commercial_grant_events.ts

import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('commercial_grant_events', (table) => {
    table.unique(['external_ref'], 'uq_commercial_grant_events_external_ref');
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('commercial_grant_events', (table) => {
    table.dropUnique(['external_ref'], 'uq_commercial_grant_events_external_ref');
  });
}