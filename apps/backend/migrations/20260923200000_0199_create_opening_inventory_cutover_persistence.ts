import type { Knex } from 'knex';

/**
 * MIGRATION 0199 — opening inventory cutover persistence
 * ------------------------------------------------------
 *
 * Durable authority for the one-time Shopify opening-inventory cutover.
 *
 * Economic model:
 *   opening reconciliation -> merchant approval -> frozen Shopify delta batches
 *   -> confirmed external success -> onboarding readiness.
 *
 * Physical inventory is NOT mutated here.
 *
 * One opening_inventory_cutovers row exists per shop.
 * One opening_inventory_cutover_batches row exists per Shopify
 * inventoryAdjustQuantities call (maximum 250 changes).
 *
 * Shopify request identity and payload are frozen before external HTTP:
 *   idempotency_key + shopify_input
 *
 * Runtime rows are durable economic evidence:
 *   DELETE is forbidden.
 *   Economic identity/payload columns are immutable.
 *   Execution status/error/attempt/completion columns remain mutable.
 */

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('shop_wms_settings', (table) => {
    table
      .timestamp('opening_inventory_shopify_synced_at', { useTz: true })
      .nullable();
  });

  await knex.schema.createTable('opening_inventory_cutovers', (table) => {
    table.uuid('cutover_id').primary();

    table
      .integer('shop_id')
      .notNullable()
      .references('id')
      .inTable('shops')
      .onDelete('CASCADE');

    table.text('status').notNullable().defaultTo('prepared');

    table.text('approved_by_actor_type').notNullable();
    table.text('approved_by_actor_id').notNullable();
    table.text('approved_by_role').notNullable();
    table.timestamp('approved_at', { useTz: true }).notNullable();

    table
      .timestamp('physical_truth_accepted_at', { useTz: true })
      .nullable();

    table.integer('correction_variant_count').notNullable();
    table.integer('batch_count').notNullable();

    table.text('last_error').nullable();
    table.timestamp('completed_at', { useTz: true }).nullable();

    table
      .timestamp('created_at', { useTz: true })
      .notNullable()
      .defaultTo(knex.fn.now());

    table
      .timestamp('updated_at', { useTz: true })
      .notNullable()
      .defaultTo(knex.fn.now());

    table.unique(
      ['shop_id'],
      'opening_inventory_cutovers_shop_unique'
    );

    table.unique(
      ['cutover_id', 'shop_id'],
      'opening_inventory_cutovers_cutover_shop_unique'
    );

    table.index(
      ['shop_id', 'status'],
      'opening_inventory_cutovers_shop_status_idx'
    );
  });

  await knex.raw(`
    ALTER TABLE opening_inventory_cutovers
      ADD CONSTRAINT opening_inventory_cutovers_status_check
      CHECK (
        status IN ('prepared', 'executing', 'failed', 'complete')
      ),

      ADD CONSTRAINT opening_inventory_cutovers_approver_type_check
      CHECK (
        approved_by_actor_type = 'user'
      ),

      ADD CONSTRAINT opening_inventory_cutovers_approver_role_check
      CHECK (
        approved_by_role IN ('owner', 'admin')
      ),

      ADD CONSTRAINT opening_inventory_cutovers_counts_nonnegative_check
      CHECK (
        correction_variant_count >= 0
        AND batch_count >= 0
      ),

      ADD CONSTRAINT opening_inventory_cutovers_acceptance_batch_check
      CHECK (
        (
          correction_variant_count = 0
          AND batch_count = 0
          AND physical_truth_accepted_at IS NULL
        )
        OR
        (
          correction_variant_count > 0
          AND physical_truth_accepted_at IS NOT NULL
          AND batch_count = ((correction_variant_count - 1) / 250) + 1
        )
      ),

      ADD CONSTRAINT opening_inventory_cutovers_completion_check
      CHECK (
        (status = 'complete') = (completed_at IS NOT NULL)
      );
  `);

  await knex.schema.createTable(
    'opening_inventory_cutover_batches',
    (table) => {
      table.bigIncrements('id').primary();

      table.uuid('cutover_id').notNullable();
      table.integer('shop_id').notNullable();

      table.integer('batch_sequence').notNullable();

      table.text('idempotency_key').notNullable();

      table.jsonb('shopify_input').notNullable();
      table.jsonb('audit_snapshot').notNullable();

      table.text('status').notNullable().defaultTo('pending');

      table.integer('attempt_count').notNullable().defaultTo(0);
      table
        .timestamp('last_attempted_at', { useTz: true })
        .nullable();
      table.text('last_error').nullable();

      table.text('shopify_adjustment_group_id').nullable();
      table.timestamp('completed_at', { useTz: true }).nullable();

      table
        .timestamp('created_at', { useTz: true })
        .notNullable()
        .defaultTo(knex.fn.now());

      table
        .timestamp('updated_at', { useTz: true })
        .notNullable()
        .defaultTo(knex.fn.now());

      table
        .foreign(
          ['cutover_id', 'shop_id'],
          'opening_inventory_cutover_batches_cutover_shop_fk'
        )
        .references(['cutover_id', 'shop_id'])
        .inTable('opening_inventory_cutovers')
        .onDelete('CASCADE');

      table.unique(
        ['cutover_id', 'batch_sequence'],
        'opening_inventory_cutover_batches_sequence_unique'
      );

      table.unique(
        ['idempotency_key'],
        'opening_inventory_cutover_batches_idempotency_unique'
      );

      table.index(
        ['shop_id', 'status'],
        'opening_inventory_cutover_batches_shop_status_idx'
      );

      table.index(
        ['cutover_id', 'status'],
        'opening_inventory_cutover_batches_cutover_status_idx'
      );
    }
  );

  await knex.raw(`
    ALTER TABLE opening_inventory_cutover_batches
      ADD CONSTRAINT opening_inventory_cutover_batches_status_check
      CHECK (
        status IN ('pending', 'in_flight', 'failed', 'succeeded')
      ),

      ADD CONSTRAINT opening_inventory_cutover_batches_sequence_check
      CHECK (
        batch_sequence >= 1
      ),

      ADD CONSTRAINT opening_inventory_cutover_batches_attempt_count_check
      CHECK (
        attempt_count >= 0
      ),

      ADD CONSTRAINT opening_inventory_cutover_batches_completion_check
      CHECK (
        (status = 'succeeded') = (completed_at IS NOT NULL)
      ),

      ADD CONSTRAINT opening_inventory_cutover_batches_shopify_input_check
      CHECK (
        COALESCE(jsonb_typeof(shopify_input) = 'object', FALSE)
        AND COALESCE(shopify_input ->> 'reason' = 'correction', FALSE)
        AND COALESCE(shopify_input ->> 'name' = 'available', FALSE)
        AND CASE
          WHEN jsonb_typeof(shopify_input -> 'changes') = 'array'
          THEN jsonb_array_length(shopify_input -> 'changes')
               BETWEEN 1 AND 250
          ELSE FALSE
        END
      ),

      ADD CONSTRAINT opening_inventory_cutover_batches_audit_snapshot_check
      CHECK (
        CASE
          WHEN jsonb_typeof(audit_snapshot) = 'array'
           AND jsonb_typeof(shopify_input -> 'changes') = 'array'
          THEN
            jsonb_array_length(audit_snapshot)
            =
            jsonb_array_length(shopify_input -> 'changes')
          ELSE FALSE
        END
      );
  `);

  await knex.raw(`
    CREATE OR REPLACE FUNCTION prevent_opening_inventory_cutover_identity_mutation()
    RETURNS trigger AS $$
    BEGIN
      IF
        NEW.cutover_id IS DISTINCT FROM OLD.cutover_id
        OR NEW.shop_id IS DISTINCT FROM OLD.shop_id
        OR NEW.approved_by_actor_type IS DISTINCT FROM OLD.approved_by_actor_type
        OR NEW.approved_by_actor_id IS DISTINCT FROM OLD.approved_by_actor_id
        OR NEW.approved_by_role IS DISTINCT FROM OLD.approved_by_role
        OR NEW.approved_at IS DISTINCT FROM OLD.approved_at
        OR NEW.physical_truth_accepted_at IS DISTINCT FROM OLD.physical_truth_accepted_at
        OR NEW.correction_variant_count IS DISTINCT FROM OLD.correction_variant_count
        OR NEW.batch_count IS DISTINCT FROM OLD.batch_count
      THEN
        RAISE EXCEPTION
          '[OPENING_INVENTORY_CUTOVER_IMMUTABLE] economic cutover identity cannot be changed';
      END IF;

      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;

    CREATE TRIGGER opening_inventory_cutovers_identity_immutable
    BEFORE UPDATE ON opening_inventory_cutovers
    FOR EACH ROW
    EXECUTE FUNCTION prevent_opening_inventory_cutover_identity_mutation();
  `);

  await knex.raw(`
    CREATE OR REPLACE FUNCTION prevent_opening_inventory_cutover_batch_identity_mutation()
    RETURNS trigger AS $$
    BEGIN
      IF
        NEW.cutover_id IS DISTINCT FROM OLD.cutover_id
        OR NEW.shop_id IS DISTINCT FROM OLD.shop_id
        OR NEW.batch_sequence IS DISTINCT FROM OLD.batch_sequence
        OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key
        OR NEW.shopify_input IS DISTINCT FROM OLD.shopify_input
        OR NEW.audit_snapshot IS DISTINCT FROM OLD.audit_snapshot
      THEN
        RAISE EXCEPTION
          '[OPENING_INVENTORY_CUTOVER_BATCH_IMMUTABLE] external operation identity cannot be changed';
      END IF;

      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;

    CREATE TRIGGER opening_inventory_cutover_batches_identity_immutable
    BEFORE UPDATE ON opening_inventory_cutover_batches
    FOR EACH ROW
    EXECUTE FUNCTION prevent_opening_inventory_cutover_batch_identity_mutation();
  `);

  await knex.raw(`
    CREATE OR REPLACE FUNCTION prevent_opening_inventory_cutover_delete()
    RETURNS trigger AS $$
    BEGIN
      RAISE EXCEPTION
        '[OPENING_INVENTORY_CUTOVER_DELETE_BLOCKED] durable cutover evidence cannot be deleted';
    END;
    $$ LANGUAGE plpgsql;

    CREATE TRIGGER opening_inventory_cutovers_no_delete
    BEFORE DELETE ON opening_inventory_cutovers
    FOR EACH ROW
    EXECUTE FUNCTION prevent_opening_inventory_cutover_delete();

    CREATE TRIGGER opening_inventory_cutover_batches_no_delete
    BEFORE DELETE ON opening_inventory_cutover_batches
    FOR EACH ROW
    EXECUTE FUNCTION prevent_opening_inventory_cutover_delete();
  `);

  for (const table of [
    'opening_inventory_cutovers',
    'opening_inventory_cutover_batches',
  ]) {
    await knex.raw(`ALTER TABLE ?? ENABLE ROW LEVEL SECURITY`, [table]);
    await knex.raw(`ALTER TABLE ?? FORCE ROW LEVEL SECURITY`, [table]);
  }

  await knex.raw(`
    CREATE POLICY opening_inventory_cutovers_tenant_isolation_policy
    ON opening_inventory_cutovers
    FOR ALL
    USING (
      shop_id =
        NULLIF(current_setting('app.current_tenant', true), '')::integer
      AND
        NULLIF(current_setting('app.current_tenant', true), '')::integer > 0
    )
    WITH CHECK (
      shop_id =
        NULLIF(current_setting('app.current_tenant', true), '')::integer
      AND
        NULLIF(current_setting('app.current_tenant', true), '')::integer > 0
    );
  `);

  await knex.raw(`
    CREATE POLICY opening_inventory_cutover_batches_tenant_isolation_policy
    ON opening_inventory_cutover_batches
    FOR ALL
    USING (
      shop_id =
        NULLIF(current_setting('app.current_tenant', true), '')::integer
      AND
        NULLIF(current_setting('app.current_tenant', true), '')::integer > 0
    )
    WITH CHECK (
      shop_id =
        NULLIF(current_setting('app.current_tenant', true), '')::integer
      AND
        NULLIF(current_setting('app.current_tenant', true), '')::integer > 0
    );
  `);
}

