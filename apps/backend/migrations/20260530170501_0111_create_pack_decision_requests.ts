import type { Knex } from 'knex';

/**
 * PACK DECISION REQUESTS
 * ----------------------
 * Persistent decision request raised by a packer when a blocking
 * exception (item_missing, short_pick) cannot self-resolve.
 *
 * PROBLEM:
 * Previously item_missing/short_pick silently advanced the pack job
 * with partial_shipment=false hardcoded. Owner was never consulted.
 *
 * SOLUTION:
 * Packer raises a PackDecisionRequest → pack job pauses on that order
 * → owner notified (push + Alert) → owner approves (ship_partial) or
 * rejects (hold + requeue) → packer gets green light or instruction.
 *
 * INVARIANTS:
 * - One pending request per (shop_id, pick_batch_id, lasyncro_order_id)
 *   at a time — prevents duplicate blocking requests on same order.
 * - resolved_by / resolved_at / note nullable until owner acts.
 * - partial_shipment nullable — set by owner on approval only.
 *
 * LIFECYCLE:
 *   pending → approved (ship_partial=true|false) | rejected (requeue)
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('pack_decision_requests', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.integer('shop_id').notNullable();

    /**
     * CONTEXT
     * -------
     * Ties the decision to its exact pack job + order + affected line.
     */
    table.uuid('pick_batch_id').notNullable();
    // references pick_batches.pick_batch_id
    table.uuid('lasyncro_order_id').notNullable();
    // references orders.lasyncro_order_id
    table.uuid('lasyncro_line_item_id').notNullable();
    // the specific line that triggered the decision request

    /**
     * EXCEPTION CONTEXT
     * -----------------
     * exception_type: what the packer found
     * question: what decision the owner must make
     */
    table.string('exception_type').notNullable();
    // item_missing | short_pick
    table.string('question').notNullable();
    // ship_partial | hold_and_requeue

    /**
     * LIFECYCLE
     * ---------
     * status drives pack job gate:
     *   pending  → pack job paused, owner notified
     *   approved → packer gets green light (partial_shipment set)
     *   rejected → order removed from batch, re-queued
     */
    table.string('status').notNullable().defaultTo('pending');
    // pending | approved | rejected

    /**
     * PARTIAL SHIPMENT DECISION
     * -------------------------
     * Set by owner on approval:
     *   true  → ship without missing item
     *   false → wait (effectively same as rejected for current batch)
     * Null until owner resolves.
     */
    table.boolean('partial_shipment').nullable();

    /**
     * AUDIT
     * -----
     * Full trace of who raised and who resolved.
     */
    table.integer('raised_by').notNullable();
    // references users.id
    table.timestamp('raised_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.integer('resolved_by').nullable();
    // references users.id — null until resolved
    table.timestamp('resolved_at', { useTz: true }).nullable();
    table.text('note').nullable();
    // owner's optional instruction to packer

    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    /**
     * UNIQUENESS
     * ----------
     * One pending request per order per batch.
     * Prevents packer raising duplicate blocking requests.
     */
    table.unique(
      ['shop_id', 'pick_batch_id', 'lasyncro_order_id', 'lasyncro_line_item_id'],
      { indexName: 'uq_pack_decision_per_order_line' }
    );

    table.index(['shop_id', 'status'],         'idx_pack_decision_shop_status');
    table.index(['pick_batch_id', 'status'],   'idx_pack_decision_batch_status');
    table.index(['lasyncro_order_id'],          'idx_pack_decision_order');
  });

  /**
   * RLS — tenant isolation
   * Canonical variable: app.current_tenant::int
   */
  await knex.raw(`ALTER TABLE pack_decision_requests ENABLE ROW LEVEL SECURITY;`);
  await knex.raw(`
    CREATE POLICY pack_decision_requests_tenant_isolation
    ON pack_decision_requests
    USING (shop_id = current_setting('app.current_tenant')::int)
    WITH CHECK (shop_id = current_setting('app.current_tenant')::int);
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw(`DROP POLICY IF EXISTS pack_decision_requests_tenant_isolation ON pack_decision_requests;`);
  await knex.schema.dropTableIfExists('pack_decision_requests');
}