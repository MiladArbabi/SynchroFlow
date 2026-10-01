import type { Knex } from 'knex';

/**
 * MIGRATION 0200 — opening inventory Shopify on_hand snapshot (GH-1179)
 * ---------------------------------------------------------------------
 *
 * Immutable, location-scoped evidence of Shopify on_hand captured when
 * Opening Inventory starts. It is provenance only, never delta arithmetic.
 *
 * Header: opening_inventory_shopify_snapshots
 *   One row per collection attempt for one shop, frozen to exactly one
 *   warehouse and its mapped Shopify Location. Every attempt is born
 *   'collecting' (holding a lease) and ends in exactly one terminal state:
 *     complete  — every Location.inventoryLevels page persisted
 *     failed    — provider/validation failure; no lines persist
 *     abandoned — lease expired and the scope was re-reserved
 *   At most one collecting/complete attempt exists per shop.
 *
 * Lines: opening_inventory_shopify_snapshot_lines
 *   One row per Shopify inventory level. Inserted only while the parent is
 *   collecting; the finalizing transaction inserts all lines and then marks
 *   the parent complete. A missing level is inventory_level_present=false
 *   with NULL on_hand, never zero. on_hand is the raw signed observation.
 *
 * Durable evidence: identity is immutable, terminal rows are immutable,
 * lines are append-only, and DELETE is forbidden. Tenant ownership is
 * enforced by composite FKs, not by RLS alone.
 *
 * shopify_opening_inventory_expectations and the cutover tables are
 * untouched.
 */

const SNAPSHOTS = 'opening_inventory_shopify_snapshots';
const LINES = 'opening_inventory_shopify_snapshot_lines';

