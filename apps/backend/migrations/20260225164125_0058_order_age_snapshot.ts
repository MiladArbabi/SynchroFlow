import type { Knex } from "knex";

/**
 * ORDER AGE SNAPSHOT
 * ==================
 *
 * Derived operational read model.
 *
 * Purpose:
 * - Materialize order aging classification
 * - Enable SLA breach detection
 * - Enable latency monitoring
 *
 * Characteristics:
 * - Replace-on-reconcile
 * - No incremental mutation
 * - Fully derived from canonical order + fulfillment state
 */

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('order_age_snapshot', (table) => {

    table
      .uuid('lasyncro_order_id')
      .primary()
      .references('lasyncro_order_id')
      .inTable('orders')
      .onDelete('CASCADE');

    /**
     * Age metrics (in seconds)
     */
    table.integer('age_since_creation_seconds').notNullable();
    table.integer('age_since_paid_seconds').nullable();
    table.integer('age_since_fulfillment_seconds').nullable();

    /**
     * SLA breach flags
     */
    table.boolean('is_shipping_sla_breached')
      .notNullable()
      .defaultTo(false);

    table.boolean('is_delivery_sla_breached')
      .notNullable()
      .defaultTo(false);

    /**
     * Snapshot timestamp
     */
    table.timestamp('snapshot_generated_at', { useTz: true })
      .notNullable()
      .defaultTo(knex.fn.now());

    table.index(['is_shipping_sla_breached']);
    table.index(['is_delivery_sla_breached']);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('order_age_snapshot');
}