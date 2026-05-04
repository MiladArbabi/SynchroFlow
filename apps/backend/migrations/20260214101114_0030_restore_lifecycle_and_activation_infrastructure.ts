/**
 * Infrastructure restoration.
 * RLS applied to specter_shop_configs (tenant-scoped via shop_id).
 * activation_audit_events RLS applied in migration 0031.
 */

import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  // ---- specter_shop_configs ----
  const hasSpecter = await knex.schema.hasTable('specter_shop_configs');
  if (!hasSpecter) {
    await knex.schema.createTable('specter_shop_configs', (table) => {
      table.increments('id').primary();
      table
        .integer('shop_id')
        .notNullable()
        .references('id')
        .inTable('shops')
        .onDelete('CASCADE');
      table.jsonb('config_json').notNullable().defaultTo('{}');
      table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
      table.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
      table.unique(['shop_id']);
    });

    // --- RLS: tenant isolation (direct shop_id) ---
    await knex.raw(`
      ALTER TABLE specter_shop_configs ENABLE ROW LEVEL SECURITY;
      ALTER TABLE specter_shop_configs FORCE ROW LEVEL SECURITY;
    `);
    await knex.raw(`
      DROP POLICY IF EXISTS specter_shop_configs_tenant_isolation_policy ON specter_shop_configs;
      CREATE POLICY specter_shop_configs_tenant_isolation_policy
      ON specter_shop_configs
      USING (shop_id = current_setting('app.current_tenant')::int);
    `);
  }

  // ---- activation_audit_events ----
  const hasActivation = await knex.schema.hasTable('activation_audit_events');
  if (!hasActivation) {
    await knex.schema.createTable('activation_audit_events', (table) => {
      table.increments('id').primary();
      table.timestamp('occurred_at').defaultTo(knex.fn.now());
      table.integer('user_id').nullable();
      table.integer('shop_id').nullable();
      table.string('entry_channel').nullable();
      table.string('verdict').notNullable();
      table.string('reason').nullable();
      table.jsonb('payload').notNullable();
    });
  }
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('activation_audit_events');
  await knex.schema.dropTableIfExists('specter_shop_configs');
}
