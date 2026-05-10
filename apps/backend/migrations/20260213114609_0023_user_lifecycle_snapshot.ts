//apps/backend/migrations/20251224092507_create_user_lifecycle_snapshot.ts
import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('user_lifecycle_snapshot', table => {
    /**
     * DESIGN CONTRACT (v3):
     * Lifecycle is SHOP-SCOPED.
     * One lifecycle state per shop.
     *
     * user_id is retained for audit reference only.
     * shop_id is the authoritative uniqueness boundary.
     */
    table
      .integer('shop_id')
      .notNullable()
      .primary()
      .references('id')
      .inTable('shops')
      .onDelete('CASCADE');

    table
      .integer('user_id')
      .notNullable()
      .references('id')
      .inTable('users')
      .onDelete('CASCADE');

    table
      .string('phase', 32)
      .notNullable();

    /**
     * 🟡 LIFECYCLE SUBPHASE (v2)
     * --------------------------
     * - Only meaningful for FT0
     * - Written ONLY by projection layer
     * - NEVER used for transitions
     * - Prevents sync_status leaking into frontend
     */
    table
      .string('subphase', 32)
      .nullable();

    table
      .timestamp('since', { useTz: true })
      .notNullable();

    /**
     * last_event_id
     * -------------
     * UUID reference to lifecycle_events.event_id.
     * No FK constraint to avoid migration order coupling.
     * Consistency enforced at projection layer.
     */
    table
      .uuid('last_event_id')
      .notNullable();

    table
      .timestamp('updated_at', { useTz: true })
      .notNullable()
      .defaultTo(knex.fn.now());

    table.index(['phase'], 'user_lifecycle_snapshot_phase_idx');
  });

  await knex.raw(`
    ALTER TABLE user_lifecycle_snapshot
    ADD CONSTRAINT lifecycle_phase_valid
    CHECK (phase IN ('FT_MINUS_ONE', 'FT0', 'FT1', 'FT2'))
  `);

  // --- RLS: Enforce tenant isolation (direct via shop_id) ---
  // shop_id is PRIMARY KEY and canonical tenant boundary → safe direct enforcement
  await knex.raw(`
    ALTER TABLE user_lifecycle_snapshot ENABLE ROW LEVEL SECURITY;
    ALTER TABLE user_lifecycle_snapshot FORCE ROW LEVEL SECURITY;
  `);

  await knex.raw(`
    DROP POLICY IF EXISTS user_lifecycle_snapshot_tenant_isolation_policy ON user_lifecycle_snapshot;
    DROP POLICY IF EXISTS user_lifecycle_snapshot_select_policy ON user_lifecycle_snapshot;
    DROP POLICY IF EXISTS user_lifecycle_snapshot_write_policy ON user_lifecycle_snapshot;
  `);

  await knex.raw(`
    CREATE POLICY user_lifecycle_snapshot_select_policy
    ON user_lifecycle_snapshot FOR SELECT
    USING (
      shop_id = current_setting('app.current_tenant', true)::int
      OR current_setting('app.current_tenant', true) IN ('', '0')
      OR current_setting('app.current_tenant', true) IS NULL
    );
  `);
  await knex.raw(`
    CREATE POLICY user_lifecycle_snapshot_write_policy
    ON user_lifecycle_snapshot FOR ALL
    USING (shop_id = current_setting('app.current_tenant', true)::int)
    WITH CHECK (shop_id = current_setting('app.current_tenant', true)::int);
  `);
}


export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('user_lifecycle_snapshot');
}
