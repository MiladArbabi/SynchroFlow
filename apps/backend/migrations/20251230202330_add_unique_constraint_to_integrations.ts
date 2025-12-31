import { Knex } from 'knex';

const TABLE = 'integrations';
const CONSTRAINT = 'integrations_shop_platform_unique';

export async function up(knex: Knex): Promise<void> {

  const tableExists = await knex.schema.hasTable(TABLE);
    if (!tableExists) {
      return;
    }

  // 1️⃣ Defensive cleanup:
  // Keep the newest row per (shop_id, platform)
  await knex.raw(`
    DELETE FROM ${TABLE} a
    USING ${TABLE} b
    WHERE a.id > b.id
      AND a.shop_id = b.shop_id
      AND a.platform = b.platform
  `);

  // 2️⃣ Enforce invariant ONLY if missing
  const exists = await knex.raw(
    `
    SELECT 1
    FROM pg_constraint
    WHERE conname = ?
      AND conrelid = 'integrations'::regclass
    `,
    [CONSTRAINT]
  );

  if (exists.rowCount === 0) {
    await knex.raw(
      `
      ALTER TABLE integrations
      ADD CONSTRAINT ${CONSTRAINT}
      UNIQUE (shop_id, platform)
      `
    );
  }
}

export async function down(knex: Knex): Promise<void> {
  const tableExists = await knex.schema.hasTable(TABLE);
  if (!tableExists) {
    return;
  }

  await knex.raw(
    `
    ALTER TABLE integrations
    DROP CONSTRAINT IF EXISTS ${CONSTRAINT}
    `
  );
}
