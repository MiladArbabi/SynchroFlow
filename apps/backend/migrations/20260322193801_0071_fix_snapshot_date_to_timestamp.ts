import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('orders_operational_control_snapshot', (table) => {
    table.timestamp('snapshot_date_tmp', { useTz: true });
  });

  await knex.raw(`
    UPDATE orders_operational_control_snapshot
    SET snapshot_date_tmp = snapshot_date::timestamp
  `);

  await knex.schema.alterTable('orders_operational_control_snapshot', (table) => {
    table.dropColumn('snapshot_date');
  });

  await knex.schema.alterTable('orders_operational_control_snapshot', (table) => {
    table.renameColumn('snapshot_date_tmp', 'snapshot_date');
  });

  /**
   * RECREATE UNIQUE CONSTRAINT
   */
  await knex.raw(`
    ALTER TABLE orders_operational_control_snapshot
    ADD CONSTRAINT orders_operational_control_snapshot_unique
    UNIQUE (shop_id, snapshot_date)
  `);
}

export async function down(knex: Knex): Promise<void> {
  throw new Error('Irreversible migration');
}