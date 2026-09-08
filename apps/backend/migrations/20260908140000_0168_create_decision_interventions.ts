import type { Knex } from 'knex';

/**
 * MIGRATION 0168 — create_decision_interventions
 * ----------------------------------------------------------------------------
 * OUTCOME-ATTR-01 — durable decision intervention provenance.
 *
 * GOVERNING INVARIANT
 *   execution success != treatment success != operational outcome
 *
 * A decision_execution_queue row reaching 'success' means a handler ran. An
 * operator saving a corrected address means a treatment was APPLIED. Neither is
 * evidence that the merchant's operational problem is gone.
 *
 * This table records only the first two facts: that a specific treatment was
 * applied, by whom, from where, with what provenance, against which exact
 * constraint. It deliberately carries NO outcome/status column — an outcome
 * stored here would be a claim, and claims rot. Canonical outcome authority
 * remains order_constraints.is_active / order_constraints.resolved_at, and the
 * outcome is DERIVED at read time by correlating constraint_id
 * (see apps/backend/src/services/decision/interventionOutcome.service.ts).
 *
 * Generic by design. The address pilot (customer/incomplete_address) is the
 * first writer, but nothing here is address-specific: treatment_key /
 * action_key name the treatment vocabulary, and correction provenance lives in
 * `metadata` rather than in a bespoke column. SLA and inventory attribution are
 * later slices and add no schema.
 *
 * constraint_id is nullable at the SCHEMA level (a future treatment may not be
 * constraint-backed) but is REQUIRED by application logic for this pilot: an
 * intervention is written only when an exact active constraint was found.
 *
 * NO FOREIGN KEY ON constraint_id — deliberate. order_constraints cascades from
 * orders, so an FK here would silently destroy intervention audit history the
 * moment an order row is removed. Provenance that can be erased by unrelated
 * data lifecycle is not provenance; the UUID is retained as immutable evidence,
 * and the read model treats a missing constraint as 'unknown' rather than
 * pretending. decision_id is likewise a free UUID: an intervention does NOT
 * require a decisions row, and decision lifecycle is not outcome authority.
 *
 * Carries the standard forced tenant RLS policy (it holds shop_id), matching
 * migration 0167 (shop_subscription_transitions) and 0164
 * (order_intake_exceptions). Table privileges come from the schema-wide default
 * privileges established in 0105.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('decision_interventions', (table) => {
    table.uuid('id').primary();

    table
      .integer('shop_id')
      .notNullable()
      .references('id')
      .inTable('shops')
      .onDelete('CASCADE');

    /**
     * Entity the treatment was applied to. Generic on purpose:
     * entity_type 'order' + entity_id lasyncro_order_id today; nothing stops a
     * later slice recording an intervention against another entity kind.
     * entity_id is text (not a typed FK) so this ledger never becomes
     * order-shaped, and so history survives entity deletion.
     */
    table.text('entity_type').notNullable();
    table.text('entity_id').notNullable();

    // The EXACT canonical constraint this intervention is attributed to.
    // See header: intentionally no FK.
    table.uuid('constraint_id').nullable();

    // Optional decision correlation. An intervention never requires one.
    table.uuid('decision_id').nullable();

    /**
     * Treatment vocabulary.
     *   treatment_key — what kind of remediation was applied
     *                   (address pilot: 'address_correction')
     *   action_key    — the concrete action taken
     *                   (address pilot: 'update_shipping_address')
     */
    table.text('treatment_key').notNullable();
    table.text('action_key').notNullable();

    /**
     * Actor provenance. actor_type is mandatory ('user' | 'system' | ...);
     * actor_user_id is nullable because non-human actors have none.
     */
    table.text('actor_type').notNullable();
    table.integer('actor_user_id').nullable();

    // Where the operator acted, e.g. 'order_detail_shipping_address_dialog'.
    table.text('source_surface').notNullable();

    // When the treatment was applied (the write's own transaction clock).
    table.timestamp('occurred_at', { useTz: true }).notNullable();

    /**
     * Treatment-specific provenance. For the address pilot this holds
     * correction_source ('manual' | 'historical_address_assist') — HOW the
     * operator arrived at the value they saved. Diagnostic provenance only;
     * never an outcome, never an entitlement or constraint input.
     */
    table.jsonb('metadata').notNullable().defaultTo('{}');

    table
      .timestamp('created_at', { useTz: true })
      .notNullable()
      .defaultTo(knex.fn.now());

    // Primary read path: every intervention for one entity, in one tenant.
    table.index(
      ['shop_id', 'entity_type', 'entity_id'],
      'decision_interventions_shop_entity_idx'
    );
    // Attribution correlation by exact constraint.
    table.index(['constraint_id'], 'decision_interventions_constraint_idx');
    // Chronological sweeps within a tenant.
    table.index(
      ['shop_id', 'occurred_at'],
      'decision_interventions_shop_occurred_idx'
    );
  });

  await knex.raw(`
    ALTER TABLE decision_interventions
      ENABLE ROW LEVEL SECURITY;

    ALTER TABLE decision_interventions
      FORCE ROW LEVEL SECURITY;

    CREATE POLICY decision_interventions_tenant_isolation_policy
      ON decision_interventions
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
   * HARD APPEND-ONLY GUARD
   * ----------------------
   * Provenance that can be rewritten is not provenance. UPDATE is rejected at
   * the database level for every role — there is no legitimate reason to
   * restate what an operator did.
   *
   * DELETE is deliberately NOT blocked: shop_id cascades from shops, and a
   * genuine tenant erasure (uninstall/GDPR) must not be wedged by this ledger.
   * Mirrors the immutability trigger pattern of 0018 / 0167, narrowed to the
   * mutation that would actually falsify history.
   */
  await knex.raw(`
    CREATE OR REPLACE FUNCTION prevent_decision_intervention_mutation()
    RETURNS trigger AS $$
    BEGIN
      RAISE EXCEPTION
        '[IMMUTABILITY_VIOLATION] decision_interventions is append-only. % is not allowed.',
        TG_OP;
    END;
    $$ LANGUAGE plpgsql;
  `);

  await knex.raw(`
    CREATE TRIGGER decision_interventions_no_update
    BEFORE UPDATE ON decision_interventions
    FOR EACH ROW EXECUTE FUNCTION prevent_decision_intervention_mutation();
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw(`
    DROP TRIGGER IF EXISTS decision_interventions_no_update
      ON decision_interventions;
  `);
  await knex.raw(
    `DROP FUNCTION IF EXISTS prevent_decision_intervention_mutation();`
  );
  await knex.schema.dropTableIfExists('decision_interventions');
}
