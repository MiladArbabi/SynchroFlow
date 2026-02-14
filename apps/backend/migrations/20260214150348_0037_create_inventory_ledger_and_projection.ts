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

    table.string('reference_type', 255).notNullable();
    table.string('reference_id', 255).notNullable();

    table.string('platform', 255).nullable();
    table.string('location_code', 255).nullable();

    table.timestamp('occurred_at', { useTz: true }).notNullable();
    table.timestamp('created_at', { useTz: true }).defaultTo(knex.fn.now());

    // Invariants
    table.unique(
      ['reference_type', 'reference_id', 'lasyncro_variant_id'],
      'inventory_movements_reference_unique'
    );

    table.index('lasyncro_variant_id');
    table.index('occurred_at');
    table.index(['lasyncro_variant_id', 'occurred_at']);
  });

  await knex.schema.raw(`
    ALTER TABLE inventory_movements
    ADD CONSTRAINT inventory_quantity_nonzero_check
    CHECK (quantity_delta <> 0);
  `);

  // ─────────────────────────────────────────
  // 3️⃣ inventory_truth (Deterministic Projection)
  // ─────────────────────────────────────────
  await knex.schema.createTable('inventory_truth', (table) => {
    table
      .uuid('lasyncro_variant_id')
      .primary()
      .notNullable()
      .references('lasyncro_variant_id')
      .inTable('variants')
      .onDelete('CASCADE');

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
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('inventory_truth');
  await knex.schema.dropTableIfExists('inventory_movements');
  await knex.schema.raw(`
    DROP TYPE IF EXISTS inventory_movement_type;
  `);
}
