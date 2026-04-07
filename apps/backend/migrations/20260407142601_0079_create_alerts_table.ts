import type { Knex } from 'knex';

/**
 * ALERTS TABLE
 * ------------
 * Persistent operator-facing signal inbox.
 *
 * PURPOSE:
 * - Unified surface for all system-generated signals
 * - Ranked by urgency and commercial impact
 * - Dismissible per operator session
 * - Source-agnostic: constraints, decisions, projection health
 *
 * INVARIANTS:
 * - One alert per (shop_id, alert_key) — alert_key is deterministic
 * - Alerts are upserted, not duplicated
 * - resolved_at set when signal clears — UI auto-dismisses
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('alerts', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));

    table.integer('shop_id').notNullable();

    /**
     * DETERMINISTIC ALERT KEY
     * -----------------------
     * Uniqueness anchor per shop.
     * Format: {source}:{entity_id}:{alert_type}
     * Example: constraint:order-uuid:operational
     *          snapshot:shop-1:sla_risk
     */
    table.string('alert_key').notNullable();
    table.unique(['shop_id', 'alert_key']);

    /**
     * ALERT CLASSIFICATION
     * --------------------
     * source: where the signal originated
     * alert_type: what kind of signal it is
     */
    table.string('source').notNullable();
    // constraint | decision | snapshot | projection_health
    table.string('alert_type').notNullable();
    // sla_breach | inventory_short | customer_block | revenue_at_risk | system_degraded

    /**
     * SEVERITY
     * --------
     * critical | warning | info
     * Maps to UI color and ordering
     */
    table.string('severity').notNullable().defaultTo('warning');

    /**
     * OPERATOR-FACING CONTENT
     * -----------------------
     * title: short, operator-vocabulary label
     * message: one-sentence explanation
     */
    table.string('title').notNullable();
    table.text('message').notNullable();

    /**
     * ENTITY CONTEXT
     * --------------
     * Optional reference to the affected entity (order, shop, etc.)
     */
    table.string('entity_id').nullable();
    table.string('entity_type').nullable(); // order | shop | variant

    /**
     * COMMERCIAL SIGNAL
     * -----------------
     * Revenue impact if available — used for ranking
     */
    table.decimal('revenue_impact', 14, 2).nullable();

    /**
     * LIFECYCLE
     * ---------
     * is_active: false when signal clears (auto-resolved)
     * dismissed_at: operator manually dismissed
     * resolved_at: system determined signal no longer applies
     */
    table.boolean('is_active').notNullable().defaultTo(true);
    table.timestamp('dismissed_at', { useTz: true }).nullable();
    table.timestamp('resolved_at', { useTz: true }).nullable();

    table.timestamp('created_at', { useTz: true })
      .notNullable()
      .defaultTo(knex.fn.now());
    table.timestamp('updated_at', { useTz: true })
      .notNullable()
      .defaultTo(knex.fn.now());

    table.index(['shop_id', 'is_active'], 'idx_alerts_shop_active');
    table.index(['shop_id', 'severity'], 'idx_alerts_shop_severity');
  });

  /**
   * RLS (MANDATORY)
   * ---------------
   * Canonical variable: app.current_tenant::int
   */
  await knex.raw(`
    ALTER TABLE alerts ENABLE ROW LEVEL SECURITY;
  `);

  await knex.raw(`
    CREATE POLICY alerts_tenant_isolation
    ON alerts
    USING (shop_id = current_setting('app.current_tenant')::int)
    WITH CHECK (shop_id = current_setting('app.current_tenant')::int);
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw(`DROP POLICY IF EXISTS alerts_tenant_isolation ON alerts;`);
  await knex.schema.dropTableIfExists('alerts');
}