import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {

  /**
   * MIGRATION DEPRECATED (SCHEMA MOVED EARLIER)
   * -------------------------------------------
   * Originally introduced `lasyncro_variant_id`
   * on order_line_items.
   *
   * This column now exists in base migration:
   *
   * 0005_order_line_items_sovereign
   *
   * To preserve migration history while avoiding
   * duplicate column creation, this migration is
   * now intentionally a NO-OP.
   */

  return;
}

export async function down(knex: Knex): Promise<void> {

  /**
   * NO-OP
   * -----
   * Column removal handled by base migration.
   * This migration intentionally performs nothing.
   */

  return;
}