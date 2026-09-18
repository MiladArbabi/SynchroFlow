import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('purchase_orders', (table) => {
    table.integer('po_number').nullable();
  });

  await knex.raw(`
    WITH numbered AS (
      SELECT
        id,
        1000 + ROW_NUMBER() OVER (
          PARTITION BY shop_id
          ORDER BY created_at, id
        ) AS po_number
      FROM purchase_orders
      WHERE po_number IS NULL
    )
    UPDATE purchase_orders AS po
    SET po_number = numbered.po_number
    FROM numbered
    WHERE po.id = numbered.id;
  `);

  await knex.raw(`
    CREATE OR REPLACE FUNCTION assign_purchase_order_po_number()
    RETURNS trigger AS $$
    BEGIN
      IF NEW.po_number IS NULL THEN
        PERFORM pg_advisory_xact_lock(
          hashtext('lasyncro.purchase_orders.po_number'),
          NEW.shop_id
        );

        SELECT GREATEST(1001, COALESCE(MAX(po_number), 1000) + 1)
        INTO NEW.po_number
        FROM purchase_orders
        WHERE shop_id = NEW.shop_id;
      END IF;

      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;
  `);

  await knex.raw(`
    CREATE OR REPLACE FUNCTION prevent_purchase_order_po_number_update()
    RETURNS trigger AS $$
    BEGIN
      IF NEW.po_number IS DISTINCT FROM OLD.po_number THEN
        RAISE EXCEPTION 'purchase_orders.po_number is immutable'
          USING ERRCODE = '23514';
      END IF;

      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;
  `);

  await knex.raw(`
    DROP TRIGGER IF EXISTS purchase_orders_assign_po_number ON purchase_orders;
    CREATE TRIGGER purchase_orders_assign_po_number
      BEFORE INSERT ON purchase_orders
      FOR EACH ROW
      EXECUTE FUNCTION assign_purchase_order_po_number();
  `);

  await knex.raw(`
    DROP TRIGGER IF EXISTS purchase_orders_prevent_po_number_update ON purchase_orders;
    CREATE TRIGGER purchase_orders_prevent_po_number_update
      BEFORE UPDATE OF po_number ON purchase_orders
      FOR EACH ROW
      EXECUTE FUNCTION prevent_purchase_order_po_number_update();
  `);

  await knex.raw(`
    ALTER TABLE purchase_orders
      ALTER COLUMN po_number SET NOT NULL;
  `);

  await knex.raw(`
    CREATE UNIQUE INDEX IF NOT EXISTS purchase_orders_shop_po_number_unique
      ON purchase_orders (shop_id, po_number);
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw(`
    DROP TRIGGER IF EXISTS purchase_orders_prevent_po_number_update ON purchase_orders;
    DROP TRIGGER IF EXISTS purchase_orders_assign_po_number ON purchase_orders;
    DROP FUNCTION IF EXISTS prevent_purchase_order_po_number_update();
    DROP FUNCTION IF EXISTS assign_purchase_order_po_number();
    DROP INDEX IF EXISTS purchase_orders_shop_po_number_unique;
  `);

  await knex.schema.alterTable('purchase_orders', (table) => {
    table.dropColumn('po_number');
  });
}
