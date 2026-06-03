import type { Knex } from 'knex';

/**
 * MIGRATION 0114 — WM-39 Shipping Cost Ingestion
 * ------------------------------------------------
 * Two table extensions:
 *
 * 1. order_shipment_tracking — capture carrier label economics
 *    shipping_cost_excl_vat: label price before VAT (what merchant pays)
 *    shipping_cost_currency: ISO 4217 — Sendcloud bills in shop currency
 *    carrier_zone:           carrier zone string (e.g. "EU Zone 1")
 *
 * 2. order_margin_snapshot — true margin columns
 *    carrier_shipping_cost: label cost excl VAT in shop base currency
 *    true_margin:           gross_margin − carrier_shipping_cost
 *    true_margin_pct:       true_margin / gross_revenue
 *
 * Design principle:
 *    gross_margin = revenue − COGS                (preserved, unchanged)
 *    true_margin  = revenue − COGS − shipping     (new — the real number)
 *
 * order_revenue_units is immutable — carrier cost NEVER written there.
 * computeOrderMargin joins order_shipment_tracking to derive true_margin.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('order_shipment_tracking', (table) => {
    table.decimal('shipping_cost_excl_vat', 10, 4).nullable();
    table.string('shipping_cost_currency', 3).nullable();
    table.string('carrier_zone', 64).nullable();
  });

  await knex.schema.alterTable('order_margin_snapshot', (table) => {
    table.decimal('carrier_shipping_cost', 10, 4).nullable();
    table.decimal('true_margin', 14, 2).nullable();
    table.decimal('true_margin_pct', 8, 4).nullable();
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('order_margin_snapshot', (table) => {
    table.dropColumn('true_margin_pct');
    table.dropColumn('true_margin');
    table.dropColumn('carrier_shipping_cost');
  });

  await knex.schema.alterTable('order_shipment_tracking', (table) => {
    table.dropColumn('carrier_zone');
    table.dropColumn('shipping_cost_currency');
    table.dropColumn('shipping_cost_excl_vat');
  });
}
