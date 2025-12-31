import { Knex } from 'knex';

const TABLE = 'integrations';

export async function up(knex: Knex): Promise<void> {
  // 1. Drop the incorrect constraint
  await knex.schema.alterTable(TABLE, table => {
    table.dropUnique(
      ['shop_id', 'platform', 'platform_shop_name'],
      'integrations_shop_platform_shopname_unique'
    );
  });

  // 2. Enforce the real invariant
  await knex.schema.alterTable(TABLE, table => {
    table.unique(
      ['shop_id', 'platform'],
      'integrations_shop_platform_unique'
    );
  });
}

export async function down(knex: Knex): Promise<void> {
  // Revert if absolutely necessary
  await knex.schema.alterTable(TABLE, table => {
    table.dropUnique(
      ['shop_id', 'platform'],
      'integrations_shop_platform_unique'
    );
    table.unique(
      ['shop_id', 'platform', 'platform_shop_name'],
      'integrations_shop_platform_shopname_unique'
    );
  });
}
