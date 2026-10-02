import type { Knex } from 'knex';

// GH-1179 D26 — bind immutable opening inventory cutover generations to the
// stable Shopify merchant identity (shopify_app_installations.shop_gid).
//
// Existing generations are NEVER backfilled: copying today's installation GID
// onto an already-frozen generation would manufacture historical identity
// evidence. A nonempty table therefore fails closed and requires explicit,
// manual reconciliation.

export async function up(knex: Knex): Promise<void> {
  // Block concurrent generation writers between the emptiness check and the
  // NOT NULL column addition.
  await knex.raw(`
    LOCK TABLE opening_inventory_cutover_generations
      IN ACCESS EXCLUSIVE MODE
  `);

  // row_security=off either exposes all rows for the migration role or raises
  // rather than silently hiding evidence behind FORCE RLS.
  await knex.raw(`SET LOCAL row_security = off`);

  await knex.raw(`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1
        FROM opening_inventory_cutover_generations
        LIMIT 1
      ) THEN
        RAISE EXCEPTION
          '[OPENING_INVENTORY_CUTOVER_GENERATION_SHOP_GID_BACKFILL_BLOCKED] stable Shopify Shop identity cannot be retrospectively inferred for existing immutable cutover generations; reconcile them explicitly before applying this migration';
      END IF;
    END;
    $$;
  `);

  await knex.raw(`
    ALTER TABLE opening_inventory_cutover_generations
      ADD COLUMN shopify_shop_gid text NOT NULL;

    ALTER TABLE opening_inventory_cutover_generations
      ADD CONSTRAINT opening_inventory_cutover_generations_shop_gid_valid
        CHECK (
          shopify_shop_gid ~ '^gid://shopify/Shop/[0-9]+$'
        );
  `);
}

export async function down(knex: Knex): Promise<void> {
  // Durable generation evidence wins over rollback convenience (0201 down
  // precedent). Lock first so no generation can be inserted between the
  // evidence check and the schema removal.
  await knex.raw(`
    LOCK TABLE opening_inventory_cutover_generations
      IN ACCESS EXCLUSIVE MODE
  `);

  await knex.raw(`SET LOCAL row_security = off`);

  const result = await knex.raw(`
    SELECT EXISTS (
      SELECT 1
      FROM opening_inventory_cutover_generations
      LIMIT 1
    ) AS has_evidence
  `);

  if (Boolean(result.rows?.[0]?.has_evidence)) {
    throw new Error(
      '[OPENING_INVENTORY_CUTOVER_GENERATION_SHOP_GID_ROLLBACK_BLOCKED] durable generation evidence exists; stable Shopify Shop identity cannot be removed'
    );
  }

  await knex.raw(`
    ALTER TABLE opening_inventory_cutover_generations
      DROP CONSTRAINT IF EXISTS
        opening_inventory_cutover_generations_shop_gid_valid;

    ALTER TABLE opening_inventory_cutover_generations
      DROP COLUMN IF EXISTS shopify_shop_gid;
  `);
}
