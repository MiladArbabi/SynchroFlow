import type { Knex } from 'knex';

// One Pick quantity action owns child evidence for the exact LSUs it affected.
// Batch, line, variant and allocation authority remain on the parent action.
export async function up(knex: Knex): Promise<void> {
  await knex.raw(`
    ALTER TABLE pick_scan_log ADD CONSTRAINT pick_scan_log_scan_shop_unique
      UNIQUE (scan_id, shop_id);
    ALTER TABLE inventory_units ADD CONSTRAINT inventory_units_shop_unit_unique
      UNIQUE (shop_id, lasyncro_unit_id);

    CREATE TABLE pick_scan_unit_lineage (
      scan_id uuid NOT NULL,
      shop_id integer NOT NULL,
      lasyncro_unit_id varchar(20) NOT NULL,
      PRIMARY KEY (scan_id, lasyncro_unit_id),
      FOREIGN KEY (scan_id, shop_id)
        REFERENCES pick_scan_log (scan_id, shop_id) ON DELETE RESTRICT,
      FOREIGN KEY (shop_id, lasyncro_unit_id)
        REFERENCES inventory_units (shop_id, lasyncro_unit_id) ON DELETE RESTRICT
    );
    CREATE INDEX pick_scan_unit_lineage_shop_unit_idx
      ON pick_scan_unit_lineage (shop_id, lasyncro_unit_id);
    ALTER TABLE pick_scan_unit_lineage ENABLE ROW LEVEL SECURITY;
    ALTER TABLE pick_scan_unit_lineage FORCE ROW LEVEL SECURITY;
    CREATE POLICY pick_scan_unit_lineage_tenant_isolation_policy
      ON pick_scan_unit_lineage
      USING (shop_id = current_setting('app.current_tenant')::int)
      WITH CHECK (shop_id = current_setting('app.current_tenant')::int);
    CREATE TRIGGER pick_scan_unit_lineage_no_update
      BEFORE UPDATE ON pick_scan_unit_lineage
      FOR EACH ROW EXECUTE FUNCTION prevent_pick_scan_log_mutation();
    CREATE TRIGGER pick_scan_unit_lineage_no_delete
      BEFORE DELETE ON pick_scan_unit_lineage
      FOR EACH ROW EXECUTE FUNCTION prevent_pick_scan_log_mutation();
    GRANT SELECT, INSERT ON pick_scan_unit_lineage TO sf_app;
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTable('pick_scan_unit_lineage');
  await knex.raw(`
    ALTER TABLE inventory_units DROP CONSTRAINT inventory_units_shop_unit_unique;
    ALTER TABLE pick_scan_log DROP CONSTRAINT pick_scan_log_scan_shop_unique;
  `);
}
