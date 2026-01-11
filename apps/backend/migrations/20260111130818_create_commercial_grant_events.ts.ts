// apps/backend/migrations/20260111130818_create_commercial_grant_events.ts.ts

import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('commercial_grant_events', (table) => {
    table.increments('id').primary();

    table.integer('shop_id').notNullable().index();

    // Who/what triggered the grant
    table.string('source').notNullable(); // billing | admin | migration

    // Canonical payload
    table.jsonb('grant_payload').notNullable();

    // Optional external linkage (Stripe, admin action, etc.)
    table.string('external_ref').nullable();

    // Metadata for forensics/debugging
    table.jsonb('metadata').nullable();

    table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('commercial_grant_events');
}