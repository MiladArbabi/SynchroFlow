import { Knex } from 'knex';

const TABLE = 'integrations';
const CONSTRAINT = 'integrations_shop_platform_unique';

export async function up(knex: Knex): Promise<void> {
  // 1️⃣ Defensive cleanup:
  // Keep the newest row per (shop_id, platform)
  await knex.raw(`
    DELETE FROM ${TABLE} a
    USING ${TABLE} b
    WHERE a.id > b.id
      AND a.shop_id = b.shop_id
      AND a.platform = b.platform
  `);

  // 2️⃣ Enforce the real invariant
  await knex.schema.alterTable(TABLE, (table) => {
    table.unique(['shop_id', 'platform'], CONSTRAINT);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable(TABLE, (table) => {
    table.dropUnique(['shop_id', 'platform'], CONSTRAINT);
  });
}
