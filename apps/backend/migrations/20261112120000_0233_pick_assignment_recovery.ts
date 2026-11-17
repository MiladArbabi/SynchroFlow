import type { Knex } from 'knex';

/**
 * MIGRATION 0233 — Pick assignment and idle recovery (SF-PICK-ASSIGN-01)
 * ---------------------------------------------------------------------
 * Additive only. Nothing existing is renamed, narrowed or dropped.
 *
 *   pick_batches.pick_assigned_at            clock for assignment expiry. Set
 *                                            whenever assigned_operator_id is
 *                                            set; NULL when unassigned.
 *   pick_batches.pick_claim_generation       ownership-generation token. Rotated
 *                                            on every new claim / takeover;
 *                                            consequential Pick writes must
 *                                            present the current value.
 *   pick_batches.pick_custody_ack_required   true after a takeover of a batch
 *                                            with picked units, until the new
 *                                            owner acknowledges the tote.
 *   warehouses.pick_recovery_threshold_minutes
 *                                            per-warehouse recovery threshold
 *                                            (default 30). Independent of
 *                                            shop_wms_settings.idle_alert_threshold_minutes.
 *   list_pick_recovery_tenants()             SECURITY DEFINER tenant lister for
 *                                            the recovery worker. The existing
 *                                            list_active_wms_tenants() (idle
 *                                            alerts) is NOT modified.
 *
 * Backfill:
 *   - pick_assigned_at = released_at for open batches that carry an assignee,
 *     so pre-existing assignments age from release rather than never expiring.
 *   - pick_claim_generation for batches already in 'picking', so in-flight
 *     sessions have a token that clients can read from GET /batches.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('pick_batches', (table) => {
    table.timestamp('pick_assigned_at', { useTz: true }).nullable();
    table.uuid('pick_claim_generation').nullable();
    table.boolean('pick_custody_ack_required').notNullable().defaultTo(false);
    table.index(
      ['shop_id', 'status', 'assigned_operator_id'],
      'pick_batches_shop_status_assigned_idx'
    );
  });

  await knex.raw(`
    UPDATE pick_batches
       SET pick_assigned_at = released_at
     WHERE assigned_operator_id IS NOT NULL
       AND status IN ('pending', 'picking');

    UPDATE pick_batches
       SET pick_claim_generation = gen_random_uuid()
     WHERE status = 'picking';
  `);

  await knex.schema.alterTable('warehouses', (table) => {
    table.integer('pick_recovery_threshold_minutes').notNullable().defaultTo(30);
  });

  await knex.raw(`
    ALTER TABLE warehouses
      ADD CONSTRAINT warehouses_pick_recovery_threshold_range
      CHECK (pick_recovery_threshold_minutes BETWEEN 5 AND 480);

    CREATE OR REPLACE FUNCTION public.list_pick_recovery_tenants()
    RETURNS TABLE (shop_id integer)
    LANGUAGE sql
    STABLE
    SECURITY DEFINER
    SET search_path = pg_catalog, public
    AS $$
      SELECT DISTINCT batch.shop_id
      FROM public.pick_batches AS batch
      WHERE batch.status IN ('pending', 'picking')
        AND batch.assigned_operator_id IS NOT NULL
        AND batch.picked_by IS DISTINCT FROM batch.assigned_operator_id
    $$;

    REVOKE ALL ON FUNCTION public.list_pick_recovery_tenants()
      FROM PUBLIC;
    GRANT EXECUTE ON FUNCTION public.list_pick_recovery_tenants()
      TO sf_app;
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw(`
    DROP FUNCTION IF EXISTS public.list_pick_recovery_tenants();
    ALTER TABLE warehouses
      DROP CONSTRAINT IF EXISTS warehouses_pick_recovery_threshold_range;
  `);

  await knex.schema.alterTable('warehouses', (table) => {
    table.dropColumn('pick_recovery_threshold_minutes');
  });

  await knex.schema.alterTable('pick_batches', (table) => {
    table.dropIndex(
      ['shop_id', 'status', 'assigned_operator_id'],
      'pick_batches_shop_status_assigned_idx'
    );
    table.dropColumn('pick_custody_ack_required');
    table.dropColumn('pick_claim_generation');
    table.dropColumn('pick_assigned_at');
  });
}
