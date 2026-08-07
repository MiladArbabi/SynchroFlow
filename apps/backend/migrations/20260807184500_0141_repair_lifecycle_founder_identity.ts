import type { Knex } from 'knex';

/**
 * LIFECYCLE-ID-01 — repair lifecycle founder identity.
 *
 * user_lifecycle_snapshot is shop-scoped, but its user_id identifies the
 * founding owner whose onboarding established that shop. First-order ingestion
 * previously fell back to user 1, corrupting this identity for later shops.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.raw(`
    WITH founding_owners AS (
      SELECT DISTINCT ON (membership.shop_id)
        membership.shop_id,
        membership.user_id
      FROM public.shop_memberships AS membership
      WHERE membership.role = 'owner'
      ORDER BY
        membership.shop_id,
        membership.created_at ASC,
        membership.id ASC
    )
    UPDATE public.user_lifecycle_snapshot AS snapshot
    SET
      user_id = founder.user_id,
      updated_at = CURRENT_TIMESTAMP
    FROM founding_owners AS founder
    WHERE snapshot.shop_id = founder.shop_id
      AND snapshot.user_id IS DISTINCT FROM founder.user_id;
  `);
}

/**
 * Identity repair is intentionally irreversible: the previous user_id values
 * were corrupt fallback data and cannot be reconstructed as valid identities.
 */
export async function down(_knex: Knex): Promise<void> {
  return;
}
