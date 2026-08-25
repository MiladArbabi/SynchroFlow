import type { Knex } from 'knex';

/**
 * MON-ALLOW-04 — merchant overage preference
 * -------------------------------------------
 * Core and Growth use an included fulfilled-order allowance with optional
 * continuation into paid overage.
 *
 * allow_overage=true means WMS execution may continue beyond the included
 * shipped-order allowance and newly over-cap units may be billed.
 *
 * Starter and Scale do not expose this preference:
 * - Starter remains a hard-stop/upgrade plan.
 * - Scale has no shipped-order cap.
 *
 * Enforcement is added separately at WMS pack-complete.
 */
export async function up(knex: Knex): Promise<void> {
  const exists = await knex.schema.hasTable('shop_subscriptions');

  if (!exists) {
    throw new Error(
      'MON-ALLOW-04: shop_subscriptions is required before adding allow_overage'
    );
  }

  const hasColumn = await knex.schema.hasColumn(
    'shop_subscriptions',
    'allow_overage'
  );

  if (!hasColumn) {
    await knex.schema.alterTable('shop_subscriptions', (table) => {
      table
        .boolean('allow_overage')
        .notNullable()
        .defaultTo(true)
        .comment(
          'Core/Growth merchant preference: permit WMS fulfillment beyond the included shipped-order allowance.'
        );
    });
  }
}

export async function down(knex: Knex): Promise<void> {
  const exists = await knex.schema.hasTable('shop_subscriptions');

  if (!exists) {
    throw new Error(
      'MON-ALLOW-04 rollback: shop_subscriptions does not exist'
    );
  }

  const hasColumn = await knex.schema.hasColumn(
    'shop_subscriptions',
    'allow_overage'
  );

  if (hasColumn) {
    await knex.schema.alterTable('shop_subscriptions', (table) => {
      table.dropColumn('allow_overage');
    });
  }
}
