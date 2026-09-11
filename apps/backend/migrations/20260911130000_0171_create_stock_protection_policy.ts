import type { Knex } from 'knex';

/**
 * MIGRATION 0171 — create_stock_protection_policy
 * ----------------------------------------------------------------------------
 * STOCK-PROTECT-01 — durable merchant-approved Stock Protection Policy.
 *
 * stock_protection_policies holds ONLY merchant-authoritative planning
 * configuration for a shop+variant: safety_days, review_cycle_days, an
 * explicit planning_supplier_id anchor, version, and approval provenance.
 * Derived intelligence (velocity, current stock, buffer units, reorder
 * point, stockout date, suggested reorder qty, urgency) is computed at read
 * time by demandIntelligence.service.ts and is NEVER written here — storing
 * it as "current policy" would let a stale recommendation silently become
 * future planning authority.
 *
 * A shop+variant with NO row here is not "unconfigured" — it has an
 * EFFECTIVE policy of safety_days=5 / review_cycle_days=7 / source=
 * system_default (apps/backend/src/services/inventory/
 * stockProtectionPolicyResolution.ts), preserving the legacy behaviour that
 * was previously hardcoded in demandIntelligence.service.ts's
 * SYSTEM_SAFETY_DAYS / SYSTEM_PURCHASING_CYCLE_DAYS constants.
 *
 * stock_protection_policy_transitions is the append-only provenance ledger:
 * every material change to current authoritative state writes exactly one
 * transition row, in the same transaction, recording the complete
 * before/after authoritative triple plus mandatory provenance and an
 * immutable recommendation_snapshot (historical evidence only — never
 * replayed as future planning input). A no-op resubmission writes no row.
 *
 * Follows the shop_subscription_transitions (0167) / decision_interventions
 * (0168) precedent: forced tenant RLS with the hardened
 * NULLIF(current_setting(...), '')::integer > 0 predicate, and a
 * BEFORE UPDATE/DELETE trigger making the transition ledger append-only at
 * the database level, independent of role.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('stock_protection_policies', (table) => {
    table.increments('id').primary();

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

    // Optimistic-concurrency token. Every material mutation increments this
    // by exactly 1; a caller must present the version it read to modify an
    // existing row (stockProtectionPolicy.service.ts).
    table.integer('version').notNullable().defaultTo(1);

    table.integer('safety_days').notNullable();
    table.integer('review_cycle_days').notNullable();

    // Explicit supplier anchor. NULL = no explicit planning supplier
    // configured — planning falls back to legacy most-recent-PO resolution.
    // ON DELETE SET NULL: a supplier record disappearing must never destroy
    // the safety_days/review_cycle_days authority the merchant approved.
    table
      .integer('planning_supplier_id')
      .nullable()
      .references('id')
      .inTable('suppliers')
      .onDelete('SET NULL');

    // Provenance of how the CURRENT row came to be approved (mirrors the
    // most recent transition's `source`, e.g. 'ui_approval').
    table.text('source').notNullable();
    table.text('approved_by_actor_type').notNullable();
    table.text('approved_by_actor_id').nullable();
    table.timestamp('approved_at', { useTz: true }).notNullable();

    table
      .timestamp('created_at', { useTz: true })
      .notNullable()
      .defaultTo(knex.fn.now());
    table
      .timestamp('updated_at', { useTz: true })
      .notNullable()
      .defaultTo(knex.fn.now());

    table.unique(['shop_id', 'lasyncro_variant_id'], 'stock_protection_policies_shop_variant_uidx');

    table.check('?? >= 0', ['safety_days'], 'stock_protection_policies_safety_days_nonneg');
    table.check('?? >= 0', ['review_cycle_days'], 'stock_protection_policies_review_cycle_days_nonneg');
    table.check('?? >= 1', ['version'], 'stock_protection_policies_version_positive');
  });

  await knex.schema.createTable('stock_protection_policy_transitions', (table) => {
    table.bigIncrements('id').primary();

    table
      .integer('shop_id')
      .notNullable()
      .references('id')
      .inTable('shops')
      .onDelete('CASCADE');

    // The current-policy row this transition applied to. Always known: the
    // current row is inserted/updated in the SAME transaction before this
    // ledger row is written (stockProtectionPolicy.service.ts).
    table
      .integer('policy_id')
      .notNullable()
      .references('id')
      .inTable('stock_protection_policies')
      .onDelete('CASCADE');

    table
      .uuid('lasyncro_variant_id')
      .notNullable()
      .references('lasyncro_variant_id')
      .inTable('variants')
      .onDelete('CASCADE');

    // Complete BEFORE/AFTER authoritative state. from_* are NULL only for the
    // creation transition (no prior approved policy existed).
    table.integer('from_version').nullable();
    table.integer('to_version').notNullable();
    table.integer('from_safety_days').nullable();
    table.integer('to_safety_days').notNullable();
    table.integer('from_review_cycle_days').nullable();
    table.integer('to_review_cycle_days').notNullable();
    table.integer('from_planning_supplier_id').nullable();
    table.integer('to_planning_supplier_id').nullable();

    // Mandatory provenance — an unattributable policy change is exactly the
    // condition this ledger exists to make impossible.
    table.text('source').notNullable();
    table.text('reason').notNullable();
    table.text('actor_type').notNullable();
    table.text('actor_id').nullable();

    // Immutable historical evidence of what LaSyncro recommended AT THE
    // MOMENT of this transition. Never read back as future planning input —
    // enforced by stockProtectionPolicyResolution.ts, which never accepts a
    // transition row as an input at all.
    table.jsonb('recommendation_snapshot').nullable();

    table.timestamp('occurred_at', { useTz: true }).notNullable();
    table
      .timestamp('created_at', { useTz: true })
      .notNullable()
      .defaultTo(knex.fn.now());

    // Per-variant history reads are the primary access path.
    table.index(['shop_id'], 'stock_protection_policy_transitions_shop_idx');
    table.index(
      ['shop_id', 'lasyncro_variant_id', 'occurred_at'],
      'stock_protection_policy_transitions_shop_variant_occurred_idx'
    );
  });

  await knex.raw(`
    ALTER TABLE stock_protection_policies
      ENABLE ROW LEVEL SECURITY;
    ALTER TABLE stock_protection_policies
      FORCE ROW LEVEL SECURITY;

    CREATE POLICY stock_protection_policies_tenant_isolation_policy
      ON stock_protection_policies
      FOR ALL
      USING (
        shop_id = NULLIF(current_setting('app.current_tenant', true), '')::integer
        AND NULLIF(current_setting('app.current_tenant', true), '')::integer > 0
      )
      WITH CHECK (
        shop_id = NULLIF(current_setting('app.current_tenant', true), '')::integer
        AND NULLIF(current_setting('app.current_tenant', true), '')::integer > 0
      );
  `);

  await knex.raw(`
    ALTER TABLE stock_protection_policy_transitions
      ENABLE ROW LEVEL SECURITY;
    ALTER TABLE stock_protection_policy_transitions
      FORCE ROW LEVEL SECURITY;

    CREATE POLICY stock_protection_policy_transitions_tenant_isolation_policy
      ON stock_protection_policy_transitions
      FOR ALL
      USING (
        shop_id = NULLIF(current_setting('app.current_tenant', true), '')::integer
        AND NULLIF(current_setting('app.current_tenant', true), '')::integer > 0
      )
      WITH CHECK (
        shop_id = NULLIF(current_setting('app.current_tenant', true), '')::integer
        AND NULLIF(current_setting('app.current_tenant', true), '')::integer > 0
      );
  `);

  /**
   * HARD APPEND-ONLY GUARD — mirrors 0167 / 0018. UPDATE and DELETE are
   * rejected at the database level for every role; INSERT stays permitted.
   */
  await knex.raw(`
    CREATE OR REPLACE FUNCTION prevent_stock_protection_policy_transition_mutation()
    RETURNS trigger AS $$
    BEGIN
      RAISE EXCEPTION
        '[IMMUTABILITY_VIOLATION] stock_protection_policy_transitions is append-only. % is not allowed.',
        TG_OP;
    END;
    $$ LANGUAGE plpgsql;
  `);

  await knex.raw(`
    CREATE TRIGGER stock_protection_policy_transitions_no_update
    BEFORE UPDATE ON stock_protection_policy_transitions
    FOR EACH ROW EXECUTE FUNCTION prevent_stock_protection_policy_transition_mutation();
  `);

  await knex.raw(`
    CREATE TRIGGER stock_protection_policy_transitions_no_delete
    BEFORE DELETE ON stock_protection_policy_transitions
    FOR EACH ROW EXECUTE FUNCTION prevent_stock_protection_policy_transition_mutation();
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw(`
    DROP TRIGGER IF EXISTS stock_protection_policy_transitions_no_delete
      ON stock_protection_policy_transitions;
    DROP TRIGGER IF EXISTS stock_protection_policy_transitions_no_update
      ON stock_protection_policy_transitions;
  `);
  await knex.raw(
    `DROP FUNCTION IF EXISTS prevent_stock_protection_policy_transition_mutation();`
  );
  await knex.schema.dropTableIfExists('stock_protection_policy_transitions');
  await knex.schema.dropTableIfExists('stock_protection_policies');
}
