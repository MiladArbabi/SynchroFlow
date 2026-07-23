// apps/backend/migrations/20260723140000_0126_dedupe_and_create_open_module_unique_index.ts
import { Knex } from 'knex';

/**
 * SHB-DRIFT-03 (continued)
 * ------------------------
 * Migration 0125 attempted to create shop_module_entitlements_open_module_unique
 * on prod but failed with 23505 (unique violation): prod has genuine duplicate
 * open grants for the same (shop_id, module_key) with flag_key IS NULL and
 * valid_until IS NULL — e.g. shop 1's 'specter' module has both a
 * trial:growth grant (id 15) and a manual:scale_upgrade grant (id 38) still
 * open simultaneously. 19 (shop_id, module_key) pairs affected across 2 shops.
 *
 * Root cause (application-level, not this migration): whatever grants
 * entitlements on upgrade/reinstall was relying on the ON CONFLICT clause
 * that this same missing index was supposed to back — so instead of closing
 * the prior grant (setting valid_until) and opening a new one, duplicate
 * open rows accumulated silently.
 *
 * This migration is data-preserving, not destructive: for every duplicate
 * group, all rows except the most recently-granted one are closed by
 * setting valid_until to the valid_from of the row that superseded them —
 * preserving full grant history rather than deleting rows. Only after
 * dedup is the index created.
 *
 * 0125 is left untouched (already executed + checksummed locally) — this
 * migration is additive and safe to run regardless of whether 0125
 * succeeded (local) or failed (prod), via IF NOT EXISTS on the index.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.raw(`
    WITH ranked AS (
      SELECT
        id,
        LEAD(valid_from) OVER (
          PARTITION BY shop_id, module_key
          ORDER BY valid_from ASC, id ASC
        ) AS superseded_at,
        ROW_NUMBER() OVER (
          PARTITION BY shop_id, module_key
          ORDER BY valid_from DESC, id DESC
        ) AS rn
      FROM shop_module_entitlements
      WHERE flag_key IS NULL AND valid_until IS NULL
    )
    UPDATE shop_module_entitlements sme
    SET valid_until = ranked.superseded_at,
        updated_at = NOW()
    FROM ranked
    WHERE sme.id = ranked.id AND ranked.rn <> 1;
  `);

  await knex.raw(`
    CREATE UNIQUE INDEX IF NOT EXISTS shop_module_entitlements_open_module_unique
    ON shop_module_entitlements (shop_id, module_key)
    WHERE flag_key IS NULL AND valid_until IS NULL;
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw(`
    DROP INDEX IF EXISTS shop_module_entitlements_open_module_unique;
  `);
  // Deliberately not reversing the valid_until closures — down migrations
  // that resurrect superseded entitlement grants would be a correctness
  // regression, not a rollback. The index removal alone is sufficient to
  // undo this migration's schema effect.
}