import { Knex } from 'knex';

/**
 * MIGRATION 0132 — backfill_missing_columns_suppliers_shopopsettings
 * -----------------------------------------------------------------
 * DRIFT-AUDIT-01 forward fix. suppliers.moq/lead_time_days (0094) and
 * shop_operational_settings.returns_aging_warning_hours/
 * returns_aging_critical_hours (0067) were added to their respective
 * batch-1 migration files (2026-06-18) after those migrations had
 * already run in prod. Same Knex-skip drift pattern as 0048/0010/
 * 0056/0037. Confirmed via schema diff, 2026-07-28.
 *
 * Live code paths reference all four columns: suppliers.controller.ts,
 * reorderRequests.controller.ts, sourcingRecommendations.controller.ts,
 * demandIntelligence.service.ts (moq/lead_time_days); returns.settings.
 * controller.ts, returnsIntelligence.service.ts (returns_aging_*).
 *
 * Idempotent via hasColumn() checks. All four columns are nullable or
 * have defaults, so no backfill logic is needed beyond the DEFAULT
 * clause itself applying to existing rows.
 */
export async function up(knex: Knex): Promise<void> {
  const hasMoq = await knex.schema.hasColumn('suppliers', 'moq');
  const hasLeadTimeDays = await knex.schema.hasColumn('suppliers', 'lead_time_days');

  if (!hasMoq || !hasLeadTimeDays) {
    await knex.schema.alterTable('suppliers', (table) => {
      if (!hasMoq) {
        table
          .integer('moq')
          .nullable()
          .comment('Minimum order quantity (units) this supplier accepts per PO. Null = no minimum. Supplier-level; reorder qty is rounded up to this before drafting a PO.');
      }
      if (!hasLeadTimeDays) {
        table
          .integer('lead_time_days')
          .nullable()
          .comment('Typical days from PO sent to goods received (produce + ship). Null = unknown. Supplier-level; used to compute reorder-by date = today + (days_of_stock - lead_time_days).');
      }
    });
  }

  const hasWarningHours = await knex.schema.hasColumn('shop_operational_settings', 'returns_aging_warning_hours');
  const hasCriticalHours = await knex.schema.hasColumn('shop_operational_settings', 'returns_aging_critical_hours');

  if (!hasWarningHours || !hasCriticalHours) {
    await knex.schema.alterTable('shop_operational_settings', (table) => {
      if (!hasWarningHours) {
        table.integer('returns_aging_warning_hours').notNullable().defaultTo(48);
      }
      if (!hasCriticalHours) {
        table.integer('returns_aging_critical_hours').notNullable().defaultTo(168);
      }
    });
  }
}

export async function down(knex: Knex): Promise<void> {
  const hasMoq = await knex.schema.hasColumn('suppliers', 'moq');
  const hasLeadTimeDays = await knex.schema.hasColumn('suppliers', 'lead_time_days');
  if (hasMoq || hasLeadTimeDays) {
    await knex.schema.alterTable('suppliers', (table) => {
      if (hasMoq) table.dropColumn('moq');
      if (hasLeadTimeDays) table.dropColumn('lead_time_days');
    });
  }

  const hasWarningHours = await knex.schema.hasColumn('shop_operational_settings', 'returns_aging_warning_hours');
  const hasCriticalHours = await knex.schema.hasColumn('shop_operational_settings', 'returns_aging_critical_hours');
  if (hasWarningHours || hasCriticalHours) {
    await knex.schema.alterTable('shop_operational_settings', (table) => {
      if (hasWarningHours) table.dropColumn('returns_aging_warning_hours');
      if (hasCriticalHours) table.dropColumn('returns_aging_critical_hours');
    });
  }
}
