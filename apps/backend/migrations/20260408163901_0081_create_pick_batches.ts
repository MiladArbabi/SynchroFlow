import { Knex } from 'knex';

/**
 * MIGRATION 0081 — create_pick_batches
 * -------------------------------------
 * Pick batch is the atomic unit of work released from the order pool.
 *
 * Invariants:
 * - Full orders only — no split orders across batches
 * - Max line-item ceiling is configurable per release
 * - Single owner at a time — claimed_by enforces exclusive access
 * - Picker and packer are independent operators
 * - release_trigger distinguishes auto vs manual release
 * - UPH derivable: units_picked / (pick_completed_at - pick_claimed_at)
 */
export async function up(knex: Knex): Promise<void> {

  await knex.raw(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_type WHERE typname = 'pick_batch_status'
      ) THEN
        CREATE TYPE pick_batch_status AS ENUM (
          'pending',
          'picking',
          'pick_complete',
          'packing',
          'pack_complete',
          'cancelled'
        );
      END IF;
    END$$;
  `);

  await knex.raw(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_type WHERE typname = 'batch_release_trigger'
      ) THEN
        CREATE TYPE batch_release_trigger AS ENUM (
          'auto',
          'manual'
        );
      END IF;
    END$$;
  `);

  await knex.schema.createTable('pick_batches', (table) => {
    table
      .uuid('pick_batch_id')
      .primary()
      .notNullable()
      .defaultTo(knex.raw('gen_random_uuid()'));

    table
      .integer('shop_id')
      .notNullable()
      .references('id')
      .inTable('shops')
      .onDelete('CASCADE');

    table
      .specificType('status', 'pick_batch_status')
      .notNullable()
      .defaultTo('pending');

    table
      .specificType('release_trigger', 'batch_release_trigger')
      .notNullable();

    /**
     * Max line-items allowed in this batch at release time.
     * Configurable — captured at release, not derived.
     */
    table
      .integer('max_line_items')
      .notNullable();

    table
      .integer('total_line_items')
      .notNullable();

    table
      .integer('total_units')
      .notNullable();

    /**
     * PICKER
     * ------
     * Claimed exclusively — no two operators may pick the same batch.
     * pick_claimed_at used for idle alert threshold.
     * pick_completed_at used for UPH computation.
     */
    table
      .integer('picked_by')
      .nullable()
      .references('id')
      .inTable('users')
      .onDelete('SET NULL');

    table.timestamp('pick_claimed_at', { useTz: true }).nullable();
    table.timestamp('pick_last_activity_at', { useTz: true }).nullable();
    table.timestamp('pick_completed_at', { useTz: true }).nullable();
    table.integer('units_picked').notNullable().defaultTo(0);

    /**
     * PACKER
     * ------
     * Independent operator from picker.
     * Claimable after status = pick_complete.
     */
    table
      .integer('packed_by')
      .nullable()
      .references('id')
      .inTable('users')
      .onDelete('SET NULL');

    table.timestamp('pack_claimed_at', { useTz: true }).nullable();
    table.timestamp('pack_last_activity_at', { useTz: true }).nullable();
    table.timestamp('pack_completed_at', { useTz: true }).nullable();
    table.integer('units_packed').notNullable().defaultTo(0);

    /**
     * RELEASE
     * -------
     * released_by is nullable — null means auto-released by worker.
     */
    table
      .integer('released_by')
      .nullable()
      .references('id')
      .inTable('users')
      .onDelete('SET NULL');

    table.timestamp('released_at', { useTz: true }).notNullable();

    table.timestamp('created_at', { useTz: true })
      .notNullable()
      .defaultTo(knex.fn.now());

    table.timestamp('updated_at', { useTz: true })
      .notNullable()
      .defaultTo(knex.fn.now());

    table.index(['shop_id']);
    table.index(['shop_id', 'status']);
    table.index(['picked_by']);
    table.index(['packed_by']);
  });

  await knex.raw(`
    ALTER TABLE pick_batches ENABLE ROW LEVEL SECURITY;
    ALTER TABLE pick_batches FORCE ROW LEVEL SECURITY;
  `);

  await knex.raw(`
    DROP POLICY IF EXISTS pick_batches_tenant_isolation_policy ON pick_batches;
  `);

  await knex.raw(`
    CREATE POLICY pick_batches_tenant_isolation_policy
    ON pick_batches
    USING (
      shop_id = current_setting('app.current_tenant')::int
    );
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('pick_batches');

  await knex.raw(`DROP TYPE IF EXISTS pick_batch_status;`);
  await knex.raw(`DROP TYPE IF EXISTS batch_release_trigger;`);
}