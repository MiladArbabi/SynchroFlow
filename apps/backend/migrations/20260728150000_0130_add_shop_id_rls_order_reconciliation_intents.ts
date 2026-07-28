import { Knex } from 'knex';

/**
 * MIGRATION 0130 — add_shop_id_rls_order_reconciliation_intents
 * -----------------------------------------------------------------
 * DRIFT-AUDIT-01 forward fix. Migration 0037 (batch 1, ran 2026-06-18)
 * originally created order_reconciliation_intents with NO shop_id
 * column and NO RLS at all. On 2026-06-29 a real incident occurred:
 * the projection worker's cross-tenant poll (Step 4) silently
 * returned zero rows because there was no way to distinguish "no
 * pending work" from "RLS blocked everything" — intents piled up
 * indefinitely with no error. The fix (shop_id column + split
 * select/write RLS policies, allowing untenanted cross-tenant SELECT
 * for the poll while strictly scoping writes) was written into 0037's
 * file after that migration had already run in prod. Knex marked
 * 0037 complete and silently skipped the amendment — shop_id was
 * never added to prod, and RLS was never enabled.
 *
 * Confirmed via schema diff (DRIFT-AUDIT-01, 2026-07-28): prod's
 * order_reconciliation_intents has no shop_id column and no RLS.
 * Table currently has 0 rows in prod — no backfill needed — but
 * orders.create.ts (as of commit 697ad547, 2026-06-30) unconditionally
 * writes shop_id on every insert, which will fail with "column
 * shop_id does not exist" the moment the next real order is created.
 * This is a live, unfired bug — not yet triggered only because no
 * order has been created in prod since before this code existed.
 *
 * See order_reconciliation_intents' own comments in 0037 for the
 * full policy design rationale (permissive SELECT for the cross-
 * tenant poll, strict write policy).
 */
export async function up(knex: Knex): Promise<void> {
  const hasShopId = await knex.schema.hasColumn('order_reconciliation_intents', 'shop_id');

  if (!hasShopId) {
    await knex.schema.alterTable('order_reconciliation_intents', (table) => {
      table
        .integer('shop_id')
        .references('id')
        .inTable('shops')
        .onDelete('CASCADE');
    });

    // Table has 0 rows in prod (verified 2026-07-28) — safe to enforce
    // NOT NULL immediately without a backfill step.
    await knex.schema.alterTable('order_reconciliation_intents', (table) => {
      table.integer('shop_id').notNullable().alter();
    });

    await knex.schema.alterTable('order_reconciliation_intents', (table) => {
      table.index(['shop_id']);
    });
  }

  await knex.raw(`
    ALTER TABLE order_reconciliation_intents ENABLE ROW LEVEL SECURITY;
    ALTER TABLE order_reconciliation_intents FORCE ROW LEVEL SECURITY;
  `);

  await knex.raw(`
    DROP POLICY IF EXISTS order_reconciliation_intents_tenant_isolation_policy ON order_reconciliation_intents;
    DROP POLICY IF EXISTS order_reconciliation_intents_select_policy ON order_reconciliation_intents;
    DROP POLICY IF EXISTS order_reconciliation_intents_write_policy ON order_reconciliation_intents;
  `);

  await knex.raw(`
    CREATE POLICY order_reconciliation_intents_select_policy
    ON order_reconciliation_intents FOR SELECT
    USING (
      shop_id = current_setting('app.current_tenant', true)::int
      OR current_setting('app.current_tenant', true) IN ('', '0')
      OR current_setting('app.current_tenant', true) IS NULL
    );
  `);

  await knex.raw(`
    CREATE POLICY order_reconciliation_intents_write_policy
    ON order_reconciliation_intents FOR ALL
    USING (shop_id = current_setting('app.current_tenant', true)::int)
    WITH CHECK (shop_id = current_setting('app.current_tenant', true)::int);
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw(`
    DROP POLICY IF EXISTS order_reconciliation_intents_select_policy ON order_reconciliation_intents;
    DROP POLICY IF EXISTS order_reconciliation_intents_write_policy ON order_reconciliation_intents;
  `);
  await knex.raw(`ALTER TABLE order_reconciliation_intents DISABLE ROW LEVEL SECURITY;`);

  const hasShopId = await knex.schema.hasColumn('order_reconciliation_intents', 'shop_id');
  if (hasShopId) {
    await knex.schema.alterTable('order_reconciliation_intents', (table) => {
      table.dropColumn('shop_id');
    });
  }
}
