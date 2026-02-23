// apps/backend/migrations/20260204094357_add_obligation_evaluated_at_to_order_fulfillment_status.ts
/**
 * Obligation Freshness (v1)
 * ------------------------
 * Adds an explicit timestamp to observe when obligation flags
 * were last evaluated.
 *
 * Rationale:
 * - FT2 must be able to detect stale obligation signals
 * - Absence of this timestamp forces semantic guessing (forbidden)
 *
 * Rules:
 * - NULL = never evaluated / unknown freshness
 * - Non-NULL = last deterministic evaluation time
 */

import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  return knex.schema.alterTable('order_fulfillment_status', (table) => {
    table
      .timestamp('obligation_evaluated_at')
      .nullable()
      .comment('Last time obligation flags were deterministically evaluated');
  });
}

export async function down(knex: Knex): Promise<void> {
  return knex.schema.alterTable('order_fulfillment_status', (table) => {
    table.dropColumn('obligation_evaluated_at');
  });
}