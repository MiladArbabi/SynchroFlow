import type { Knex } from 'knex';

/**
 * GH-1262 S1 — Durable idempotency ledger for manual PO creation (E1).
 *
 * Ordered after 0219/0220 (GH-979, reserved) so the protected migration tail
 * stays strictly increasing; it touches no reconnect-authority object.
 *
 * One row per (tenant, Idempotency-Key): the canonical request fingerprint
 * and the purchase order that key created. Written in the SAME transaction as
 * the supplier, PO and lines, so a failed create leaves no ledger row. The
 * writer serializes per (tenant, key) with a transaction-level advisory lock
 * before any read or write; the unique constraint is the backstop.
 *
 * Retention: a key stays consumed after its purchase order is physically
 * deleted. purchase_order_id is nulled by the FK (ON DELETE SET NULL) and the
 * row survives, so a retry of that key is refused rather than re-creating
 * the PO. Deleting the shop still cascades the ledger away.
 *
 * Rows are immutable to the application: sf_app may only SELECT and INSERT.
 * The SET NULL is a referential action executed by PostgreSQL as the table
 * owner, not an sf_app UPDATE. Every access runs under FORCE RLS with
 * app.current_tenant.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('purchase_order_idempotency_keys', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.integer('shop_id').notNullable()
      .references('id').inTable('shops').onDelete('CASCADE');
    table.text('idempotency_key').notNullable();
    table.text('request_fingerprint').notNullable();
    table.uuid('purchase_order_id').nullable()
      .references('id').inTable('purchase_orders').onDelete('SET NULL');
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.unique(
      ['shop_id', 'idempotency_key'],
      'purchase_order_idempotency_keys_shop_key_unique'
    );
  });

  const tenantExpression = `
    shop_id = NULLIF(current_setting('app.current_tenant', true), '')::integer
    AND NULLIF(current_setting('app.current_tenant', true), '')::integer > 0
  `;

  await knex.raw(`
    ALTER TABLE purchase_order_idempotency_keys
      ADD CONSTRAINT purchase_order_idempotency_keys_key_length_check
      CHECK (char_length(idempotency_key) BETWEEN 1 AND 255);

    ALTER TABLE purchase_order_idempotency_keys
      ADD CONSTRAINT purchase_order_idempotency_keys_fingerprint_check
      CHECK (request_fingerprint ~ '^[0-9a-f]{64}$');

    CREATE INDEX purchase_order_idempotency_keys_po_idx
      ON purchase_order_idempotency_keys (purchase_order_id);

    ALTER TABLE purchase_order_idempotency_keys ENABLE ROW LEVEL SECURITY;
    ALTER TABLE purchase_order_idempotency_keys FORCE ROW LEVEL SECURITY;

    CREATE POLICY purchase_order_idempotency_keys_select_policy
      ON purchase_order_idempotency_keys FOR SELECT
      USING (${tenantExpression});

    CREATE POLICY purchase_order_idempotency_keys_insert_policy
      ON purchase_order_idempotency_keys FOR INSERT
      WITH CHECK (${tenantExpression});

    GRANT SELECT, INSERT ON purchase_order_idempotency_keys TO sf_app;
    REVOKE UPDATE, DELETE ON purchase_order_idempotency_keys FROM sf_app;
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('purchase_order_idempotency_keys');
}
