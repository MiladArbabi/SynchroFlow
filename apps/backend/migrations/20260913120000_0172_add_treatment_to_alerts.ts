import type { Knex } from 'knex';

/**
 * MIGRATION 0172 — alerts.treatment (STOCK-PROTECT-03 Slice 3A)
 *
 * Nullable, unconstrained string column carrying the canonical Stock
 * Protection treatment (reorder_now / finish_reorder / receive_inbound /
 * complete_setup / none) for alert_type='stock_protection' rows. Meaningless
 * for every other alert_type, where it stays null forever — additive-only,
 * no backfill, no existing row touched.
 *
 * Deliberately no CHECK constraint and no index, matching this table's
 * existing convention for alert_type/severity/category/audience (all
 * unconstrained strings, documented by comment only). `treatment` IS used
 * as a secondary Stock Protection candidate predicate (Morning Brief's
 * pre-LIMIT prefilter), but only inside reads already scoped by shop_id and
 * is_active — no dedicated index is justified for this V1 access pattern.
 *
 * Route/label/module are NEVER persisted here — those are derived at read
 * time by the shared alertActionResolver, kept out of the DB entirely so a
 * presentation change never requires a migration/backfill.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('alerts', (table) => {
    table.string('treatment').nullable();
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('alerts', (table) => {
    table.dropColumn('treatment');
  });
}
