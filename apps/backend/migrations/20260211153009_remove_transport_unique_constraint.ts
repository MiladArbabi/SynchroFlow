// apps/backend/migrations/20260211150000_remove_transport_unique_constraint.ts
//
// Remove transport-level uniqueness from integration_webhook_events
// ------------------------------------------------------------------
// Rationale:
// - Transport events are not business identity.
// - Multiple deliveries of the same external_event_id must be allowed.
// - Business idempotency is enforced at canonical/domain layer.
//
// This migration:
// 1. Drops unique constraint (integration, external_event_id)
// 2. Replaces it with a non-unique index for lookup performance

import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  // Drop transport-level uniqueness
  await knex.raw(`
    ALTER TABLE integration_webhook_events
    DROP CONSTRAINT IF EXISTS uq_integration_webhook_events_external;
  `);

  // Add non-unique index for efficient lookup
  await knex.raw(`
    CREATE INDEX IF NOT EXISTS idx_webhook_external_lookup
      ON integration_webhook_events (integration, external_event_id);
  `);
}

export async function down(knex: Knex): Promise<void> {
  // Remove non-unique index
  await knex.raw(`
    DROP INDEX IF EXISTS idx_webhook_external_lookup;
  `);

  // Restore original unique constraint
  await knex.raw(`
    ALTER TABLE integration_webhook_events
    ADD CONSTRAINT uq_integration_webhook_events_external
    UNIQUE (integration, external_event_id);
  `);
}
