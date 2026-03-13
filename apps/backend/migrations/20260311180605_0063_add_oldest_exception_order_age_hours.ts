import { Knex } from 'knex';

/**
 * ADD: oldest_exception_order_age_hours
 * -------------------------------------
 * Exact age of the oldest operational exception order.
 *
 * Replaces UI bucket inference from:
 *   aging_24h / aging_48h / aging_72h_plus
 *
 * Guarantees:
 * - deterministic rebuild
 * - exact operational urgency
 * - simpler signal builders
 */

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable(
    'orders_operational_control_snapshot',
    (table) => {
      table.integer('oldest_exception_order_age_hours')
        .notNullable()
        .defaultTo(0)
        .comment('Age in hours of the oldest order currently flagged as operational exception');
    }
  );
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable(
    'orders_operational_control_snapshot',
    (table) => {
      table.dropColumn('oldest_exception_order_age_hours');
    }
  );
}