import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {

  // 1. Drop legacy FK safely
  await knex.raw(`
    ALTER TABLE order_line_items
    DROP CONSTRAINT IF EXISTS order_line_items_platform_order_id_foreign;
  `);

  // 2. Add sovereign column if missing
  await knex.schema.alterTable('order_line_items', (table) => {
    table.uuid('lasyncro_order_id').nullable();
  });

  // 3. Add sovereign FK
  await knex.raw(`
    ALTER TABLE order_line_items
    ADD CONSTRAINT fk_order_line_items_lasyncro
    FOREIGN KEY (lasyncro_order_id)
    REFERENCES orders_v2(lasyncro_order_id)
    ON DELETE CASCADE;
  `);
}

export async function down(): Promise<void> {}
