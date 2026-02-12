// apps/backend/migrations/20260131095458_add_obligation_flags_to_fulfillment.ts
import type { Knex } from 'knex';

/**
 * Add obligation flags to order_fulfillment_status
 *
 * Meaning:
 * - TRUE  → obligation confirmed
 * - FALSE → obligation explicitly cleared
 * - NULL  → epistemically unknown (default)
 *
 * IMPORTANT:
 * - NULL is NOT absence
 * - Classification lives in L2, not here
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('order_fulfillment_status', table => {
    /**
     * Obligation Flags (L2)
     * --------------------
     * Nullable by design:
     * - NULL  → not evaluated yet
     * - TRUE  → obligation present
     * - FALSE → explicitly not present
     */
    table.boolean('has_inventory_block').nullable();
    table.boolean('has_customer_block').nullable();
    table.boolean('has_operational_block').nullable();
    table.boolean('has_other_block').nullable();
  });
}

/**
 * NOTE:
 * Columns are dropped individually to avoid rollback failure
 * if one column is referenced or already removed.
 */
export async function down(knex: Knex): Promise<void> {
  /**
   * Defensive rollback
   * ------------------
   * Columns may or may not exist due to partial application.
   * Rollback must be idempotent.
   *
   * This migration is FORWARD-SAFE by design.
   */
  await knex.schema.raw(`
    ALTER TABLE order_fulfillment_status
      DROP COLUMN IF EXISTS has_inventory_block;
  `);

  await knex.schema.raw(`
    ALTER TABLE order_fulfillment_status
      DROP COLUMN IF EXISTS has_customer_block;
  `);

  await knex.schema.raw(`
    ALTER TABLE order_fulfillment_status
      DROP COLUMN IF EXISTS has_operational_block;
  `);

  await knex.schema.raw(`
    ALTER TABLE order_fulfillment_status
      DROP COLUMN IF EXISTS has_other_block;
  `);
}
