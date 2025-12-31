import { Knex } from 'knex';

const TABLE = 'integrations';

export async function up(knex: Knex): Promise<void> {
  // Guard: table must exist
  const tableExists = await knex.schema.hasTable(TABLE);
  if (!tableExists) {
    return;
  }

  // Drop legacy constraint ONLY if it exists
  const legacyConstraintExists = await knex.raw(
    `
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'integrations_shop_platform_shopname_unique'
      AND conrelid = 'integrations'::regclass
    `
  );

  if (legacyConstraintExists.rowCount > 0) {
    await knex.raw(
      `
      ALTER TABLE integrations
      DROP CONSTRAINT integrations_shop_platform_shopname_unique
      `
    );
  }

  // Add correct constraint ONLY if missing
  const newConstraintExists = await knex.raw(
    `
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'integrations_shop_platform_unique'
      AND conrelid = 'integrations'::regclass
    `
  );

  if (newConstraintExists.rowCount === 0) {
    await knex.raw(
      `
      ALTER TABLE integrations
      ADD CONSTRAINT integrations_shop_platform_unique
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
    DROP CONSTRAINT IF EXISTS integrations_shop_platform_unique
    `
  );

  await knex.raw(
    `
    ALTER TABLE integrations
    ADD CONSTRAINT integrations_shop_platform_shopname_unique
    UNIQUE (shop_id, platform, platform_shop_name)
    `
  );
}
