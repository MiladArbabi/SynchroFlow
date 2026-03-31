import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  // ─────────────────────────────────────────
  // 1️⃣ Create ENUM (idempotent-safe)
  // ─────────────────────────────────────────
  await knex.schema.raw(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_type WHERE typname = 'inventory_movement_type'
      ) THEN
        CREATE TYPE inventory_movement_type AS ENUM (
          'inbound_purchase',
          'sale',
          'refund_return',
          'opening_balance',
          'manual_adjustment',
          'damage',
          'shrinkage',
          'reservation_hold',
          'reservation_release',
          'reconciliation_correction'
        );
      END IF;
    END$$;
  `);

  // ─────────────────────────────────────────
  // 2️⃣ inventory_movements (Canonical Ledger)
  // ─────────────────────────────────────────
  await knex.schema.createTable('inventory_movements', (table) => {
    table
      .uuid('lasyncro_inventory_movement_id')
      .primary()
      .notNullable();

    table
      .uuid('lasyncro_variant_id')
      .notNullable()
      .references('lasyncro_variant_id')
      .inTable('variants')
      .onDelete('RESTRICT');

    table
      .specificType('movement_type', 'inventory_movement_type')
      .notNullable();

    table
      .integer('quantity_delta')
      .notNullable();

    table
      .string('reference_type', 50)
      .notNullable();

    /**
     * Allowed reference domains:
     * - order_revenue_unit
     * - refund_execution
     *
     * Add new domains explicitly via migration.
     */
    table
      .uuid('reference_id')
      .notNullable();

    table
      .uuid('device_event_id')
      .nullable();
      
    /**
     * ECONOMIC IDEMPOTENCY KEY
     * ------------------------
     * device_event_id represents the deterministic economic identity
     * of a movement-producing event.
     *
     * Rebuild safety:
     * - Movement row IDs may differ between deterministic replays
     * - device_event_id guarantees idempotent ledger insertion
     *
     * Example deterministic producers:
     * - revenue_unit sale events
     * - reservation ledger events
     *
     * If two writers attempt to emit the same economic event,
     * this constraint prevents duplicate ledger effects.
     */

    /**
     * ECONOMIC REFERENCE TYPING
     * -------------------------
     * All ledger reference identifiers must be UUID.
     *
     * This eliminates string-casting,
     * strengthens type integrity,
     * and prepares for future FK enforcement.
     *
     * Ledger is sovereign. References must be strictly typed.
     */

    table.string('platform', 255).nullable();
    table.string('location_code', 255).notNullable();

    // --- TENANT ANCHOR (MANDATORY) ---
    // Required for direct RLS enforcement.
    // Do NOT rely on variant join for tenant isolation.
    table
      .integer('shop_id')
      .notNullable()
      .references('id')
      .inTable('shops')
      .onDelete('CASCADE');

    table.index(['shop_id'], 'inventory_movements_shop_id_index');

    table.timestamp('occurred_at', { useTz: true }).notNullable();
    table.timestamp('created_at', { useTz: true }).defaultTo(knex.fn.now());

    /**
     * MUTATION TRACKING (REQUIRED)
     * ----------------------------
     * Required for ON CONFLICT DO UPDATE in reconciliation writes.
     */
    table
      .timestamp('updated_at', { useTz: true })
      .notNullable()
      .defaultTo(knex.fn.now());

    table.index('lasyncro_variant_id');
    table.index('occurred_at');
    table.index(['lasyncro_variant_id', 'occurred_at']);

    table.index(['lasyncro_variant_id', 'location_code']);

    table.unique(
      ['device_event_id'],
      'inventory_movements_device_event_unique'
    );
  });

  /**
   * INVENTORY QUANTITY CONSTRAINT
   * ----------------------------
   * Zero quantity is ONLY valid for opening_balance.
   *
   * Rationale:
   * - Required to explicitly represent zero-stock baseline
   * - Prevents "missing variant" ambiguity in projection
   * - Preserves invariant:
   *     inventory_truth = SUM(inventory_movements)
   */
  await knex.schema.raw(`
    ALTER TABLE inventory_movements
    ADD CONSTRAINT inventory_quantity_nonzero_check
    CHECK (
      quantity_delta <> 0
      OR movement_type = 'opening_balance'
    );
  `);

    await knex.schema.raw(`
    ALTER TABLE inventory_movements
    ADD CONSTRAINT inventory_movement_sign_check
    CHECK (
      (
        movement_type IN (
          'inbound_purchase',
          'refund_return',
          'manual_adjustment',
          'reconciliation_correction',
          'reservation_hold'
        )
        AND quantity_delta > 0
      )
      OR
      (
        movement_type IN (
          'sale',
          'damage',
          'shrinkage',
          'reservation_release'
        )
        AND quantity_delta < 0
      )
      OR
      (
        movement_type = 'opening_balance'
      )
    )
  `);

  // ─────────────────────────────────────────
  // 2️⃣b Enforce Append-Only Ledger Behavior
  // ─────────────────────────────────────────
  await knex.schema.raw(`
    CREATE OR REPLACE FUNCTION prevent_inventory_movements_mutation()
    RETURNS trigger AS $$
    BEGIN
      RAISE EXCEPTION 'inventory_movements is append-only. % is not allowed.', TG_OP;
    END;
    $$ LANGUAGE plpgsql;

    CREATE TRIGGER inventory_movements_no_update
    BEFORE UPDATE ON inventory_movements
    FOR EACH ROW
    EXECUTE FUNCTION prevent_inventory_movements_mutation();

    CREATE TRIGGER inventory_movements_no_delete
    BEFORE DELETE ON inventory_movements
    FOR EACH ROW
    EXECUTE FUNCTION prevent_inventory_movements_mutation();
  `);

  // --- RLS: Enforce tenant isolation (direct) ---
  // shop_id is authoritative tenant anchor.
  // NEVER use relational enforcement when direct column exists.
  // Ledger is a high-risk cross-tenant surface.
  await knex.raw(`
    ALTER TABLE inventory_movements ENABLE ROW LEVEL SECURITY;
    ALTER TABLE inventory_movements FORCE ROW LEVEL SECURITY;
  `);

  await knex.raw(`
    DROP POLICY IF EXISTS inventory_movements_tenant_isolation_policy ON inventory_movements;
  `);

  // IMPORTANT:
  // shop_id exists → MUST use direct enforcement
  // Never fallback to relational enforcement when direct column is present
  // Ensures consistency, performance, and invariant clarity
  await knex.raw(`
    CREATE POLICY inventory_movements_tenant_isolation_policy
    ON inventory_movements
    USING (
      shop_id = current_setting('app.current_tenant')::int
    );
  `);

  // ─────────────────────────────────────────
  // 3️⃣ inventory_truth (Deterministic Projection)
  // ─────────────────────────────────────────
  await knex.schema.createTable('inventory_truth', (table) => {
    table
      .integer('shop_id')
      .notNullable()
      .references('id')
      .inTable('shops')
      .onDelete('CASCADE');

    table
      .uuid('lasyncro_variant_id')
      .notNullable()
      .references('lasyncro_variant_id')
      .inTable('variants')
      .onDelete('CASCADE');

    table
      .string('location_code', 255)
      .notNullable();

    table.primary([
      'shop_id',
      'lasyncro_variant_id',
      'location_code',
    ]);

    table.integer('on_hand_quantity').notNullable();
    table.integer('reserved_quantity').notNullable().defaultTo(0);
    table.integer('committed_quantity').notNullable().defaultTo(0);

    table.integer('available_quantity').notNullable();
    table.integer('sellable_quantity').notNullable();

    table
      .timestamp('last_evaluated_at', { useTz: true })
      .notNullable();

    table.timestamp('created_at', { useTz: true }).defaultTo(knex.fn.now());
    table.timestamp('updated_at', { useTz: true }).defaultTo(knex.fn.now());
  });

  // --- RLS: Enforce tenant isolation (direct) ---
  // inventory_truth is a projection but still tenant-bound.
  // MUST enforce isolation to prevent cross-tenant reads.
  await knex.raw(`
    ALTER TABLE inventory_truth ENABLE ROW LEVEL SECURITY;
    ALTER TABLE inventory_truth FORCE ROW LEVEL SECURITY;
  `);

  await knex.raw(`
    DROP POLICY IF EXISTS inventory_truth_tenant_isolation_policy ON inventory_truth;
  `);

  await knex.raw(`
    CREATE POLICY inventory_truth_tenant_isolation_policy
    ON inventory_truth
    USING (
      shop_id = current_setting('app.current_tenant')::int
    );
  `);

  // 4️⃣ order_reconciliation_intents (Versioned Publish Barrier)
  await knex.schema.createTable('order_reconciliation_intents', (table) => {
    table
      .uuid('reconciliation_intent_id')
      .primary()
      .notNullable()
      .defaultTo(knex.raw('gen_random_uuid()'));

    table
      .uuid('lasyncro_order_id')
      .notNullable()
      .references('lasyncro_order_id')
      .inTable('orders')
      .onDelete('CASCADE');

    /**
     * VERSION CONTRACT
     * -----------------
     * Intent is tied to specific aggregate_version.
     * Guarantees monotonic reconciliation dispatch.
     */
    table
      .integer('aggregate_version')
      .notNullable();

    /**
     * Optional observed payload (serialized JSON).
     * Kept nullable for structural flexibility.
     */
    table
      .jsonb('observed')
      .nullable();

    table
      .timestamp('created_at', { useTz: true })
      .notNullable()
      .defaultTo(knex.fn.now());

    /**
     * MUTATION TRACKING (REQUIRED)
     * ----------------------------
     * Required for ON CONFLICT DO UPDATE in reconciliation writes.
     */
    table
      .timestamp('updated_at', { useTz: true })
      .notNullable()
      .defaultTo(knex.fn.now());

    /**
     * Uniqueness must be version-scoped.
     * Multiple reconciliation waves per order allowed.
     */
    table.unique(
      ['lasyncro_order_id', 'aggregate_version'],
      'order_reconciliation_version_unique'
    );

    table.index(['lasyncro_order_id']);
  });
}

export async function down(knex: Knex): Promise<void> {

  // Drop reconciliation barrier first (FK to orders)
  await knex.schema.dropTableIfExists('order_reconciliation_intents');

  // Drop projection
  await knex.schema.dropTableIfExists('inventory_truth');

  // Drop ledger triggers + function
  await knex.schema.raw(`
    DROP TRIGGER IF EXISTS inventory_movements_no_update ON inventory_movements;
    DROP TRIGGER IF EXISTS inventory_movements_no_delete ON inventory_movements;
    DROP FUNCTION IF EXISTS prevent_inventory_movements_mutation();
  `);

  // Drop ledger
  await knex.schema.dropTableIfExists('inventory_movements');

  // Drop enum
  await knex.schema.raw(`
    DROP TYPE IF EXISTS inventory_movement_type;
  `);
}

