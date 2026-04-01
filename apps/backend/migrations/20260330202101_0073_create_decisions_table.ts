import { Knex } from 'knex';

/**
 * DECISIONS TABLE (SOURCE OF TRUTH)
 * --------------------------------
 * Stores all system-generated decisions.
 *
 * RULES:
 * - Only Decision Engine writes here
 * - Controllers/services must NEVER construct decisions directly
 * - Enables lifecycle tracking + auditability
 */

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('decisions', (table) => {
    table.uuid('id').primary();

    table.string('type').notNullable();
    table.string('entity_id').notNullable();

    table.integer('aggregate_version').notNullable();

    /**
     * GLOBAL PRIORITY
     * Higher = more important
     */
    table.float('priority').notNullable();

    /**
     * Debuggable scoring breakdown
     */
    table.jsonb('score_breakdown').notNullable();

    /**
     * Human-readable explanation
     */
    table.text('reason').notNullable();

    /**
     * Raw input signals
     */
    table.jsonb('signals').notNullable();

    /**
     * Actions
     */
    table.jsonb('recommended_action').notNullable();
    table.jsonb('actions').notNullable();

    /**
     * Lifecycle status
     */
    table
      .enu('status', ['pending', 'in_progress', 'resolved', 'dismissed'], {
        useNative: true,
        enumName: 'decision_status',
      })
      .notNullable()
      .defaultTo('pending');

    /**
     * DECISION LIFECYCLE (STRUCTURED)
     * -------------------------------
     * Tracks execution + outcome over time.
     *
     * Stored as JSONB for flexibility:
     * - started_at
     * - resolved_at
     * - outcome
     */
    table.jsonb('lifecycle').notNullable().defaultTo('{}');

    table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());

    /**
     * TENANT IDENTITY (CRITICAL)
     * --------------------------
     * MUST be integer to match RLS system:
     * current_setting('app.current_tenant')::int
     *
     * If mismatched → RLS will fail at runtime
     */
    table.integer('shop_id').notNullable();

    /**
     * Indexes for performance
     */
    table.index(['shop_id', 'priority'], 'idx_decisions_shop_priority');
    table.index(['entity_id', 'aggregate_version'], 'idx_decisions_entity_version');
  });

  /**
   * ROW LEVEL SECURITY (MANDATORY)
   * ------------------------------
   * Enforces strict tenant isolation.
   * Pattern MUST match all other tables.
   */
  await knex.raw(`
    ALTER TABLE decisions ENABLE ROW LEVEL SECURITY;
  `);

  await knex.raw(`
    DROP POLICY IF EXISTS decisions_tenant_isolation ON decisions;
  `);

  await knex.raw(`
    CREATE POLICY decisions_tenant_isolation
    ON decisions
    USING (shop_id = current_setting('app.current_tenant')::int);
  `);

  /**
 * DATA INTEGRITY CONSTRAINTS
 * --------------------------
 * Prevent invalid decisions entering the system.
 * Decisions are SYSTEM-CRITICAL → must be strict.
 */
await knex.raw(`
  ALTER TABLE decisions
  ADD CONSTRAINT decisions_type_check
  CHECK (type IN ('operational', 'financial', 'risk'));
`);

await knex.raw(`
  ALTER TABLE decisions
  ADD CONSTRAINT decisions_priority_check
  CHECK (priority >= 0);
`);

await knex.raw(`
  ALTER TABLE decisions
  ADD CONSTRAINT decisions_signals_not_empty
  CHECK (jsonb_typeof(signals) = 'object');
`);

await knex.raw(`
  ALTER TABLE decisions
  ADD CONSTRAINT decisions_actions_not_empty
  CHECK (jsonb_typeof(actions) = 'array');
`);

await knex.raw(`
  ALTER TABLE decisions
  ADD CONSTRAINT decisions_lifecycle_is_object
  CHECK (jsonb_typeof(lifecycle) = 'object');
`);

/**
 * AGGREGATE VERSION BINDING (CRITICAL)
 * -----------------------------------
 * Links decision to exact reconciliation version.
 *
 * Required for:
 * - deterministic replay
 * - checkpoint validation
 * - eliminating JSON-based version lookup
 */
await knex.raw(`
  ALTER TABLE decisions
  ADD CONSTRAINT decisions_aggregate_version_positive
  CHECK (aggregate_version > 0);
`);

/**
 * UPDATED_AT TRIGGER (MANDATORY)
 * ------------------------------
 * Ensures lifecycle tracking is always accurate.
 */
await knex.raw(`
  CREATE OR REPLACE FUNCTION set_decisions_updated_at()
  RETURNS TRIGGER AS $$
  BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
  END;
  $$ LANGUAGE plpgsql;
`);

await knex.raw(`
  CREATE TRIGGER trg_set_decisions_updated_at
  BEFORE UPDATE ON decisions
  FOR EACH ROW
  EXECUTE FUNCTION set_decisions_updated_at();
`);

}

export async function down(knex: Knex): Promise<void> {
    await knex.raw(`
    DROP TRIGGER IF EXISTS trg_set_decisions_updated_at ON decisions;
    `);

    await knex.raw(`
    DROP FUNCTION IF EXISTS set_decisions_updated_at;
    `);

    await knex.raw(`
    ALTER TABLE decisions DROP CONSTRAINT IF EXISTS decisions_type_check;
    `);

    await knex.raw(`
    ALTER TABLE decisions DROP CONSTRAINT IF EXISTS decisions_priority_check;
    `);

    await knex.raw(`
    ALTER TABLE decisions DROP CONSTRAINT IF EXISTS decisions_signals_not_empty;
    `);

    await knex.raw(`
    ALTER TABLE decisions DROP CONSTRAINT IF EXISTS decisions_actions_not_empty;
    `);

    await knex.raw(`
    DROP POLICY IF EXISTS decisions_tenant_isolation ON decisions;
    `);

    await knex.schema.dropTableIfExists('decisions');
    await knex.raw('DROP TYPE IF EXISTS decision_status');
}