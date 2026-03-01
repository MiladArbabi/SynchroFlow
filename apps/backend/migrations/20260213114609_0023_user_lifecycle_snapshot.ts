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
}


export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('user_lifecycle_snapshot');
}