export async function up(knex: Knex): Promise<void> {
  // warehouse_id is the global PK; the composite key lets snapshot rows
  // reference a warehouse of the SAME shop.
  await knex.schema.alterTable('warehouses', (table) => {
    table.unique(
      ['shop_id', 'warehouse_id'],
      'warehouses_shop_warehouse_unique'
    );
  });

  await knex.schema.createTable(SNAPSHOTS, (table) => {
    table.uuid('snapshot_id').primary();

    table
      .integer('shop_id')
      .notNullable()
      .references('id')
      .inTable('shops')
      .onDelete('CASCADE');

    table.uuid('warehouse_id').notNullable();
    table.text('shopify_location_id').notNullable();
    table.integer('attempt_number').notNullable();
    table.text('status').notNullable().defaultTo('collecting');
    table.uuid('collection_token').notNullable();

    table
      .timestamp('collection_started_at', { useTz: true })
      .notNullable();
    table.timestamp('lease_expires_at', { useTz: true }).nullable();
    table.timestamp('completed_at', { useTz: true }).nullable();

    table.integer('line_count').nullable();
    table.integer('page_count').nullable();

    table.text('shopify_api_version').notNullable();
    table.text('failure_code').nullable();

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
        ['shop_id', 'warehouse_id'],
        'opening_inventory_shopify_snapshots_warehouse_fk'
      )
      .references(['shop_id', 'warehouse_id'])
      .inTable('warehouses');

    table.unique(
      ['shop_id', 'attempt_number'],
      'opening_inventory_shopify_snapshots_attempt_unique'
    );

    table.unique(
      ['snapshot_id', 'shop_id'],
      'opening_inventory_shopify_snapshots_snapshot_shop_unique'
    );
  });

  await knex.raw(`
    ALTER TABLE opening_inventory_shopify_snapshots
      ADD CONSTRAINT opening_inventory_shopify_snapshots_status_check
      CHECK (
        status IN ('collecting', 'complete', 'failed', 'abandoned')
      ),

      ADD CONSTRAINT opening_inventory_shopify_snapshots_location_gid_check
      CHECK (
        shopify_location_id ~ '^gid://shopify/Location/[0-9]+$'
      ),

      ADD CONSTRAINT opening_inventory_shopify_snapshots_attempt_check
      CHECK (
        attempt_number >= 1
      ),

      ADD CONSTRAINT opening_inventory_shopify_snapshots_lease_check
      CHECK (
        status <> 'collecting'
        OR lease_expires_at IS NOT NULL
      ),

      ADD CONSTRAINT opening_inventory_shopify_snapshots_completion_check
      CHECK (
        (status = 'complete') = (completed_at IS NOT NULL)
      ),

      ADD CONSTRAINT opening_inventory_shopify_snapshots_counts_check
      CHECK (
        (line_count IS NULL OR line_count >= 0)
        AND (page_count IS NULL OR page_count >= 0)
        AND (
          status <> 'complete'
          OR (line_count IS NOT NULL AND page_count IS NOT NULL)
        )
      );

    CREATE UNIQUE INDEX opening_inventory_shopify_snapshots_live_unique
      ON opening_inventory_shopify_snapshots (shop_id)
      WHERE status IN ('collecting', 'complete');
  `);

  await knex.schema.createTable(LINES, (table) => {
    table.bigIncrements('id').primary();

    table.uuid('snapshot_id').notNullable();
    table.integer('shop_id').notNullable();

    table.text('shopify_inventory_item_id').notNullable();
    table.text('shopify_variant_id').nullable();
    table.uuid('lasyncro_variant_id').nullable();

    table.boolean('inventory_level_present').notNullable();
    table.boolean('inventory_level_active').nullable();
    table.boolean('tracked').nullable();

    // Raw signed Shopify observation: zero and negative are valid evidence.
    table.integer('on_hand_quantity').nullable();

    table
      .timestamp('created_at', { useTz: true })
      .notNullable()
      .defaultTo(knex.fn.now());

    table
      .foreign(
        ['snapshot_id', 'shop_id'],
        'opening_inventory_shopify_snapshot_lines_snapshot_fk'
      )
      .references(['snapshot_id', 'shop_id'])
      .inTable(SNAPSHOTS);

    table.unique(
      ['snapshot_id', 'shopify_inventory_item_id'],
      'opening_inventory_shopify_snapshot_lines_item_unique'
    );
  });

  await knex.raw(`
    ALTER TABLE opening_inventory_shopify_snapshot_lines
      ADD CONSTRAINT opening_inventory_shopify_snapshot_lines_item_gid_check
      CHECK (
        shopify_inventory_item_id ~ '^gid://shopify/InventoryItem/[0-9]+$'
      ),

      ADD CONSTRAINT opening_inventory_shopify_snapshot_lines_level_check
      CHECK (
        inventory_level_present = (on_hand_quantity IS NOT NULL)
      );

    CREATE UNIQUE INDEX opening_inventory_shopify_snapshot_lines_variant_unique
      ON opening_inventory_shopify_snapshot_lines (snapshot_id, lasyncro_variant_id)
      WHERE lasyncro_variant_id IS NOT NULL;
  `);

  await knex.raw(`
    CREATE OR REPLACE FUNCTION guard_opening_inventory_shopify_snapshot_insert()
    RETURNS trigger AS $$
    BEGIN
      IF NEW.status <> 'collecting' THEN
        RAISE EXCEPTION
          '[OPENING_INVENTORY_SNAPSHOT_STATE] a snapshot attempt must begin collecting';
      END IF;

      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;

    CREATE TRIGGER opening_inventory_shopify_snapshots_insert_guard
    BEFORE INSERT ON opening_inventory_shopify_snapshots
    FOR EACH ROW
    EXECUTE FUNCTION guard_opening_inventory_shopify_snapshot_insert();

    CREATE OR REPLACE FUNCTION guard_opening_inventory_shopify_snapshot_update()
    RETURNS trigger AS $$
    BEGIN
      IF
        NEW.snapshot_id IS DISTINCT FROM OLD.snapshot_id
        OR NEW.shop_id IS DISTINCT FROM OLD.shop_id
        OR NEW.warehouse_id IS DISTINCT FROM OLD.warehouse_id
        OR NEW.shopify_location_id IS DISTINCT FROM OLD.shopify_location_id
        OR NEW.attempt_number IS DISTINCT FROM OLD.attempt_number
        OR NEW.collection_token IS DISTINCT FROM OLD.collection_token
        OR NEW.collection_started_at IS DISTINCT FROM OLD.collection_started_at
        OR NEW.shopify_api_version IS DISTINCT FROM OLD.shopify_api_version
        OR NEW.created_at IS DISTINCT FROM OLD.created_at
      THEN
        RAISE EXCEPTION
          '[OPENING_INVENTORY_SNAPSHOT_IMMUTABLE] snapshot identity cannot be changed';
      END IF;

      IF OLD.status <> 'collecting' THEN
        RAISE EXCEPTION
          '[OPENING_INVENTORY_SNAPSHOT_TERMINAL] terminal snapshot cannot be changed';
      END IF;

      -- While still collecting, only the lease heartbeat may change.
      IF
        NEW.status = 'collecting'
        AND (
          NEW.completed_at IS DISTINCT FROM OLD.completed_at
          OR NEW.line_count IS DISTINCT FROM OLD.line_count
          OR NEW.page_count IS DISTINCT FROM OLD.page_count
          OR NEW.failure_code IS DISTINCT FROM OLD.failure_code
        )
      THEN
        RAISE EXCEPTION
          '[OPENING_INVENTORY_SNAPSHOT_STATE] a collecting snapshot may only refresh its lease';
      END IF;

      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;

    CREATE TRIGGER opening_inventory_shopify_snapshots_update_guard
    BEFORE UPDATE ON opening_inventory_shopify_snapshots
    FOR EACH ROW
    EXECUTE FUNCTION guard_opening_inventory_shopify_snapshot_update();
  `);

  await knex.raw(`
    CREATE OR REPLACE FUNCTION guard_opening_inventory_shopify_snapshot_line_insert()
    RETURNS trigger AS $$
    DECLARE
      parent_status text;
    BEGIN
      -- FOR SHARE serializes against the parent's terminal transition.
      SELECT status
        INTO parent_status
        FROM opening_inventory_shopify_snapshots
       WHERE snapshot_id = NEW.snapshot_id
         AND shop_id = NEW.shop_id
         FOR SHARE;

      IF parent_status IS DISTINCT FROM 'collecting' THEN
        RAISE EXCEPTION
          '[OPENING_INVENTORY_SNAPSHOT_LINE_STATE] lines may only be added to a collecting snapshot';
      END IF;

      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;

    CREATE TRIGGER opening_inventory_shopify_snapshot_lines_insert_guard
    BEFORE INSERT ON opening_inventory_shopify_snapshot_lines
    FOR EACH ROW
    EXECUTE FUNCTION guard_opening_inventory_shopify_snapshot_line_insert();

    CREATE OR REPLACE FUNCTION prevent_opening_inventory_shopify_snapshot_line_update()
    RETURNS trigger AS $$
    BEGIN
      RAISE EXCEPTION
        '[OPENING_INVENTORY_SNAPSHOT_LINE_IMMUTABLE] snapshot lines cannot be changed';
    END;
    $$ LANGUAGE plpgsql;

    CREATE TRIGGER opening_inventory_shopify_snapshot_lines_immutable
    BEFORE UPDATE ON opening_inventory_shopify_snapshot_lines
    FOR EACH ROW
    EXECUTE FUNCTION prevent_opening_inventory_shopify_snapshot_line_update();
  `);

  await knex.raw(`
    CREATE OR REPLACE FUNCTION prevent_opening_inventory_shopify_snapshot_delete()
    RETURNS trigger AS $$
    BEGIN
      RAISE EXCEPTION
        '[OPENING_INVENTORY_SNAPSHOT_DELETE_BLOCKED] durable snapshot evidence cannot be deleted';
    END;
    $$ LANGUAGE plpgsql;

    CREATE TRIGGER opening_inventory_shopify_snapshots_no_delete
    BEFORE DELETE ON opening_inventory_shopify_snapshots
    FOR EACH ROW
    EXECUTE FUNCTION prevent_opening_inventory_shopify_snapshot_delete();

    CREATE TRIGGER opening_inventory_shopify_snapshot_lines_no_delete
    BEFORE DELETE ON opening_inventory_shopify_snapshot_lines
    FOR EACH ROW
    EXECUTE FUNCTION prevent_opening_inventory_shopify_snapshot_delete();
  `);

  for (const table of [SNAPSHOTS, LINES]) {
    await knex.raw(`ALTER TABLE ?? ENABLE ROW LEVEL SECURITY`, [table]);
    await knex.raw(`ALTER TABLE ?? FORCE ROW LEVEL SECURITY`, [table]);
  }

  await knex.raw(`
    CREATE POLICY opening_inventory_shopify_snapshots_tenant_isolation_policy
    ON opening_inventory_shopify_snapshots
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
    CREATE POLICY opening_inventory_shopify_snapshot_lines_tenant_isolation_policy
    ON opening_inventory_shopify_snapshot_lines
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
  const existingSnapshot = await knex(SNAPSHOTS).first('snapshot_id');

  if (existingSnapshot) {
    throw new Error(
      '[MIGRATION_0200_DOWN_BLOCKED] Cannot remove opening-inventory Shopify snapshot persistence while snapshot evidence exists'
    );
  }

  await knex.raw(`
    DROP TRIGGER IF EXISTS opening_inventory_shopify_snapshot_lines_no_delete
      ON opening_inventory_shopify_snapshot_lines;

    DROP TRIGGER IF EXISTS opening_inventory_shopify_snapshot_lines_immutable
      ON opening_inventory_shopify_snapshot_lines;

    DROP TRIGGER IF EXISTS opening_inventory_shopify_snapshot_lines_insert_guard
      ON opening_inventory_shopify_snapshot_lines;

    DROP TRIGGER IF EXISTS opening_inventory_shopify_snapshots_no_delete
      ON opening_inventory_shopify_snapshots;

    DROP TRIGGER IF EXISTS opening_inventory_shopify_snapshots_update_guard
      ON opening_inventory_shopify_snapshots;

    DROP TRIGGER IF EXISTS opening_inventory_shopify_snapshots_insert_guard
      ON opening_inventory_shopify_snapshots;
  `);

  await knex.raw(`
    DROP FUNCTION IF EXISTS prevent_opening_inventory_shopify_snapshot_delete();
    DROP FUNCTION IF EXISTS prevent_opening_inventory_shopify_snapshot_line_update();
    DROP FUNCTION IF EXISTS guard_opening_inventory_shopify_snapshot_line_insert();
    DROP FUNCTION IF EXISTS guard_opening_inventory_shopify_snapshot_update();
    DROP FUNCTION IF EXISTS guard_opening_inventory_shopify_snapshot_insert();
  `);

  await knex.schema.dropTableIfExists(LINES);
  await knex.schema.dropTableIfExists(SNAPSHOTS);

  await knex.schema.alterTable('warehouses', (table) => {
    table.dropUnique(
      ['shop_id', 'warehouse_id'],
      'warehouses_shop_warehouse_unique'
    );
  });
}
