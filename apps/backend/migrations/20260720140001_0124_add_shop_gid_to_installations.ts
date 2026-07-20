import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  // SHB-05-DRIFT: shop_gid was added to base 0014 after prod had already
  // run it — this patch migration brings live prod in line. hasColumn
  // guard keeps it idempotent for fresh DBs where 0014 already creates it.
  const has = await knex.schema.hasColumn('shopify_app_installations', 'shop_gid');
  if (!has) {
    await knex.schema.alterTable('shopify_app_installations', (table) => {
      table.string('shop_gid', 255).nullable();
    });
  }
}

export async function down(knex: Knex): Promise<void> {
  const has = await knex.schema.hasColumn('shopify_app_installations', 'shop_gid');
  if (has) {
    await knex.schema.alterTable('shopify_app_installations', (table) => {
      table.dropColumn('shop_gid');
    });
  }
}