export async function down(knex: Knex): Promise<void> {
  const existingCutover = await knex('opening_inventory_cutovers')
    .first('cutover_id');

  if (existingCutover) {
    throw new Error(
      '[MIGRATION_0199_DOWN_BLOCKED] Cannot remove opening-inventory cutover persistence while cutover evidence exists'
    );
  }

  const syncedShop = await knex('shop_wms_settings')
    .whereNotNull('opening_inventory_shopify_synced_at')
    .first('shop_id');

  if (syncedShop) {
    throw new Error(
      '[MIGRATION_0199_DOWN_BLOCKED] Cannot remove opening-inventory cutover persistence after Shopify synchronization has been confirmed'
    );
  }

  await knex.raw(`
    DROP TRIGGER IF EXISTS opening_inventory_cutover_batches_no_delete
      ON opening_inventory_cutover_batches;

    DROP TRIGGER IF EXISTS opening_inventory_cutover_batches_identity_immutable
      ON opening_inventory_cutover_batches;

    DROP TRIGGER IF EXISTS opening_inventory_cutovers_no_delete
      ON opening_inventory_cutovers;

    DROP TRIGGER IF EXISTS opening_inventory_cutovers_identity_immutable
      ON opening_inventory_cutovers;
  `);

  await knex.raw(`
    DROP FUNCTION IF EXISTS prevent_opening_inventory_cutover_delete();
    DROP FUNCTION IF EXISTS prevent_opening_inventory_cutover_batch_identity_mutation();
    DROP FUNCTION IF EXISTS prevent_opening_inventory_cutover_identity_mutation();
  `);

  await knex.schema.dropTableIfExists(
    'opening_inventory_cutover_batches'
  );

  await knex.schema.dropTableIfExists(
    'opening_inventory_cutovers'
  );

  await knex.schema.alterTable('shop_wms_settings', (table) => {
    table.dropColumn('opening_inventory_shopify_synced_at');
  });
}
