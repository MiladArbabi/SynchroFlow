import { Knex } from 'knex';

/**
 * MIGRATION 0193 — add_shop_wms_settings_bootstrap_model (GH-1145-A1)
 * ----------------------------------------------------------------------------
 * Introduces `shop_wms_settings.bootstrap_model`, the canonical,
 * immutable-once-set classification of how a tenant's opening inventory was
 * established:
 *
 *   legacy_opening_balance_v1        — every tenant that exists when this
 *                                       migration runs. Its Shopify
 *                                       opening_balance movements keep their
 *                                       current physical semantics until A2
 *                                       provides physical verification.
 *   reconcile_opening_expectation_v2 — tenants provisioned after this
 *                                       migration. Shopify inventoryQuantity
 *                                       is captured as an opening EXPECTATION
 *                                       only (migration 0194) and never
 *                                       becomes physical capacity.
 *
 * The value is NOT inferred from stock, inventory_movements, opening_balance
 * presence or sync status: every existing row (and every shop lacking one,
 * step 2) is unconditionally legacy. This migration zeroes nothing and
 * back-fills no inventory — legacy capacity is untouched.
 *
 * NO DEFAULT: every application write path that provisions a new
 * shop_wms_settings row must name the model explicitly. A path that forgets
 * fails loudly (NOT NULL violation) instead of silently becoming legacy.
 *
 * STEP ORDER
 *   1. Add the column NULLABLE, no default.
 *   2. Create shop_wms_settings rows for shops that predate any provisioning
 *      write (shops has no FK/trigger guaranteeing a row; ISSUE-12).
 *   3. Classify every existing row legacy_opening_balance_v1.
 *   4. NOT NULL.
 *   5. CHECK — exactly the two canonical values.
 *   6. Immutable once set — same single-column BEFORE UPDATE OF shape as
 *      migration 0179 (purchase_orders_prevent_po_number_update). Every other
 *      shop_wms_settings column stays freely mutable.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('shop_wms_settings', (table) => {
    table.string('bootstrap_model', 64).nullable();
  });

  // All non-PK columns carry NOT NULL DEFAULTs (0087/0153), so a bare
  // (shop_id) insert is schema-safe while bootstrap_model is still nullable.
  await knex.raw(`
    INSERT INTO public.shop_wms_settings (shop_id)
    SELECT s.id
    FROM public.shops AS s
    LEFT JOIN public.shop_wms_settings AS sws ON sws.shop_id = s.id
    WHERE sws.shop_id IS NULL;
  `);

  await knex.raw(`
    UPDATE public.shop_wms_settings
    SET bootstrap_model = 'legacy_opening_balance_v1'
    WHERE bootstrap_model IS NULL;
  `);

  await knex.raw(`
    ALTER TABLE public.shop_wms_settings
      ALTER COLUMN bootstrap_model SET NOT NULL;
  `);

  await knex.raw(`
    ALTER TABLE public.shop_wms_settings
      ADD CONSTRAINT shop_wms_settings_bootstrap_model_check
      CHECK (bootstrap_model IN ('legacy_opening_balance_v1', 'reconcile_opening_expectation_v2'));
  `);

  await knex.raw(`
    CREATE OR REPLACE FUNCTION prevent_shop_wms_settings_bootstrap_model_update()
    RETURNS trigger AS $$
    BEGIN
      IF NEW.bootstrap_model IS DISTINCT FROM OLD.bootstrap_model THEN
        RAISE EXCEPTION 'shop_wms_settings.bootstrap_model is immutable'
          USING ERRCODE = '23514';
      END IF;

      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;
  `);

  await knex.raw(`
    DROP TRIGGER IF EXISTS shop_wms_settings_prevent_bootstrap_model_update ON shop_wms_settings;
    CREATE TRIGGER shop_wms_settings_prevent_bootstrap_model_update
      BEFORE UPDATE OF bootstrap_model ON shop_wms_settings
      FOR EACH ROW
      EXECUTE FUNCTION prevent_shop_wms_settings_bootstrap_model_update();
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw(`
    DROP TRIGGER IF EXISTS shop_wms_settings_prevent_bootstrap_model_update ON shop_wms_settings;
    DROP FUNCTION IF EXISTS prevent_shop_wms_settings_bootstrap_model_update();
  `);

  await knex.raw(`
    ALTER TABLE public.shop_wms_settings
      DROP CONSTRAINT IF EXISTS shop_wms_settings_bootstrap_model_check;
  `);

  await knex.schema.alterTable('shop_wms_settings', (table) => {
    table.dropColumn('bootstrap_model');
  });

  // Rows created in up() step 2 are intentionally kept: down is schema
  // reversal only (same convention as 0179 down).
}
