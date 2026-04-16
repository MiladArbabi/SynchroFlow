// apps/backend/migrations/20260416132101_0093_create_exchange_rates.ts
import type { Knex } from 'knex';

/**
 * EXCHANGE RATES TABLE
 * --------------------
 * Caches daily exchange rates fetched from an external provider.
 *
 * Architecture:
 * - Rates are fetched once daily by the exchange rate worker
 * - All DB monetary values remain in shop base_currency — NEVER converted
 * - Conversion is display-only, applied via formatCurrency() on the frontend
 * - base_currency is always 'USD' as the pivot currency (triangular conversion)
 *
 * Usage:
 *   amount_in_display = amount_in_base * rate (where base=USD, target=displayCurrency)
 *
 * RLS: exchange_rates are global (not tenant-scoped) — rates are public data.
 * RLS is intentionally NOT enabled on this table.
 * @rls-exempt: exchange rates are public market data, no tenant isolation needed
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('exchange_rates', (table) => {
    table.increments('id').primary();

    /**
     * BASE CURRENCY
     * -------------
     * Always 'USD' — we use USD as the pivot currency.
     * All rates are expressed as: 1 USD = N target_currency
     */
    table.string('base_currency', 3)
      .notNullable()
      .defaultTo('USD');

    /**
     * TARGET CURRENCY
     * ---------------
     * ISO 4217 currency code (e.g. 'EUR', 'GBP', 'CAD')
     */
    table.string('target_currency', 3)
      .notNullable();

    /**
     * RATE
     * ----
     * Exchange rate: 1 base_currency = rate target_currency
     * High precision — financial rates require 6 decimal places
     */
    table.decimal('rate', 18, 6)
      .notNullable();

    /**
     * FETCHED AT
     * ----------
     * Timestamp of when this rate was fetched from the provider.
     * Used to determine staleness and skip redundant fetches.
     */
    table.timestamp('fetched_at', { useTz: true })
      .notNullable()
      .defaultTo(knex.fn.now());

    /**
     * VALID ON
     * --------
     * The calendar date this rate is valid for.
     * One row per (base_currency, target_currency, valid_on) — upserted daily.
     */
    table.date('valid_on').notNullable();

    table.unique(['base_currency', 'target_currency', 'valid_on']);
    table.index(['target_currency', 'valid_on']);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('exchange_rates');
}