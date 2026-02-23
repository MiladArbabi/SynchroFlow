// apps/backend/migrations/20260131095414_add_execution_provenance_to_fulfillment.ts
import type { Knex } from 'knex';

/**
 * Add execution provenance to order_fulfillment_status
 *
 * Purpose:
 * - Preserve epistemic honesty
 * - Distinguish observed vs synthetic execution
 *
 * Rules:
 * - Synthetic execution is valid truth
 * - Missing execution is forbidden
 */
export async function up(knex: Knex): Promise<void> {
  await knex.raw(`
    ALTER TABLE order_fulfillment_status
    ADD COLUMN IF NOT EXISTS execution_source text
      CHECK (execution_source IN ('observed', 'synthetic'))
      NOT NULL
      DEFAULT 'observed';

    ALTER TABLE order_fulfillment_status
    ADD COLUMN IF NOT EXISTS execution_confidence text
      CHECK (execution_confidence IN ('certain', 'assumed'))
      NOT NULL
      DEFAULT 'certain';
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw(`
    ALTER TABLE order_fulfillment_status
    DROP COLUMN IF EXISTS execution_source,
    DROP COLUMN IF EXISTS execution_confidence;
  `);
}