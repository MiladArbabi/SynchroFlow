import { Knex } from 'knex';

/**
 * MIGRATION 0133 — backfill_enum_values_fulfillment_stow
 * -----------------------------------------------------------------
 * DRIFT-AUDIT-01 forward fix. fulfillment_status_type.address_corrected
 * (0006) and stow_task_trigger.return_restock (0084) were added to
 * their respective batch-1 migration files (2026-06-18) after those
 * migrations had already run in prod. Same Knex-skip drift pattern
 * as prior fixes tonight. address_corrected's own comment confirms
 * it was added 2026-07-02 (OF-08/OF-11, shipping-address correction
 * feature). Confirmed via schema diff, DRIFT-AUDIT-01, 2026-07-28.
 *
 * Live code depends on both: orders.shipping_address_corrected.ts
 * (a projection handler — would fail with an invalid enum value
 * error in prod if this code path fires) for address_corrected;
 * stow.service.ts / returnJobs.service.ts for return_restock.
 *
 * ALTER TYPE ... ADD VALUE IF NOT EXISTS is used for idempotency and
 * safety — safe to run even if the value already exists (fresh
 * installs) or if this migration is somehow re-run.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.raw(`
    ALTER TYPE fulfillment_status_type ADD VALUE IF NOT EXISTS 'address_corrected';
  `);
  await knex.raw(`
    ALTER TYPE stow_task_trigger ADD VALUE IF NOT EXISTS 'return_restock';
  `);
}

export async function down(knex: Knex): Promise<void> {
  // Postgres does not support removing enum values. A down migration
  // would require rebuilding the type from scratch (create new type,
  // migrate columns, drop old type) — not attempted here since this
  // is purely additive and safe to leave in place.
}
