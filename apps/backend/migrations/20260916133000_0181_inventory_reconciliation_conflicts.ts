import type { Knex } from 'knex';

/**
 * MIGRATION 0181 — inventory reconciliation conflicts
 * ---------------------------------------------------
 *
 * Durable boundary between:
 *
 *   Shopify commerce / warehouse-level observations
 *
 * and
 *
 *   LaSyncro physical warehouse truth.
 *
 * A conflict is created only when LaSyncro cannot derive one safe,
 * auditable physical outcome from the evidence available.
 *
 * Examples:
 * - Shopify says a fulfillment occurred, but multiple internal bins could
 *   have supplied the quantity.
 * - Shopify location is known, but no LaSyncro warehouse mapping exists.
 *
 * The conflict preserves evidence. It does NOT guess inventory location.
 *
 * Problem Center owns the human resolution workflow through:
 *
 *   problem_center_tasks.source = 'reconciliation'
 *   problem_center_tasks.source_exception_id = conflict_id
 *
 * transaction:false is required because PostgreSQL must commit the new enum
 * value before it can be referenced by the partial index predicate below.
 */

export const config = {
  transaction: false,
};

export async function up(knex: Knex): Promise<void> {
  // ---------------------------------------------------------------------------
  // 1. Problem Center can own trusted server-created reconciliation incidents.
  // ---------------------------------------------------------------------------
  await knex.raw(`
    ALTER TYPE problem_center_source
    ADD VALUE IF NOT EXISTS 'reconciliation';
  `);

  // ---------------------------------------------------------------------------
  // 2. Conflict lifecycle.
  // ---------------------------------------------------------------------------
  await knex.raw(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM pg_type
        WHERE typname = 'inventory_reconciliation_conflict_status'
      ) THEN
        CREATE TYPE inventory_reconciliation_conflict_status AS ENUM (
          'open',
          'resolved',
          'dismissed'
        );
      END IF;
    END$$;
  `);

  // ---------------------------------------------------------------------------
  // 3. Durable conflict evidence.
  // ---------------------------------------------------------------------------
  await knex.schema.createTable(
    'inventory_reconciliation_conflicts',
    (table) => {
      table
        .uuid('conflict_id')
        .primary()
        .notNullable()
        .defaultTo(knex.raw('gen_random_uuid()'));

      table
        .integer('shop_id')
        .notNullable()
        .references('id')
        .inTable('shops')
        .onDelete('CASCADE');

      /**
       * Machine-readable reason for escalation.
       *
       * Initial expected value:
       *   fulfillment_location_ambiguous
       *
       * Deliberately varchar rather than enum because this table is the
       * extensible reconciliation boundary for future external conflicts.
       */
      table.string('conflict_type', 100).notNullable();

      table.string('source_platform', 50).notNullable();

      /**
       * Durable replay identity.
       * A projection retry of the same Shopify event must reuse the same
       * conflict instead of creating another Problem Center incident.
       */
      table
        .bigInteger('source_domain_event_id')
        .notNullable()
        .references('id')
        .inTable('domain_events')
        .onDelete('RESTRICT');

      table
        .uuid('lasyncro_order_id')
        .notNullable()
        .references('lasyncro_order_id')
        .inTable('orders')
        .onDelete('CASCADE');

      table
        .uuid('lasyncro_line_item_id')
        .notNullable()
        .references('lasyncro_line_item_id')
        .inTable('order_line_items')
        .onDelete('CASCADE');

      table
        .uuid('lasyncro_variant_id')
        .notNullable()
        .references('lasyncro_variant_id')
        .inTable('variants')
        .onDelete('RESTRICT');

      /**
       * Shopify owns commerce-location / fulfillment-location identity.
       * It does not own LaSyncro bins.
       *
       * Nullable because some webhook/event shapes may not contain a usable
       * external location and that absence itself can require reconciliation.
       */
      table.string('external_location_id', 255).nullable();

      /**
       * Mapped LaSyncro warehouse, when deterministically known.
       *
       * Internal candidate bins live below this boundary.
       */
      table
        .uuid('warehouse_id')
        .nullable()
        .references('warehouse_id')
        .inTable('warehouses')
        .onDelete('RESTRICT');

      table.integer('quantity').notNullable();

      /**
       * Effective time of the external observation/action.
       */
      table.timestamp('occurred_at', { useTz: true }).notNullable();

      /**
       * Immutable-at-creation evidence snapshot used to explain why the system
       * refused to guess.
       *
       * Example:
       * [
       *   {"location_code":"A-1","on_hand_quantity":3},
       *   {"location_code":"B-2","on_hand_quantity":2}
       * ]
       */
      table
        .jsonb('candidate_locations')
        .notNullable()
        .defaultTo(knex.raw(`'[]'::jsonb`));

      table
        .specificType(
          'status',
          'inventory_reconciliation_conflict_status'
        )
        .notNullable()
        .defaultTo('open');

      /**
       * Resolution is deliberately explicit and audited.
       *
       * Examples later:
       * - use_location
       * - already_adjusted
       * - dismiss_invalid_external_event
       */
      table.string('resolution_action', 100).nullable();
      table.string('resolution_location_code', 255).nullable();
      table.text('resolution_notes').nullable();

      table
        .integer('resolved_by')
        .nullable()
        .references('id')
        .inTable('users')
        .onDelete('SET NULL');

      table.timestamp('resolved_at', { useTz: true }).nullable();

      table
        .timestamp('created_at', { useTz: true })
        .notNullable()
        .defaultTo(knex.fn.now());

      table
        .timestamp('updated_at', { useTz: true })
        .notNullable()
        .defaultTo(knex.fn.now());

      table.index(
        ['shop_id', 'status'],
        'inventory_reconciliation_conflicts_shop_status_idx'
      );

      table.index(
        ['shop_id', 'lasyncro_order_id'],
        'inventory_reconciliation_conflicts_order_idx'
      );

      table.index(
        ['shop_id', 'lasyncro_variant_id'],
        'inventory_reconciliation_conflicts_variant_idx'
      );
    }
  );

  // ---------------------------------------------------------------------------
  // 4. Replay identity.
  // ---------------------------------------------------------------------------
  await knex.raw(`
    CREATE UNIQUE INDEX
      inventory_reconciliation_conflicts_event_line_unique
    ON inventory_reconciliation_conflicts (
      shop_id,
      source_domain_event_id,
      lasyncro_line_item_id,
      conflict_type
    );
  `);

  // ---------------------------------------------------------------------------
  // 5. Basic domain invariants.
  // ---------------------------------------------------------------------------
  await knex.raw(`
    ALTER TABLE inventory_reconciliation_conflicts
    ADD CONSTRAINT
      inventory_reconciliation_conflicts_quantity_positive_chk
    CHECK (quantity > 0);
  `);

  await knex.raw(`
    ALTER TABLE inventory_reconciliation_conflicts
    ADD CONSTRAINT
      inventory_reconciliation_conflicts_resolution_state_chk
    CHECK (
      (
        status = 'open'
        AND resolved_at IS NULL
        AND resolved_by IS NULL
      )
      OR
      (
        status IN ('resolved', 'dismissed')
        AND resolved_at IS NOT NULL
      )
    );
  `);

  // ---------------------------------------------------------------------------
  // 6. Tenant isolation.
  // ---------------------------------------------------------------------------
  await knex.raw(`
    ALTER TABLE inventory_reconciliation_conflicts
    ENABLE ROW LEVEL SECURITY;

    ALTER TABLE inventory_reconciliation_conflicts
    FORCE ROW LEVEL SECURITY;
  `);

  await knex.raw(`
    DROP POLICY IF EXISTS
      inventory_reconciliation_conflicts_tenant_isolation_policy
    ON inventory_reconciliation_conflicts;
  `);

  await knex.raw(`
    CREATE POLICY
      inventory_reconciliation_conflicts_tenant_isolation_policy
    ON inventory_reconciliation_conflicts
    USING (
      shop_id = current_setting('app.current_tenant')::int
    )
    WITH CHECK (
      shop_id = current_setting('app.current_tenant')::int
    );
  `);

  // ---------------------------------------------------------------------------
  // 7. Exactly one Problem Center incident per reconciliation conflict.
  //
  // source_exception_id already has the correct UUID shape for conflict_id.
  // Other Problem Center sources are unaffected.
  // ---------------------------------------------------------------------------
  await knex.raw(`
    CREATE UNIQUE INDEX
      problem_center_reconciliation_source_unique
    ON problem_center_tasks (
      shop_id,
      source_exception_id,
      source
    )
    WHERE
      source = 'reconciliation'
      AND source_exception_id IS NOT NULL;
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw(`
    DROP INDEX IF EXISTS
      problem_center_reconciliation_source_unique;
  `);

  await knex.schema.dropTableIfExists(
    'inventory_reconciliation_conflicts'
  );

  await knex.raw(`
    DROP TYPE IF EXISTS
      inventory_reconciliation_conflict_status;
  `);

  /**
   * PostgreSQL cannot safely remove a single enum value.
   * problem_center_source.reconciliation therefore remains after rollback,
   * matching the established repository convention for enum extensions.
   */
}
