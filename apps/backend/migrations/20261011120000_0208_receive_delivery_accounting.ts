import type { Knex } from 'knex';

/** GH-1245 / S2. Additive cutover: NULL is unknown legacy evidence.
 * No inferred physical/discrepancy backfill. Existing active duplicates fail
 * the unique-index gate rather than silently cancelling or merging history.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('purchase_order_line_items', (t) => {
    t.integer('quantity_pending_delivery').nullable();
  });
  await knex.schema.alterTable('receive_jobs', (t) => {
    t.integer('delivery_accounting_version').notNullable().defaultTo(1);
    // Provenance FKs follow 0097/0099: losing the actor never deletes the receipt.
    t.integer('closed_by').nullable().references('id').inTable('users').onDelete('SET NULL');
  });
  await knex.schema.alterTable('receive_job_lines', (t) => {
    t.integer('quantity_delivered').nullable();
    t.integer('quantity_missing').nullable();
    t.integer('quantity_deferred').nullable();
    t.integer('quantity_held_recoverable').nullable();
    t.integer('inspected_by').nullable().references('id').inTable('users').onDelete('SET NULL');
    t.uuid('inspection_device_event_id').nullable();
  });
  await knex.schema.alterTable('receive_exceptions', (t) => {
    t.uuid('device_event_id').nullable();
  });
  await knex.raw(`
    ALTER TABLE purchase_order_line_items ADD CONSTRAINT po_pending_delivery_nonnegative
      CHECK (quantity_pending_delivery IS NULL OR quantity_pending_delivery >= 0);
    ALTER TABLE receive_jobs ADD CONSTRAINT receive_accounting_version_valid
      CHECK (delivery_accounting_version IN (1, 2));
    ALTER TABLE receive_job_lines ADD CONSTRAINT receive_delivery_disposition_valid CHECK (
      (quantity_delivered IS NULL OR quantity_delivered >= 0)
      AND (quantity_missing IS NULL OR quantity_missing >= 0)
      AND (quantity_deferred IS NULL OR quantity_deferred >= 0)
      AND (quantity_held_recoverable IS NULL OR quantity_held_recoverable = 0)
      AND (quantity_delivered IS NULL OR (
        inspection_complete AND quantity_missing IS NOT NULL AND quantity_deferred IS NOT NULL
        AND quantity_held_recoverable IS NOT NULL AND quantity_accepted >= 0 AND quantity_rejected >= 0
        AND quantity_delivered = quantity_accepted + quantity_rejected + quantity_held_recoverable
        AND quantity_delivered + quantity_missing + quantity_deferred >= quantity_expected
      ))
    );
    CREATE UNIQUE INDEX receive_one_active_job_per_po ON receive_jobs (shop_id, po_id)
      WHERE status IN ('pending', 'in_progress', 'inspection', 'barcode_assignment', 'stow_ready');
    CREATE UNIQUE INDEX receive_exception_device_event_unique ON receive_exceptions (shop_id, device_event_id)
      WHERE device_event_id IS NOT NULL;
    CREATE UNIQUE INDEX receive_inspection_device_event_unique ON receive_job_lines (shop_id, inspection_device_event_id)
      WHERE inspection_device_event_id IS NOT NULL;
  `);
}

export async function down(knex: Knex): Promise<void> {
  // Durable delivery evidence wins over rollback convenience (0201-0203
  // precedent). Lock first so no evidence can be written between the check
  // and schema removal; row_security=off either exposes every tenant's rows
  // to the migration role or raises, never silently hides evidence behind
  // FORCE RLS. Any 0208-owned value beyond its legacy default is evidence —
  // v1 data is never reconstructed from it.
  await knex.raw(`
    LOCK TABLE receive_jobs, receive_job_lines, receive_exceptions, purchase_order_line_items
      IN ACCESS EXCLUSIVE MODE
  `);
  await knex.raw(`SET LOCAL row_security = off`);

  const result = await knex.raw(`
    SELECT (
      EXISTS (SELECT 1 FROM receive_jobs
               WHERE delivery_accounting_version <> 1 OR closed_by IS NOT NULL)
      OR EXISTS (SELECT 1 FROM receive_job_lines
               WHERE quantity_delivered IS NOT NULL OR quantity_missing IS NOT NULL
                  OR quantity_deferred IS NOT NULL OR quantity_held_recoverable IS NOT NULL
                  OR inspected_by IS NOT NULL OR inspection_device_event_id IS NOT NULL)
      OR EXISTS (SELECT 1 FROM receive_exceptions WHERE device_event_id IS NOT NULL)
      OR EXISTS (SELECT 1 FROM purchase_order_line_items WHERE quantity_pending_delivery IS NOT NULL)
    ) AS has_evidence
  `);

  if (Boolean(result.rows?.[0]?.has_evidence)) {
    throw new Error(
      '[RECEIVE_DELIVERY_ACCOUNTING_ROLLBACK_BLOCKED] persisted v2 Receive or pending-delivery evidence exists; 0208 cannot be removed'
    );
  }

  await knex.raw(`
    DROP INDEX receive_inspection_device_event_unique;
    DROP INDEX receive_exception_device_event_unique;
    DROP INDEX receive_one_active_job_per_po;
    ALTER TABLE receive_job_lines DROP CONSTRAINT receive_delivery_disposition_valid;
    ALTER TABLE receive_jobs DROP CONSTRAINT receive_accounting_version_valid;
    ALTER TABLE purchase_order_line_items DROP CONSTRAINT po_pending_delivery_nonnegative;
  `);
  await knex.schema.alterTable('receive_exceptions', (t) => t.dropColumn('device_event_id'));
  await knex.schema.alterTable('receive_job_lines', (t) => {
    t.dropColumns('quantity_delivered', 'quantity_missing', 'quantity_deferred', 'quantity_held_recoverable', 'inspected_by', 'inspection_device_event_id');
  });
  await knex.schema.alterTable('receive_jobs', (t) => t.dropColumns('delivery_accounting_version', 'closed_by'));
  await knex.schema.alterTable('purchase_order_line_items', (t) => t.dropColumn('quantity_pending_delivery'));
}
