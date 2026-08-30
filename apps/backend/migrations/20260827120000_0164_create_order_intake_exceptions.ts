import type { Knex } from 'knex';

/**
 * MIGRATION 0164 — create_order_intake_exceptions
 * ----------------------------------------------------------------------------
 * SHOP-REVIEW-ORDER-INTAKE-CLASSIFICATION-10.
 *
 * Records why a Shopify record that WAS persisted as an `orders` row could not
 * be represented as a warehouse-executable laSyncro order. This is the INTAKE
 * boundary — it is NOT an operational blocker:
 *
 *   - order_constraints  -> a VALID WMS order with an actionable fulfillment
 *                           obligation (oversell / incomplete_address).
 *   - order_intake_exceptions (this table)
 *                        -> a source/system condition preventing a safe WMS
 *                           representation at all.
 *
 * One row PER ORDER (order-level result), keyed by lasyncro_order_id so
 * projection replay upserts idempotently and can never duplicate.
 *
 * `domain_event_projection_failures` (0154) was deliberately NOT reused: it is
 * truncated on every rebuild, is keyed to a FAILED projection event, and
 * describes the current replay — none of which fits an order that projected
 * successfully but is non-WMS-capable.
 *
 * Slice A's EXISTS(usable WMS line) predicate remains the authoritative
 * defense-in-depth for Order Pool correctness; this table is the explicit
 * "why", plus (Slice B, PART 9) the fail-closed exclusion of partially-mapped
 * orders via `resolved_at IS NULL`.
 *
 * Carries the standard forced tenant RLS policy (it holds shop_id), matching
 * migration 0142 (pick_reservation_allocations).
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('order_intake_exceptions', (table) => {
    // Order-level: exactly one intake-exception result per order.
    table
      .uuid('lasyncro_order_id')
      .primary()
      .notNullable()
      .references('lasyncro_order_id')
      .inTable('orders')
      .onDelete('CASCADE');

    table
      .integer('shop_id')
      .notNullable()
      .references('id')
      .inTable('shops')
      .onDelete('CASCADE');

    /**
     * exception_kind — typed, narrow:
     *   SOURCE_NON_WMS           Shopify supplied a legitimate line/order shape
     *                            with no warehouse identity (custom line,
     *                            deleted variant represented as variant:null).
     *   INGESTION_INTEGRITY_ERROR laSyncro could not safely resolve/project a
     *                            variant identity Shopify DID supply. (Diagnostic
     *                            only in Slice B — those paths stay fail-closed
     *                            and roll back, so no row is written for them
     *                            yet; the value exists for a later slice.)
     */
    table.text('exception_kind').notNullable();

    /**
     * reason_code — typed, narrow:
     *   NO_USABLE_WMS_LINES   every source line was dropped; zero usable lines.
     *   PARTIALLY_MAPPED      some source lines mapped, at least one did not.
     */
    table.text('reason_code').notNullable();

    table.integer('source_line_count').notNullable();
    table.integer('usable_line_count').notNullable();

    // Small diagnostic breakdown (per-line reason counts). No Shopify PII.
    table.jsonb('detail').notNullable().defaultTo('{}');

    table
      .timestamp('created_at', { useTz: true })
      .notNullable()
      .defaultTo(knex.fn.now());
    table
      .timestamp('updated_at', { useTz: true })
      .notNullable()
      .defaultTo(knex.fn.now());

    // Resolution is a later-slice / manual-reconciliation concern. Slice B
    // never auto-resolves; `resolved_at IS NULL` == active exception.
    table.timestamp('resolved_at', { useTz: true }).nullable();

    table.index(['shop_id'], 'order_intake_exceptions_shop_idx');
    table.index(
      ['shop_id', 'resolved_at'],
      'order_intake_exceptions_shop_active_idx'
    );
  });

  await knex.raw(`
    ALTER TABLE order_intake_exceptions
      ADD CONSTRAINT order_intake_exceptions_counts_nonneg
      CHECK (source_line_count >= 0 AND usable_line_count >= 0);

    ALTER TABLE order_intake_exceptions
      ENABLE ROW LEVEL SECURITY;

    ALTER TABLE order_intake_exceptions
      FORCE ROW LEVEL SECURITY;

    CREATE POLICY order_intake_exceptions_tenant_isolation_policy
      ON order_intake_exceptions
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
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('order_intake_exceptions');
}
