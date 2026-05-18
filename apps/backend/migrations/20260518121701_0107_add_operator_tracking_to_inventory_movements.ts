import { Knex } from 'knex';

/**
 * MIGRATION 0107 — add_operator_tracking_to_inventory_movements
 * ---------------------------------------------------------------
 * Adds two nullable columns to inventory_movements:
 *
 *   operator_id   — FK to users.id. NULL = system/Shopify-driven movement.
 *                   NOT NULL = human action (pick, stow, receive, manual adjustment).
 *
 *   triggered_by  — categorical source of the movement. Values:
 *                   'shopify_webhook' | 'pick_scan' | 'stow_confirm' |
 *                   'receive_job' | 'manual' | 'system'
 *
 * Both columns are nullable for backwards compatibility — all existing rows
 * pre-date operator tracking and are implicitly system/Shopify-driven.
 *
 * TRACEABILITY SPRINT: these columns power the full cross-module traceability
 * system — bin logs, product location history, operator activity, ghost stock
 * detection. See docs/blueprints/WarehouseGrid.md and traceability sprint plan.
 *
 * NOTE: inventory_movements has immutability triggers (no update/delete).
 * These columns must be populated at INSERT time by the writing service.
 * Writers to update: wms.controller.ts (pick), stow confirm, receive_job.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('inventory_movements', (table) => {
    table
      .integer('operator_id')
      .nullable()
      .references('id')
      .inTable('users')
      .onDelete('SET NULL');

    table
      .string('triggered_by', 50)
      .nullable()
      .comment('shopify_webhook | pick_scan | stow_confirm | receive_job | manual | system');
  });

  // Index for operator activity queries (Team module, traceability sprint)
  await knex.schema.alterTable('inventory_movements', (table) => {
    table.index(['shop_id', 'operator_id'], 'inventory_movements_shop_operator_idx');
    table.index(['triggered_by'], 'inventory_movements_triggered_by_idx');
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('inventory_movements', (table) => {
    table.dropIndex([], 'inventory_movements_shop_operator_idx');
    table.dropIndex([], 'inventory_movements_triggered_by_idx');
    table.dropColumn('operator_id');
    table.dropColumn('triggered_by');
  });
}